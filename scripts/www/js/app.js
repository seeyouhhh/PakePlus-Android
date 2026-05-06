/**
 * app.js - 主应用逻辑
 * 管理步骤流转、UI渲染、用户交互
 */

// ===== State =====
const state = {
  currentStep: 0, // 0=主题, 1=切入点, 2=选切入点, 3=素材导向, 4=素材加载, 5=筛选素材, 6=结构生成, 7=结构预览修改, 8=生成剧本, 9=预览修改
  topic: '',
  angle: '',
  // ===== 切入点（多选支持） =====
  angles: [],
  selectedAngleIndices: [], // 多选：已选切入点索引列表
  customAngles: [],         // 用户自定义切入点（字符串数组）
  allGeneratedAngles: [], // 所有已生成的切入点（去重用）
  // 素材搜索导向
  orientations: [],
  selectedOrientations: [], // 已选的搜索导向（多选）
  customOrientations: [],   // 用户自定义搜索导向
  keptOrientations: [],     // 重新生成导向时保留的已选导向
  allGeneratedOrientations: [], // 所有已生成的导向（去重用）
  // 素材
  materials: [],
  selectedMaterialIndices: [],
  keptMaterials: [], // 重新生成素材时保留的已选素材
  allGeneratedMaterials: [], // 所有已生成的素材（去重用）
  customMaterials: [],
  // 剧本结构
  scriptStructure: '',
  structureHistory: [], // 结构修改历史
  // 剧本
  script: '',
  scriptHistory: [], // 剧本修改历史
  isGenerating: false,
  currentPage: 'main', // 'main' | 'settings'
};


// ===== DOM References =====
const $ = (id) => document.getElementById(id);

// ===== Toast =====
function showToast(message, type = '') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  // Trigger reflow
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== Page Navigation =====
function showPage(page) {
  state.currentPage = page;
  $('page-main').classList.toggle('active', page === 'main');
  $('page-settings').classList.toggle('active', page === 'settings');
  $('progress-container').style.display = page === 'main' ? 'block' : 'none';

  // 刷新设置页面的联网搜索开关状态
  if (page === 'settings') {
    const cb = $('search-toggle');
    if (cb) cb.checked = Storage.isWebSearchEnabled();
  }
}

// ===== Step Views =====
const STEP_COUNT = 9;

function showStep(step) {
  state.currentStep = step;
  // Hide all steps
  for (let i = 0; i <= STEP_COUNT; i++) {
    const el = $(`step-${i}`);
    if (el) el.classList.remove('active');
  }
  const target = $(`step-${step}`);
  if (target) target.classList.add('active');

  // Update progress
  updateProgress(step);
}

function updateProgress(step) {
  const fill = $('progress-fill');
  const pct = ((step) / STEP_COUNT) * 100;
  fill.style.width = `${pct}%`;

  const labels = ['主题', '切入', '选题', '导向', '素材', '筛选', '结构', '修改', '创作', '预览'];
  for (let i = 0; i < labels.length; i++) {
    const el = $(`pstep-${i}`);
    if (!el) continue;
    el.classList.remove('active', 'done');
    if (i < step) el.classList.add('done');
    else if (i === step) el.classList.add('active');
  }
}


// ===== Settings =====

function initSettings() {
  // Load saved values
  $('deepseek-key').value = Storage.getDeepSeekKey();
  $('silicon-key').value = Storage.getSiliconKey();

  const provider = Storage.getActiveProvider();
  document.querySelectorAll('input[name="provider"]').forEach(r => {
    r.checked = r.value === provider;
  });

  // Web search toggle
  const searchCb = $('search-toggle');
  if (searchCb) searchCb.checked = Storage.isWebSearchEnabled();

  // Search API key
  const searchKey = $('search-api-key');
  if (searchKey) searchKey.value = Storage.getSearchApiKey();

  // Script type - 直接加载已保存的值
  $('script-type').value = Storage.getScriptType();

  // Script setting
  $('script-setting').value = Storage.getScriptSetting();

  // Script format
  $('script-format').value = Storage.getScriptFormat();
}

