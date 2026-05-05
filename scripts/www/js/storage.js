/**
 * storage.js - 本地存储工具
 * 管理 API 密钥、配置等数据的 localStorage 读写
 */

const STORAGE_KEYS = {
  DEEPSEEK_KEY: 'ai_script_deepseek_key',
  SILICON_KEY: 'ai_script_silicon_key',
  ACTIVE_PROVIDER: 'ai_script_provider',
  SCRIPT_TYPE: 'ai_script_type',
  SEARCH_API_KEY: 'ai_script_search_api_key',
  WEB_SEARCH_ENABLED: 'ai_script_search_enabled',
  SCRIPT_FORMAT: 'ai_script_format',
  SCRIPT_SETTING: 'ai_script_setting',
};

const Storage = {
  // ===== API Keys =====
  getDeepSeekKey() {
    return localStorage.getItem(STORAGE_KEYS.DEEPSEEK_KEY) || '';
  },
  setDeepSeekKey(key) {
    localStorage.setItem(STORAGE_KEYS.DEEPSEEK_KEY, key.trim());
  },
  getSiliconKey() {
    return localStorage.getItem(STORAGE_KEYS.SILICON_KEY) || '';
  },
  setSiliconKey(key) {
    localStorage.setItem(STORAGE_KEYS.SILICON_KEY, key.trim());
  },

  // ===== Active Provider =====
  getActiveProvider() {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_PROVIDER) || 'deepseek';
  },
  setActiveProvider(provider) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROVIDER, provider);
  },

  // ===== Script Type =====
  getScriptType() {
    return localStorage.getItem(STORAGE_KEYS.SCRIPT_TYPE) || '电视剧';
  },
  setScriptType(type) {
    localStorage.setItem(STORAGE_KEYS.SCRIPT_TYPE, type);
  },

  // ===== Search API Key (for Web Search - Zhipu BigModel) =====
  getSearchApiKey() {
    return localStorage.getItem(STORAGE_KEYS.SEARCH_API_KEY) || '';
  },
  setSearchApiKey(key) {
    localStorage.setItem(STORAGE_KEYS.SEARCH_API_KEY, key.trim());
  },
  isSearchConfigured() {
    return !!this.getSearchApiKey();
  },


  // ===== Web Search Toggle =====
  isWebSearchEnabled() {
    const stored = localStorage.getItem(STORAGE_KEYS.WEB_SEARCH_ENABLED);
    if (stored === null) return false;
    return stored === 'true';
  },
  setWebSearchEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.WEB_SEARCH_ENABLED, enabled ? 'true' : 'false');
  },

  // ===== Check if API is configured =====
  isApiConfigured() {
    const provider = this.getActiveProvider();
    if (provider === 'deepseek') {
      return !!this.getDeepSeekKey();
    } else if (provider === 'silicon') {
      return !!this.getSiliconKey();
    }
    return false;
  },

  // ===== Get current API key =====
  getApiKey() {
    const provider = this.getActiveProvider();
    if (provider === 'deepseek') return this.getDeepSeekKey();
    if (provider === 'silicon') return this.getSiliconKey();
    return '';
  },

  // ===== Get provider display name =====
  getProviderName() {
    const provider = this.getActiveProvider();
    if (provider === 'deepseek') return 'DeepSeek';
    if (provider === 'silicon') return '硅基流动';
    return '未配置';
  },

  // ===== Script Format =====
  getScriptFormat() {
    return localStorage.getItem(STORAGE_KEYS.SCRIPT_FORMAT) || '';
  },
  setScriptFormat(format) {
    localStorage.setItem(STORAGE_KEYS.SCRIPT_FORMAT, format.trim());
  },

  // ===== Script Setting =====
  getScriptSetting() {
    return localStorage.getItem(STORAGE_KEYS.SCRIPT_SETTING) || '';
  },
  setScriptSetting(setting) {
    localStorage.setItem(STORAGE_KEYS.SCRIPT_SETTING, setting.trim());
  },
};
