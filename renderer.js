
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

// Button Loading State
async function withLoading(btn, action) {
  if (!btn) return;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = '运行中...';
  btn.style.opacity = '0.7';
  btn.style.cursor = 'not-allowed';
  
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('操作超时，请重试')), 10000)
    );
    await Promise.race([action(), timeoutPromise]);
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
    '训练动机': 'TM',
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
  const psyResults = {
    神经质_Psy: namedSubscales['神经质'] || null,
    尽责性_Psy: namedSubscales['尽责性'] || null,
    宜人性_Psy: namedSubscales['宜人性'] || null,
    开放性_Psy: namedSubscales['开放性'] || null,
    外向性_Psy: namedSubscales['外向性'] || null,
    内部动机_Psy: namedSubscales['内部动机'] || null,
    外部调节_Psy: namedSubscales['外在调节'] || null,
    自主动机_Psy: namedComposites['自主动机'] || null,
    心理弹性总分_Psy: namedComposites['心理弹性总分'] || namedSubscales['心理弹性总分'] || null,
    坚韧_Psy: namedSubscales['坚韧'] || null,
    力量_Psy: namedSubscales['力量'] || null,
    乐观_Psy: namedSubscales['乐观'] || null,
    进取_Psy: namedSubscales['进取'] || null,
    主动_Psy: namedSubscales['主动'] || null,
    求精_Psy: namedSubscales['求精'] || null,
    奉献_Psy: namedSubscales['奉献'] || null,
    乐业_Psy: namedSubscales['乐业'] || null,
    持续学习_Psy: namedSubscales['持续学习'] || null
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

async function renderQuestionnaireFields() {
  const container = document.getElementById('questionnaire-fields');
  if (!container) return;
  if (container.dataset.rendered === 'true') return;
  const res = await window.api.getDefaultQuestionnaire();
  if (!res || !res.ok || !res.data) return;
  const cfg = res.data;
  defaultQuestionnaireCfg = cfg;
  
  const titleEl = document.querySelector('#questionnaire-form h3');
  if (titleEl) titleEl.innerText = cfg.title || '技能训练动机问卷';
  
  container.innerHTML = '';
  const sectionMeta = {
    '训练动机': {
      title: '第一部分：训练动机'
    },
    '五大人格': {
      title: '第二部分：大五人格'
    },
    '心理弹性': {
      title: '第三部分：心理弹性'
    },
    '成就动机': {
      title: '第四部分：成就动机'
    }
  };
  const sectionOrder = ['训练动机', '五大人格', '心理弹性', '成就动机'];
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
      const displayNo = (item && item.number != null) ? item.number : (idxInSection + 1);

      const group = document.createElement('div');
      group.style.marginBottom = '14px';
      const qText = document.createElement('div');
      qText.style.fontSize = '14px';
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
        txt.style.fontSize = '14px';
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
      ['手臂 MAV (Arm_MAV)', m.Arm_MAV],
      ['手臂 MDF (Hz, Arm_MDF)', m.Arm_MDF],
      ['手臂 MPF (Hz, Arm_MPF)', m.Arm_MPF],
      ['手臂 RMS (Arm_RMS)', m.Arm_RMS],
      ['手臂 iEMG (Arm_iEMG)', m.Arm_iEMG],
      ['手臂最大幅值 Max_Amp (Arm_Max_Amp)', m.Arm_Max_Amp],
      ['颈部 MAV (Neck_MAV)', m.Neck_MAV],
      ['颈部 MDF (Hz, Neck_MDF)', m.Neck_MDF],
      ['颈部 MPF (Hz, Neck_MPF)', m.Neck_MPF],
      ['颈部 RMS (Neck_RMS)', m.Neck_RMS],
      ['颈部 iEMG (Neck_iEMG)', m.Neck_iEMG],
      ['颈部最大幅值 Max_Amp (Neck_Max_Amp)', m.Neck_Max_Amp]
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.style.padding = '4px 0';
      div.style.fontSize = '13px';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      div.innerText = `${label}: ${v}`;
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
      ['R 峰数量 n_peaks_ECG', m.n_peaks_ECG],
      ['平均 R-R 间期 Mean_RR_ms_ECG (ms)', m.Mean_RR_ms_ECG],
      ['R-R 标准差 SDNN_ms_ECG (ms)', m.SDNN_ms_ECG],
      ['RMSSD_ms_ECG (ms)', m.RMSSD_ms_ECG],
      ['pNN50_pct_ECG (%)', m.pNN50_pct_ECG],
      ['平均心率 HR_Mean_ECG (bpm)', m.HR_Mean_ECG],
      ['心率标准差 HR_Std_ECG (bpm)', m.HR_Std_ECG],
      ['心率变异率 HR_Change_Rate_ECG (%)', m.HR_Change_Rate_ECG]
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.style.padding = '4px 0';
      div.style.fontSize = '13px';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      div.innerText = `${label}: ${v}`;
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
      ['眨眼次数 Blink Count', m.blink_count_Eye],
      ['眨眼频率 Blink Rate (Hz)', m.blink_rate_Hz_Eye],
      ['眨眼持续时间 Blink Dur (ms)', m.blink_dur_ms_Eye],
      ['注视次数 Fixation Count', m.fixation_count_Eye],
      ['注视频率 Fixation Rate (Hz)', m.fixation_rate_Hz_Eye],
      ['平均注视时长 Avg Fix Dur (ms)', m.avg_fixation_dur_ms_Eye],
      ['平均瞳孔直径 Pupil Diam (mm)', m.avg_pupil_diam_mm_Eye],
      ['扫视次数 Saccade Count', m.saccade_count_Eye],
      ['扫视频率 Saccade Rate (Hz)', m.saccade_rate_Hz_Eye],
      ['平均扫视幅度 Avg Sacc Amp (deg)', m.avg_saccade_amp_deg_Eye],
      ['平均扫视速度 Avg Sacc Vel (deg/s)', m.avg_saccade_vel_deg_s_Eye]
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement('div');
      div.style.padding = '4px 0';
      div.style.fontSize = '13px';
      const v = typeof value === 'number' ? value.toFixed(2) : (value != null ? String(value) : '-');
      div.innerText = `${label}: ${v}`;
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
  心理弹性总分: { min: 25, max: 125 },
  内部动机: { min: 4, max: 20 },
  整合调节: { min: 4, max: 20 },
  内摄调节: { min: 4, max: 20 },
  外在调节: { min: 4, max: 20 },
  无动机: { min: 4, max: 20 },
  认同动机: { min: 3, max: 15 },
  自主动机: { min: -81, max: 91 },
  成就动机总分: { min: 21, max: 105 }
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

  const subscales = scores.subscales_named || {};
  const composites = scores.composites_named || {};
  const metricDefs = [
    {
      label: '自主动机',
      value: Number(composites['自主动机'] || 0),
      range: getQuestionnaireCompositeRange(questionnaireCfg, 'autonomous_motivation')
    },
    {
      label: '心理弹性总分',
      value: Number(subscales['心理弹性总分'] || composites['心理弹性总分'] || 0),
      range: getQuestionnaireSubscaleRange(questionnaireCfg, 'resilience_total')
    },
    {
      label: '成就动机总分',
      value: Number(subscales['成就动机总分'] || 0),
      range: getQuestionnaireSubscaleRange(questionnaireCfg, 'achievement_motivation_total')
    }
  ];

  const renderMetricCard = (metric) => {
    const min = Number(metric.range.min || 0);
    const max = Number(metric.range.max || 100);
    const safeValue = Number.isFinite(metric.value) ? metric.value : 0;
    const ratioRaw = max === min ? 0 : (safeValue - min) / (max - min);
    const ratio = Math.max(0, Math.min(1, ratioRaw));
    const markerLeft = (ratio * 100).toFixed(2);
    return `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
          <span style="font-size:14px;color:#334155;font-weight:600;">${metric.label}</span>
          <span style="font-size:20px;color:#0f172a;font-weight:700;">${safeValue}</span>
        </div>
        <div style="position:relative;height:16px;border-radius:9999px;overflow:hidden;background:linear-gradient(to right,#ef4444 0%,#ef4444 33.333%,#f59e0b 33.333%,#f59e0b 66.666%,#10b981 66.666%,#10b981 100%);">
          <span style="position:absolute;top:50%;left:${markerLeft}%;transform:translate(-50%,-50%);width:14px;height:14px;background:#111827;border:2px solid #ffffff;border-radius:50%;box-shadow:0 0 0 1px rgba(15,23,42,0.15);"></span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:#64748b;">
          <span>最低 ${min}</span>
          <span>最高 ${max}</span>
        </div>
      </div>
    `;
  };

  container.innerHTML = `
    <h5 style="margin:0 0 12px 0;color:#2563eb;font-size:15px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">关键指标</h5>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
      ${metricDefs.map(renderMetricCard).join('')}
    </div>
  `;
}

function renderQuestionnaireRadar(scores, questionnaireCfg) {
    const subscales = scores.subscales_named || {};
    const radarDefs = [
      {
        chartId: 'questionnaire-radar-training',
        title: '训练动机',
        color: '#2563eb',
        dimensions: [
          { name: '内部动机', subscaleId: 'intrinsic_motivation' },
          { name: '整合调节', subscaleId: 'integrated_regulation' },
          { name: '内摄调节', subscaleId: 'introjected_regulation' },
          { name: '外在调节', subscaleId: 'external_regulation' },
          { name: '无动机', subscaleId: 'amotivation' },
          { name: '认同动机', subscaleId: 'identified_motivation' }
        ]
      },
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
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

const exportEmgBtn = document.getElementById('exportEmgBtn');
if (exportEmgBtn) {
  exportEmgBtn.onclick = async () => {
    if (!lastEmgAnalysis || !lastEmgAnalysis.metrics) {
      return showModal('请先完成分析 (Please complete analysis first)');
    }
    const m = lastEmgAnalysis.metrics;
    const res = await window.api.exportPhysioSummary({
      module: 'emg',
      subject_id: lastEmgSubjectId || 'unknown',
      metrics: m
    });
    if (!res || !res.ok) {
      return showModal('保存失败 (Save Failed): ' + (res && res.error ? res.error : '未知错误'));
    }
    showModal('结果已保存 (Results Saved)');
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
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

const exportEcgBtn = document.getElementById('exportEcgBtn');
if (exportEcgBtn) {
  exportEcgBtn.onclick = async () => {
    if (!lastEcgAnalysis || !lastEcgAnalysis.metrics) {
      return showModal('请先完成分析 (Please complete analysis first)');
    }
    const m = lastEcgAnalysis.metrics;
    const res = await window.api.exportPhysioSummary({
      module: 'ecg',
      subject_id: lastEcgSubjectId || 'unknown',
      metrics: m
    });
    if (!res || !res.ok) {
      return showModal('保存失败 (Save Failed): ' + (res && res.error ? res.error : '未知错误'));
    }
    showModal('结果已保存 (Results Saved)');
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
      showModal('分析完成 (Analysis Complete)');
    });
  };
}

const exportEyeBtn = document.getElementById('exportEyeBtn');
if (exportEyeBtn) {
  exportEyeBtn.onclick = async () => {
    if (!lastEyeAnalysis || !lastEyeAnalysis.metrics) {
      return showModal('请先完成分析 (Please complete analysis first)');
    }
    const m = lastEyeAnalysis.metrics;
    const res = await window.api.exportPhysioSummary({
      module: 'eye',
      subject_id: lastEyeSubjectId || 'unknown',
      metrics: m
    });
    if (!res || !res.ok) {
      return showModal('保存失败 (Save Failed): ' + (res && res.error ? res.error : '未知错误'));
    }
    showModal('结果已保存 (Results Saved)');
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
          data.title = defaultQuestionnaireCfg.title || '技能训练动机问卷';
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
            if (input.id) data[input.id] = input.value;
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
                showModal('分析完成 (Analysis Complete)');
            } else {
                showModal('分析失败 (Analysis Failed): ' + (res.error || '未找到数据'));
            }
        });
    };
}