function saveSettings() {
  const deepseekKey = $('deepseek-key').value.trim();
  const siliconKey = $('silicon-key').value.trim();
  const searchApiKey = $('search-api-key')?.value.trim() || '';
  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'deepseek';
  const scriptType = $('script-type').value.trim() || '电视剧';
  const searchEnabled = $('search-toggle').checked;
  const scriptSetting = $('script-setting').value.trim();
  const scriptFormat = $('script-format').value.trim();

  Storage.setDeepSeekKey(deepseekKey);
  Storage.setSiliconKey(siliconKey);
  Storage.setSearchApiKey(searchApiKey);
  Storage.setActiveProvider(provider);
  Storage.setScriptType(scriptType);
  Storage.setWebSearchEnabled(searchEnabled);
  Storage.setScriptSetting(scriptSetting);
  Storage.setScriptFormat(scriptFormat);

  showToast('设置已保存', 'success');
  updateModelInfo();

  // Check if API is configured
  if (Storage.isApiConfigured()) {
    showPage('main');
  }
}

function updateModelInfo() {
  const info = $('model-info');
  const provider = Storage.getProviderName();
  const configured = Storage.isApiConfigured();
  const searchEnabled = Storage.isWebSearchEnabled();

  let parts = [];
  if (configured) {
    parts.push(`🤖 ${provider}`);
  } else {
    parts.push('⚠️ 请先配置 API Key');
  }

  if (searchEnabled) {
    parts.push('🌐 联网搜索已开启');
  }

  const setting = Storage.getScriptSetting();
  if (setting) {
    parts.push('🌍 已设剧本设定');
  }

  info.textContent = parts.join(' | ') + ` | 类型: ${Storage.getScriptType()}`;
}

// ===== Status Update for Search + Generation =====
function handleGenerationStatus(type, message) {
  // type: 'thinking_keywords' | 'search_angles' | 'generate_angles' | 'thinking_orientations' | 'search_materials' | 'generate_materials'
  const loadingEl1 = $('step-1-loading');
  const loadingEl3 = $('step-3-loading');
  const loadingEl4 = $('step-4-loading');
  const textEl1 = loadingEl1?.querySelector('.loading-text');
  const textEl3 = loadingEl3?.querySelector('.loading-text');
  const textEl4 = loadingEl4?.querySelector('.loading-text');

  if (type === 'thinking_keywords' || type === 'search_angles' || type === 'generate_angles') {
    if (textEl1) textEl1.textContent = message;
  } else if (type === 'thinking_orientations') {
    if (textEl3) textEl3.textContent = message;
  } else if (type === 'search_materials' || type === 'generate_materials') {
    if (textEl4) textEl4.textContent = message;
  }
}



// ===== Main Flow =====

// --- Step 0: Topic Input ---
function submitTopic() {
  const topic = $('topic-input').value.trim();
  if (!topic) {
    showToast('请输入剧本主题或描述', 'error');
    return;
  }
  state.topic = topic;
  state.angles = [];
  state.selectedAngleIndices = [];
  state.customAngles = [];
  state.allGeneratedAngles = [];
  state.materials = [];
  state.keptMaterials = [];
  state.allGeneratedMaterials = [];
  state.customMaterials = [];
  state.scriptStructure = '';
  state.structureHistory = [];
  state.script = '';
  state.scriptHistory = [];

  generateAngles();
}

// --- Step 1: Generate Angles ---
async function generateAngles() {
  if (state.isGenerating) return;
  if (!Storage.isApiConfigured()) {
    showToast('请先在设置中配置 API Key', 'error');
    return;
  }

  state.isGenerating = true;
  showStep(1);
  showLoading('step-1-loading', true, '🤖 AI 正在构思切入点...');

  try {
    const angles = await API.generateAngles(
      state.topic,
      Storage.getScriptType(),
      state.allGeneratedAngles,
      handleGenerationStatus
    );

    state.angles = angles;
    state.allGeneratedAngles.push(...angles);
    renderAngles();
  } catch (err) {
    showToast(err.message, 'error');
    // Go back to step 0
    showStep(0);
  } finally {
    state.isGenerating = false;
    showLoading('step-1-loading', false);
  }
}

