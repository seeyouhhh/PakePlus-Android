/**
 * api.js - API 调用封装
 * 支持 DeepSeek、硅基流动 (SiliconFlow) 以及智谱 BigModel 联网搜索
 */

const API = {
  // ===== Provider Configs =====
  providers: {
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      headers(key) {
        return {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        };
      },
    },
    silicon: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      headers(key) {
        return {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        };
      },
    },
  },

  // ===== Get active provider config =====
  _getConfig() {
    const provider = Storage.getActiveProvider();
    const key = Storage.getApiKey();
    const config = this.providers[provider];
    if (!config || !key) {
      throw new Error('请先配置 API Key');
    }
    return { ...config, key };
  },

  // ===== Call Chat API =====
  async _chat(messages, options = {}) {
    const config = this._getConfig();
    const {
      temperature = 0.8,
      maxTokens = 4096,
      onStream = null, // 流式回调
    } = options;

    const body = {
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };

    // 如果支持流式且有回调
    if (onStream) {
      body.stream = true;
    }

    const startTime = Date.now();

    // 记录请求日志 — 显示每条消息的角色和实际内容长度，而非仅截取200字符预览
    Logger.add(Logger.TYPE.CHAT_REQUEST, {
      model: config.model,
      temperature,
      maxTokens,
      messageCount: messages.length,
      totalContentLength: messages.reduce((sum, m) => sum + m.content.length, 0),
      messages: messages.map(m => ({
        role: m.role,
        contentLength: m.content.length,
        preview: m.content.slice(0, 500), // 扩展预览到500字符
      })),
    });

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: config.headers(config.key),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorMsg = `API 请求失败 (${response.status})`;
        try {
          const errBody = await response.json();
          errorMsg = errBody.error?.message || errorMsg;
        } catch {}
        Logger.add(Logger.TYPE.ERROR, {
          message: errorMsg,
          duration: Date.now() - startTime,
          model: config.model,
        });
        throw new Error(errorMsg);
      }

      // 流式处理
      if (onStream && response.body) {
        const result = await this._handleStream(response, onStream);
        Logger.add(Logger.TYPE.CHAT_RESPONSE, {
          model: config.model,
          contentLength: result.length,
          preview: result.slice(0, 200),
          duration: Date.now() - startTime,
        });
        return result;
      }

      // 非流式
      const data = await response.json();
      const content = data.choices[0].message.content;
      Logger.add(Logger.TYPE.CHAT_RESPONSE, {
        model: config.model,
        contentLength: content.length,
        preview: content.slice(0, 200),
        duration: Date.now() - startTime,
      });
      return content;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        Logger.add(Logger.TYPE.ERROR, {
          message: '网络连接失败',
          duration: Date.now() - startTime,
          model: config.model,
        });
        throw new Error('网络连接失败，请检查网络');
      }
      Logger.add(Logger.TYPE.ERROR, {
        message: err.message,
        duration: Date.now() - startTime,
        model: config.model,
      });
      throw err;
    }
  },

  // ===== Handle SSE Stream =====
  async _handleStream(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content || '';
          fullContent += content;
          onChunk(fullContent, content);
        } catch {}
      }
    }

    return fullContent;
  },

  // ===== Web Search (Zhipu BigModel Web Search - 直接调用) =====
  // 智谱 BigModel API 支持 CORS，可直接从浏览器调用，无需本地代理服务器

  // 解析智谱 Web Search API 响应
  // 返回格式: { analysis: string, items: Array<{index, title, summary, url, content}> }
  _parseSearchResults(data, query) {
    const result = {
      analysis: '',        // AI 对搜索主题的总结分析文本
      items: [],           // 结构化搜索结果条目
    };

    // 截断常数：调大以保留更完整的原文，同时避免超出 token 限制
    const MAX_SUMMARY_LEN = 3000;  // 摘要最大长度（原500）
    const MAX_CONTENT_LEN = 5000;  // 正文内容最大长度（原800）

    try {
      // === 1. 提取 AI 分析文本（choices[0].message.content）===
      let analysisText = '';
      if (data.choices && data.choices[0]) {
        const choice = data.choices[0];
        if (choice.message && choice.message.content) {
          analysisText = choice.message.content;
        } else if (choice.content) {
          analysisText = choice.content;
        }
      }
      // 后备：data.result.answer
      if (!analysisText && data.result && data.result.answer) {
        analysisText = data.result.answer;
      }
      // 后备：data.answer
      if (!analysisText && data.answer) {
        analysisText = data.answer;
      }
      result.analysis = analysisText.trim();

      // === 2. 提取结构化搜索结果条目 ===
      const seenUrls = new Set(); // 去重

      // 2a. 优先：search_result（智谱 API 最新结构化格式，包含标题/URL/摘要）
      if (data.search_result && Array.isArray(data.search_result)) {
        data.search_result.forEach((item, i) => {
          const url = item.link || item.url || '';
          const urlKey = url || `_internal_${i}`;
          if (url && seenUrls.has(urlKey)) return;
          seenUrls.add(urlKey);
          result.items.push({
            index: result.items.length + 1,
            title: item.title || `搜索结果 ${result.items.length + 1}`,
            summary: (item.content || item.summary || item.snippet || '').slice(0, MAX_SUMMARY_LEN),
            url: url,
            content: (item.content || item.summary || item.snippet || '').slice(0, MAX_CONTENT_LEN),
          });
        });
      }

      // 2b. 后备：citations
      if (result.items.length === 0 && data.citations && Array.isArray(data.citations)) {
        data.citations.forEach((item, i) => {
          const url = item.url || item.link || item.source || '';
          const urlKey = url || `_cit_${i}`;
          if (url && seenUrls.has(urlKey)) return;
          seenUrls.add(urlKey);
          result.items.push({
            index: result.items.length + 1,
            title: item.title || item.name || `搜索结果 ${result.items.length + 1}`,
            summary: item.summary || item.snippet || item.abstract || item.content || item.text || '',
            url: url,
            content: (item.content || item.summary || item.snippet || item.abstract || item.text || '').slice(0, MAX_CONTENT_LEN),
          });
        });
      }

      // 2c. 后备：result.items
      if (result.items.length === 0 && data.result && data.result.items && Array.isArray(data.result.items)) {
        data.result.items.forEach((item, i) => {
          const url = item.url || item.link || '';
          const urlKey = url || `_ritem_${i}`;
          if (url && seenUrls.has(urlKey)) return;
          seenUrls.add(urlKey);
          result.items.push({
            index: result.items.length + 1,
            title: item.title || item.name || `搜索结果 ${result.items.length + 1}`,
            summary: item.abstract || item.summary || item.snippet || item.content || item.text || '',
            url: url,
            content: (item.abstract || item.summary || item.snippet || item.content || item.text || '').slice(0, MAX_CONTENT_LEN),
          });
        });
      }

      // 2d. 后备：knowledge / sources
      if (result.items.length === 0 && data.knowledge && Array.isArray(data.knowledge)) {
        data.knowledge.forEach((item, i) => {
          const url = item.url || item.link || item.source || '';
          const urlKey = url || `_know_${i}`;
          if (url && seenUrls.has(urlKey)) return;
          seenUrls.add(urlKey);
          result.items.push({
            index: result.items.length + 1,
            title: item.title || item.name || `参考资料 ${result.items.length + 1}`,
            summary: item.summary || item.abstract || item.content || item.text || '',
            url: url,
            content: (item.summary || item.abstract || item.content || item.text || '').slice(0, MAX_CONTENT_LEN),
          });
        });
      }

      // === 3. 调试日志：输出实际响应结构 ===
      console.log('[调试] 搜索响应顶层键:', Object.keys(data).join(', '));
      console.log('[调试] AI 分析文本长度:', result.analysis.length);
      console.log('[调试] 结构化结果数量:', result.items.length);
      if (result.items.length > 0) {
        console.log('[调试] 第一条结果:', JSON.stringify(result.items[0]).slice(0, 200));
      }

      // 如果既没有 AI 分析文本也没有结构化结果，输出更多调试信息
      if (!result.analysis && result.items.length === 0) {
        console.log('[调试] 搜索响应完整结构:', JSON.stringify(data, null, 2).slice(0, 2000));
      }
    } catch (err) {
      console.warn('[解析] 解析搜索结果出错:', err.message);
    }

    return result;
  },

  async searchWeb(query) {
    const startTime = Date.now();
    Logger.add(Logger.TYPE.SEARCH_REQUEST, { query });

    const apiKey = Storage.getSearchApiKey();

    if (!apiKey) {
      Logger.add(Logger.TYPE.ERROR, {
        message: '未配置搜索 API Key',
        query,
        duration: Date.now() - startTime,
      });
      return [];
    }

    try {
      // 直接调用智谱 BigModel Web Search API（支持 CORS）
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/web_search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          search_query: query,
          search_engine: 'search_std',
          search_intent: false,
          count: 10,
          content_size: 'medium',
        }),
      });

      if (!response.ok) {
        let errorMsg = `搜索 API 请求失败 (${response.status})`;
        try {
          const errBody = await response.json();
          errorMsg = errBody.error?.message || errBody.error_msg || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      const data = await response.json();

      // 检查错误
      if (data.error_code) {
        throw new Error(`搜索失败: ${data.error_msg || data.error_code}`);
      }
      if (data.code && data.code !== 200 && data.code !== 0) {
        throw new Error(`搜索失败: ${data.message || data.code}`);
      }

      // 解析结果（新版：同时返回 AI 分析 + 结构化条目）
      const parsed = this._parseSearchResults(data, query);

      Logger.add(Logger.TYPE.SEARCH_RESPONSE, {
        query,
        resultCount: parsed.items.length,
        analysisLength: parsed.analysis.length,
        results: parsed.items.slice(0, 5),
        duration: Date.now() - startTime,
        note: '智谱 Web Search (直接调用)',
      });

      // 返回解析后的完整数据
      return parsed;
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        Logger.add(Logger.TYPE.ERROR, {
          message: '网络请求失败，请检查网络连接',
          query,
          duration: Date.now() - startTime,
        });
        throw new Error('网络请求失败，请检查网络连接');
      }
      Logger.add(Logger.TYPE.ERROR, {
        message: `搜索失败: ${err.message}`,
        query,
        duration: Date.now() - startTime,
      });
      throw err;
    }
  },

  // 判断是否需要搜索
  _shouldSearch() {
    return Storage.isWebSearchEnabled();
  },

  // ===== 系统提示词 =====

  _systemPrompt(scriptType, scriptFormat = '') {
    let prompt = `你是一位专业的剧本写作专家。请根据用户的需求提供专业的剧本创作服务。
当前剧本类型：${scriptType}
请始终保持专业、创意的写作风格。`;

    const scriptSetting = Storage.getScriptSetting();
    if (scriptSetting) {
      prompt += `\n\n剧本设定：\n${scriptSetting}`;
    }

    if (scriptFormat) {
      prompt += `\n\n【重要】剧本格式要求（必须严格遵守，不得自行添加除以下要求外的任何额外内容）：\n${scriptFormat}`;
    }

    return prompt;
  },

  // ===== 构建搜索上下文文本（同时包含 AI 分析和原始搜索结果）=====
  _buildSearchContext(searchResult) {
    if (!searchResult || (!searchResult.analysis && (!searchResult.items || searchResult.items.length === 0))) {
      return '';
    }

    const parts = [];

    // 1. AI 分析总结
    if (searchResult.analysis) {
      parts.push(`【AI 搜索结果分析总结】\n${searchResult.analysis}`);
    }

    // 2. 原始搜索结果条目（含标题、URL、摘要）
    if (searchResult.items && searchResult.items.length > 0) {
      const itemsText = searchResult.items.map(item => {
        const urlPart = item.url ? ` (来源: ${item.url})` : '';
        const summaryPart = item.content || item.summary || '';
        return `  ${item.index}. [${item.title}]${urlPart}\n     ${summaryPart}`;
      }).join('\n\n');
      parts.push(`【搜索结果原文详情（共${searchResult.items.length}条）】\n${itemsText}`);
    }

    return '\n\n' + parts.join('\n\n');
  },

  // ===== 0. 生成搜索关键词 =====
  async generateSearchKeywords(topic, scriptType) {
    const scriptSetting = Storage.getScriptSetting();
    let settingContext = '';
    if (scriptSetting) {
      settingContext = `\n剧本设定：\n${scriptSetting}`;
    }

    const messages = [
      {
        role: 'system',
        content: `你是一位专业的剧本创作策划专家。请根据用户提供的主题、剧本类型和剧本设定，思考适合用于联网搜索的关键词。
关键词用于搜索与剧本创作相关的素材资料，如相关历史事件、人物、文化背景、场景设定参考等。
请输出3-5个精准、有针对性、能搜索到有价值素材的关键词。
每个关键词应简洁明了，不要过长。`,
      },
      {
        role: 'user',
        content: `剧本主题：${topic}
剧本类型：${scriptType}${settingContext}

请根据以上信息，思考并输出3-5个适合联网搜索的关键词，用于搜索与这个剧本创作相关的素材资料。
关键词要精准、有针对性，能帮助找到有价值的创作素材。

请严格按照以下格式输出，不要有多余内容：
1. [关键词1]
2. [关键词2]
3. [关键词3]`,
      },
    ];

    const result = await this._chat(messages, { temperature: 0.7, maxTokens: 1024 });
    return this._parseNumberedList(result);
  },

  // ===== 1.5 生成素材搜索导向 =====
  async generateSearchOrientations(topic, angle, scriptType, existingOrientations = [], onStatus, onStream) {
    const scriptSetting = Storage.getScriptSetting();

    if (onStatus) {
      onStatus('thinking_orientations', '🤔 AI 正在思考素材搜索导向...');
    }

    const excluded = existingOrientations.length > 0
      ? `\n注意：以下搜索导向已经生成过，请勿重复生成：\n${existingOrientations.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
      : '';

    const messages = [
      {
        role: 'system',
        content: `你是一位专业的剧本创作策划专家。用户已经确定了一个剧本主题和一个创作切入点。
接下来需要为素材搜索提供精准的搜索导向（搜索方向）。每个搜索导向应该是一个具体、有针对性的搜索方向，用于在联网搜索中查找相关的素材资料。
搜索导向可以是：相关历史事件、人物背景、文化元素、场景设定参考、专业领域知识、类似作品分析等。`,
      },
      {
        role: 'user',
        content: `剧本主题：${topic}
切入点：${angle}
剧本类型：${scriptType}
${scriptSetting ? `剧本设定：\n${scriptSetting}` : ''}

请根据以上信息，生成5个不同的素材搜索导向。每个搜索导向应该是一个具体、有针对性的搜索方向，用于搜索与剧本创作相关的素材资料。
这些导向应当覆盖不同的维度，如：历史背景、人物原型、场景设定、文化元素、专业知识等。${excluded}

请严格按照以下格式输出，不要有多余内容：
1. [搜索导向1]
2. [搜索导向2]
3. [搜索导向3]
4. [搜索导向4]
5. [搜索导向5]`,
      },
    ];

    const result = await this._chat(messages, { temperature: 0.8, maxTokens: 1024, onStream });
    return this._parseNumberedList(result);
  },

  // ===== 1. 生成切入点（支持联网搜索） =====

  async generateAngles(topic, scriptType, existingAngles = [], onStatus, onStream) {
    let searchContext = '';

    // 如果启用了联网搜索
    if (this._shouldSearch() && onStatus) {
      onStatus('thinking_keywords', '🤔 AI 正在思考搜索关键词...');
      try {
        // 1. AI 先思考搜索关键词（结合剧本类型和设定）
        const keywords = await this.generateSearchKeywords(topic, scriptType);
        if (keywords && keywords.length > 0) {
          onStatus('search_angles', `🌐 正在搜索「${keywords[0]}」等相关资料...`);
          // 2. 用 AI 生成的关键词进行联网搜索
          const searchQuery = keywords.join(' ');
          const searchResult = await this.searchWeb(searchQuery);
          if (searchResult && (searchResult.analysis || (searchResult.items && searchResult.items.length > 0))) {
            searchContext = this._buildSearchContext(searchResult);
          }
        }
      } catch (err) {
        console.warn('搜索失败，将使用模型自身知识:', err.message);
      }
    }

    if (onStatus) {
      onStatus('generate_angles', '🤖 AI 正在根据资料整理切入点...');
    }

    const scriptFormat = Storage.getScriptFormat();
    const scriptSetting = Storage.getScriptSetting();
    const settingContext = scriptSetting ? `\n\n剧本设定：\n${scriptSetting}` : '';
    const excluded = existingAngles.length > 0
      ? `\n注意：以下切入点已经生成过，请勿重复生成：\n${existingAngles.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : '';

    // 根据是否有搜索资料，构建不同的用户提示
    let angleUserMessage;
    if (searchContext) {
      // 有联网搜索资料 → 仅基于资料整理
      angleUserMessage = `主题/描述：${topic}${settingContext}

【联网搜索资料】
${searchContext}

【核心任务】
请严格仅根据以上联网搜索到的资料，从不同角度归纳提炼出5个可能的剧本创作切入点。

【重要规则 - 必须遵守】
1. 严禁编造剧情：不得自行构思故事情节、人物关系或虚构事件
2. 只做归纳整理：每个切入点必须基于资料中的真实信息进行提炼
3. 如果资料不足以支撑5个切入点，允许少生成，但绝不要编造
4. 保持简洁，一句话概括一个切入点
${excluded}

请严格按照以下格式输出，不要有多余内容：
1. [切入点1]
2. [切入点2]
3. [切入点3]
4. [切入点4]
5. [切入点5]`;
    } else {
      // 无搜索资料 → 基于专业知识整理（同样禁止编造）
      angleUserMessage = `主题/描述：${topic}${settingContext}

【核心任务】
请基于你的专业知识，从不同角度归纳出5个可能的剧本创作切入点。

【重要规则 - 必须遵守】
1. 严禁编造剧情：不得自行构思故事情节、人物关系或虚构事件
2. 只做归纳整理：每个切入点应该是根据实际知识总结出的创作方向，而非凭空构思的故事线
3. 保持简洁，一句话概括一个切入点
${excluded}

请严格按照以下格式输出，不要有多余内容：
1. [切入点1]
2. [切入点2]
3. [切入点3]
4. [切入点4]
5. [切入点5]`;
    }

    const messages = [
      {
        role: 'system',
        content: `你是一位专业的剧本素材整理专家。你的任务是基于已有资料为剧本创作提供切入点建议。

【核心原则】
1. 只做归纳整理：基于提供的资料提炼出不同的创作角度/方向
2. 严禁编造剧情：不得添加自行构思的故事情节、人物关系或虚构事件
3. 保持客观：每个切入点必须在提供的资料中有据可依，不得凭空虚构
4. 如果资料不足，可以基于你的专业知识进行合理归纳总结，但仍严禁虚构具体剧情

当前剧本类型：${scriptType}${scriptFormat ? `\n\n剧本格式要求：\n${scriptFormat}` : ''}`,
      },
      {
        role: 'user',
        content: angleUserMessage,
      },
    ];

    const result = await this._chat(messages, { temperature: 0.9, onStream });
    return this._parseNumberedList(result);
  },

  // ===== 2. 生成素材信息（支持联网搜索，结合搜索导向） =====
  async generateMaterials(topic, angle, scriptType, orientations = [], existingMaterials = [], onStatus, onStream) {
    let searchContext = '';

    // 如果启用了联网搜索
    if (this._shouldSearch() && onStatus) {
      onStatus('search_materials', '🤔 AI 正在思考搜索关键词...');
      try {
        // AI 根据切入点、主题、素材搜索导向思考搜索词条
        const keywordMessages = [
          {
            role: 'system',
            content: `你是一位专业的剧本素材搜集专家。请根据用户提供的剧本主题、切入点和搜索导向，思考3-5个精准的联网搜索关键词。
这些关键词将用于搜索与剧本创作相关的具体素材资料。
每个关键词要简洁、具体、有针对性。`,
          },
          {
            role: 'user',
            content: `剧本主题：${topic}
切入点：${angle}
搜索导向：${orientations.join('、')}

请根据以上信息，思考并输出3-5个精准的联网搜索关键词，用于搜索与这个剧本创作相关的具体素材资料。
关键词要贴合搜索导向，精准且有针对性。

请严格按照以下格式输出：
1. [关键词1]
2. [关键词2]
3. [关键词3]`,
          },
        ];

        const keywordResult = await this._chat(keywordMessages, { temperature: 0.7, maxTokens: 1024 });
        const keywords = this._parseNumberedList(keywordResult);

        if (keywords && keywords.length > 0) {
          onStatus('search_materials', `🌐 正在搜索「${keywords[0]}」等相关资料...`);
          // 用 AI 生成的关键词进行联网搜索
          const searchQuery = keywords.join(' ');
          const searchResult = await this.searchWeb(searchQuery);
          if (searchResult && (searchResult.analysis || (searchResult.items && searchResult.items.length > 0))) {
            searchContext = this._buildSearchContext(searchResult);
          }
        }
      } catch (err) {
        console.warn('搜索失败，将使用模型自身知识:', err.message);
      }
    }

    if (onStatus) {
      onStatus('generate_materials', '🤖 AI 正在整理素材...');
    }

    const scriptFormat = Storage.getScriptFormat();
    const orientationsText = orientations.length > 0
      ? `\n素材搜索导向：${orientations.join('、')}`
      : '';
    const excluded = existingMaterials.length > 0
      ? `\n注意：以下素材已生成过，请勿重复生成：\n${existingMaterials.map((m, i) => `${i + 1}. ${m.title}`).join('\n')}`
      : '';

    const messages = [
      { role: 'system', content: this._systemPrompt(scriptType, scriptFormat) },
      {
        role: 'user',
        content: `主题：${topic}
切入点：${angle}${orientationsText}${searchContext}

请根据以上主题、切入点和搜索导向，生成5条相关的创作素材信息。
每条素材包括：标题和简要描述。
素材可以是相关历史事件、人物、场景设定、文化元素、专业背景知识等。${excluded}

请严格按照以下格式输出，不要有多余内容：
1. [素材标题] | [素材描述]
2. [素材标题] | [素材描述]
3. [素材标题] | [素材描述]
4. [素材标题] | [素材描述]
5. [素材标题] | [素材描述]`,
      },
    ];

    const result = await this._chat(messages, { temperature: 0.85, onStream });
    return this._parseMaterialList(result);
  },


  // ===== 3. 生成剧本结构 =====
  async generateStructure(topic, angle, materials, scriptType, onStream) {
    const scriptFormat = Storage.getScriptFormat();
    const scriptSetting = Storage.getScriptSetting();
    const materialsText = materials.length > 0
      ? `\n素材信息：\n${materials.map((m, i) => `${i + 1}. ${m.title}：${m.desc}`).join('\n')}`
      : '';
    const settingContext = scriptSetting ? `\n\n剧本设定（必须严格遵循此设定）：\n${scriptSetting}` : '';

    let systemContent = `你是一位剧本结构规划师。请根据用户提供的主题、切入点、素材和设定，构思一个简洁清晰的剧本结构大纲。

要求：
1. 保持简洁，不要过于复杂或详细
2. 只需包含关键框架：核心冲突、主要人物、大致的起承转合脉络
3. 输出要通俗易懂，一目了然
4. 不要在人物弧光、分幕细节上过度展开
5. 保持与剧本类型、设定的世界观一致

当前剧本类型：${scriptType}`;

    if (scriptSetting) {
      systemContent += `\n\n【重要】必须严格遵循以下剧本设定来规划结构，不得与设定冲突：\n${scriptSetting}`;
    }

    if (scriptFormat) {
      systemContent += `\n\n剧本格式要求：\n${scriptFormat}`;
    }

    const messages = [
      {
        role: 'system',
        content: systemContent,
      },
      {
        role: 'user',
        content: `请为这部${scriptType}构思一个简洁的剧本结构大纲，清晰易懂即可。

主题：${topic}
切入点：${angle}${materialsText}${settingContext}

请输出简洁的剧本结构大纲。`,
      },
    ];

    return await this._chat(messages, { temperature: 0.6, maxTokens: 4096, onStream });
  },


  // ===== 3.5 修改剧本结构 =====
  async reviseStructure(currentStructure, revisionRequest, onStream) {
    const messages = [
      { role: 'system', content: '你是一位专业的剧本架构专家。请根据用户的要求修改剧本结构，保持原有框架的完整性和逻辑性的同时，实现用户的修改需求。' },
      {
        role: 'user',
        content: `以下是当前剧本结构：

${currentStructure}

请根据以下修改要求进行修改：
${revisionRequest}

请输出修改后的完整剧本结构。`,
      },
    ];

    return await this._chat(messages, { temperature: 0.7, maxTokens: 8192, onStream });
  },

  // ===== 4. 生成剧本（基于结构） =====
  async generateScript(topic, angle, materials, scriptType, scriptStructure, onStream) {
    const scriptFormat = Storage.getScriptFormat();
    const materialsText = materials.length > 0
      ? `\n素材信息：\n${materials.map((m, i) => `${i + 1}. ${m.title}：${m.desc}`).join('\n')}`
      : '';

    // 当用户有自定义格式要求时，不要输出硬编码的"必须包含"列表
    const defaultContentList = scriptFormat
      ? ''
      : `\n剧本应该包含：
1. 标题
2. 正文内容
3. 如果有对白，请标注角色名
`;

    const messages = [
      { role: 'system', content: this._systemPrompt(scriptType, scriptFormat) },
      {
        role: 'user',
        content: `请基于以下剧本结构，创作一个${scriptType}剧本。

主题：${topic}
切入点：${angle}${materialsText}

剧本结构：
${scriptStructure}

请严格按照以上剧本结构创作剧本。${defaultContentList}
请确保剧本结构完整、有创意、情节引人入胜。`,
      },
    ];

    return await this._chat(messages, { temperature: 0.8, maxTokens: 8192, onStream });
  },

  // ===== 4. 修改剧本 =====
  async reviseScript(originalScript, revisionRequest, onStream) {
    const messages = [
      { role: 'system', content: '你是一位专业的剧本修改专家。请根据用户的要求修改剧本，保持原有风格和结构的同时，实现用户的修改需求。' },
      {
        role: 'user',
        content: `以下是当前剧本：

${originalScript}

请根据以下修改要求进行修改：
${revisionRequest}

请输出修改后的完整剧本。`,
      },
    ];

    return await this._chat(messages, { temperature: 0.7, maxTokens: 8192, onStream });
  },

  // ===== 解析工具 =====

  // 解析编号列表
  _parseNumberedList(text) {
    const items = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^\d+[\.\、\s]\s*(.+)/);
      if (match) {
        items.push(match[1].trim());
      }
    }
    // 如果解析失败，尝试按行分割并过滤空行
    if (items.length === 0) {
      const nonEmpty = lines.map(l => l.trim()).filter(l => l.length > 0);
      return nonEmpty.slice(0, 5);
    }
    return items.slice(0, 5);
  },

  // 解析素材列表
  _parseMaterialList(text) {
    const materials = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^\d+[\.\、\s]\s*(.+?)\s*[|｜]\s*(.+)/);
      if (match) {
        materials.push({
          title: match[1].trim(),
          desc: match[2].trim(),
        });
      }
    }
    // 备用解析：没有 | 分隔符的情况
    if (materials.length === 0) {
      const items = this._parseNumberedList(text);
      materials.push(...items.map(item => ({
        title: item,
        desc: '',
      })));
    }
    return materials.slice(0, 5);
  },
};
