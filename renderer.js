
// --- 1. Global Error Handler & Init ---
window.onerror = function(message, source, lineno, colno, error) {
  const errorMsg = `Global Error: ${message}\nSource: ${source}:${lineno}:${colno}`;
  console.error(errorMsg, error);
  if (window.showModal) window.showModal(errorMsg, '系统错误');
  else alert(errorMsg);
  return false;
};

if (!window.api) {
  alert('Critical Error: window.api is not defined. Preload script may have failed.');
}

console.log('Renderer script started');

// --- 2. UI Helpers ---

const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const headerTitle = document.getElementById('header-title');

// Window Controls
const minBtn = document.getElementById('minBtn');
const maxBtn = document.getElementById('maxBtn');
const closeBtn = document.getElementById('closeBtn');

if (minBtn) minBtn.addEventListener('click', () => window.api.minimizeWindow());
if (maxBtn) maxBtn.addEventListener('click', () => window.api.maximizeWindow());
if (closeBtn) closeBtn.addEventListener('click', () => window.api.closeWindow());

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');

    const targetPageId = `page-${item.dataset.page}`;
    pages.forEach(page => {
      if (page.id === targetPageId) page.classList.add('active');
      else page.classList.remove('active');
    });

    if (headerTitle) {
      headerTitle.innerText = item.innerText.replace(/^[^\s]+\s/, ''); 
    }
    
    if (targetPageId === 'page-questionnaire') {
      const form = document.getElementById('questionnaire-form');
      if (form) form.style.display = 'block';
      renderQuestionnaireFields();
    }
  });
});

const questionnairePage = document.getElementById('page-questionnaire');
if (questionnairePage && questionnairePage.classList.contains('active')) {
  const form = document.getElementById('questionnaire-form');
  if (form) form.style.display = 'block';
  renderQuestionnaireFields();
}

// Modal
const modalOverlay = document.getElementById('custom-modal-overlay');
const modalTitle = document.getElementById('custom-modal-title');
const modalMessage = document.getElementById('custom-modal-message');
const modalCloseBtn = document.getElementById('custom-modal-close-btn');
let modalCloseCallback = null;

window.showModal = function(message, title = '提示', onClose = null) {
  if (modalTitle) modalTitle.innerText = title;
  if (modalMessage) modalMessage.innerText = message;
  modalCloseCallback = onClose;
  if (modalOverlay) modalOverlay.style.display = 'flex';
};

if (modalCloseBtn) {
  modalCloseBtn.onclick = () => {
    if (modalOverlay) modalOverlay.style.display = 'none';
    if (modalCloseCallback) {
      modalCloseCallback();
      modalCloseCallback = null;
    }
  };
}

function showToast(message, type = 'success', duration = 2000) {
  const toast = document.createElement('div');
  const isError = type === 'error';
  toast.innerText = message;
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '9999';
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '13px';
  toast.style.color = '#ffffff';
  toast.style.backgroundColor = isError ? '#ef4444' : '#22c55e';
  toast.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.2)';
  toast.style.maxWidth = '360px';
  toast.style.wordBreak = 'break-word';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }, Math.max(0, duration));
}

// Button Loading State
async function withLoading(btn, action) {
  if (!btn) return;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = '运行中...';
  btn.style.opacity = '0.7';
  btn.style.cursor = 'not-allowed';
  
  try {
    await action();
  } catch (e) {
    console.error('Button action failed:', e);
    showModal('操作发生错误: ' + (e.message || '未知错误'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = originalText;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  }
}

let defaultQuestionnaireCfg = null;
let lastEmgAnalysis = null;
let lastEmgSubjectId = '';
let lastEcgAnalysis = null;
let lastEcgSubjectId = '';
let lastEyeAnalysis = null;
let lastEyeSubjectId = '';

async function autoSavePhysioAnalysis(module, subjectId, analysis) {
  const payload = {
    module,
    subject_id: subjectId || 'unknown',
    metrics: analysis && analysis.metrics ? analysis.metrics : {},
    analysis
  };
  const res = await window.api.exportPhysioSummary(payload);
  if (!res || !res.ok) {
    const msg = res && res.error ? res.error : '未知错误';
    showToast(`自动保存失败: ${msg}`, 'error', 4000);
    return false;
  }
  showToast('结果已自动保存至cache', 'success', 2000);
  return true;
}

async function autoSaveGameScore(subjectId) {
  const data = { subject_id: subjectId || 'unknown' };
  const resultIds = [
    'val_shooting_total', 'val_shooting_accuracy', 'val_shooting_avg',
    'val_task4_ball', 'val_task4_line', 'val_task4_total', 'val_task4_accuracy',
    'val_game5_total', 'val_game5_life'
  ];
  resultIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.innerText;
  });
  const res = await window.api.saveGameScore(data);
  if (!res || !res.ok) {
    const msg = res && res.error ? res.error : '未知错误';
    showToast(`自动保存失败: ${msg}`, 'error', 4000);
    return false;
  }
  showToast('结果已自动保存至cache', 'success', 2000);
  return true;
}

function calcMean(arr) {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function calcStd(arr, mean) {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mean;
    s += d * d;
  }
  return Math.sqrt(s / arr.length);
}

function renderSeriesChart(elId, xData, yData, title) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chart = echarts.init(el);
  const isECG = title && title.indexOf('ECG') !== -1;
  const isEMG = title && title.indexOf('EMG') !== -1;
  const isClinicalWave = isECG || isEMG;
  const bgColor = '#ffffff';
  const lineColor = isECG ? '#2ecc71' : (isEMG ? '#e67e22' : '#5470c6');
  const axisColor = '#999999';
  const textColor = '#333333';
  const gridColor = '#e0e0e0';
  const xAxis = {
    type: 'value',
    axisLine: { lineStyle: { color: axisColor } },
    axisLabel: isClinicalWave ? { color: textColor, fontSize: 10 } : {},
    splitLine: { show: true, lineStyle: { color: gridColor } }
  };
  const yAxis = {
    type: 'value',
    axisLine: { lineStyle: { color: axisColor } },
    axisLabel: isClinicalWave ? { color: textColor, fontSize: 10 } : {},
    splitLine: { show: true, lineStyle: { color: gridColor } }
  };
  const option = {
    backgroundColor: bgColor,
    title: { text: title, left: 'center', textStyle: { color: textColor } },
    tooltip: { trigger: 'axis' },
    grid: { top: '12%', left: '8%', right: '4%', bottom: '15%' },
    xAxis,
    yAxis,
    dataZoom: [
      {
        type: 'slider',
        show: true,
        xAxisIndex: [0],
        start: 0,
        end: 10,
        bottom: 10
      },
      {
        type: 'inside',
        xAxisIndex: [0],
        start: 0,
        end: 10
      }
    ],
    series: [
      {
        type: 'line',
        data: (xData && yData) ? yData.map((y, i) => [xData[i], y]) : [],
        showSymbol: false,
        lineStyle: {
          width: isClinicalWave ? 1.8 : 1.5,
          color: lineColor
        }
      }
    ]
  };
  chart.setOption(option);
}

function getQuestionnaireItemId(item, index = 0) {
  if (item && item.id) return String(item.id);
  const sectionPrefixMap = {
    '五大人格': 'BF',
    '心理弹性': 'RS',
    '成就动机': 'AM'
  };
  const prefix = item && item.section ? sectionPrefixMap[item.section] : '';
  const number = item && Number.isFinite(Number(item.number)) ? Number(item.number) : NaN;
  if (prefix && Number.isFinite(number)) {
    return `${prefix}${String(number).padStart(2, '0')}`;
  }
  return `ITEM_${index + 1}`;
}

function getQuestionnaireScaleForItem(cfg, item) {
  if (cfg && cfg.response_scale) return cfg.response_scale;
  const allScales = (cfg && cfg.scales) ? cfg.scales : {};
  if (item && item.scale_id && allScales[item.scale_id]) return allScales[item.scale_id];
  const firstScaleId = Object.keys(allScales)[0];
  return firstScaleId ? allScales[firstScaleId] : {};
}