// ===== 切入点渲染（多选，参考导向页面风格） =====
function renderAngles() {
  const container = $('angles-list');
  const selectedContainer = $('selected-angles-list');
  container.innerHTML = '';
  selectedContainer.innerHTML = '';

  // 1. AI 生成的切入点列表（仅显示未被选中的）
  state.angles.forEach((angle, i) => {
    if (state.selectedAngleIndices.includes(i)) return;
    const div = document.createElement('div');
    div.className = 'option-item';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(angle)}</span>
      </div>
    `;
    div.onclick = () => selectAngle(i);
    container.appendChild(div);
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">暂无可用切入点，可点击重新生成或自定义添加</div>';
  }

  // 2. 已选区域
  // 已选 AI 切入点
  state.selectedAngleIndices.forEach(idx => {
    const angle = state.angles[idx];
    if (!angle) return;
    const div = document.createElement('div');
    div.className = 'option-item selected orientation-selected';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(angle)}</span>
      </div>
      <button class="material-delete-btn orientation-delete-btn" title="删除">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      state.selectedAngleIndices = state.selectedAngleIndices.filter(v => v !== idx);
      renderAngles();
    };
    selectedContainer.appendChild(div);
  });

  // 自定义切入点
  state.customAngles.forEach((angle, i) => {
    const div = document.createElement('div');
    div.className = 'option-item selected orientation-selected';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(angle)}（自定义）</span>
      </div>
      <button class="material-delete-btn orientation-delete-btn" title="删除">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      state.customAngles.splice(i, 1);
      renderAngles();
    };
    selectedContainer.appendChild(div);
  });

  if (selectedContainer.children.length === 0) {
    selectedContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">尚未选择任何切入点</div>';
  }

  showStep(2);
}

function selectAngle(index) {
  // 多选：切换选中状态
  if (state.selectedAngleIndices.includes(index)) {
    state.selectedAngleIndices = state.selectedAngleIndices.filter(v => v !== index);
  } else {
    state.selectedAngleIndices.push(index);
  }
  renderAngles();
}

function addCustomAngle() {
  const input = $('custom-angle');
  const text = input.value.trim();
  if (!text) {
    showToast('请输入自定义切入点', 'error');
    return;
  }
  state.customAngles.push(text);
  input.value = '';
  renderAngles();
  showToast('已添加自定义切入点', 'success');
}

function confirmAngle() {
  // 收集所有已选的切入点文本
  const selectedTexts = [
    ...state.selectedAngleIndices.map(i => state.angles[i]),
    ...state.customAngles,
  ].filter(Boolean);

  if (selectedTexts.length === 0) {
    showToast('请至少选择一个切入点或添加自定义切入点', 'error');
    return;
  }

  // 将多个切入点用分号连接
  state.angle = selectedTexts.join('；');

  // Reset orientations for new angle
  state.orientations = [];
  state.selectedOrientations = [];
  state.customOrientations = [];
  state.keptOrientations = [];
  state.allGeneratedOrientations = [];

  // Generate search orientations (step 3)
  generateOrientations();
}

function regenerateAngles() {
  if (state.isGenerating) return;
  // 保留已选的切入点和自定义切入点
  const newlySelected = state.selectedAngleIndices.map(i => state.angles[i]).filter(Boolean);
  state.customAngles.push(...newlySelected);
  state.angles = [];
  state.selectedAngleIndices = [];
  generateAngles();
}

// ===== Step 3: 素材搜索导向 =====
async function generateOrientations() {
  if (state.isGenerating) return;

  state.isGenerating = true;
  showStep(3);
  // Show loading, hide content
  const loadingEl = $('step-3-loading');
  const contentEl = $('step-3-content');
  if (loadingEl) loadingEl.classList.add('show');
  if (contentEl) contentEl.style.display = 'none';

  try {
    const orientations = await API.generateSearchOrientations(
      state.topic,
      state.angle,
      Storage.getScriptType(),
      state.allGeneratedOrientations,
      handleGenerationStatus
    );

    state.orientations = orientations;
    state.allGeneratedOrientations.push(...orientations);
    renderOrientations();
  } catch (err) {
    showToast(err.message, 'error');
    // Go back to step 2 (angle selection)
    showStep(2);
  } finally {
    state.isGenerating = false;
    if (loadingEl) loadingEl.classList.remove('show');
    if (contentEl) contentEl.style.display = 'block';
  }
}


function renderOrientations() {
  const container = $('orientations-list');
  const selectedContainer = $('selected-orientations-list');
  container.innerHTML = '';
  selectedContainer.innerHTML = '';

  // 1. AI 生成的导向列表（仅显示未被选中的）
  state.orientations.forEach((ori, i) => {
    if (state.selectedOrientations.includes(i)) return;
    const div = document.createElement('div');
    div.className = 'option-item';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(ori)}</span>
      </div>
    `;
    div.onclick = () => selectOrientation(i);
    container.appendChild(div);
  });

  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">暂无可用搜索导向，可点击重新生成或自定义添加</div>';
  }

  // 2. 已选区域
  // 已保留导向（keptOrientations）
  state.keptOrientations.forEach((ori, i) => {
    const div = document.createElement('div');
    div.className = 'option-item selected orientation-selected';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(ori)}（已保留）</span>
      </div>
      <button class="material-delete-btn orientation-delete-btn" title="删除">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      removeKeptOrientation(i);
    };
    selectedContainer.appendChild(div);
  });

  state.selectedOrientations.forEach(idx => {
    const ori = state.orientations[idx];
    if (!ori) return;
    const div = document.createElement('div');
    div.className = 'option-item selected orientation-selected';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(ori)}</span>
      </div>
      <button class="material-delete-btn orientation-delete-btn" title="删除">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      state.selectedOrientations = state.selectedOrientations.filter(v => v !== idx);
      renderOrientations();
    };
    selectedContainer.appendChild(div);
  });

  // 自定义导向
  state.customOrientations.forEach((ori, i) => {
    const div = document.createElement('div');
    div.className = 'option-item selected orientation-selected';
    div.innerHTML = `
      <div class="option-row">
        <span class="option-text">${escapeHtml(ori)}（自定义）</span>
      </div>
      <button class="material-delete-btn orientation-delete-btn" title="删除">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      state.customOrientations.splice(i, 1);
      renderOrientations();
    };
    selectedContainer.appendChild(div);
  });

  if (selectedContainer.children.length === 0) {
    selectedContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">尚未选择任何搜索导向</div>';
  }

  showStep(3);
}

function selectOrientation(index) {
  if (!state.selectedOrientations.includes(index)) {
    state.selectedOrientations.push(index);
  }
  renderOrientations();
}

function removeKeptOrientation(idx) {
  state.keptOrientations.splice(idx, 1);
  renderOrientations();
}

function addCustomOrientation() {
  const input = $('custom-orientation');
  const text = input.value.trim();
  if (!text) {
    showToast('请输入搜索导向内容', 'error');
    return;
  }
  state.customOrientations.push(text);
  input.value = '';
  renderOrientations();
  showToast('已添加自定义搜索导向', 'success');
}

function regenerateOrientations() {
  if (state.isGenerating) return;
  // 将当前已选的 AI 导向和自定义导向移到 keptOrientations 中保留
  const newlySelected = state.selectedOrientations.map(i => state.orientations[i]).filter(Boolean);
  state.keptOrientations.push(...newlySelected);
  state.keptOrientations.push(...state.customOrientations);
  // 重置 AI 导向列表，保留已保留的导向
  // 注意：不清空 allGeneratedOrientations，确保 AI 不会生成与之前重复的内容
  state.orientations = [];
  state.selectedOrientations = [];
  state.customOrientations = [];
  generateOrientations();
}


function confirmOrientations() {
  const totalSelected = state.selectedOrientations.length + state.customOrientations.length + state.keptOrientations.length;
  if (totalSelected === 0) {
    showToast('请至少选择一个搜索导向', 'error');
    return;
  }

  // Reset materials for new generation
  state.materials = [];
  state.allGeneratedMaterials = [];
  state.selectedMaterialIndices = [];
  state.customMaterials = [];
  state.keptMaterials = [];
  generateMaterials();
}

// ===== Step 4: Materials Loading =====
async function generateMaterials() {
  if (state.isGenerating) return;

  // Collect selected orientations (including kept ones)
  const selectedOriTexts = [
    ...state.selectedOrientations.map(i => state.orientations[i]),
    ...state.customOrientations,
    ...state.keptOrientations,
  ].filter(Boolean);

  state.isGenerating = true;
  showStep(4);

  showLoading('step-4-loading', true, '🤖 AI 正在搜集素材...');


  try {
    const materials = await API.generateMaterials(
      state.topic,
      state.angle,
      Storage.getScriptType(),
      selectedOriTexts,
      state.allGeneratedMaterials,
      handleGenerationStatus
    );

    state.materials = materials;
    state.allGeneratedMaterials.push(...materials);
    renderMaterials();
  } catch (err) {
    showToast(err.message, 'error');
    showStep(3);
  } finally {
    state.isGenerating = false;
    showLoading('step-4-loading', false);
  }
}

// ===== Step 5: Filter Materials =====
function renderMaterials() {

  const container = $('materials-list');

  const selectedContainer = $('selected-materials-list');
  container.innerHTML = '';
  selectedContainer.innerHTML = '';

  // 1. AI 生成的素材列表（仅显示未被选中的）
  state.materials.forEach((mat, i) => {
    // 如果已被选中，不显示在 AI 列表中
    if (state.selectedMaterialIndices.includes(i)) return;
    const div = document.createElement('div');
    div.className = 'material-item';
    div.innerHTML = `
      <div class="material-content">
        <div class="material-title">${escapeHtml(mat.title)}</div>
        <div class="material-desc">${escapeHtml(mat.desc || '暂无详细描述')}</div>
      </div>
    `;
    div.onclick = () => selectMaterial(i);
    container.appendChild(div);
  });

  // 如果 AI 素材列表为空
  if (container.children.length === 0) {
    container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">暂无可用 AI 素材，可点击重新生成或添加自定义素材</div>';
  }

  // --- 已选素材区域 ---
  // 已保留素材（keptMaterials）
  state.keptMaterials.forEach((mat, i) => {
    const div = document.createElement('div');
    div.className = 'material-item checked selected';
    div.innerHTML = `
      <div class="material-content">
        <div class="material-title">${escapeHtml(mat.title)}（已保留）</div>
        <div class="material-desc">${escapeHtml(mat.desc || '')}</div>
      </div>
      <button class="material-delete-btn" title="删除素材">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      removeSelectedMaterial('kept', i);
    };
    selectedContainer.appendChild(div);
  });

  // 已选 AI 素材（selectedMaterialIndices）
  state.selectedMaterialIndices.forEach(idx => {
    const mat = state.materials[idx];
    if (!mat) return;
    const div = document.createElement('div');
    div.className = 'material-item checked selected';
    div.innerHTML = `
      <div class="material-content">
        <div class="material-title">${escapeHtml(mat.title)}</div>
        <div class="material-desc">${escapeHtml(mat.desc || '')}</div>
      </div>
      <button class="material-delete-btn" title="删除素材">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      removeSelectedMaterial('ai', idx);
    };
    selectedContainer.appendChild(div);
  });

  // 自定义素材
  state.customMaterials.forEach((mat, i) => {
    const div = document.createElement('div');
    div.className = 'material-item checked selected';
    div.innerHTML = `
      <div class="material-content">
        <div class="material-title">${escapeHtml(mat.title)}（自定义）</div>
        <div class="material-desc">${escapeHtml(mat.desc || '')}</div>
      </div>
      <button class="material-delete-btn" title="删除素材">×</button>
    `;
    div.querySelector('.material-delete-btn').onclick = (e) => {
      e.stopPropagation();
      removeSelectedMaterial('custom', i);
    };
    selectedContainer.appendChild(div);
  });

  // 如果已选区域为空
  if (selectedContainer.children.length === 0) {
    selectedContainer.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);padding:12px;text-align:center;">尚未选择任何素材</div>';
  }

  showStep(5);
}

// 点击 AI 素材 → 移动到已选区域

function selectMaterial(index) {
  if (!state.selectedMaterialIndices.includes(index)) {
    state.selectedMaterialIndices.push(index);
  }
  renderMaterials();
}

// 从已选区域删除素材
function removeSelectedMaterial(type, idx) {
  if (type === 'kept') {
    state.keptMaterials.splice(idx, 1);
  } else if (type === 'ai') {
    const pos = state.selectedMaterialIndices.indexOf(idx);
    if (pos >= 0) state.selectedMaterialIndices.splice(pos, 1);
  } else if (type === 'custom') {
    state.customMaterials.splice(idx, 1);
  }
  renderMaterials();
}

function addCustomMaterial() {
  const title = $('custom-material-title').value.trim();
  const desc = $('custom-material-desc').value.trim();
  if (!title) {
    showToast('请输入素材标题', 'error');
    return;
  }
  state.customMaterials.push({ title, desc });
  $('custom-material-title').value = '';
  $('custom-material-desc').value = '';
  renderMaterials();
  showToast('已添加自定义素材', 'success');
}

function regenerateMaterials() {
  if (state.isGenerating) return;

  // 将当前已选的 AI 素材移到 keptMaterials 中保留
  const newlySelected = state.selectedMaterialIndices.map(i => state.materials[i]).filter(Boolean);
  state.keptMaterials.push(...newlySelected);
  // 重置 AI 素材列表，保留已选和自定义素材
  state.materials = [];
  state.selectedMaterialIndices = [];
  generateMaterials();
}

function confirmMaterials() {
  const totalSelected = state.selectedMaterialIndices.length + state.customMaterials.length + state.keptMaterials.length;
  if (totalSelected === 0) {
    showToast('请至少选择一个素材', 'error');
    return;
  }
  generateStructure();
}

// ===== Step 6-7: 剧本结构构思 =====

// --- Step 6: Generate Structure (loading) ---
async function generateStructure() {
  if (state.isGenerating) return;

  // Collect all selected materials (kept + newly selected + custom)
  const selectedMats = [
    ...state.keptMaterials,
    ...state.selectedMaterialIndices.map(i => state.materials[i]),
    ...state.customMaterials,
  ].filter(Boolean);

  state.isGenerating = true;
  showStep(6);
  showLoading('step-6-loading', true, '🤖 AI 正在构思剧本结构...');

  // 重置结构相关状态
  state.scriptStructure = '';
  state.structureHistory = [];

  try {
    const result = await API.generateStructure(
      state.topic,
      state.angle,
      selectedMats,
      Storage.getScriptType(),
      (fullText) => {
        // 流式更新结构内容
        state.scriptStructure = fullText;
        const structureContent = $('structure-content');
        if (structureContent) structureContent.textContent = fullText;
      }
    );

    state.scriptStructure = result;
    state.structureHistory = [result];
    renderStructure();
  } catch (err) {
    showToast(err.message, 'error');
    showStep(5);
  } finally {
    state.isGenerating = false;
    showLoading('step-6-loading', false);
  }
}

// --- Step 7: Structure Preview ---
function renderStructure() {
  const structureContent = $('structure-content');
  if (structureContent) {
    structureContent.textContent = state.scriptStructure || '暂无结构内容';
  }
  showStep(7);
}

function confirmStructure() {
  if (!state.scriptStructure) {
    showToast('请先等待剧本结构生成完成', 'error');
    return;
  }
  generateScriptFromStructure();
}

function regenerateStructure() {
  if (state.isGenerating) return;
  state.scriptStructure = '';
  state.structureHistory = [];
  generateStructure();
}

// 结构修改对话
function addStructureChatMessage(text, role) {
  const container = $('structure-chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function submitStructureRevision() {
  const input = $('structure-revision-input');
  const request = input.value.trim();
  if (!request) {
    showToast('请输入修改要求', 'error');
    return;
  }

  if (state.isGenerating) return;
  state.isGenerating = true;

  // Add user message
  addStructureChatMessage(request, 'user');
  input.value = '';

  // Show AI loading
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'chat-message ai';
  loadingMsg.textContent = '修改中...';
  $('structure-chat-messages').appendChild(loadingMsg);

  try {
    const result = await API.reviseStructure(
      state.scriptStructure,
      request,
      (fullText) => {
        loadingMsg.textContent = fullText;
        // 实时更新结构预览
        const structureContent = $('structure-content');
        if (structureContent) structureContent.textContent = fullText;
      }
    );

    state.scriptStructure = result;
    state.structureHistory.push(result);
    const structureContent = $('structure-content');
    if (structureContent) structureContent.textContent = result;
    loadingMsg.textContent = '修改完成！';
    showToast('结构已更新', 'success');
  } catch (err) {
    loadingMsg.textContent = `修改失败: ${err.message}`;
    showToast(err.message, 'error');
  } finally {
    state.isGenerating = false;
    $('structure-chat-messages').scrollTop = $('structure-chat-messages').scrollHeight;
  }
}

function handleStructureRevisionKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitStructureRevision();
  }
}

// ===== Step 8-9: 生成剧本 =====

// --- Step 8: Generate Script (loading) ---
async function generateScriptFromStructure() {
  if (state.isGenerating) return;

  // Collect all selected materials (kept + newly selected + custom)
  const selectedMats = [
    ...state.keptMaterials,
    ...state.selectedMaterialIndices.map(i => state.materials[i]),
    ...state.customMaterials,
  ].filter(Boolean);

  state.isGenerating = true;
  showStep(8);
  showLoading('step-8-loading', true, '✍️ AI 正在创作剧本...');
  const scriptContent = $('script-content');
  scriptContent.textContent = '';

  try {
    const result = await API.generateScript(
      state.topic,
      state.angle,
      selectedMats,
      Storage.getScriptType(),
      state.scriptStructure,
      (fullText) => {
        scriptContent.textContent = fullText;
      }
    );

    state.script = result;
    state.scriptHistory = [result];
    // Copy to final preview
    $('script-content-final').textContent = result;
    showStep(9);
  } catch (err) {
    showToast(err.message, 'error');
    showStep(7);
  } finally {
    state.isGenerating = false;
    showLoading('step-8-loading', false);
  }
}

// --- Step 9: Preview & Revise ---

function downloadScript() {
  if (!state.script) {
    showToast('没有可下载的剧本', 'error');
    return;
  }

  const blob = new Blob([state.script], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `剧本_${state.topic.slice(0, 20) || 'untitled'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('剧本已下载', 'success');
}

function copyScript() {
  if (!state.script) {
    showToast('没有可复制的剧本', 'error');
    return;
  }

  navigator.clipboard.writeText(state.script).then(() => {
    showToast('剧本已复制到剪贴板', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = state.script;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('剧本已复制到剪贴板', 'success');
  });
}

async function submitRevision() {
  const request = $('revision-input').value.trim();
  if (!request) {
    showToast('请输入修改要求', 'error');
    return;
  }

  if (state.isGenerating) return;
  state.isGenerating = true;

  // Add user message
  addChatMessage(request, 'user');
  $('revision-input').value = '';

  // Show AI loading
  const loadingMsg = document.createElement('div');
  loadingMsg.className = 'chat-message ai';
  loadingMsg.textContent = '修改中...';
  $('chat-messages').appendChild(loadingMsg);

  try {
    const result = await API.reviseScript(
      state.script,
      request,
      (fullText) => {
        loadingMsg.textContent = fullText;
      }
    );

    state.script = result;
    state.scriptHistory.push(result);
    $('script-content').textContent = result;
    $('script-content-final').textContent = result;
    loadingMsg.textContent = '修改完成！';
    showToast('剧本已更新', 'success');
  } catch (err) {
    loadingMsg.textContent = `修改失败: ${err.message}`;
    showToast(err.message, 'error');
  } finally {
    state.isGenerating = false;
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  }
}

function addChatMessage(text, role) {
  const container = $('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function handleRevisionKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitRevision();
  }
}

// ===== Start Over =====
function startOver() {
  if (!confirm('确定要重新开始吗？当前进度将丢失。')) return;
  state.topic = '';
  state.angle = '';
  state.angles = [];
  state.selectedAngleIndices = [];
  state.customAngles = [];
  state.allGeneratedAngles = [];
  state.materials = [];
  state.selectedMaterialIndices = [];
  state.keptMaterials = [];
  state.allGeneratedMaterials = [];
  state.customMaterials = [];
  state.scriptStructure = '';
  state.structureHistory = [];
  state.script = '';
  state.scriptHistory = [];
  state.isGenerating = false;
  state.orientations = [];
  state.selectedOrientations = [];
  state.customOrientations = [];
  state.keptOrientations = [];
  state.allGeneratedOrientations = [];

  $('topic-input').value = '';
  $('custom-angle').value = '';
  $('custom-material-title').value = '';
  $('custom-material-desc').value = '';
  $('revision-input').value = '';
  $('chat-messages').innerHTML = '';
  $('script-content').textContent = '';
  $('script-content-final').textContent = '';
  $('structure-content').textContent = '';
  $('structure-chat-messages').innerHTML = '';
  $('structure-revision-input').value = '';

  showStep(0);
  showToast('已重新开始', 'success');
}

// ===== Helpers =====

function showLoading(id, show, text = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', show);
  if (text) {
    const textEl = el.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
  }
}

// ===== Go Back Navigation =====
function goBack(currentStep) {
  switch (currentStep) {
    case 2: // 选择切入点 → 输入主题
      state.selectedAngleIndices = [];
      state.customAngles = [];
      state.angle = '';
      showStep(0);
      break;
    case 3: // 素材搜索导向 → 选择切入点
      state.orientations = [];
      state.selectedOrientations = [];
      state.customOrientations = [];
      state.keptOrientations = [];
      state.allGeneratedOrientations = [];
      showStep(2);
      break;
    case 5: // 筛选素材 → 素材搜索导向
      state.materials = [];
      state.selectedMaterialIndices = [];
      state.customMaterials = [];
      state.keptMaterials = [];
      state.allGeneratedMaterials = [];
      showStep(3);
      break;
    case 7: // 结构预览修改 → 筛选素材
      state.scriptStructure = '';
      state.structureHistory = [];
      showStep(5);
      break;
    case 9: // 预览修改 → 结构预览修改
      state.script = '';
      state.scriptHistory = [];
      showStep(7);
      break;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Debug Panel =====

let debugExpanded = false;

function toggleDebugPanel() {
  const panel = $('debug-panel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    renderDebugLogs();
  }
}

function toggleDebugExpand() {
  const panel = $('debug-panel');
  debugExpanded = !debugExpanded;
  panel.classList.toggle('expanded', debugExpanded);
  // If not open, open first
  if (!panel.classList.contains('open')) {
    panel.classList.add('open');
  }
  // Scroll to bottom after expand
  setTimeout(() => {
    const body = $('debug-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, 100);
}

function clearDebugLogs() {
  Logger.clear();
  renderDebugLogs();
}

function renderDebugLogs() {
  const container = $('debug-list');
  const countEl = $('debug-count');
  if (!container) return;

  const logs = Logger.getLogs();

  if (countEl) countEl.textContent = logs.length;

  if (logs.length === 0) {
    container.innerHTML = '<div class="debug-empty">暂无 API 调用记录</div>';
    return;
  }

  container.innerHTML = logs.map(log => {
    const typeLabel = Logger.getTypeLabel(log.type);
    const duration = log.duration ? Logger.formatDuration(log.duration) : '';
    let summary = '';
    let detail = '';

    switch (log.type) {
      case Logger.TYPE.CHAT_REQUEST:
        summary = `模型: ${log.model || 'N/A'} | ${log.messageCount || 0}条消息 | 总长度: ${Logger.formatDuration ? (log.totalContentLength || 0) + '字符' : (log.totalContentLength || 0) + '字符'}`;
        detail = `[请求消息] 总内容长度: ${log.totalContentLength || 0} 字符\n` + (log.messages || []).map(m =>
          `[${m.role}] (长度: ${m.contentLength || 0} 字符)\n${m.preview || ''}${(m.contentLength || 0) > 500 ? '\n...(更多内容已省略)' : ''}`
        ).join('\n\n');
        break;
      case Logger.TYPE.CHAT_RESPONSE:
        summary = `长度: ${log.contentLength || 0}字符 | ${duration}`;
        detail = log.preview || '';
        break;
      case Logger.TYPE.CHAT_STREAM:
        summary = `已接收: ${log.contentLength || 0}字符 | ${duration}`;
        detail = `增量: ${log.preview || ''}`;
        break;
      case Logger.TYPE.SEARCH_REQUEST:
        summary = `🔍 "${Logger.truncate(log.query, 30)}"`;
        detail = `搜索词: ${log.query}`;
        break;
      case Logger.TYPE.SEARCH_RESPONSE:
        summary = `📄 ${log.resultCount || 0} 条结果 | AI分析: ${log.analysisLength || 0}字符 | ${duration}`;
        const sourceNote = log.note ? `来源: ${log.note}` : '';
        detail = sourceNote + '\nAI分析文本长度: ' + (log.analysisLength || 0) + ' 字符\n' + (log.results || []).map(r =>
          `#${r.index} ${r.title}\n${(r.content || r.summary || '').slice(0, 1000)}${((r.content || r.summary || '').length > 1000) ? '\n...(更多内容已省略)' : ''}`
        ).join('\n\n');
        break;
      case Logger.TYPE.ERROR:
        summary = log.message || '未知错误';
        detail = `错误: ${log.message}`;
        break;
      default:
        summary = log.message || log.preview || '';
        detail = JSON.stringify(log, null, 2);
    }

    return `<div class="debug-entry ${log.type}${log.type === Logger.TYPE.CHAT_STREAM ? '' : ''}" onclick="this.classList.toggle('open')">
      <div class="debug-entry-header">
        <span class="debug-entry-time">${log.time}</span>
        <span class="debug-entry-type">${typeLabel}</span>
        ${duration ? `<span class="debug-entry-duration">${duration}</span>` : ''}
      </div>
      <div class="debug-entry-summary">${Logger.truncate(summary, 150)}</div>
      <div class="debug-entry-detail">${escapeHtml(detail)}</div>
    </div>`;
  }).join('');

  // Auto scroll to top (newest first)
  container.scrollTop = 0;
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  initSettings();
  updateModelInfo();

  // Listen for new log entries
  Logger.onLog((entry, action) => {
    if (action === 'clear') {
      renderDebugLogs();
      return;
    }
    // Update count
    renderDebugLogs();
  });

  // Check if API is configured
  if (Storage.isApiConfigured()) {
    showPage('main');
  } else {
    showPage('settings');
    showToast('请先配置 API Key', '');
  }

  showStep(0);
});