const saveGameBtn = document.getElementById('saveGameBtn');
if (saveGameBtn) {
    saveGameBtn.onclick = async () => {
        const subjectId = getGlobalSubjectId();
        if (!subjectId) return showModal('请先在问卷中填写 Subject ID');
        
        // Collect current displayed data
        const data = { subject_id: subjectId };
        const resultIds = [
            'val_shooting_total', 'val_shooting_accuracy', 'val_shooting_avg',
            'val_task4_ball', 'val_task4_line', 'val_task4_total', 'val_task4_accuracy',
            'val_game5_total', 'val_game5_life'
        ];
        
        resultIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) data[id] = el.innerText;
        });

        await withLoading(saveGameBtn, async () => {
            const res = await window.api.saveGameScore(data);
            if (res.ok) showModal('游戏成绩保存成功');
            else showModal('保存失败: ' + res.error);
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
                'eyeDataPathInput': paths.eyeDataPath
            };
            Object.entries(map).forEach(([id, val]) => {
                const el = document.getElementById(id);
                if (el && val) el.value = val;
            });
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
    { btn: 'browseEyeDataPathBtn', input: 'eyeDataPathInput', key: 'eyeDataPath', type: 'folder' }
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

const runPredictionBtn = document.getElementById('run-prediction-btn');
if (runPredictionBtn) {
    runPredictionBtn.onclick = async () => {
        const idInput = document.getElementById('prediction-subject-id');
        const manualId = idInput && idInput.value ? idInput.value.trim() : '';
        const subjectId = manualId || getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先填写被试编号（可以在问卷页或本页填写）');
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
            if (outputEl) {
                outputEl.innerText = `预测等级：${res.label_text || '未知'}（分类标签 = ${res.label}）`;
            }
            if (probEl && typeof res.prob_high === 'number') {
                probEl.innerText = `模型输出为「高水平」的概率：${(res.prob_high * 100).toFixed(1)}%`;
            }
        });
    };
}