function computeQuestionnaireScores(cfg, answers) {
  const itemScores = {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  items.forEach((it, index) => {
    const itemId = getQuestionnaireItemId(it, index);
    const scale = getQuestionnaireScaleForItem(cfg, it);
    const min = scale.min || 1;
    const max = scale.max || 5;
    const v = answers[`q_item_${itemId}`];
    if (v == null) return;
    const val = parseInt(v, 10);
    const score = it.reverse_scored ? (min + max - val) : val;
    itemScores[itemId] = score;
  });
  const subscaleScores = {};
  const subscaleNames = {};
  const subs = cfg.scoring && Array.isArray(cfg.scoring.subscales) ? cfg.scoring.subscales : [];
  subs.forEach(s => {
    let sum = 0;
    const ids = Array.isArray(s.item_ids) ? s.item_ids : [];
    ids.forEach(id => {
      sum += itemScores[id] || 0;
    });
    subscaleScores[s.id] = sum;
    subscaleNames[s.id] = s.name || s.id;
  });
  const compositeScores = {};
  const comps = cfg.scoring && Array.isArray(cfg.scoring.composites) ? cfg.scoring.composites : [];
  comps.forEach(c => {
    const weights = c.weights || {};
    let total = 0;
    Object.keys(weights).forEach(k => {
      total += (subscaleScores[k] || 0) * (weights[k] || 0);
    });
    compositeScores[c.id] = total;
  });
  const namedSubscales = {};
  Object.keys(subscaleScores).forEach(k => {
    const nm = subscaleNames[k] || k;
    namedSubscales[nm] = subscaleScores[k];
  });
  const namedComposites = {};
  comps.forEach(c => {
    const nm = c.name || c.id;
    namedComposites[nm] = compositeScores[c.id] || 0;
  });
  const pickMetric = (source, key) => (
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null
  );
  const pickNamed = (subKey, compKey) => {
    if (compKey && Object.prototype.hasOwnProperty.call(namedComposites, compKey)) return namedComposites[compKey];
    if (subKey && Object.prototype.hasOwnProperty.call(namedSubscales, subKey)) return namedSubscales[subKey];
    return null;
  };
  const psyResults = {
    神经质_Psy: pickMetric(namedSubscales, '神经质'),
    尽责性_Psy: pickMetric(namedSubscales, '尽责性'),
    宜人性_Psy: pickMetric(namedSubscales, '宜人性'),
    开放性_Psy: pickMetric(namedSubscales, '开放性'),
    外向性_Psy: pickMetric(namedSubscales, '外向性'),
    坚韧_Psy: pickMetric(namedSubscales, '坚韧'),
    力量_Psy: pickMetric(namedSubscales, '力量'),
    乐观_Psy: pickMetric(namedSubscales, '乐观'),
    进取_Psy: pickMetric(namedSubscales, '进取'),
    主动_Psy: pickMetric(namedSubscales, '主动'),
    求精_Psy: pickMetric(namedSubscales, '求精'),
    奉献_Psy: pickMetric(namedSubscales, '奉献'),
    乐业_Psy: pickMetric(namedSubscales, '乐业')
  };
  return {
    items: itemScores,
    subscales: subscaleScores,
    composites: compositeScores,
    subscales_named: namedSubscales,
    composites_named: namedComposites,
    psy_results: psyResults
  };
}

function buildQuestionnaireMetrics(scores) {
  const subNamed = (scores && scores.subscales_named) || {};
  return {
    神经质: subNamed['神经质'] ?? null,
    尽责性: subNamed['尽责性'] ?? null,
    宜人性: subNamed['宜人性'] ?? null,
    开放性: subNamed['开放性'] ?? null,
    外向性: subNamed['外向性'] ?? null,
    坚韧: subNamed['坚韧'] ?? null,
    力量: subNamed['力量'] ?? null,
    乐观: subNamed['乐观'] ?? null,
    进取: subNamed['进取'] ?? null,
    主动: subNamed['主动'] ?? null,
    求精: subNamed['求精'] ?? null,
    奉献: subNamed['奉献'] ?? null,
    乐业: subNamed['乐业'] ?? null
  };
}

async function renderQuestionnaireFields() {
  const container = document.getElementById('questionnaire-fields');
  if (!container) return;
  if (container.dataset.rendered === 'true') return;
  const res = await window.api.getDefaultQuestionnaire();
  if (!res || !res.ok || !res.data) return;
  const cfg = res.data;
  defaultQuestionnaireCfg = cfg;
  
  const titleEl = document.querySelector('#questionnaire-form h3');
  if (titleEl) titleEl.innerText = cfg.title || '技能训练问卷';
  
  container.innerHTML = '';
  const sectionMeta = {
    '五大人格': {
      title: '第一部分：大五人格'
    },
    '心理弹性': {
      title: '第二部分：心理弹性'
    },
    '成就动机': {
      title: '第三部分：成就动机'
    }
  };
  const sectionOrder = ['五大人格', '心理弹性', '成就动机'];
  const grouped = new Map();
  (Array.isArray(cfg.items) ? cfg.items : []).forEach((item, index) => {
    const sectionName = item && item.section ? item.section : '其他';
    if (!grouped.has(sectionName)) grouped.set(sectionName, []);
    grouped.get(sectionName).push({ item, index });
  });
  const renderSections = [
    ...sectionOrder.filter(name => grouped.has(name)),
    ...Array.from(grouped.keys()).filter(name => !sectionOrder.includes(name))
  ];
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '1fr';
  wrap.style.gap = '16px';
  renderSections.forEach(sectionName => {
    const sectionBlock = document.createElement('div');
    sectionBlock.style.border = '1px solid #e2e8f0';
    sectionBlock.style.borderRadius = '10px';
    sectionBlock.style.padding = '14px';
    sectionBlock.style.background = '#fbfdff';

    const header = document.createElement('div');
    header.style.fontSize = '16px';
    header.style.fontWeight = '600';
    header.style.color = '#1f2937';
    header.style.marginBottom = '6px';
    header.innerText = (sectionMeta[sectionName] && sectionMeta[sectionName].title) || sectionName;
    sectionBlock.appendChild(header);

    const items = grouped.get(sectionName) || [];
    items.forEach(({ item, index }, idxInSection) => {
      const itemId = getQuestionnaireItemId(item, index);
      const scale = getQuestionnaireScaleForItem(cfg, item);
      const labels = scale.labels || {};
      const displayNo = idxInSection + 1;

      const group = document.createElement('div');
      group.style.marginBottom = '14px';
      const qText = document.createElement('div');
      qText.style.fontSize = '16px';
      qText.style.marginBottom = '8px';
      qText.style.color = '#111827';
      qText.innerText = `${displayNo}. ${item.text || `${sectionName} 第${displayNo}题`}`;
      group.appendChild(qText);

      const optionsRow = document.createElement('div');
      optionsRow.style.display = 'flex';
      optionsRow.style.gap = '20px';
      optionsRow.style.flexWrap = 'wrap';
      const min = scale.min || 1;
      const max = scale.max || 5;
      for (let v = min; v <= max; v++) {
        const optWrap = document.createElement('label');
        optWrap.style.display = 'inline-flex';
        optWrap.style.alignItems = 'center';
        optWrap.style.gap = '8px';
        optWrap.style.padding = '4px 8px';
        optWrap.style.borderRadius = '6px';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `q_item_${itemId}`;
        radio.value = String(v);
        radio.id = `q_item_${itemId}_${v}`;
        const txt = document.createElement('span');
        txt.style.fontSize = '15px';
        txt.style.color = '#555';
        txt.innerText = labels[String(v)] || String(v);
        optWrap.appendChild(radio);
        optWrap.appendChild(txt);
        optionsRow.appendChild(optWrap);
      }
      group.appendChild(optionsRow);
      sectionBlock.appendChild(group);
    });

    wrap.appendChild(sectionBlock);
  });

  container.appendChild(wrap);
  container.dataset.rendered = 'true';
}

// --- Render Helpers ---

function renderFeatureBarChart(elId, features) {
  const chartDom = document.getElementById(elId);
  if (!chartDom) return;
  const existing = echarts.getInstanceByDom(chartDom);
  if (existing) existing.dispose();
  
  const chart = echarts.init(chartDom);
  
  // features is array of [key, value]
  const categories = features.map(f => f[0]);
  const values = features.map(f => f[1]);
  
  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed' } } },
    yAxis: { 
        type: 'category', 
        data: categories, 
        inverse: true,
        axisLabel: { width: 140, overflow: 'truncate' } 
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: '#3b82f6' },
                { offset: 1, color: '#2563eb' }
            ]),
            borderRadius: [0, 4, 4, 0]
        },
        label: { show: true, position: 'right', formatter: '{c}' }
      }
    ]
  };
  chart.setOption(option);
}

