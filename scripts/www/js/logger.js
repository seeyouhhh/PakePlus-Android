/**
 * logger.js - API 调用日志记录器
 * 用于在调试面板中观察 API 调用情况
 */

const Logger = {
  _logs: [],
  _maxLogs: 200,
  _listeners: [],

  // 日志类型常量
  TYPE: {
    CHAT_REQUEST: 'chat_request',       // AI 对话请求
    CHAT_RESPONSE: 'chat_response',     // AI 回复完成
    CHAT_STREAM: 'chat_stream',         // AI 流式回复内容
    SEARCH_REQUEST: 'search_request',   // 搜索请求
    SEARCH_RESPONSE: 'search_response', // 搜索结果
    ERROR: 'error',                     // 错误
    STATUS: 'status',                   // 状态信息
  },

  // 添加日志
  add(type, data = {}) {
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      type,
      ...data,
    };

    this._logs.unshift(entry); // 最新的在最前面
    if (this._logs.length > this._maxLogs) {
      this._logs.pop();
    }

    // 通知监听器
    this._listeners.forEach(fn => fn(entry));
    return entry;
  },

  // 获取所有日志
  getLogs() {
    return this._logs;
  },

  // 清空日志
  clear() {
    this._logs = [];
    this._listeners.forEach(fn => fn(null, 'clear'));
  },

  // 监听新日志
  onLog(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  },

  // 获取日志类型的中文标签
  getTypeLabel(type) {
    const labels = {
      [this.TYPE.CHAT_REQUEST]: '🤖 AI 请求',
      [this.TYPE.CHAT_RESPONSE]: '✅ AI 回复',
      [this.TYPE.CHAT_STREAM]: '💬 流式输出',
      [this.TYPE.SEARCH_REQUEST]: '🌐 搜索请求',
      [this.TYPE.SEARCH_RESPONSE]: '🌐 搜索结果',
      [this.TYPE.ERROR]: '❌ 错误',
      [this.TYPE.STATUS]: '📋 状态',
    };
    return labels[type] || type;
  },

  // 格式化耗时
  formatDuration(ms) {
    if (!ms) return '';
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  },

  // 截断长文本
  truncate(text, maxLen = 120) {
    if (!text) return '';
    const str = typeof text === 'string' ? text : JSON.stringify(text);
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '...';
  },
};