const runCogPredictionBtn = document.getElementById('run-cog-prediction-btn');
if (runCogPredictionBtn) {
    runCogPredictionBtn.onclick = async () => {
        const idInput = document.getElementById('cog-prediction-subject-id');
        const manualId = idInput && idInput.value ? idInput.value.trim() : '';
        const subjectId = manualId || getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先填写被试编号（可以在问卷页或本页填写）');
        }

        const resultBox = document.getElementById('cog-prediction-result');
        const outputEl = document.getElementById('cog-prediction-output');
        const probEl = document.getElementById('cog-prediction-prob');

        await withLoading(runCogPredictionBtn, async () => {
            const res = await window.api.predictCogType(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            if (outputEl) {
                outputEl.innerText = `认知优势类型：${res.label_text || res.label || '未知'}`;
            }
            if (probEl && res.probs) {
                const parts = Object.keys(res.probs).map(k => {
                    const v = res.probs[k];
                    return `${k}: ${(v * 100).toFixed(1)}%`;
                });
                probEl.innerText = `各类型概率：${parts.join('， ')}`;
            }
        });
    };
}

const runMotTypeBtn = document.getElementById('run-mot-type-btn');
if (runMotTypeBtn) {
    runMotTypeBtn.onclick = async () => {
        const idInput = document.getElementById('mot-prediction-subject-id');
        const manualId = idInput && idInput.value ? idInput.value.trim() : '';
        const subjectId = manualId || getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先填写被试编号（可以在问卷页或本页填写）');
        }

        const resultBox = document.getElementById('mot-type-result');
        const outputEl = document.getElementById('mot-type-output');
        const probEl = document.getElementById('mot-type-prob');

        await withLoading(runMotTypeBtn, async () => {
            const res = await window.api.predictMotivationType(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            if (outputEl) {
                outputEl.innerText = `动机类型：${res.label_text || res.label || '未知'}`;
            }
            if (probEl && res.probs) {
                const parts = Object.keys(res.probs).map(k => {
                    const v = res.probs[k];
                    return `${k}: ${(v * 100).toFixed(1)}%`;
                });
                probEl.innerText = `各类型概率：${parts.join('， ')}`;
            }
        });
    };
}