function renderKeyMetrics(features, limit) {
    if (!features) return '';
    const entries = Object.entries(features).slice(0, limit);
    return entries.map(([k, v]) => `
        <div class="pro-metric-card">
            <div class="pro-metric-label" title="${k}">${k}</div>
            <div class="pro-metric-value">${typeof v === 'number' ? v.toFixed(2) : v}</div>
        </div>
    `).join('');
}

window.switchProTab = function(el, targetId) {
    const panel = el.closest('.pro-panel');
    const tabs = panel.querySelectorAll('.pro-tab');
    const contents = panel.querySelectorAll('.pro-content');
    
    tabs.forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    
    contents.forEach(c => {
        if (c.dataset.tab === targetId) c.classList.add('active');
        else c.classList.remove('active');
    });
    
    // Resize charts
    setTimeout(() => {
        const charts = panel.querySelectorAll('.pro-content.active div[id^="chart-"]');
        charts.forEach(div => {
            const instance = echarts.getInstanceByDom(div);
            if (instance) instance.resize();
        });
    }, 50);
};

function getGuidance(type, label, labelText) {
    const templates = {
        'ele': {
            '高水平': '该士兵体能综合素质优异，具备较强的高强度持续作战能力。建议：1. 保持当前训练强度，巩固优势；2. 可适当增加极限环境下的适应性训练；3. 适合承担高负荷突击任务。',
            '低水平': '该士兵体能基础相对薄弱，在高负荷任务中可能出现耐力不足。建议：1. 重点加强心肺耐力与核心力量的基础训练；2. 制定循序渐进的增负计划，避免运动损伤；3. 关注营养摄入与恢复，提升体能储备。'
        },
        'cog': {
            '记忆强': '该士兵在工作记忆与信息保持方面表现突出。建议：1. 适合安排情报分析、复杂指令传达等任务；2. 训练中可增加多任务并行处理的难度；3. 发挥其在细节捕捉上的优势。',
            '推理强': '该士兵逻辑推理与战术理解能力较强。建议：1. 适合参与战术规划、现场指挥决策等岗位；2. 训练中增加战场态势研判环节；3. 鼓励其参与战法创新研讨。',
            '执行强': '该士兵反应速度快，执行指令果断。建议：1. 适合担任突击手、驾驶员等对反应速度要求高的角色；2. 训练中强化瞬时反应与压力下的动作精准度；3. 保持高强度的实战化模拟训练。'
        },
        'mot_type': {
            '自主动机型': '该类型个体主要受内在兴趣、个人价值认同驱动。建议：给予充分的自主权，鼓励其挑战更高目标，发挥榜样作用。',
            '外在调节型': '该类型个体主要受外部奖惩、压力或顺从意愿驱动。建议：建立明确的奖惩反馈机制，逐步引导其寻找训练的内在乐趣。',
            '内部动机': '该士兵训练热情源于内心热爱，积极性高。建议：给予充分的自主权，鼓励其挑战更高目标，发挥榜样作用。',
            '认同动机': '该士兵认同训练价值，自觉性较好。建议：明确任务意义，强化其对集体目标的认同感。',
            '外在调节': '该士兵主要受奖惩机制驱动。建议：建立明确的奖惩反馈机制，逐步引导其寻找训练的内在乐趣。',
            '无动机': '该士兵缺乏训练动力，可能存在心理倦怠。建议：重点关注心理状态，进行深入沟通，寻找动力阻碍点，制定个性化激励方案。'
        },
        'mot_level': {
            '高自主动机水平': '心理韧性强，抗压能力出色。建议：可委以重任，在团队中担任精神核心，带动整体士气。',
            '较低自主动机水平': '易受外界环境影响，情绪波动可能较大。建议：加强心理疏导与抗压训练，多给予正向反馈，帮助建立自信心。'
        }
    };

    let key = type;
    let subKey = labelText;
    
    // Fuzzy match for label text if exact match not found
    if (templates[key]) {
        if (templates[key][subKey]) return templates[key][subKey];
        for (const k in templates[key]) {
            if (subKey.includes(k)) return templates[key][k];
        }
    }
    
    return '暂无特定指导意见。建议结合具体各项指标进行针对性补强。';
}

function renderProfessionalPanel(containerId, res, options) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.style.display = 'block';
    
    // Unique IDs
    const uid = Math.random().toString(36).substr(2, 9);
    const overviewChartId = `chart-overview-${uid}`;
    const featureChartId = `chart-features-${uid}`;
    
    // Prepare features
    const features = res.input_features || {};
    // Sort by absolute value descending for visualization relevance (heuristic)
    const sortedFeatures = Object.entries(features)
        .filter(([k, v]) => typeof v === 'number' && !isNaN(v))
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 15);

    const topFeatures = sortedFeatures.slice(0, 6);
    // Removed metrics preview as per user request
    /*
    const renderMetricsHtml = (entries) => entries.map(([k, v]) => `
        <div class="pro-metric-card">
            <div class="pro-metric-label" title="${k}">${k}</div>
            <div class="pro-metric-value">${typeof v === 'number' ? v.toFixed(2) : v}</div>
        </div>
    `).join('');
    */

    const guidanceText = getGuidance(
        options.guidanceKey || options.tag.toLowerCase(), 
        res.label, 
        res.label_text || res.label
    );

    const tabsHtml = `
      <div class="pro-panel">
        <div class="pro-tabs">
          <div class="pro-tab active" onclick="switchProTab(this, 'overview')">总览 (Overview)</div>
          <div class="pro-tab" onclick="switchProTab(this, 'analysis')">结果分析 (Analysis)</div>
        </div>
        
        <div class="pro-content active" data-tab="overview">
           <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 280px;">
                 <div style="margin-bottom: 12px;">
                    <span style="background: ${options.color || '#2563eb'}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
                        ${options.tag || 'PREDICTION'}
                    </span>
                 </div>
                 <h2 style="margin: 0 0 12px 0; color: #1e293b; font-size: 24px;">${res.label_text || '未知'}</h2>
                 <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0; line-height: 1.5;">
                    ${options.description || '基于多模态数据的智能预测结果'}
                 </p>
                 
                 <!-- Removed Key Metrics Preview -->
              </div>
              <div id="${overviewChartId}" style="width: 400px; height: 320px; background: #f8fafc; border-radius: 12px; border: 1px solid #f1f5f9;"></div>
           </div>
        </div>
        
        <div class="pro-content" data-tab="analysis">
           <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
             <h4 style="margin: 0 0 8px 0; color: #0c4a6e; font-size: 16px;">💡 指导与建议</h4>
             <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.6;">
               ${guidanceText}
             </p>
           </div>
        </div>
      </div>
    `;
    
    container.innerHTML = tabsHtml;
    
    // Render Charts
    setTimeout(() => {
        if (options.type === 'gauge') {
            renderGaugeChart(overviewChartId, options.value, options.valueTitle, options.min, options.max, options.isPercent);
        } else if (options.type === 'radar') {
            renderRadarChart(overviewChartId, options.radarData, options.radarTitle);
        }
        
        // renderFeatureBarChart(featureChartId, sortedFeatures);
    }, 0);
}

function renderGaugeChart(elId, value, title, min = 0, max = 1, isPercent = true) {
  const chartDom = document.getElementById(elId);
  if (!chartDom) return;
  
  // Dispose existing instance if any
  const existingInstance = echarts.getInstanceByDom(chartDom);
  if (existingInstance) existingInstance.dispose();

  const chart = echarts.init(chartDom);
  
  // Robustness fix: If isPercent is true and max is still default 1, assume 100
  if (isPercent && max === 1) max = 100;

  const val = isPercent ? (value * 100).toFixed(1) : value.toFixed(1);
  const displayVal = parseFloat(val);
  
  // Color calculation for gauge progress
  // For standard 0-100 or 0-1, we can use standard colors.
  // For custom range like -81 to 91, we might need mapped colors.
  
  const option = {
    series: [
      {
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        min: min,
        max: max,
        splitNumber: 5,
        itemStyle: {
          color: '#58D9F9',
          shadowColor: 'rgba(0,138,255,0.45)',
          shadowBlur: 10,
          shadowOffsetX: 2,
          shadowOffsetY: 2
        },
        progress: {
          show: true,
          roundCap: true,
          width: 12
        },
        pointer: {
          show: true,
          length: '70%',
          width: 6,
          itemStyle: { color: 'auto' }
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 12
          }
        },
        axisTick: {
          splitNumber: 2,
          lineStyle: {
            width: 2,
            color: '#999'
          }
        },
        splitLine: {
          length: 20,
          lineStyle: {
            width: 3,
            color: '#999'
          }
        },
        axisLabel: {
          distance: 25,
          color: '#999',
          fontSize: 12
        },
        title: {
          show: true,
          offsetCenter: [0, '30%'],
          fontSize: 14,
          color: '#555'
        },
        detail: {
          valueAnimation: true,
          formatter: function (value) {
            return value.toFixed(1) + (isPercent ? '%' : '');
          },
          color: '#333',
          fontSize: 20,
          offsetCenter: [0, '65%']
        },
        data: [
          {
            value: displayVal,
            name: title
          }
        ]
      }
    ]
  };
  chart.setOption(option);
}

function renderRadarChart(elId, probs, title) {
  const chartDom = document.getElementById(elId);
  if (!chartDom) return;
  
  const existingInstance = echarts.getInstanceByDom(chartDom);
  if (existingInstance) existingInstance.dispose();

  const chart = echarts.init(chartDom);
  
  const keys = Object.keys(probs);
  const values = keys.map(k => probs[k]);
  
  // Set max to 1.0 since these are probabilities
  const indicators = keys.map(key => ({
    name: key,
    max: 1.0 
  }));
  
  const option = {
    title: {
      text: title,
      left: 'center',
      top: 10,
      textStyle: { fontSize: 16, color: '#1e293b', fontWeight: 'bold' }
    },
    tooltip: {
        trigger: 'item'
    },
    radar: {
      indicator: indicators,
      center: ['50%', '55%'],
      radius: '65%',
      splitNumber: 4,
      axisName: {
        color: '#64748b',
        fontWeight: 'bold',
        fontSize: 13,
        padding: [3, 5]
      },
      splitArea: {
        areaStyle: {
          color: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1'].reverse()
        }
      },
      axisLine: {
        lineStyle: {
            color: '#94a3b8'
        }
      },
      splitLine: {
        lineStyle: {
            color: '#cbd5e1'
        }
      }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: values,
            name: '概率分布'
          }
        ],
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: {
            color: '#8b5cf6',
            borderColor: '#fff',
            borderWidth: 2
        },
        areaStyle: {
          opacity: 0.5,
          color: new echarts.graphic.RadialGradient(0.5, 0.5, 1, [
            { offset: 0, color: 'rgba(139, 92, 246, 0.2)' },
            { offset: 1, color: 'rgba(139, 92, 246, 0.8)' }
          ])
        },
        lineStyle: {
            color: '#8b5cf6',
            width: 3
        }
      }
    ]
  };
  chart.setOption(option);
}

function renderEmgResult(d, subjectId) {
  const container = document.getElementById('emg-results');
  if (container) container.style.display = 'block';
  
  // Update state
  lastEmgAnalysis = d;
  if (subjectId) lastEmgSubjectId = subjectId;

  const grid = document.getElementById('emg-metrics');
  if (grid) {
    grid.innerHTML = '';
    const m = d.metrics || {};
    const rows = [
      ['上肢肌电平均绝对值 (μV)', m.Arm_MAV],
      ['上肢肌电中值频率 (Hz)', m.Arm_MDF],
      ['上肢肌电平均功率频率 (Hz)', m.Arm_MPF],
      ['上肢肌电均方根 (μV)', m.Arm_RMS],
      ['上肢肌电积分 (μV·s)', m.Arm_iEMG],
      ['上肢肌电最大幅值 (μV)', m.Arm_Max_Amp],
      ['颈部肌电平均绝对值 (μV)', m.Neck_MAV],
      ['颈部肌电中值频率 (Hz)', m.Neck_MDF],
      ['颈部肌电平均功率频率 (Hz)', m.Neck_MPF],
      ['颈部肌电均方根 (μV)', m.Neck_RMS],
      ['颈部肌电积分 (μV·s)', m.Neck_iEMG],
      ['颈部肌电最大幅值 (μV)', m.Neck_Max_Amp]
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'metric-card';
      div.style.background = '#f8fafc';
      div.style.border = '1px solid #e2e8f0';
      div.style.borderRadius = '6px';
      div.style.padding = '8px 12px';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.justifyContent = 'center';

      const labelSpan = document.createElement('span');
      labelSpan.style.fontSize = '12px';
      labelSpan.style.color = '#64748b';
      labelSpan.style.marginBottom = '4px';
      labelSpan.innerText = label;

      const valueSpan = document.createElement('span');
      valueSpan.style.fontSize = '18px';
      valueSpan.style.fontWeight = 'bold';
      valueSpan.style.color = '#0f172a';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      valueSpan.innerText = v;

      div.appendChild(labelSpan);
      div.appendChild(valueSpan);
      grid.appendChild(div);
    });
  }
  renderSeriesChart('emg-charts', d.times || [], d.voltage || [], 'EMG 时序');
}

function renderEcgResult(d, subjectId) {
  const container = document.getElementById('ecg-results');
  if (container) container.style.display = 'block';
  
  lastEcgAnalysis = d;
  if (subjectId) lastEcgSubjectId = subjectId;

  const grid = document.getElementById('ecg-metrics');
  if (grid) {
    grid.innerHTML = '';
    const m = d.metrics || {};
    const rows = [
      ['心电 R 峰数量 (次)', m.n_peaks_ECG],
      ['平均 RR 间期 (ms)', m.Mean_RR_ms_ECG],
      ['RR 间期标准差 (ms)', m.SDNN_ms_ECG],
      ['相邻 RR 差值均方根 (ms)', m.RMSSD_ms_ECG],
      ['相邻 RR 间期差值 >50ms 比例 (%)', m.pNN50_pct_ECG],
      ['平均心率 (bpm)', m.HR_Mean_ECG],
      ['心率标准差 (bpm)', m.HR_Std_ECG],
      ['心率变化率', m.HR_Change_Rate_ECG]
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'metric-card';
      div.style.background = '#f8fafc';
      div.style.border = '1px solid #e2e8f0';
      div.style.borderRadius = '6px';
      div.style.padding = '8px 12px';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.justifyContent = 'center';

      const labelSpan = document.createElement('span');
      labelSpan.style.fontSize = '12px';
      labelSpan.style.color = '#64748b';
      labelSpan.style.marginBottom = '4px';
      labelSpan.innerText = label;

      const valueSpan = document.createElement('span');
      valueSpan.style.fontSize = '18px';
      valueSpan.style.fontWeight = 'bold';
      valueSpan.style.color = '#0f172a';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      valueSpan.innerText = v;

      div.appendChild(labelSpan);
      div.appendChild(valueSpan);
      grid.appendChild(div);
    });
  }
  renderSeriesChart('ecg-charts', d.time || [], d.voltage || [], 'ECG 时序');
}