const runMotLevelBtn = document.getElementById('run-mot-level-btn');
if (runMotLevelBtn) {
    runMotLevelBtn.onclick = async () => {
        const idInput = document.getElementById('mot-prediction-subject-id');
        const manualId = idInput && idInput.value ? idInput.value.trim() : '';
        const subjectId = manualId || getGlobalSubjectId();
        if (!subjectId) {
            return showModal('请先填写被试编号（可以在问卷页或本页填写）');
        }

        const resultBox = document.getElementById('mot-level-result');
        const outputEl = document.getElementById('mot-level-output');
        const probEl = document.getElementById('mot-level-prob');
        const scoreEl = document.getElementById('mot-level-score');

        await withLoading(runMotLevelBtn, async () => {
            const res = await window.api.predictMotivationLevel(subjectId);
            if (!res || !res.ok) {
                const msg = res && res.error ? res.error : '预测失败';
                if (resultBox) resultBox.style.display = 'none';
                return showModal('预测失败: ' + msg);
            }

            if (resultBox) resultBox.style.display = 'block';
            if (outputEl) {
                outputEl.innerText = `自主动机水平：${res.label_text || '未知'}（分类标签 = ${res.label}）`;
            }
            if (probEl && typeof res.prob_high === 'number') {
                probEl.innerText = `模型输出为「高自主动机水平」的概率：${(res.prob_high * 100).toFixed(1)}%`;
            }
            if (scoreEl && typeof res.score === 'number') {
                scoreEl.innerText = `回归预测的自主动机连续得分：${res.score.toFixed(2)}`;
            }
        });
    };
}