function renderEyeResult(d, subjectId) {
  const container = document.getElementById('eye-results');
  if (container) container.style.display = 'block';
  
  lastEyeAnalysis = d;
  if (subjectId) lastEyeSubjectId = subjectId;

  const grid = document.getElementById('eye-metrics');
  if (grid) {
    grid.innerHTML = '';
    const m = d.metrics || {};
    const blinkAnomalyAll = m.blink_anomaly_all === true;
    const blinkAnomalyCount = typeof m.blink_anomaly_count === 'number' ? m.blink_anomaly_count : 0;
    const blinkLabelSuffix = blinkAnomalyAll ? '（数据异常）' : (blinkAnomalyCount > 0 ? '（已剔除异常）' : '');
    const blinkValue = (v) => blinkAnomalyAll ? '数据异常' : v;
    
    // Add title indicating batch or single
    /*
    if (d.isBatch) {
      const header = document.createElement('div');
      header.style.width = '100%';
      header.style.fontWeight = 'bold';
      header.style.padding = '5px 0';
      header.style.borderBottom = '1px solid #ccc';
      header.innerText = `批量分析结果 (平均值，共 ${d.count} 个文件)`;
      grid.appendChild(header);
    }
    */

    const rows = [
      ['由于增加了上面的三个指标', null], // Placeholder or wait, I don't need this right? Let me check the prompt: "数据分析模块中ecg，emg和眼动数据分析中，软件中展示的指标名称直接采用Neck_Max_Amp这种变量名，现将其全部改成中文名(单位)的形式，并优化指标的展示表格，使其紧凑且美观。"
      ['眨眼次数 (次)' + blinkLabelSuffix, blinkValue(m.blink_count_Eye)],
      ['眨眼频率 (次/分钟)' + blinkLabelSuffix, blinkValue(m.blink_rate_Hz_Eye)],
      ['眨眼持续时间 (ms)' + blinkLabelSuffix, blinkValue(m.blink_dur_ms_Eye)],
      ['注视次数 (次)', m.fixation_count_Eye],
      ['注视频率 (次/分钟)', m.fixation_rate_Hz_Eye],
      ['平均注视时长 (ms)', m.avg_fixation_dur_ms_Eye],
      ['平均瞳孔直径 (mm)', m.avg_pupil_diam_mm_Eye],
      ['扫视次数 (次)', m.saccade_count_Eye],
      ['扫视频率 (次/分钟)', m.saccade_rate_Hz_Eye],
      ['平均扫视幅度 (度)', m.avg_saccade_amp_deg_Eye],
      ['平均扫视速度 (度/秒)', m.avg_saccade_vel_deg_s_Eye]
    ];
    // Remove the null placeholder before mapping
    rows.shift();
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'metric-card';
      div.style.background = '#f8fafc';
      div.style.border = '1px solid #e2e8f0';
      div.style.borderRadius = '6px';
      div.style.padding = '8px 12px';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.justifyContent = 'center';

      const labelSpan = document.createElement('span');
      labelSpan.style.fontSize = '12px';
      labelSpan.style.color = '#64748b';
      labelSpan.style.marginBottom = '4px';
      labelSpan.innerText = label;

      const valueSpan = document.createElement('span');
      valueSpan.style.fontSize = '18px';
      valueSpan.style.fontWeight = 'bold';
      valueSpan.style.color = '#0f172a';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      valueSpan.innerText = v;

      div.appendChild(labelSpan);
      div.appendChild(valueSpan);
      grid.appendChild(div);
    });
  }
  
  // Clear existing heatmaps
  const chartsContainer = document.getElementById('eye-charts-container');
  if (chartsContainer) {
    chartsContainer.innerHTML = ''; // Clear all previous charts
  }

  // Render heatmaps
  if (d.isBatch && Array.isArray(d.results)) {
    d.results.forEach((res, index) => {
      renderEyeHeatmap(res, index + 1);
    });
  } else {
    renderEyeHeatmap(d);
  }
}

// --- 3. Module Logic ---

function getSubjectId(inputId) {
  const el = document.getElementById(inputId);
  return el ? el.value.trim() : '';
}

function getGlobalSubjectId() {
  return getSubjectId('basic_subject_id');
}

// Questionnaire Radar Analysis
const analyzeQuestionnaireBtn = document.getElementById('analyzeQuestionnaireBtn');
if (analyzeQuestionnaireBtn) {
    analyzeQuestionnaireBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) return showModal('请先在问卷中填写被试编号 (Please enter Subject ID first)');
        
        await withLoading(analyzeQuestionnaireBtn, async () => {
            const [scoreRes, cfgRes] = await Promise.all([
                window.api.getLatestQuestionnaire(subjectId),
                defaultQuestionnaireCfg ? Promise.resolve({ ok: true, data: defaultQuestionnaireCfg }) : window.api.getDefaultQuestionnaire()
            ]);
            if (scoreRes.ok && scoreRes.data) {
                if (cfgRes && cfgRes.ok && cfgRes.data) defaultQuestionnaireCfg = cfgRes.data;
                const resultsContainer = document.getElementById('questionnaire-analysis-results');
                if (resultsContainer) resultsContainer.style.display = 'block';
                
                renderQuestionnaireRadar(scoreRes.data.scores || {}, defaultQuestionnaireCfg);
                renderQuestionnaireTable('questionnaire-table-container', scoreRes.data.scores || {}, defaultQuestionnaireCfg);
                showModal('问卷数据加载成功 (Data Loaded)');
            } else {
                showModal('加载失败 (Load Failed): ' + (scoreRes.error || '未找到数据'));
            }
        });
    };
}

const questionnaireTheoreticalRanges = {
  神经质: { min: 8, max: 48 },
  尽责性: { min: 8, max: 48 },
  宜人性: { min: 8, max: 48 },
  开放性: { min: 8, max: 48 },
  外向性: { min: 8, max: 48 },
  坚韧: { min: 13, max: 65 },
  力量: { min: 8, max: 40 },
  乐观: { min: 4, max: 20 },
  进取: { min: 3, max: 15 },
  主动: { min: 5, max: 25 },
  求精: { min: 3, max: 15 },
  奉献: { min: 5, max: 25 },
  乐业: { min: 3, max: 15 }
};

function getQuestionnaireTheoreticalRangeByName(metricName) {
  const range = questionnaireTheoreticalRanges[metricName];
  if (!range) return null;
  return { min: range.min, max: range.max };
}

function getQuestionnaireSubscaleRange(cfg, subscaleId) {
  const subs = cfg && cfg.scoring && Array.isArray(cfg.scoring.subscales) ? cfg.scoring.subscales : [];
  const target = subs.find(s => s.id === subscaleId);
  if (!target) return { min: 0, max: 100 };
  const namedRange = getQuestionnaireTheoreticalRangeByName(target.name);
  if (namedRange) return namedRange;
  const itemMap = new Map((Array.isArray(cfg.items) ? cfg.items : []).map(it => [it.id, it]));
  let min = 0;
  let max = 0;
  (Array.isArray(target.item_ids) ? target.item_ids : []).forEach(itemId => {
    const item = itemMap.get(itemId);
    const scale = getQuestionnaireScaleForItem(cfg, item || {});
    min += Number(scale.min || 1);
    max += Number(scale.max || 5);
  });
  return { min, max: max > min ? max : min + 1 };
}

function getQuestionnaireCompositeRange(cfg, compositeId) {
  const comps = cfg && cfg.scoring && Array.isArray(cfg.scoring.composites) ? cfg.scoring.composites : [];
  const target = comps.find(c => c.id === compositeId);
  if (!target || !target.weights) return { min: 0, max: 100 };
  const namedRange = getQuestionnaireTheoreticalRangeByName(target.name);
  if (namedRange) return namedRange;
  let min = 0;
  let max = 0;
  Object.keys(target.weights).forEach(subscaleId => {
    const w = Number(target.weights[subscaleId] || 0);
    const subRange = getQuestionnaireSubscaleRange(cfg, subscaleId);
    if (w >= 0) {
      min += w * subRange.min;
      max += w * subRange.max;
    } else {
      min += w * subRange.max;
      max += w * subRange.min;
    }
  });
  if (min === max) max = min + 1;
  if (min > max) return { min: max, max: min };
  return { min, max };
}

function renderQuestionnaireTable(containerId, scores, questionnaireCfg) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
}

function renderQuestionnaireRadar(scores, questionnaireCfg) {
    const subscales = scores.subscales_named || {};
    const radarDefs = [
      {
        chartId: 'questionnaire-radar-bigfive',
        title: '大五人格',
        color: '#7c3aed',
        dimensions: [
          { name: '神经质', subscaleId: 'neuroticism' },
          { name: '尽责性', subscaleId: 'conscientiousness' },
          { name: '宜人性', subscaleId: 'agreeableness' },
          { name: '开放性', subscaleId: 'openness' },
          { name: '外向性', subscaleId: 'extraversion' }
        ]
      },
      {
        chartId: 'questionnaire-radar-psycap',
        title: '心理弹性',
        color: '#059669',
        dimensions: [
          { name: '坚韧', subscaleId: 'tenacity' },
          { name: '力量', subscaleId: 'strength' },
          { name: '乐观', subscaleId: 'optimism' }
        ]
      },
      {
        chartId: 'questionnaire-radar-achievement',
        title: '成就动机',
        color: '#0ea5e9',
        dimensions: [
          { name: '进取', subscaleId: 'ambition' },
          { name: '主动', subscaleId: 'initiative' },
          { name: '求精', subscaleId: 'excellence' },
          { name: '奉献', subscaleId: 'dedication' },
          { name: '乐业', subscaleId: 'job_satisfaction' }
        ]
      }
    ];

    radarDefs.forEach(radarDef => {
      const chartDom = document.getElementById(radarDef.chartId);
      if (!chartDom) return;
      const existingInstance = echarts.getInstanceByDom(chartDom);
      if (existingInstance) existingInstance.dispose();

      const chart = echarts.init(chartDom);
      const indicators = radarDef.dimensions.map(dim => {
        const range = getQuestionnaireSubscaleRange(questionnaireCfg, dim.subscaleId);
        return {
          name: dim.name,
          min: range.min,
          max: range.max
        };
      });
      const values = radarDef.dimensions.map(dim => Number(subscales[dim.name] || 0));
      chart.setOption({
        title: {
          text: radarDef.title,
          left: 'center',
          textStyle: { fontSize: 16, fontWeight: 600 }
        },
        tooltip: {},
        radar: {
          indicator: indicators,
          center: ['50%', '56%'],
          radius: '64%'
        },
        series: [{
          type: 'radar',
          data: [{
            value: values,
            name: '得分'
          }],
          areaStyle: { opacity: 0.2, color: radarDef.color },
          lineStyle: { color: radarDef.color, width: 2 },
          itemStyle: { color: radarDef.color }
        }]
      });
      window.addEventListener('resize', () => chart.resize());
    });
}

// EMG Analysis
const launchEmgBtn = document.getElementById('launchEmgBtn');
if (launchEmgBtn) {
  launchEmgBtn.onclick = async () => {
    const subjectId = getGlobalSubjectId();
    await withLoading(launchEmgBtn, async () => {
      const res = await window.api.launchSoftware('emg', subjectId);
      if (!res.success) throw new Error(res.message);
    });
  };
}

const analyzeEmgBtn = document.getElementById('analyzeEmgBtn');
if (analyzeEmgBtn) {
  analyzeEmgBtn.onclick = async () => {
    await withLoading(analyzeEmgBtn, async () => {
      const subjectId = getGlobalSubjectId();
      const res = await window.api.computeEMG(subjectId);
      if (res.canceled) return;
      if (!res.ok) throw new Error(res.error);
      
      renderEmgResult(res.data, subjectId);
      await autoSavePhysioAnalysis('emg', subjectId, res.data);
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

// ECG
const launchEcgBtn = document.getElementById('launchEcgBtn');
if (launchEcgBtn) {
  launchEcgBtn.onclick = async () => {
    const subjectId = getGlobalSubjectId();
    await withLoading(launchEcgBtn, async () => {
      const res = await window.api.launchSoftware('ecg', subjectId);
      if (!res.success) throw new Error(res.message);
    });
  };
}

const analyzeEcgBtn = document.getElementById('analyzeEcgBtn');
if (analyzeEcgBtn) {
  analyzeEcgBtn.onclick = async () => {
    await withLoading(analyzeEcgBtn, async () => {
      const subjectId = getGlobalSubjectId();
      const res = await window.api.computeECG(subjectId);
      if (res.canceled) return;
      if (!res.ok) throw new Error(res.error);
      
      renderEcgResult(res.data, subjectId);
      await autoSavePhysioAnalysis('ecg', subjectId, res.data);
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

// VR
const launchVrBtn = document.getElementById('launchVrBtn');
if (launchVrBtn) {
  launchVrBtn.onclick = async () => {
    const subjectId = getGlobalSubjectId();
    await withLoading(launchVrBtn, async () => {
      const res = await window.api.launchSoftware('eye', subjectId);
      if (!res.success) throw new Error(res.message);
    });
  };
}

const analyzeEyeBtn = document.getElementById('analyzeEyeBtn');
if (analyzeEyeBtn) {
  analyzeEyeBtn.onclick = async () => {
    await withLoading(analyzeEyeBtn, async () => {
      const subjectId = getGlobalSubjectId();
      const res = await window.api.computeEye(subjectId);
      if (res.canceled) return;
      if (!res.ok) throw new Error(res.error);
      
      renderEyeResult(res.data, subjectId);
      await autoSavePhysioAnalysis('eye', subjectId, res.data);
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

// Heatmap Renderer
function renderEyeHeatmap(data, index = 1) {
  const container = document.getElementById('eye-charts-container');
  if (!container) return;
  
  const taskId = data.filename ? data.filename.replace(/[^a-zA-Z0-9]/g, '_') : 'manual_' + Date.now();
  
  const wrapper = document.createElement('div');
  wrapper.id = `wrapper-${taskId}`;
  wrapper.style.width = '100%';
  wrapper.style.height = '400px';
  wrapper.style.marginTop = '20px';
  wrapper.style.border = '1px solid #eee'; // Add border to separate charts
  container.appendChild(wrapper);
  
  const chart = echarts.init(wrapper);
  const heatmapData = data.heatmapData || []; // [x, y, value]
  
  const titleText = data.filename ? `Gaze Heatmap (${index}): ${data.filename}` : `Gaze Heatmap ${index}`;

  const option = {
      title: { text: titleText, left: 'center' },
      tooltip: { position: 'top' },
      grid: { top: '15%', height: '70%' },
      xAxis: { type: 'value', min: -180, max: 180, name: 'Yaw' },
      yAxis: { type: 'value', min: -90, max: 90, name: 'Pitch' },
      visualMap: {
          min: 0,
          max: 1, // Dynamic later
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: '0%'
      },
      series: [{
          type: 'heatmap',
          data: heatmapData,
          emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } }
      }]
  };
  
  // Adjust max
  if (heatmapData.length > 0) {
      const maxVal = Math.max(...heatmapData.map(d => d[2]));
      option.visualMap.max = maxVal;
  }
  
  chart.setOption(option);
}

// --- 4. Data Logic ---

// Questionnaire
const saveQuestionnaireBtn = document.getElementById('saveQuestionnaireBtn');
if (saveQuestionnaireBtn) {
    saveQuestionnaireBtn.onclick = async () => {
        const data = {};
        const basicInputs = document.querySelectorAll('#basic-info-section input, #basic-info-section select');
        basicInputs.forEach(input => {
            if (input.id) data[input.id] = input.value;
        });
        if (defaultQuestionnaireCfg && Array.isArray(defaultQuestionnaireCfg.items)) {
          defaultQuestionnaireCfg.items.forEach((item, index) => {
            const itemId = getQuestionnaireItemId(item, index);
            const checked = document.querySelector(`input[name="q_item_${itemId}"]:checked`);
            data[`q_item_${itemId}`] = checked ? parseInt(checked.value, 10) : null;
          });
          data.questionnaire_id = defaultQuestionnaireCfg.questionnaire_id || 'default';
          data.title = defaultQuestionnaireCfg.title || '技能训练问卷';
        }
        data.subject_id = data.basic_subject_id || data.subject_id || '';
        const err = document.getElementById('questionnaire-error');
        if (!data.basic_subject_id) {
          if (err) {
            err.innerText = '请填写被试编号 (Please enter Subject ID)';
            err.style.display = 'block';
          }
          return;
        } else if (err) {
          err.style.display = 'none';
        }
        await withLoading(saveQuestionnaireBtn, async () => {
          if (defaultQuestionnaireCfg) {
            const scores = computeQuestionnaireScores(defaultQuestionnaireCfg, data);
            data.scores = scores;
            data.questionnaire_metrics = buildQuestionnaireMetrics(scores);
          }
          await window.api.saveQuestionnaireAnswers(data);
          // Removed result display as per request
          showModal('问卷已保存 (Questionnaire Saved)');
        });
    };
}

const listAnswersBtn = document.getElementById('listAnswersBtn');
if (listAnswersBtn) {
    listAnswersBtn.onclick = async () => {
        await withLoading(listAnswersBtn, async () => {
            const res = await window.api.listQuestionnaireAnswers();
            if (res.ok) {
                const listDiv = document.getElementById('answers-list-content');
                const listContainer = document.getElementById('answers-list');
                if (listContainer) listContainer.style.display = 'block';
                if (listDiv) {
                    listDiv.innerHTML = res.data.map(item => `
                        <div style="padding:5px;border-bottom:1px solid #eee">
                            <b>${item.subject_id}</b> - ${item.created_at}
                        </div>
                    `).join('');
                }
            }
        });
    }
}


// Physio
const savePhysioBtn = document.getElementById('savePhysioBtn');
if (savePhysioBtn) {
    savePhysioBtn.onclick = async () => {
        const inputs = document.querySelectorAll('#physio-section input');
        const data = {};
        inputs.forEach(input => {
            if (input.id && input.value !== '') {
                // Try to parse as float if it looks like a number
                const val = parseFloat(input.value);
                data[input.id] = isNaN(val) ? input.value : val;
            }
        });
        const subjectId = getGlobalSubjectId();
        if (!subjectId) return showModal('请先在问卷中填写 Subject ID');
        data.subject_id = subjectId;
        
        await withLoading(savePhysioBtn, async () => {
            const res = await window.api.savePhysioRecord(data);
            if (res.ok) showModal('保存成功 (Saved Successfully)');
            else showModal('保存失败 (Save Failed): ' + res.error);
        });
    };
}

const listPhysioBtn = document.getElementById('listPhysioBtn');
if (listPhysioBtn) {
    listPhysioBtn.onclick = async () => {
         await withLoading(listPhysioBtn, async () => {
            const res = await window.api.listPhysioRecords();
            if (res.ok) {
                 const listDiv = document.getElementById('physio-list-content');
                const listContainer = document.getElementById('physio-list');
                if (listContainer) listContainer.style.display = 'block';
                if (listDiv) {
                    listDiv.innerHTML = res.data.map(item => `
                        <div style="padding:5px;border-bottom:1px solid #eee">
                            <b>${item.subject_id}</b> - ${item.created_at}
                        </div>
                    `).join('');
                }
            }
         });
    }
}

const exportUnifiedCsvBtn = document.getElementById('exportUnifiedCsvBtn');
if (exportUnifiedCsvBtn) {
    exportUnifiedCsvBtn.onclick = async () => {
        await withLoading(exportUnifiedCsvBtn, async () => {
            const res = await window.api.exportUnifiedCsv();
            if (res && res.ok) {
                showModal('导出成功 (Exported): ' + res.filePath);
            } else {
                const msg = res && res.error ? res.error : '未知错误';
                showModal('导出失败 (Export Failed): ' + msg);
            }
        });
    };
}

const exportPdfReportBtn = document.getElementById('exportPdfReportBtn');
if (exportPdfReportBtn) {
    exportPdfReportBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先填写被试编号 (Please enter Subject ID first)');
        }
        
        await withLoading(exportPdfReportBtn, async () => {
            const res = await window.api.exportPdfReport(subjectId);
            if (res && res.ok) {
                showModal('PDF 报告已生成 (PDF Report Generated): ' + res.filePath);
            } else {
                const msg = res && res.error ? res.error : '未知错误';
                showModal('生成报告失败 (Generation Failed): ' + msg);
            }
        });
    };
}

// Questionnaire Reset
const resetQuestionnaireBtn = document.getElementById('resetQuestionnaireBtn');
if (resetQuestionnaireBtn) {
    resetQuestionnaireBtn.onclick = () => {
        if (confirm('确定要重置吗？ (Are you sure to reset?)')) {
            const inputs = document.querySelectorAll('#questionnaire-form input, #questionnaire-form select');
            inputs.forEach(input => input.value = '');
            showModal('重置完成 (Reset Complete)');
        }
    };
}

// Game Score Module
const gameScoreMap = {
    Shooting_TotalScore_Score: 'val_shooting_total',
    Shooting_Accuracy_Score: 'val_shooting_accuracy',
    Shooting_AvgScore_Score: 'val_shooting_avg',
    Task4_BallAndRing_Score: 'val_task4_ball',
    Task4_NumberLine_Score: 'val_task4_line',
    Task4_Total_Score: 'val_task4_total',
    Task4_Accuracy_Score: 'val_task4_accuracy',
    Game5_TotalScore_Score: 'val_game5_total',
    Game5_LifeSum_Score: 'val_game5_life'
};

async function handleGameImport(btnId, type) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    btn.onclick = async () => {
        await withLoading(btn, async () => {
            const filePath = await window.api.selectFile({
                filters: [
                    { name: 'Game Data', extensions: ['txt', 'csv', 'json'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            
            if (!filePath) return;
            
            const res = await window.api.analyzeGameFile(type, filePath);
            if (res.ok && res.data) {
                Object.entries(gameScoreMap).forEach(([key, elementId]) => {
                    if (res.data.hasOwnProperty(key)) {
                        const el = document.getElementById(elementId);
                        if (el) el.innerText = res.data[key];
                    }
                });
                const subjectId = getGlobalSubjectId();
                await autoSaveGameScore(subjectId);
                showModal('导入成功 (Import Successful)');
            } else {
                showModal('分析失败 (Analysis Failed): ' + (res.error || '未知错误'));
            }
        });
    };
}

handleGameImport('importShootingBtn', 'shooting');
handleGameImport('importTask4Btn', 'task4');
handleGameImport('importGame5Btn', 'game5');

// Global analyze button (Batch analysis by Subject ID)
const analyzeGameBtn = document.getElementById('analyzeGameBtn');
if (analyzeGameBtn) {
    analyzeGameBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) return showModal('请先在问卷中填写 Subject ID');
        
        await withLoading(analyzeGameBtn, async () => {
            const res = await window.api.analyzeGameScore(subjectId);
            if (res.ok) {
                const results = document.getElementById('game-results');
                if (results) results.style.display = 'block';
                
                if (res.data) {
                    Object.entries(gameScoreMap).forEach(([src, target]) => {
                        const el = document.getElementById(target);
                        if (el && res.data.hasOwnProperty(src)) el.innerText = res.data[src];
                    });
                }
                await autoSaveGameScore(subjectId);
                showModal('分析完成 (Analysis Complete)');
            } else {
                showModal('分析失败 (Analysis Failed): ' + (res.error || '未找到数据'));
            }
        });
    };
}

const listGameBtn = document.getElementById('listGameBtn');
if (listGameBtn) {
    listGameBtn.onclick = async () => {
        await withLoading(listGameBtn, async () => {
            const res = await window.api.listGameScores();
            if (res.ok) {
                const listDiv = document.getElementById('game-list-content');
                const listContainer = document.getElementById('game-list');
                if (listContainer) listContainer.style.display = 'block';
                if (listDiv) {
                    listDiv.innerHTML = res.data.map(item => `
                        <div style="padding:5px;border-bottom:1px solid #eee">
                            <b>${item.subject_id}</b> - ${item.created_at}
                        </div>
                    `).join('');
                }
            }
        });
    };
}

// Settings Module
async function loadSettings() {
    try {
        const paths = await window.api.getPaths();
        if (paths) {
            const map = {
                'emgPathInput': paths.emg,
                'emgDataPathInput': paths.emgDataPath,
                'ecgPathInput': paths.ecg,
                'ecgDataPathInput': paths.ecgDataPath,
                'eyePathInput': paths.eye,
                'eyeDataPathInput': paths.eyeDataPath,
                'gameDataPathInput': paths.gameDataPath,
                'cacheDirInput': paths.cacheDir
            };
            Object.entries(map).forEach(([id, val]) => {
                const el = document.getElementById(id);
                if (el && val) el.value = val;
            });
            const autoMaximizeCheckbox = document.getElementById('autoMaximizeCheckbox');
            if (autoMaximizeCheckbox) {
                autoMaximizeCheckbox.checked = Boolean(paths.autoMaximize);
            }
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

// Initial load
loadSettings();

const configBindings = [
    { btn: 'browseEmgPathBtn', input: 'emgPathInput', key: 'emg', type: 'file' },
    { btn: 'browseEmgDataPathBtn', input: 'emgDataPathInput', key: 'emgDataPath', type: 'folder' },
    { btn: 'browseEcgPathBtn', input: 'ecgPathInput', key: 'ecg', type: 'file' },
    { btn: 'browseEcgDataPathBtn', input: 'ecgDataPathInput', key: 'ecgDataPath', type: 'folder' },
    { btn: 'browseEyePathBtn', input: 'eyePathInput', key: 'eye', type: 'file' },
    { btn: 'browseEyeDataPathBtn', input: 'eyeDataPathInput', key: 'eyeDataPath', type: 'folder' },
    { btn: 'browseGameDataPathBtn', input: 'gameDataPathInput', key: 'gameDataPath', type: 'folder' },
    { btn: 'browseCacheDirBtn', input: 'cacheDirInput', key: 'cacheDir', type: 'folder' }
];

configBindings.forEach(cfg => {
    const btn = document.getElementById(cfg.btn);
    if (btn) {
        btn.onclick = async () => {
            const method = cfg.type === 'file' ? window.api.selectPath : window.api.selectFolder;
            const sel = await method();
            const selectedPath = typeof sel === 'string' ? sel : (sel && sel.filePaths && sel.filePaths[0]);
            if (!selectedPath) return;
            const input = document.getElementById(cfg.input);
            if (input) input.value = selectedPath;
            await window.api.setPath(cfg.key, selectedPath);
        };
    }
});

const autoMaximizeCheckbox = document.getElementById('autoMaximizeCheckbox');
if (autoMaximizeCheckbox) {
    autoMaximizeCheckbox.onchange = async () => {
        await window.api.setPath('autoMaximize', autoMaximizeCheckbox.checked);
    };
}

const runPredictionBtn = document.getElementById('run-prediction-btn');
if (runPredictionBtn) {
    runPredictionBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先在问卷中填写被试编号');
        }

        const resultBox = document.getElementById('prediction-result');
        const outputEl = document.getElementById('prediction-output');
        const probEl = document.getElementById('prediction-prob');

        await withLoading(runPredictionBtn, async () => {
            const res = await window.api.predictEleLevel(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            
            const probHigh = (res.prob_high * 100).toFixed(1);
            const probLow = res.prob_low !== undefined ? (res.prob_low * 100).toFixed(1) : ((1 - res.prob_high) * 100).toFixed(1);
            
            renderProfessionalPanel('prediction-result', res, {
                type: 'gauge',
                value: res.prob_high,
                valueTitle: '高水平概率',
                min: 0,
                max: 100,
                isPercent: true,
                tag: '体能等级 (ELE)',
                guidanceKey: 'ele',
                color: '#0ea5e9',
                description: `预测结果为：<strong>${res.label_text}</strong>。<br>高水平概率: ${probHigh}%, 低水平概率: ${probLow}%。<br>综合了问卷、生理与任务表现的数据。`
            });
        });
    };
}

const runCogPredictionBtn = document.getElementById('run-cog-prediction-btn');
if (runCogPredictionBtn) {
    runCogPredictionBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先在问卷中填写被试编号');
        }

        const resultBox = document.getElementById('cog-prediction-result');

        await withLoading(runCogPredictionBtn, async () => {
            const res = await window.api.predictCogType(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            
            const probsText = Object.entries(res.probs || {})
                .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
                .join(', ');
            
            renderProfessionalPanel('cog-prediction-result', res, {
                type: 'radar',
                radarData: res.probs,
                radarTitle: '认知类型分布',
                tag: '认知类型 (COG)',
                guidanceKey: 'cog',
                color: '#8b5cf6',
                description: `预测优势类型为：<strong>${res.label_text || res.label}</strong>。<br>概率分布: ${probsText}。<br>基于多项认知任务表现的综合评估。`
            });
        });
    };
}

const runMotTypeBtn = document.getElementById('run-mot-type-btn');
if (runMotTypeBtn) {
    runMotTypeBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先在问卷中填写被试编号');
        }

        const resultBox = document.getElementById('mot-type-result');

        await withLoading(runMotTypeBtn, async () => {
            const res = await window.api.predictMotivationType(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            
            const probsText = Object.entries(res.probs || {})
                .map(([k, v]) => `${k}: ${(v * 100).toFixed(1)}%`)
                .join(', ');
            
            renderProfessionalPanel('mot-type-result', res, {
                type: 'radar',
                radarData: res.probs,
                radarTitle: '动机类型分布',
                tag: '动机类型 (MOT TYPE)',
                guidanceKey: 'mot_type',
                color: '#f59e0b',
                description: `预测主导动机为：<strong>${res.label_text || res.label}</strong>。<br>概率分布: ${probsText}。<br>基于问卷与行为数据的综合判断。`
            });
        });
    };
}

const runMotLevelBtn = document.getElementById('run-mot-level-btn');
if (runMotLevelBtn) {
    runMotLevelBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先在问卷中填写被试编号');
        }

        const resultBox = document.getElementById('mot-level-result');

        await withLoading(runMotLevelBtn, async () => {
            const res = await window.api.predictMotivationLevel(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            
            renderProfessionalPanel('mot-level-result', res, {
                type: 'gauge',
                value: res.score,
                valueTitle: '自主动机得分',
                min: 0,
                max: 100,
                isPercent: false,
                tag: '动机水平 (MOT LEVEL)',
                guidanceKey: 'mot_level',
                color: '#10b981',
                description: `预测等级：<strong>${res.label_text}</strong>。<br>综合评估得分为 ${res.score.toFixed(2)}。`
            });
        });
    };
}
