// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { analyzeECG, analyzeEMG, analyzeEye } = require('./utils/physio_analysis');

const LEGACY_DATA_ROOT = 'D:\\ccho_RECORD';

function getDefaultDataRoot() {
  try {
    if (fs.existsSync(LEGACY_DATA_ROOT)) return LEGACY_DATA_ROOT;
  } catch (e) {}
  return path.join(app.getPath('documents'), 'ccho_RECORD');
}

function getDefaultPaths() {
  const dataRoot = getDefaultDataRoot();
  return {
    emg: 'C:\\Users\\vrtrain2\\Desktop\\肌电软件-标准\\软件\\EmgServer采集-64位\\Release\\EmgServer.exe',
    ecg: 'C:\\Users\\vrtrain2\\Desktop\\运动风险评估系统\\Release\\HeartCapture.exe',
    eye: 'C:\\Users\\vrtrain2\\Desktop\\vrpack3\\CCHO_DEMO.exe',
    emgDataPath: path.join(dataRoot, 'EMG'),
    ecgDataPath: path.join(dataRoot, 'ECG'),
    eyeDataPath: path.join(dataRoot, 'eyetrack'),
    gameDataPath: path.join(dataRoot, 'SCOREresult'),
    cacheDir: path.join(app.getPath('userData'), 'cache'),
    autoMaximize: false
  };
}

function ensureDirSafe(dirPath) {
  if (!dirPath) return;
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (e) {}
}

function ensureDataDirs(config) {
  if (!config) return;
  const keys = ['emgDataPath', 'ecgDataPath', 'eyeDataPath', 'gameDataPath', 'cacheDir'];
  keys.forEach((key) => ensureDirSafe(config[key]));
}

function getCacheDir() {
  const config = loadConfig();
  const defaults = getDefaultPaths();
  return (config && config.cacheDir) || defaults.cacheDir;
}

function ensureCacheDir() {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true }) ;
  }
}

function getCNDateParts() {
  const now = Date.now();
  const utcMs = now + new Date().getTimezoneOffset() * 60000;
  const cnMs = utcMs + 8 * 60 * 60 * 1000;
  const d = new Date(cnMs);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const date = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const time = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  return { date, time };
}

function getCNTimestampForFile() {
  const parts = getCNDateParts();
  return parts.date + 'T' + parts.time.replace(/:/g, '-');
}

function getCNISOString() {
  const parts = getCNDateParts();
  return parts.date + 'T' + parts.time + '+08:00';
}

function savePredictionRecord(type, subjectIdRaw, payload) {
  ensureCacheDir();
  const timestamp = getCNTimestampForFile();
  const safeSubject = String(subjectIdRaw || 'unknown').trim() || 'unknown';
  const filename = `prediction_${type}_${safeSubject}_${timestamp}.json`;
  const filePath = path.join(getCacheDir(), filename);
  const record = {
    id: Date.now(),
    subject_id: safeSubject,
    prediction_type: type,
    ...payload,
    created_at: getCNISOString()
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

function getCogTypeCode(label, labelText) {
  const raw = labelText ?? label;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const map = {
    '记忆强': 0,
    '执行强': 1,
    '推理强': 2
  };
  if (Object.prototype.hasOwnProperty.call(map, s)) return map[s];
  return null;
}

function resolveBundledPath(relativePath) {
  const normalized = String(relativePath || '').replace(/[\\/]+/g, path.sep);
  const devPath = path.join(__dirname, normalized);
  if (!app.isPackaged) return devPath;
  const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', normalized);
  if (fs.existsSync(unpackedPath)) return unpackedPath;
  return devPath;
}

function getPythonCwd() {
  if (!app.isPackaged) return __dirname;
  const unpackedRoot = path.join(process.resourcesPath, 'app.asar.unpacked');
  if (fs.existsSync(unpackedRoot)) return unpackedRoot;
  return process.resourcesPath;
}

function getPythonExecInfo() {
  const bundledExe = resolveBundledPath(path.join('bin', 'python', 'python.exe'));
  if (fs.existsSync(bundledExe)) {
    const pyRoot = path.dirname(bundledExe);
    const libPath = path.join(pyRoot, 'Lib');
    const sitePath = path.join(libPath, 'site-packages');
    return {
      exe: bundledExe,
      env: {
        PYTHONHOME: pyRoot,
        PYTHONPATH: [libPath, sitePath, getPythonCwd()].join(path.delimiter)
      }
    };
  }
  return { exe: 'python', env: {} };
}

function collectFeaturesForSubject(subjectIdRaw) {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    throw new Error('未找到缓存目录，请先保存数据');
  }

  const subjectId = String(subjectIdRaw || '').trim();
  if (!subjectId) {
    throw new Error('被试编号为空');
  }

  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error('缓存目录中没有 JSON 数据');
  }
  
  // Sort files by name (timestamp) to ensure we process latest files last
  files.sort();

  const row = { Subject_ID: subjectId };

  for (const file of files) {
    let record;
    try {
      const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
      record = JSON.parse(content);
    } catch (e) {
      continue;
    }
    if (!record || typeof record !== 'object') continue;

    let sid = record.subject_id || record.basic_subject_id || record.Subject_ID;
    sid = String(sid || '').trim();
    if (!sid || sid !== subjectId) continue;

    if (file.startsWith('physio_')) {
      // 1. Apply legacy mapping
      const mapping = {
        Pre_SBP_BPHR: 'pre_sbp',
        Pre_DBP_BPHR: 'pre_dbp',
        Pre_HR_BPHR: 'pre_hr',
        Post_SBP_BPHR: 'post_sbp',
        Post_DBP_BPHR: 'post_dbp',
        Post_HR_BPHR: 'post_hr',
        '30x2_Ele': 'run_30x2',
        '仰卧卷腹_Ele': 'sit_ups',
        '引体向上_Ele': 'pull_ups',
        '3000米_Ele': 'run_3000',
        '单兵训练综合成绩_Ele': 'composite_score'
      };
      Object.keys(mapping).forEach(dst => {
        const src = mapping[dst];
        if (Object.prototype.hasOwnProperty.call(record, src)) {
          row[dst] = record[src];
        }
      });
      
      // 2. Also collect direct keys (new format)
      const directKeys = [
        'pre_sbp', 'pre_dbp', 'pre_hr', 
        'post_sbp', 'post_dbp', 'post_hr'
      ];
      directKeys.forEach(k => {
        if (Object.prototype.hasOwnProperty.call(record, k)) {
           row[k] = record[k];
        }
      });

    } else if (file.startsWith('cognitive_')) {
      const mapping = {
        '工作记忆(正确数)_Cog': 'wm_correct',
        '工作记忆(时长s)_Cog': 'wm_time',
        '物品再认(正确数)_Cog': 'obj_correct',
        '物品再认(时长s)_Cog': 'obj_time',
        'TMT-A(正确数)_Cog': 'tmta_correct',
        'TMT-A(时长s)_Cog': 'tmta_time',
        '延迟回忆(正确数)_Cog': 'delay_correct',
        '延迟回忆(时长s)_Cog': 'delay_time',
        '回溯测试(正确数)_Cog': 'nback_correct',
        '色词干扰(正确数)_Cog': 'stroop_correct',
        '语法推理(正确数)_Cog': 'reasoning_correct'
      };
      Object.keys(mapping).forEach(dst => {
        const src = mapping[dst];
        if (Object.prototype.hasOwnProperty.call(record, src)) {
          row[dst] = record[src];
        }
      });
    } else if (file.startsWith('questionnaire_')) {
      const basicKeys = [
        'basic_name',
        'basic_age',
        'basic_gender',
        'basic_education',
        'basic_grade',
        'basic_ethnicity',
        'basic_service_years',
        'basic_major'
      ];
      basicKeys.forEach(k => {
        if (Object.prototype.hasOwnProperty.call(record, k)) {
          row[k] = record[k];
        }
      });

      const scores = record.scores || {};
      const metrics = record.questionnaire_metrics || {};
      const subNamed = scores.subscales_named || {};
      const compNamed = scores.composites_named || {};
      const psy = scores.psy_results || {};
      const questionnaireMetricKeys = [
        '神经质',
        '尽责性',
        '宜人性',
        '开放性',
        '外向性',
        '坚韧',
        '力量',
        '乐观',
        '进取',
        '主动',
        '求精',
        '奉献',
        '乐业'
      ];
      questionnaireMetricKeys.forEach(k => {
        const val = metrics[k] ?? subNamed[k] ?? compNamed[k];
        if (val != null) {
          row[k] = val;
          row[`${k}_Psy`] = val;
        }
      });
      Object.keys(psy).forEach(k => {
        if (k.includes('动机')) return;
        row[k] = psy[k];
      });
    } else if (file.startsWith('ecg_') || file.startsWith('emg_') || file.startsWith('eye_')) {
      const metrics = record.metrics || {};
      Object.keys(metrics).forEach(k => {
        let key = k;
        // EMG metrics need suffix to match training data
        if (file.startsWith('emg_') && !k.endsWith('_EMG')) {
            key = k + '_EMG';
        }
        row[key] = metrics[k];
      });
    } else if (file.startsWith('game_')) {
      const map = {
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
      Object.keys(map).forEach(dst => {
        const src = map[dst];
        if (Object.prototype.hasOwnProperty.call(record, src)) {
          row[dst] = record[src];
        }
      });
    }
  }

  return row;
}

// --- Process Management ---
const runningProcesses = [];

function registerProcess(child) {
  runningProcesses.push(child);
  child.on('exit', () => {
    const index = runningProcesses.indexOf(child);
    if (index > -1) runningProcesses.splice(index, 1);
  });
}

function killAllProcesses() {
  console.log(`Killing ${runningProcesses.length} background processes...`);
  runningProcesses.forEach(proc => {
    try {
      if (!proc.killed) proc.kill();
    } catch (e) {
      console.error('Failed to kill process:', e);
    }
  });
  runningProcesses.length = 0;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Remove title bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
 
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    const config = loadConfig();
    if (config && config.autoMaximize) {
      mainWindow.maximize();
    }
  });
  // mainWindow.webContents.openDevTools();
}

ipcMain.handle('launch-software', async (_, module, subjectId) => {
  const config = loadConfig();
  const exePath = config[module];
  if (!exePath) return { success: false, message: '未配置软件路径' };

  try {
    // Start process attached (no detached: true) so we can track and kill it
    // IMPORTANT: Set cwd to the executable's directory to ensure it can find its dependencies/DLLs
    // Check if executable exists first
    if (!fs.existsSync(exePath)) {
      throw new Error(`Executable not found at path: ${exePath}`);
    }

    return new Promise((resolve) => {
      try {
        const subprocess = spawn(exePath, [], {
          cwd: path.dirname(exePath),
          // Use pipe to capture output for debugging, ignore stdin
          stdio: ['ignore', 'pipe', 'pipe'] 
        });
        
        let hasError = false;

        // Add error handlers for spawn
        subprocess.on('error', (err) => {
          console.error(`Failed to spawn process ${module}:`, err);
          if (!hasError) {
            hasError = true;
            resolve({ success: false, message: `启动失败: ${err.message}` });
          }
        });

        if (subprocess.stderr) {
          subprocess.stderr.on('data', (data) => {
            console.error(`Process ${module} stderr: ${data}`);
          });
        }

        if (subprocess.stdout) {
          subprocess.stdout.on('data', (data) => {
            console.log(`Process ${module} stdout: ${data}`);
          });
        }

        registerProcess(subprocess);
        
        // Wait 1 second to see if it crashes immediately
        setTimeout(() => {
          if (!hasError) {
            resolve({ success: true });
          }
        }, 1000);

      } catch (spawnError) {
        console.error(`Spawn exception for ${module}:`, spawnError);
        resolve({ success: false, message: spawnError.message });
      }
    });

  } catch (e) {
    console.error(`Failed to launch ${module}:`, e);
    return { success: false, message: e.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killAllProcesses();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('process:killAll', () => {
  killAllProcesses();
  return true;
});

// Window controls
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('export:unifiedCsv', async () => {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      return { ok: false, error: '未找到缓存目录' };
    }
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return { ok: false, error: '缓存目录中没有 JSON 数据' };
    }

    const rowsBySubject = new Map();
    const getRow = (subjectIdRaw) => {
      const key = subjectIdRaw || 'unknown';
      if (!rowsBySubject.has(key)) {
        rowsBySubject.set(key, { subject_id: key });
      }
      return rowsBySubject.get(key);
    };

    for (const file of files) {
      let record;
      try {
        const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
        record = JSON.parse(content);
      } catch (e) {
        continue;
      }
      if (!record || typeof record !== 'object') continue;

      let subjectId = record.subject_id;
      if (!subjectId && record.basic_subject_id) subjectId = record.basic_subject_id;
      if (!subjectId) subjectId = 'unknown';
      subjectId = String(subjectId).trim() || 'unknown';

      const row = getRow(subjectId);

      if (file.startsWith('physio_')) {
        const keys = [
          'pre_sbp',
          'pre_dbp',
          'pre_hr',
          'post_sbp',
          'post_dbp',
          'post_hr',
          'run_30x2',
          'sit_ups',
          'pull_ups',
          'run_3000',
          'composite_score'
        ];
        keys.forEach(k => {
          if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k];
        });
      } else if (file.startsWith('cognitive_')) {
        const keys = [
          'wm_correct',
          'wm_time',
          'obj_correct',
          'obj_time',
          'delay_correct',
          'delay_time',
          'tmta_correct',
          'tmta_time',
          'nback_correct',
          'stroop_correct',
          'reasoning_correct'
        ];
        keys.forEach(k => {
          if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k];
        });
      } else if (file.startsWith('questionnaire_')) {
        const basicKeys = [
          'basic_name',
          'basic_age',
          'basic_gender',
          'basic_education',
          'basic_grade',
          'basic_ethnicity',
          'basic_service_years',
          'basic_major'
        ];
        basicKeys.forEach(k => {
          if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k];
        });

        const genderRaw = record.basic_gender;
        if (genderRaw) {
          const g = String(genderRaw).toLowerCase();
          let cn = '';
          if (g === 'male' || g === 'm' || g === '男') cn = '男';
          else if (g === 'female' || g === 'f' || g === '女') cn = '女';
          row.basic_gender = cn || genderRaw;
        }

        const eduRaw = record.basic_education || record.basic_grade;
        if (eduRaw) {
          const s = String(eduRaw).toLowerCase();
          let cn = '';
          const isCollege = s.includes('大专') || s.includes('专科') || s.includes('associate') || s.includes('college');
          const isBachelor = s.includes('本科') || s.includes('bachelor');
          const isGraduate = s.includes('研究生') || s.includes('硕士') || s.includes('博士') || s.includes('master') || s.includes('phd') || s.includes('doctor');
          if (isCollege) cn = '大专';
          else if (isBachelor) cn = '本科';
          else if (isGraduate) cn = '研究生及以上';
          row.basic_grade = cn || eduRaw;
        }

        const scores = record.scores || {};
        const metrics = record.questionnaire_metrics || {};
        const subNamed = scores.subscales_named || {};
        const compNamed = scores.composites_named || {};
        const psy = scores.psy_results || {};
        const questionnaireKeys = [
          '神经质',
          '尽责性',
          '宜人性',
          '开放性',
          '外向性',
          '坚韧',
          '力量',
          '乐观',
          '心理弹性总分',
          '进取',
          '主动',
          '求精',
          '奉献',
          '乐业'
        ];
        questionnaireKeys.forEach(k => {
          let val = null;
          if (Object.prototype.hasOwnProperty.call(metrics, k)) val = metrics[k];
          else if (Object.prototype.hasOwnProperty.call(psy, `${k}_Psy`)) val = psy[`${k}_Psy`];
          else if (Object.prototype.hasOwnProperty.call(psy, k)) val = psy[k];
          else if (Object.prototype.hasOwnProperty.call(subNamed, k)) val = subNamed[k];
          else if (Object.prototype.hasOwnProperty.call(compNamed, k)) val = compNamed[k];
          if (val != null) row[k] = val;
        });
      } else if (file.startsWith('ecg_') || file.startsWith('emg_') || file.startsWith('eye_')) {
        const metrics = record.metrics || {};
        const copyIfPresent = (dstKey, srcKey) => {
          if (Object.prototype.hasOwnProperty.call(metrics, srcKey)) {
            row[dstKey] = metrics[srcKey];
          }
        };

        if (file.startsWith('ecg_')) {
          [
            'n_peaks_ECG',
            'Mean_RR_ms_ECG',
            'SDNN_ms_ECG',
            'RMSSD_ms_ECG',
            'pNN50_pct_ECG',
            'HR_Mean_ECG',
            'HR_Std_ECG',
            'HR_Change_Rate_ECG'
          ].forEach(k => copyIfPresent(k, k));
        } else if (file.startsWith('emg_')) {
          copyIfPresent('Arm_MAV', 'Arm_MAV');
          copyIfPresent('Arm_MDF', 'Arm_MDF');
          copyIfPresent('Arm_MPF', 'Arm_MPF');
          copyIfPresent('Arm_Max_Amp', 'Arm_Max_Amp');
          copyIfPresent('Arm_RMS', 'Arm_RMS');
          copyIfPresent('Arm_iEMG', 'Arm_iEMG');
          copyIfPresent('Neck_MAV', 'Neck_MAV');
          copyIfPresent('Neck_MDF', 'Neck_MDF');
          copyIfPresent('Neck_MPF', 'Neck_MPF');
          copyIfPresent('Neck_Max_Amp', 'Neck_Max_Amp');
          copyIfPresent('Neck_RMS', 'Neck_RMS');
          copyIfPresent('Neck_iEMG', 'Neck_iEMG');
        } else if (file.startsWith('eye_')) {
          copyIfPresent('duration_sec_Eye', 'duration_sec_Eye');
          copyIfPresent('sampling_rate_est_Eye', 'sampling_rate_est_Eye');
          copyIfPresent('blink_count_Eye', 'blink_count_Eye');
          copyIfPresent('short_blink_count_Eye', 'short_blink_count_Eye');
          copyIfPresent('blink_freq_Eye', 'blink_freq_Eye');
          copyIfPresent('blink_freq_Eye', 'blink_rate_Hz_Eye');
          copyIfPresent('avg_blink_dur_ms_Eye', 'avg_blink_dur_ms_Eye');
          copyIfPresent('avg_blink_dur_ms_Eye', 'blink_dur_ms_Eye');
          copyIfPresent('fixation_count_Eye', 'fixation_count_Eye');
          copyIfPresent('fixation_freq_Eye', 'fixation_freq_Eye');
          copyIfPresent('fixation_freq_Eye', 'fixation_rate_Hz_Eye');
          copyIfPresent('avg_fixation_dur_ms_Eye', 'avg_fixation_dur_ms_Eye');
          copyIfPresent('saccade_count_Eye', 'saccade_count_Eye');
          copyIfPresent('avg_saccade_amp_deg_Eye', 'avg_saccade_amp_deg_Eye');
          copyIfPresent('avg_pupil_L_Eye', 'avg_pupil_L_Eye');
          copyIfPresent('gaze_yaw_std_Eye', 'gaze_yaw_std_Eye');
          copyIfPresent('gaze_pitch_std_Eye', 'gaze_pitch_std_Eye');
          copyIfPresent('avg_pupil_R_Eye', 'avg_pupil_R_Eye');
        }
      } else if (file.startsWith('game_')) {
        const map = {
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
        Object.keys(map).forEach(dst => {
          const src = map[dst];
          if (Object.prototype.hasOwnProperty.call(record, src)) {
            row[dst] = record[src];
          }
        });
      } else if (file.startsWith('prediction_')) {
        const predType = record.prediction_type;
        if (predType === 'ele_level') {
          row.ele_level_pred = record.label;
        } else if (predType === 'cog_type') {
          const code = record.label_code ?? getCogTypeCode(record.label, record.label_text);
          row.cog_type_pred = code ?? null;
        } else if (predType === 'mot_type') {
          row.mot_type_pred = record.label;
        } else if (predType === 'mot_level') {
          row.mot_level_pred = record.label;
        }
      }
    }

    if (rowsBySubject.size === 0) {
      return { ok: false, error: '未能从缓存数据中提取任何被试记录' };
    }

    const rows = Array.from(rowsBySubject.values());

    const columnDefs = [
      { header: 'id', key: 'subject_id' },
      { header: '姓名', key: 'basic_name' },
      { header: '性别', key: 'basic_gender' },
      { header: '民族', key: 'basic_ethnicity' },
      { header: '年龄', key: 'basic_age' },
      { header: '军龄', key: 'basic_service_years' },
      { header: '学历', key: 'basic_grade' },
      { header: '神经质', key: '神经质' },
      { header: '尽责性', key: '尽责性' },
      { header: '宜人性', key: '宜人性' },
      { header: '开放性', key: '开放性' },
      { header: '外向性', key: '外向性' },
      { header: '坚韧', key: '坚韧' },
      { header: '力量', key: '力量' },
      { header: '乐观', key: '乐观' },
      { header: '进取', key: '进取' },
      { header: '主动', key: '主动' },
      { header: '求精', key: '求精' },
      { header: '奉献', key: '奉献' },
      { header: '乐业', key: '乐业' },
      { header: '体能水平预测', key: 'ele_level_pred' },
      { header: '认知优势预测', key: 'cog_type_pred' },
      { header: '动机类型预测', key: 'mot_type_pred' },
      { header: '动机水平预测', key: 'mot_level_pred' },
      { header: 'Pre_SBP_BPHR', key: 'pre_sbp' },
      { header: 'Pre_DBP_BPHR', key: 'pre_dbp' },
      { header: 'Pre_HR_BPHR', key: 'pre_hr' },
      { header: 'Post_SBP_BPHR', key: 'post_sbp' },
      { header: 'Post_DBP_BPHR', key: 'post_dbp' },
      { header: 'Post_HR_BPHR', key: 'post_hr' },
      { header: 'n_peaks_ECG', key: 'n_peaks_ECG' },
      { header: 'Mean_RR_ms_ECG', key: 'Mean_RR_ms_ECG' },
      { header: 'SDNN_ms_ECG', key: 'SDNN_ms_ECG' },
      { header: 'RMSSD_ms_ECG', key: 'RMSSD_ms_ECG' },
      { header: 'pNN50_pct_ECG', key: 'pNN50_pct_ECG' },
      { header: 'HR_Mean_ECG', key: 'HR_Mean_ECG' },
      { header: 'HR_Std_ECG', key: 'HR_Std_ECG' },
      { header: 'HR_Change_Rate_ECG', key: 'HR_Change_Rate_ECG' },
      { header: 'Arm_MAV_EMG', key: 'Arm_MAV' },
      { header: 'Arm_MDF_EMG', key: 'Arm_MDF' },
      { header: 'Arm_MPF_EMG', key: 'Arm_MPF' },
      { header: 'Arm_Max_Amp_EMG', key: 'Arm_Max_Amp' },
      { header: 'Arm_RMS_EMG', key: 'Arm_RMS' },
      { header: 'Arm_iEMG_EMG', key: 'Arm_iEMG' },
      { header: 'Neck_MAV_EMG', key: 'Neck_MAV' },
      { header: 'Neck_MDF_EMG', key: 'Neck_MDF' },
      { header: 'Neck_MPF_EMG', key: 'Neck_MPF' },
      { header: 'Neck_Max_Amp_EMG', key: 'Neck_Max_Amp' },
      { header: 'Neck_RMS_EMG', key: 'Neck_RMS' },
      { header: 'Neck_iEMG_EMG', key: 'Neck_iEMG' },
      { header: 'duration_sec_Eye', key: 'duration_sec_Eye' },
      { header: 'sampling_rate_est_Eye', key: 'sampling_rate_est_Eye' },
      { header: 'blink_count_Eye', key: 'blink_count_Eye' },
      { header: 'short_blink_count_Eye', key: 'short_blink_count_Eye' },
      { header: 'blink_freq_Eye', key: 'blink_freq_Eye' },
      { header: 'avg_blink_dur_ms_Eye', key: 'avg_blink_dur_ms_Eye' },
      { header: 'fixation_count_Eye', key: 'fixation_count_Eye' },
      { header: 'fixation_freq_Eye', key: 'fixation_freq_Eye' },
      { header: 'avg_fixation_dur_ms_Eye', key: 'avg_fixation_dur_ms_Eye' },
      { header: 'saccade_count_Eye', key: 'saccade_count_Eye' },
      { header: 'avg_saccade_amp_deg_Eye', key: 'avg_saccade_amp_deg_Eye' },
      { header: 'avg_pupil_L_Eye', key: 'avg_pupil_L_Eye' },
      { header: 'gaze_yaw_std_Eye', key: 'gaze_yaw_std_Eye' },
      { header: 'gaze_pitch_std_Eye', key: 'gaze_pitch_std_Eye' },
      { header: 'avg_pupil_R_Eye', key: 'avg_pupil_R_Eye' },
      { header: 'Shooting_TotalScore_Score', key: 'Shooting_TotalScore_Score' },
      { header: 'Shooting_Accuracy_Score', key: 'Shooting_Accuracy_Score' },
      { header: 'Shooting_AvgScore_Score', key: 'Shooting_AvgScore_Score' },
      { header: 'Task4_BallAndRing_Score', key: 'Task4_BallAndRing_Score' },
      { header: 'Task4_NumberLine_Score', key: 'Task4_NumberLine_Score' },
      { header: 'Task4_Total_Score', key: 'Task4_Total_Score' },
      { header: 'Task4_Accuracy_Score', key: 'Task4_Accuracy_Score' },
      { header: 'Game5_TotalScore_Score', key: 'Game5_TotalScore_Score' },
      { header: 'Game5_LifeSum_Score', key: 'Game5_LifeSum_Score' }
    ];

    const escapeCsv = (value) => {
      if (value == null) return '';
      const s = String(value);
      if (/[",\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const lines = [];
    const headers = columnDefs.map(col => col.header);
    lines.push(headers.map(escapeCsv).join(','));
    rows.forEach(r => {
      const line = columnDefs.map(col => escapeCsv(r[col.key]));
      lines.push(line.join(','));
    });

    const timestamp = getCNTimestampForFile();
    const subjectIds = Array.from(rowsBySubject.keys());
    let baseId = subjectIds.length === 1 ? subjectIds[0] : (subjectIds[0] || 'ALL');
    baseId = String(baseId || 'ALL');
    const defaultName = `${baseId}_${timestamp}.csv`;

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (!filePath) {
      return { ok: false, error: '用户取消导出' };
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    return { ok: true, filePath };
  } catch (e) {
    console.error('Failed to export unified CSV:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('export:pdfReport', async (_event, subjectIdRaw) => {
  try {
    const subjectId = String(subjectIdRaw || '').trim();
    if (!subjectId) {
      return { ok: false, error: '未提供被试编号 (Subject ID missing)' };
    }

    // 1. 收集所有数据
    let features;
    try {
      features = collectFeaturesForSubject(subjectId);
    } catch (e) {
      return { ok: false, error: '数据收集失败: ' + e.message };
    }

    // 2. 获取预测结果 (调用 Python 脚本)
    const runPy = (script, mode) => {
      return new Promise(resolve => {
        const args = ['-X', 'utf8', resolveBundledPath(script)];
        if (mode) args.push(mode);
        const pyInfo = getPythonExecInfo();
        const py = spawn(pyInfo.exe, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: getPythonCwd(),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pyInfo.env }
        });
        
        let stdout = '';
        py.stdout.on('data', d => stdout += d.toString());
        py.on('close', () => {
          try { resolve(JSON.parse(stdout)); } catch (e) { resolve({}); }
        });
        py.stdin.write(JSON.stringify({ features }));
        py.stdin.end();
      });
    };

    const [eleRes, cogRes, motTypeRes, motLevelRes] = await Promise.all([
      runPy('utils/predict_ele_live.py'),
      runPy('utils/predict_cog_type_live.py'),
      runPy('utils/predict_motivation_live.py', 'type'),
      runPy('utils/predict_motivation_live.py', 'level')
    ]);

    // Force mapping for Motivation Type to ensure Chinese labels
    const motLabelMap = {
        '0': '外在调节型',
        '1': '自主动机型',
        'External Regulation Type': '外在调节型',
        'Autonomous Motivation Type': '自主动机型'
    };
    // Use label_text if available and not numeric/english, otherwise map from label
    let finalMotLabel = motTypeRes.label_text;
    if (!finalMotLabel || finalMotLabel === '0' || finalMotLabel === '1' || /^[a-zA-Z\s]+$/.test(finalMotLabel)) {
        finalMotLabel = motLabelMap[String(motTypeRes.label)] || motTypeRes.label_text || '未知';
    }

    // Guidance Helper
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
                '内部动机': '该士兵训练热情源于内心热爱，积极性高。建议：给予充分的自主权，鼓励其挑战更高目标，发挥榜样作用。',
                '认同动机': '该士兵认同训练价值，自觉性较好。建议：明确任务意义，强化其对集体目标的认同感。',
                '外在调节': '该士兵主要受奖惩机制驱动。建议：建立明确的奖惩反馈机制，逐步引导其寻找训练的内在乐趣。',
                '无动机': '该士兵缺乏训练动力，可能存在心理倦怠。建议：重点关注心理状态，进行深入沟通，寻找动力阻碍点，制定个性化激励方案。',
                '自主动机型': '该士兵整体表现为自主动机主导，训练积极性高，心理韧性强。建议：继续给予自主权，发挥其榜样作用，同时关注其在高压下的心理状态。',
                '外在调节型': '该士兵整体表现为外在调节主导，依赖外部奖惩。建议：建立明确的短期目标和奖惩机制，逐步引导其寻找训练的内在意义，培养自主性。'
            },
            'mot_level': {
                '高自主动机水平': '心理韧性强，抗压能力出色。建议：可委以重任，在团队中担任精神核心，带动整体士气。',
                '较低自主动机水平': '易受外界环境影响，情绪波动可能较大。建议：加强心理疏导与抗压训练，多给予正向反馈，帮助建立自信心。'
            }
        };

        let key = type;
        let subKey = labelText || label;
        if (templates[key]) {
            if (templates[key][subKey]) return templates[key][subKey];
            for (const k in templates[key]) {
                if (subKey && subKey.includes(k)) return templates[key][k];
            }
        }
        return '暂无特定指导意见。建议结合具体各项指标进行针对性补强。';
    }

    // 3. 构建 HTML 报告内容
    const timestamp = getCNTimestampForFile();
    let echartsScript = '';
    try {
        const echartsPath = path.join(__dirname, 'libs', 'echarts.min.js');
        if (fs.existsSync(echartsPath)) {
            echartsScript = fs.readFileSync(echartsPath, 'utf-8');
        } else {
            echartsScript = '/* Local echarts not found, using CDN */'; 
        }
    } catch (e) {
        console.error('Failed to read local echarts:', e);
    }

    // Prepare Radar Data for Questionnaire
    // Extract subscale scores from features if available (keys ending with _Psy or from raw naming)
    // Actually features has flattened keys. We need to map them back to radar dimensions.
    // Dimensions from renderer.js:
    // BigFive: 神经质, 尽责性, 宜人性, 开放性, 外向性
    // PsyCap: 坚韧, 力量, 乐观
    
    const getVal = (k) => {
        let v = features[k] || features[k + '_Psy'];
        return (typeof v === 'number' && !isNaN(v)) ? v : 0;
    };

    const radarData = {
        bigfive: [getVal('神经质'), getVal('尽责性'), getVal('宜人性'), getVal('开放性'), getVal('外向性')],
        psycap: [getVal('坚韧'), getVal('力量'), getVal('乐观')],
        achievement: [getVal('进取'), getVal('主动'), getVal('求精'), getVal('奉献'), getVal('乐业')]
    };

    // Helper for safe number formatting
    const safeFixed = (val, digits = 2) => {
        if (val == null || val === '') return '-';
        const num = parseFloat(val);
        if (isNaN(num)) return '-';
        return num.toFixed(digits);
    };

    const pickFeature = (keys) => {
        for (const k of keys) {
            if (Object.prototype.hasOwnProperty.call(features, k)) {
                const v = features[k];
                if (v !== null && v !== undefined && v !== '') return v;
            }
        }
        return null;
    };

    const formatValue = (val) => {
        if (val == null || val === '') return '-';
        const num = Number(val);
        if (!Number.isFinite(num)) return String(val);
        return Number.isInteger(num) ? String(num) : num.toFixed(2);
    };

    const loadMetricConfig = (fileName) => {
        const candidates = [
            path.join(__dirname, fileName),
            path.join(__dirname, 'config', fileName),
            path.join(__dirname, 'data', fileName),
            path.join(process.cwd(), fileName)
        ];
        for (const filePath of candidates) {
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    return JSON.parse(content);
                }
            } catch (e) {}
        }
        return null;
    };

    const normalizeMetricGroups = (config, fallbackTitle) => {
        if (!config) return [];
        if (Array.isArray(config)) {
            return [{ title: fallbackTitle, items: config }];
        }
        const groupArray = config.groups || config.sections || config.tables || null;
        if (Array.isArray(groupArray)) {
            return groupArray.map(group => ({
                title: group.title || group.name || group.label || fallbackTitle,
                items: group.items || group.metrics || group.rows || group.list || []
            }));
        }
        const items = config.items || config.metrics || config.rows || config.list || config.data || [];
        if (Array.isArray(items)) {
            return [{ title: config.title || config.name || fallbackTitle, items }];
        }
        return [];
    };

    const physioIndexConfig = loadMetricConfig('physiological_index.json');
    const ecgMetricsConfig = loadMetricConfig('ecg_metrics.json');
    const emgMetricsConfig = loadMetricConfig('emg_metrics.json');

    const fallbackEcgMetrics = [
        { label: 'n_peaks_ECG', keys: ['n_peaks_ECG'] },
        { label: 'Mean_RR_ms_ECG', keys: ['Mean_RR_ms_ECG'] },
        { label: 'SDNN_ms_ECG', keys: ['SDNN_ms_ECG'] },
        { label: 'RMSSD_ms_ECG', keys: ['RMSSD_ms_ECG'] },
        { label: 'pNN50_pct_ECG', keys: ['pNN50_pct_ECG'] },
        { label: 'HR_Mean_ECG', keys: ['HR_Mean_ECG'] },
        { label: 'HR_Std_ECG', keys: ['HR_Std_ECG'] },
        { label: 'HR_Change_Rate_ECG', keys: ['HR_Change_Rate_ECG'] }
    ];

    const fallbackEmgMetrics = [
        { label: 'Arm_MAV_EMG', keys: ['Arm_MAV_EMG', 'Arm_MAV'] },
        { label: 'Arm_MDF_EMG', keys: ['Arm_MDF_EMG', 'Arm_MDF'] },
        { label: 'Arm_MPF_EMG', keys: ['Arm_MPF_EMG', 'Arm_MPF'] },
        { label: 'Arm_Max_Amp_EMG', keys: ['Arm_Max_Amp_EMG', 'Arm_Max_Amp'] },
        { label: 'Arm_RMS_EMG', keys: ['Arm_RMS_EMG', 'Arm_RMS'] },
        { label: 'Arm_iEMG_EMG', keys: ['Arm_iEMG_EMG', 'Arm_iEMG'] },
        { label: 'Neck_MAV_EMG', keys: ['Neck_MAV_EMG', 'Neck_MAV'] },
        { label: 'Neck_MDF_EMG', keys: ['Neck_MDF_EMG', 'Neck_MDF'] },
        { label: 'Neck_MPF_EMG', keys: ['Neck_MPF_EMG', 'Neck_MPF'] },
        { label: 'Neck_Max_Amp_EMG', keys: ['Neck_Max_Amp_EMG', 'Neck_Max_Amp'] },
        { label: 'Neck_RMS_EMG', keys: ['Neck_RMS_EMG', 'Neck_RMS'] },
        { label: 'Neck_iEMG_EMG', keys: ['Neck_iEMG_EMG', 'Neck_iEMG'] }
    ];

    const fallbackPhysioIndex = [
        { label: 'duration_sec_Eye', keys: ['duration_sec_Eye'] },
        { label: 'sampling_rate_est_Eye', keys: ['sampling_rate_est_Eye'] },
        { label: 'blink_count_Eye', keys: ['blink_count_Eye'] },
        { label: 'short_blink_count_Eye', keys: ['short_blink_count_Eye'] },
        { label: 'blink_freq_Eye', keys: ['blink_freq_Eye'] },
        { label: 'avg_blink_dur_ms_Eye', keys: ['avg_blink_dur_ms_Eye'] },
        { label: 'fixation_count_Eye', keys: ['fixation_count_Eye'] },
        { label: 'fixation_freq_Eye', keys: ['fixation_freq_Eye'] },
        { label: 'avg_fixation_dur_ms_Eye', keys: ['avg_fixation_dur_ms_Eye'] },
        { label: 'saccade_count_Eye', keys: ['saccade_count_Eye'] },
        { label: 'avg_saccade_amp_deg_Eye', keys: ['avg_saccade_amp_deg_Eye'] },
        { label: 'avg_pupil_L_Eye', keys: ['avg_pupil_L_Eye'] },
        { label: 'gaze_yaw_std_Eye', keys: ['gaze_yaw_std_Eye'] },
        { label: 'gaze_pitch_std_Eye', keys: ['gaze_pitch_std_Eye'] },
        { label: 'avg_pupil_R_Eye', keys: ['avg_pupil_R_Eye'] }
    ];

    const gameMetrics = [
        { label: 'Shooting_TotalScore_Score', keys: ['Shooting_TotalScore_Score'] },
        { label: 'Shooting_Accuracy_Score', keys: ['Shooting_Accuracy_Score'] },
        { label: 'Shooting_AvgScore_Score', keys: ['Shooting_AvgScore_Score'] },
        { label: 'Task4_BallAndRing_Score', keys: ['Task4_BallAndRing_Score'] },
        { label: 'Task4_NumberLine_Score', keys: ['Task4_NumberLine_Score'] },
        { label: 'Task4_Total_Score', keys: ['Task4_Total_Score'] },
        { label: 'Task4_Accuracy_Score', keys: ['Task4_Accuracy_Score'] },
        { label: 'Game5_TotalScore_Score', keys: ['Game5_TotalScore_Score'] },
        { label: 'Game5_LifeSum_Score', keys: ['Game5_LifeSum_Score'] }
    ];

    const renderMetricRows = (metrics) => {
        return metrics.map(m => {
            const value = formatValue(pickFeature(m.keys));
            return `<tr><td>${m.label}</td><td>${value}</td></tr>`;
        }).join('');
    };

    const normalizeGender = (raw) => {
        if (raw == null) return '';
        const g = String(raw).toLowerCase();
        if (g === 'male' || g === 'm' || g === '男') return '男';
        if (g === 'female' || g === 'f' || g === '女') return '女';
        return String(raw);
    };

    const genderDisplay = normalizeGender(features.basic_gender);

    const normalizeEducation = (raw) => {
        if (raw == null) return '';
        const s = String(raw).toLowerCase();
        const isCollege = s.includes('大专') || s.includes('专科') || s.includes('associate') || s.includes('college');
        const isBachelor = s.includes('本科') || s.includes('bachelor');
        const isGraduate = s.includes('研究生') || s.includes('硕士') || s.includes('博士') || s.includes('master') || s.includes('phd') || s.includes('doctor');
        if (isCollege) return '大专';
        if (isBachelor) return '本科';
        if (isGraduate) return '研究生及以上';
        return String(raw);
    };

    const educationDisplay = normalizeEducation(features.basic_education || features.basic_grade);

    const getMetricKeys = (item) => {
        if (Array.isArray(item.keys)) return item.keys;
        const key = item.value_key || item.key || item.id || item.metric || item.name || item.label || item.title;
        if (!key) return [];
        return [key, `${key}_ECG`, `${key}_EMG`, `${key}_Eye`];
    };

    const formatRange = (item) => {
        const direct = item.range || item.normal_range || item.ref_range || item.reference || item.ref;
        if (direct) return String(direct);
        if (item.min != null && item.max != null) return `${item.min} - ${item.max}`;
        return '';
    };

    const getLatestCacheRecord = (prefix) => {
        const cacheDir = getCacheDir();
        if (!fs.existsSync(cacheDir)) return null;
        const files = fs.readdirSync(cacheDir).filter(f => f.startsWith(prefix + '_' + subjectId + '_') && f.endsWith('.json'));
        if (files.length === 0) return null;
        files.sort();
        const target = files[files.length - 1];
        try {
            const content = fs.readFileSync(path.join(cacheDir, target), 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    };

    const downsample = (arr, maxPoints) => {
        if (!Array.isArray(arr)) return [];
        if (arr.length <= maxPoints) return arr;
        const out = [];
        const step = arr.length / maxPoints;
        for (let i = 0; i < maxPoints; i++) {
            out.push(arr[Math.floor(i * step)]);
        }
        return out;
    };

    const ecgRecord = getLatestCacheRecord('ecg');
    const emgRecord = getLatestCacheRecord('emg');
    const eyeRecord = getLatestCacheRecord('eye');

    const metricNameMap = {
        'n_peaks_ECG': '心电 R 峰数量 (次)',
        'Mean_RR_ms_ECG': '平均 RR 间期 (ms)',
        'SDNN_ms_ECG': 'RR 间期标准差 (ms)',
        'RMSSD_ms_ECG': '相邻 RR 差值均方根 (ms)',
        'pNN50_pct_ECG': '相邻 RR 间期差值 >50ms 比例 (%)',
        'HR_Mean_ECG': '平均心率 (bpm)',
        'HR_Std_ECG': '心率标准差 (bpm)',
        'HR_Change_Rate_ECG': '心率变化率',
        
        'Arm_MAV': '上肢肌电平均绝对值 (μV)',
        'Arm_MDF': '上肢肌电中值频率 (Hz)',
        'Arm_MPF': '上肢肌电平均功率频率 (Hz)',
        'Arm_RMS': '上肢肌电均方根 (μV)',
        'Arm_iEMG': '上肢肌电积分 (μV·s)',
        'Arm_Max_Amp': '上肢肌电最大幅值 (μV)',
        'Neck_MAV': '颈部肌电平均绝对值 (μV)',
        'Neck_MDF': '颈部肌电中值频率 (Hz)',
        'Neck_MPF': '颈部肌电平均功率频率 (Hz)',
        'Neck_RMS': '颈部肌电均方根 (μV)',
        'Neck_iEMG': '颈部肌电积分 (μV·s)',
        'Neck_Max_Amp': '颈部肌电最大幅值 (μV)',

        'blink_count_Eye': '眨眼次数 (次)',
        'blink_rate_Hz_Eye': '眨眼频率 (次/分钟)',
        'blink_dur_ms_Eye': '眨眼持续时间 (ms)',
        'fixation_count_Eye': '注视次数 (次)',
        'fixation_rate_Hz_Eye': '注视频率 (次/分钟)',
        'avg_fixation_dur_ms_Eye': '平均注视时长 (ms)',
        'avg_pupil_diam_mm_Eye': '平均瞳孔直径 (mm)',
        'saccade_count_Eye': '扫视次数 (次)',
        'saccade_rate_Hz_Eye': '扫视频率 (次/分钟)',
        'avg_saccade_amp_deg_Eye': '平均扫视幅度 (度)',
        'avg_saccade_vel_deg_s_Eye': '平均扫视速度 (度/秒)'
    };

    const renderMetricTable = (title, metricsObj) => {
        const rows = metricsObj ? Object.entries(metricsObj).map(([key, value]) => {
            const valStr = formatValue(value);
            const displayKey = metricNameMap[key] || key;
            return `<tr><td>${displayKey}</td><td>${valStr}</td></tr>`;
        }).join('') : '';

        return `
          <div class="result-card avoid-break">
            <h3>${title}</h3>
            <table>
              <thead>
                <tr><th>指标名称</th><th>数值</th></tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="2">暂无数据</td></tr>`}
              </tbody>
            </table>
          </div>
        `;
    };

    const buildPhysioTablesHtml = () => {
        let html = '';
        html += renderMetricTable('ECG 心电指标 (ECG Metrics)', ecgRecord ? ecgRecord.metrics : {});
        html += renderMetricTable('EMG 肌电指标 (EMG Metrics)', emgRecord ? emgRecord.metrics : {});
        html += renderMetricTable('眼动指标 (Eye Metrics)', eyeRecord ? eyeRecord.metrics : {});
        return html;
    };

    const physioTablesHtml = buildPhysioTablesHtml();

    const ecgAnalysis = ecgRecord && ecgRecord.analysis ? ecgRecord.analysis : ecgRecord;
    const emgAnalysis = emgRecord && emgRecord.analysis ? emgRecord.analysis : emgRecord;
    const eyeAnalysis = eyeRecord && eyeRecord.analysis ? eyeRecord.analysis : eyeRecord;

    const ecgWaveData = downsample(ecgAnalysis && Array.isArray(ecgAnalysis.voltage) ? ecgAnalysis.voltage : [], 800);
    const emgWaveData = downsample(emgAnalysis && Array.isArray(emgAnalysis.voltage) ? emgAnalysis.voltage : [], 800);
    const ecgWaveAvailable = ecgWaveData.length > 0;
    const emgWaveAvailable = emgWaveData.length > 0;
    const ecgWaveBox = ecgWaveAvailable
        ? `<div class="chart-box signal-box"><div class="chart-title">ECG 波形</div><div id="chart-ecg-wave" class="chart-canvas"></div></div>`
        : `<div class="chart-box signal-box"><div class="chart-title">ECG 波形</div><div class="empty-chart">暂无数据</div></div>`;
    const emgWaveBox = emgWaveAvailable
        ? `<div class="chart-box signal-box"><div class="chart-title">EMG 波形</div><div id="chart-emg-wave" class="chart-canvas"></div></div>`
        : `<div class="chart-box signal-box"><div class="chart-title">EMG 波形</div><div class="empty-chart">暂无数据</div></div>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="zh">
      <head>
        <meta charset="UTF-8">
        <title>综合分析报告 - ${subjectId}</title>
        <style>
          body { font-family: "Microsoft YaHei", "Segoe UI", sans-serif; padding: 20px; color: #333; max-width: 820px; margin: 0 auto; background: #fff; }
          h1 { text-align: center; color: #0078d7; border-bottom: 2px solid #0078d7; padding-bottom: 8px; margin-bottom: 12px; }
          h2 { color: #0f172a; margin-top: 16px; border-left: 5px solid #0078d7; padding-left: 10px; font-size: 18px; background: #f1f5f9; padding: 8px; border-radius: 0 6px 6px 0; }
          h3 { color: #334155; margin-top: 8px; font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .meta-info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
          .meta-item { display: flex; flex-direction: column; }
          .meta-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
          .meta-value { font-size: 16px; font-weight: 600; color: #0f172a; }
          
          .result-section { display: flex; gap: 10px; margin-bottom: 10px; page-break-inside: avoid; }
          .result-card { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; box-shadow: 0 1px 2px -1px rgba(0, 0, 0, 0.05); background: #fff; }
          
          .highlight { font-weight: bold; color: #0078d7; font-size: 1.2em; }
          .chart-container { width: 100%; height: 200px; margin: 6px 0; }
          .chart-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
          .chart-column { display: flex; flex-direction: column; gap: 8px; }
          .chart-box { flex: 1; min-width: 220px; height: 220px; border: 1px solid #f1f5f9; border-radius: 6px; padding: 6px; display: flex; flex-direction: column; page-break-inside: avoid; }
          .signal-box { min-width: 300px; height: 230px; }
          .questionnaire-radar-row .chart-box { min-width: 260px; height: 290px; }
          .questionnaire-radar-row .chart-canvas { min-height: 250px; }
          .chart-title { font-size: 13px; color: #334155; font-weight: 600; margin: 2px 0 0 4px; }
          .empty-chart { height: 100%; display: flex; align-items: center; justify-content: center; color: #94a3b8; background: #f8fafc; border-radius: 6px; }
          .chart-canvas { width: 100%; height: 100%; flex: 1; }
          .chart-image { width: 100%; height: 100%; object-fit: contain; display: block; }
          .chart-small { width: 130px; height: 130px; }
          .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }
          .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
          .metric-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
          .metric-label { font-size: 13px; color: #334155; font-weight: 600; }
          .metric-value { font-size: 18px; color: #0f172a; font-weight: 700; }
          .metric-bar { position: relative; height: 16px; border-radius: 9999px; overflow: hidden; background: linear-gradient(to right, #ef4444 0%, #ef4444 33.333%, #f59e0b 33.333%, #f59e0b 66.666%, #10b981 66.666%, #10b981 100%); }
          .metric-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 14px; height: 14px; background: #111827; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.15); }
          .metric-scale { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: #64748b; }
          
          .guidance-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 10px; border-radius: 4px; margin-top: 10px; }
          .guidance-title { color: #1e40af; font-weight: bold; margin-bottom: 4px; font-size: 13px; }
          .guidance-text { color: #1e3a8a; font-size: 13px; line-height: 1.5; }
          
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
          th, td { border: 1px solid #e2e8f0; padding: 6px 6px; text-align: left; }
          th { background: #f8fafc; color: #475569; font-weight: 600; }
          .avoid-break { page-break-inside: avoid; }
          .page-break { page-break-before: always; break-before: page; }
          tr:nth-child(even) { background: #fcfcfc; }
          
          .footer { margin-top: 18px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
          
          @media print {
            body { padding: 0; max-width: 100%; }
            .result-card { box-shadow: none; border: 1px solid #ccc; }
          }
        </style>
        <script>
          ${echartsScript}
        </script>
        ${!echartsScript || echartsScript.length < 100 ? '<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>' : ''}
      </head>
      <body>
        <h1>个人综合素质评估报告</h1>
        
        <div class="meta-info">
          <div class="meta-item"><span class="meta-label">被试编号 (ID)</span><span class="meta-value">${subjectId}</span></div>
          <div class="meta-item"><span class="meta-label">姓名 (Name)</span><span class="meta-value">${features.basic_name || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">性别 (Gender)</span><span class="meta-value">${genderDisplay || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">民族 (Ethnicity)</span><span class="meta-value">${features.basic_ethnicity || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">年龄 (Age)</span><span class="meta-value">${features.basic_age || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">军龄 (Service Years)</span><span class="meta-value">${features.basic_service_years || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">学历 (Education)</span><span class="meta-value">${educationDisplay || '-'}</span></div>
          <div class="meta-item"><span class="meta-label">报告日期 (Date)</span><span class="meta-value">${new Date().toLocaleDateString()}</span></div>
        </div>

        <h2>1. 核心评估与指导 (Core Assessment & Guidance)</h2>
        
        <div class="avoid-break">
          <!-- 体能 -->
          <div class="result-section">
              <div class="result-card">
                <h3>🏃 体能水平 (Physical Fitness)</h3>
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <p>预测等级：<span class="highlight">${eleRes.label_text || '未知'}</span></p>
                        <p>高水平概率：${(eleRes.prob_high * 100).toFixed(1)}%</p>
                    </div>
                    <div id="chart-ele" class="chart-canvas chart-small"></div>
                </div>
                <div class="guidance-box">
                  <div class="guidance-title">💡 训练指导建议</div>
                  <div class="guidance-text">${getGuidance('ele', eleRes.label, eleRes.label_text)}</div>
                </div>
              </div>
              
              <!-- 认知 -->
              <div class="result-card">
                <h3>🧠 认知优势 (Cognitive Profile)</h3>
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <p>优势类型：<span class="highlight">${cogRes.label_text || '未知'}</span></p>
                    </div>
                    <div id="chart-cog" class="chart-canvas chart-small"></div>
                </div>
                <div class="guidance-box">
                  <div class="guidance-title">💡 岗位匹配建议</div>
                  <div class="guidance-text">${getGuidance('cog', cogRes.label, cogRes.label_text)}</div>
                </div>
              </div>
          </div>

          <!-- 动机 -->
          <div class="result-section">
              <div class="result-card">
                <h3>🔥 动机特征 (Motivation)</h3>
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <p>主导类型：<span class="highlight">${finalMotLabel}</span></p>
                        <p>自主动机水平：<span class="highlight">${motLevelRes.label_text || '未知'}</span> (Score: ${motLevelRes.score?.toFixed(2)})</p>
                    </div>
                    <div id="chart-mot" class="chart-canvas chart-small"></div>
                </div>
                <div class="guidance-box">
                  <div class="guidance-title">💡 心理激励建议</div>
                  <div class="guidance-text">
                      ${getGuidance('mot_type', motTypeRes.label, finalMotLabel)}<br>
                      ${getGuidance('mot_level', motLevelRes.label, motLevelRes.label_text)}
                  </div>
                </div>
              </div>
          </div>
        </div>

        <div class="page-break"></div>
        <h2>2. 问卷测评画像 (Questionnaire Profile)</h2>
        <div class="chart-row questionnaire-radar-row avoid-break">
            <div class="chart-box"><div class="chart-title">大五人格雷达</div><div class="chart-canvas" id="radar-bigfive"></div></div>
            <div class="chart-box"><div class="chart-title">心理弹性雷达</div><div class="chart-canvas" id="radar-psycap"></div></div>
            <div class="chart-box"><div class="chart-title">成就动机雷达</div><div class="chart-canvas" id="radar-achievement"></div></div>
        </div>

        <h2>3. 生理指标分析 (Physiological Analysis)</h2>
        ${physioTablesHtml}
        <div class="result-card avoid-break">
          ${ecgWaveBox}
        </div>
        <div class="result-card avoid-break">
          ${emgWaveBox}
        </div>

        <h2>4. 游戏成绩分析 (Game Performance)</h2>
        <div class="result-card">
          <table>
            <thead>
              <tr><th>指标</th><th>数值</th></tr>
            </thead>
            <tbody>
              ${renderMetricRows(gameMetrics)}
            </tbody>
          </table>
        </div>

        <div class="footer">
          此报告由 301_demo 系统自动生成 · 仅供内部训练参考 · ${timestamp}
        </div>

        <script>
          const expectedCharts = ${6 + (ecgWaveAvailable ? 1 : 0) + (emgWaveAvailable ? 1 : 0)};
          const readyIds = new Set();
          const markReadyById = (id) => {
            if (readyIds.has(id)) return;
            readyIds.add(id);
            if (readyIds.size >= expectedCharts) window.__chartsReady = true;
          };
          if (expectedCharts === 0) window.__chartsReady = true;
          const startRender = () => {
            const renderChartToImage = (id, option) => {
              const dom = document.getElementById(id);
              if (!dom) {
                markReadyById(id);
                return;
              }
              const resolveSize = () => {
                const rect = dom.getBoundingClientRect();
                let width = rect.width;
                let height = rect.height;
                if (width < 10 || height < 10) {
                  const parent = dom.parentElement;
                  if (parent) {
                    const prect = parent.getBoundingClientRect();
                    width = Math.max(width, prect.width - 16);
                    height = Math.max(height, prect.height - 36);
                  }
                }
                width = Math.max(width, 260);
                height = Math.max(height, 180);
                dom.style.width = width + 'px';
                dom.style.height = height + 'px';
                return { width, height };
              };
              const renderOnce = () => {
                try {
                  const size = resolveSize();
                  const chart = echarts.init(dom, null, { renderer: 'canvas' });
                  const finalOption = option || {};
                  finalOption.animation = false;
                  if (Array.isArray(finalOption.series)) {
                    finalOption.series = finalOption.series.map(s => ({ ...s, animation: false }));
                  }
                  chart.setOption(finalOption, true);
                  chart.resize(size);
                  const imgData = chart.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#fff' });
                  chart.dispose();
                  const imgEl = new Image();
                  imgEl.className = 'chart-image';
                  imgEl.onload = () => {
                    dom.innerHTML = '';
                    dom.appendChild(imgEl);
                    markReadyById(id);
                  };
                  imgEl.onerror = () => {
                    dom.innerHTML = '<div class="empty-chart">图形渲染失败</div>';
                    markReadyById(id);
                  };
                  imgEl.src = imgData;
                } catch (e) {
                  dom.innerHTML = '<div class="empty-chart">图形渲染失败</div>';
                  markReadyById(id);
                }
              };
              requestAnimationFrame(() => requestAnimationFrame(renderOnce));
            };

            const rData = ${JSON.stringify(radarData)};

            renderChartToImage('chart-ele', {
              series: [{
                type: 'gauge',
                max: 1,
                radius: '90%',
                detail: { formatter: '{value}', fontSize: 14 },
                axisLine: { lineStyle: { width: 8 } },
                splitLine: { length: 8 },
                data: [{ value: ${(eleRes.prob_high || 0).toFixed(2)}, name: '高水平概率' }]
              }]
            });

            renderChartToImage('chart-cog', {
              radar: { indicator: ${JSON.stringify(Object.keys(cogRes.probs || {}).map(k => ({name: k, max: 1})))} },
              series: [{
                type: 'radar',
                data: [{ value: ${JSON.stringify(Object.values(cogRes.probs || {}))}, name: '认知分布' }]
              }]
            });

            renderChartToImage('chart-mot', {
              radar: { indicator: ${JSON.stringify(Object.keys(motTypeRes.probs || {}).map(k => ({name: k, max: 1})))} },
              series: [{
                type: 'radar',
                data: [{ value: ${JSON.stringify(Object.values(motTypeRes.probs || {}))}, name: '动机分布' }]
              }]
            });

            renderChartToImage('radar-bigfive', {
              radar: { indicator: [
                {name: '神经质', max: 48}, {name: '尽责性', max: 48}, {name: '宜人性', max: 48},
                {name: '开放性', max: 48}, {name: '外向性', max: 48}
              ], radius: '65%', center: ['50%', '55%'] },
              series: [{
                type: 'radar',
                data: [{ value: rData.bigfive, name: '大五人格' }],
                areaStyle: { opacity: 0.3, color: '#7c3aed' },
                lineStyle: { color: '#7c3aed' },
                itemStyle: { color: '#7c3aed' }
              }]
            });

            renderChartToImage('radar-psycap', {
              radar: { indicator: [
                {name: '坚韧', max: 65}, {name: '力量', max: 40}, {name: '乐观', max: 20}
              ], radius: '65%', center: ['50%', '55%'] },
              series: [{
                type: 'radar',
                data: [{ value: rData.psycap, name: '心理弹性' }],
                areaStyle: { opacity: 0.3, color: '#059669' },
                lineStyle: { color: '#059669' },
                itemStyle: { color: '#059669' }
              }]
            });

            renderChartToImage('radar-achievement', {
              radar: { indicator: [
                {name: '进取', max: 15}, {name: '主动', max: 25}, {name: '求精', max: 15},
                {name: '奉献', max: 25}, {name: '乐业', max: 15}
              ], radius: '65%', center: ['50%', '55%'] },
              series: [{
                type: 'radar',
                data: [{ value: rData.achievement, name: '成就动机' }],
                areaStyle: { opacity: 0.3, color: '#0ea5e9' },
                lineStyle: { color: '#0ea5e9' },
                itemStyle: { color: '#0ea5e9' }
              }]
            });

            const ecgWave = ${JSON.stringify(ecgWaveData)};
            if (ecgWave.length) {
              renderChartToImage('chart-ecg-wave', {
                xAxis: { type: 'category', show: false, data: ecgWave.map((_, i) => i) },
                yAxis: { type: 'value', show: true },
                grid: { left: 30, right: 10, top: 10, bottom: 20 },
                series: [{ type: 'line', data: ecgWave, showSymbol: false, lineStyle: { width: 1, color: '#ef4444' } }]
              });
            }

            const emgWave = ${JSON.stringify(emgWaveData)};
            if (emgWave.length) {
              renderChartToImage('chart-emg-wave', {
                xAxis: { type: 'category', show: false, data: emgWave.map((_, i) => i) },
                yAxis: { type: 'value', show: true },
                grid: { left: 30, right: 10, top: 10, bottom: 20 },
                series: [{ type: 'line', data: emgWave, showSymbol: false, lineStyle: { width: 1, color: '#3b82f6' } }]
              });
            }

          };
          const waitStart = Date.now();
          const waitForEcharts = () => {
            if (window.echarts) {
              startRender();
              return;
            }
            if (Date.now() - waitStart > 5000) {
              window.__chartsReady = true;
              return;
            }
            setTimeout(waitForEcharts, 100);
          };
          waitForEcharts();

        </script>
      </body>
      </html>
    `;

    // 4. 生成 PDF
    const win = new BrowserWindow({ show: false, width: 800, height: 1200 });
    const tempHtmlPath = path.join(app.getPath('temp'), `report_${subjectId}_${timestamp}.html`);
    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf-8');
    await win.loadFile(tempHtmlPath);
    await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        const start = Date.now();
        const tick = () => {
          if (window.__chartsReady) return resolve(true);
          if (Date.now() - start > 8000) return resolve(false);
          requestAnimationFrame(tick);
        };
        tick();
      });
    `);

    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 } // CSS handles padding
    });

    win.close();
    try {
      fs.unlinkSync(tempHtmlPath);
    } catch (e) {}

    // 5. 保存文件
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `Report_${subjectId}_${timestamp}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    });

    if (filePath) {
      fs.writeFileSync(filePath, pdfData);
      return { ok: true, filePath };
    } else {
      return { ok: false, error: '取消保存' };
    }

  } catch (e) {
    console.error('PDF Generation Error:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('ele:predictLevel', async (_event, subjectId) => {
  try {
    ensureCacheDir();
    const features = collectFeaturesForSubject(subjectId);
    if (!features || Object.keys(features).length <= 1) {
      return { ok: false, error: '未找到该被试的有效特征，请先完成并保存相关数据' };
    }

    return await new Promise(resolve => {
      const pyInfo = getPythonExecInfo();
      const py = spawn(pyInfo.exe, ['-X', 'utf8', resolveBundledPath('utils/predict_ele_live.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getPythonCwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pyInfo.env }
      });

      let stdout = '';
      let stderr = '';

      py.stdout.on('data', data => {
        stdout += data.toString();
      });

      py.stderr.on('data', data => {
        stderr += data.toString();
      });

      py.on('close', code => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Python 退出码 ${code}` });
          return;
        }
        try {
          const out = JSON.parse(stdout);
          if (out && out.ok) {
            try {
              savePredictionRecord('ele_level', subjectId, {
                label: out.label,
                label_text: out.label_text,
                prob_high: out.prob_high
              });
            } catch (e) {
              resolve({ ok: false, error: '保存预测结果失败: ' + e.message });
              return;
            }
            resolve({
              ok: true,
              label: out.label,
              label_text: out.label_text,
              prob_high: out.prob_high
            });
          } else {
            resolve({ ok: false, error: (out && out.error) || '未知错误' });
          }
        } catch (e) {
          resolve({ ok: false, error: '解析 Python 输出失败' });
        }
      });

      try {
        py.stdin.write(JSON.stringify({ features }) + '\n');
        py.stdin.end();
      } catch (e) {
        resolve({ ok: false, error: '向 Python 发送数据失败: ' + e.message });
      }
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('cog:predictType', async (_event, subjectId) => {
  try {
    ensureCacheDir();
    const features = collectFeaturesForSubject(subjectId);
    if (!features || Object.keys(features).length <= 1) {
      return { ok: false, error: '未找到该被试的有效特征，请先完成并保存相关数据' };
    }

    return await new Promise(resolve => {
      const pyInfo = getPythonExecInfo();
      const py = spawn(pyInfo.exe, ['-X', 'utf8', resolveBundledPath('utils/predict_cog_type_live.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getPythonCwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pyInfo.env }
      });

      let stdout = '';
      let stderr = '';

      py.stdout.on('data', data => {
        stdout += data.toString();
      });

      py.stderr.on('data', data => {
        stderr += data.toString();
      });

      py.on('close', code => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Python 退出码 ${code}` });
          return;
        }
        try {
          const out = JSON.parse(stdout);
          if (out && out.ok) {
            try {
              const labelCode = getCogTypeCode(out.label, out.label_text);
              savePredictionRecord('cog_type', subjectId, {
                label: out.label,
                label_text: out.label_text,
                label_code: labelCode,
                probs: out.probs
              });
            } catch (e) {
              resolve({ ok: false, error: '保存预测结果失败: ' + e.message });
              return;
            }
            resolve({
              ok: true,
              label: out.label,
              label_text: out.label_text,
              probs: out.probs
            });
          } else {
            resolve({ ok: false, error: (out && out.error) || '未知错误' });
          }
        } catch (e) {
          resolve({ ok: false, error: '解析 Python 输出失败' });
        }
      });

      try {
        py.stdin.write(JSON.stringify({ features }) + '\n');
        py.stdin.end();
      } catch (e) {
        resolve({ ok: false, error: '向 Python 发送数据失败: ' + e.message });
      }
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('mot:predictType', async (_event, subjectId) => {
  try {
    ensureCacheDir();
    const features = collectFeaturesForSubject(subjectId);
    if (!features || Object.keys(features).length <= 1) {
      return { ok: false, error: '未找到该被试的有效特征，请先完成并保存相关数据' };
    }

    return await new Promise(resolve => {
      const pyInfo = getPythonExecInfo();
      const py = spawn(pyInfo.exe, ['-X', 'utf8', resolveBundledPath('utils/predict_motivation_live.py'), 'type'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getPythonCwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pyInfo.env }
      });

      let stdout = '';
      let stderr = '';

      py.stdout.on('data', data => {
        stdout += data.toString();
      });

      py.stderr.on('data', data => {
        stderr += data.toString();
      });

      py.on('close', code => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Python 退出码 ${code}` });
          return;
        }
        try {
          const out = JSON.parse(stdout);
          if (out && out.ok) {
            try {
              savePredictionRecord('mot_type', subjectId, {
                label: out.label,
                label_text: out.label_text,
                probs: out.probs
              });
            } catch (e) {
              resolve({ ok: false, error: '保存预测结果失败: ' + e.message });
              return;
            }
            resolve({
              ok: true,
              label: out.label,
              label_text: out.label_text,
              probs: out.probs
            });
          } else {
            resolve({ ok: false, error: (out && out.error) || '未知错误' });
          }
        } catch (e) {
          resolve({ ok: false, error: '解析 Python 输出失败' });
        }
      });

      try {
        py.stdin.write(JSON.stringify({ features }) + '\n');
        py.stdin.end();
      } catch (e) {
        resolve({ ok: false, error: '向 Python 发送数据失败: ' + e.message });
      }
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('mot:predictLevel', async (_event, subjectId) => {
  try {
    ensureCacheDir();
    const features = collectFeaturesForSubject(subjectId);
    if (!features || Object.keys(features).length <= 1) {
      return { ok: false, error: '未找到该被试的有效特征，请先完成并保存相关数据' };
    }

    return await new Promise(resolve => {
      const pyInfo = getPythonExecInfo();
      const py = spawn(pyInfo.exe, ['-X', 'utf8', resolveBundledPath('utils/predict_motivation_live.py'), 'level'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getPythonCwd(),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pyInfo.env }
      });

      let stdout = '';
      let stderr = '';

      py.stdout.on('data', data => {
        stdout += data.toString();
      });

      py.stderr.on('data', data => {
        stderr += data.toString();
      });

      py.on('close', code => {
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `Python 退出码 ${code}` });
          return;
        }
        try {
          const out = JSON.parse(stdout);
          if (out && out.ok) {
            try {
              savePredictionRecord('mot_level', subjectId, {
                label: out.label,
                label_text: out.label_text,
                prob_high: out.prob_high,
                score: out.score
              });
            } catch (e) {
              resolve({ ok: false, error: '保存预测结果失败: ' + e.message });
              return;
            }
            resolve({
              ok: true,
              label: out.label,
              label_text: out.label_text,
              prob_high: out.prob_high,
              score: out.score
            });
          } else {
            resolve({ ok: false, error: (out && out.error) || '未知错误' });
          }
        } catch (e) {
          resolve({ ok: false, error: '解析 Python 输出失败' });
        }
      });

      try {
        py.stdin.write(JSON.stringify({ features }) + '\n');
        py.stdin.end();
      } catch (e) {
        resolve({ ok: false, error: '向 Python 发送数据失败: ' + e.message });
      }
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('physio:exportSummary', async (_event, payload) => {
  try {
    ensureCacheDir();
    const timestamp = getCNTimestampForFile();
    const module = payload && payload.module ? String(payload.module) : 'unknown';
    const safeSubject = payload && payload.subject_id ? String(payload.subject_id).trim() : 'unknown';
    const stripEyeHeatmap = (input) => {
      if (!input || typeof input !== 'object') return input;
      const cleaned = { ...input };
      if (cleaned.analysis && typeof cleaned.analysis === 'object') {
        const analysis = { ...cleaned.analysis };
        delete analysis.heatmapData;
        delete analysis.minX;
        delete analysis.maxX;
        delete analysis.minY;
        delete analysis.maxY;
        if (analysis.isBatch && Array.isArray(analysis.results)) {
          analysis.results = analysis.results.map(res => {
            if (!res || typeof res !== 'object') return res;
            const next = { ...res };
            delete next.heatmapData;
            delete next.minX;
            delete next.maxX;
            delete next.minY;
            delete next.maxY;
            return next;
          });
        }
        cleaned.analysis = analysis;
      }
      delete cleaned.heatmapData;
      delete cleaned.minX;
      delete cleaned.maxX;
      delete cleaned.minY;
      delete cleaned.maxY;
      return cleaned;
    };
    const safePayload = module === 'eye' ? stripEyeHeatmap(payload) : payload;
    const filename = `${module}_${safeSubject || 'unknown'}_${timestamp}.json`;
    const filePath = path.join(getCacheDir(), filename);
    const record = {
      id: Date.now(),
      module,
      subject_id: safeSubject,
      ...safePayload,
      created_at: getCNISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return { ok: true, filePath };
  } catch (e) {
    console.error('Failed to export physio summary:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('questionnaire:saveAnswers', async (_, payload) => {
  try {
    ensureCacheDir();
    const timestamp = getCNTimestampForFile();
    const subjectId = payload.subject_id || 'unknown';
    const filename = `questionnaire_${subjectId}_${timestamp}.json`;
    const filePath = path.join(getCacheDir(), filename);
    const record = {
      ...payload,
      created_at: getCNISOString()
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Failed to save questionnaire:', e);
    throw e;
  }
});

// 后台数据库存储功能已移除

ipcMain.handle('questionnaire:listAnswers', async (_, limit = 50) => {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      return { ok: true, data: [] };
    }
    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('questionnaire_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
        const record = JSON.parse(content);
        const createdRaw = record.timestamp || record.created_at || getCNISOString();
        records.push({
          id: record.id || Date.parse(createdRaw),
          subject_id: record.subject_id || 'unknown',
          title: record.title || '问卷',
          created_at: createdRaw
        });
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
      }
    }
    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { ok: true, data: records.slice(0, limit) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('questionnaire:getLatest', async (_, subjectId) => {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) return { ok: false, error: '暂无数据' };
    
    const prefix = `questionnaire_${subjectId}_`;
    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
    
    if (files.length === 0) return { ok: false, error: '未找到该被试的问卷数据' };
    
    // Sort reverse to get latest
    files.sort().reverse();
    
    const latestFile = files[0];
    const content = fs.readFileSync(path.join(cacheDir, latestFile), 'utf-8');
    const data = JSON.parse(content);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('questionnaire:getDefault', async () => {
  try {
    const filePath = path.join(__dirname, 'data', 'questionnaire.json');
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: '未找到默认问卷配置文件' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('physio:saveRecord', async (_, data) => {
  try {
    ensureCacheDir();
    const timestamp = getCNTimestampForFile();
    const filename = `physio_${data.subject_id}_${timestamp}.json`;
    const filePath = path.join(getCacheDir(), filename);

    const record = {
      id: Date.now(),
      ...data,
      created_at: getCNISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return { ok: true, id: record.id };
  } catch (e) {
    console.error('Failed to save physio record:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('physio:listRecords', async (_, limit = 50) => {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      return { ok: true, data: [] };
    }

    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('physio_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
        const record = JSON.parse(content);
        records.push(record);
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
      }
    }

    // Sort by created_at desc
    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    return { ok: true, data: records.slice(0, limit) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('physio:computeECG', async (_event, subjectId) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'ECG Data', extensions: ['txt', 'csv', 'asc'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const filePath = result.filePaths[0];
    const analysis = analyzeECG(filePath);
    return { ok: true, data: analysis };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('physio:computeEMG', async (_event, subjectId) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'EMG Data', extensions: ['txt', 'csv', 'asc'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const filePath = result.filePaths[0];
    const analysis = analyzeEMG(filePath);
    return { ok: true, data: analysis };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('physio:computeEye', async (_event, subjectId) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Eye Data', extensions: ['txt', 'csv', 'asc'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };

  try {
    const blinkKeys = new Set(['blink_count_Eye', 'blink_rate_Hz_Eye', 'blink_dur_ms_Eye', 'short_blink_count_Eye']);
    const BLINK_COUNT_MIN = 1;
    const requiredTasks = [1, 2, 3, 4, 5];
    const selectedMap = new Map();
    result.filePaths.forEach(filePath => {
      const name = path.basename(filePath);
      const lower = name.toLowerCase();
      const match = lower.match(/^task([1-5])_.+\.csv$/);
      if (match) {
        const taskId = Number(match[1]);
        if (!selectedMap.has(taskId)) {
          selectedMap.set(taskId, { filePath, name });
        }
      }
    });
    const missing = requiredTasks.filter(taskId => !selectedMap.has(taskId));
    if (missing.length > 0) {
      const requiredHint = requiredTasks.map(n => `task${n}_*.csv`).join(', ');
      const missingHint = missing.map(n => `task${n}_*.csv`).join(', ');
      return {
        ok: false,
        error: `请一次性导入以下5个文件：${requiredHint}；缺少：${missingHint}`
      };
    }

    const results = requiredTasks.map(taskId => {
      const item = selectedMap.get(taskId);
      const analysis = analyzeEye(item.filePath);
      analysis.filename = item.name;
      const blinkCount = analysis && analysis.metrics ? analysis.metrics.blink_count_Eye : null;
      const blinkValid = typeof blinkCount === 'number' && !Number.isNaN(blinkCount) && blinkCount >= BLINK_COUNT_MIN;
      analysis.blink_anomaly = !blinkValid;
      return analysis;
    });

    const metricSums = {};
    const metricCounts = {};
    let blinkAnomalyCount = 0;
    results.forEach(res => {
      if (res.blink_anomaly) blinkAnomalyCount += 1;
      const m = res.metrics || {};
      Object.keys(m).forEach(key => {
        if (blinkKeys.has(key) && res.blink_anomaly) return;
        const val = m[key];
        if (typeof val === 'number' && !Number.isNaN(val)) {
          metricSums[key] = (metricSums[key] || 0) + val;
          metricCounts[key] = (metricCounts[key] || 0) + 1;
        }
      });
    });
    const avgMetrics = {};
    Object.keys(metricSums).forEach(key => {
      const count = metricCounts[key] || 1;
      avgMetrics[key] = metricSums[key] / count;
    });
    const blinkAnomalyAll = blinkAnomalyCount === results.length;
    avgMetrics.blink_anomaly_count = blinkAnomalyCount;
    avgMetrics.blink_anomaly_all = blinkAnomalyAll;
    if (blinkAnomalyAll) {
      blinkKeys.forEach(key => {
        avgMetrics[key] = null;
      });
    }

    return {
      ok: true,
      data: {
        isBatch: true,
        count: results.length,
        results,
        metrics: avgMetrics
      }
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('cognitive:saveRecord', async (_, data) => {
  try {
    ensureCacheDir();
    const timestamp = getCNTimestampForFile();
    const filename = `cognitive_${data.subject_id}_${timestamp}.json`;
    const filePath = path.join(getCacheDir(), filename);

    const record = {
      id: Date.now(),
      ...data,
      created_at: getCNISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    return { ok: true, id: record.id };
  } catch (e) {
    console.error('Failed to save cognitive record:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('cognitive:listRecords', async (_, limit = 50) => {
  try {
    const cacheDir = getCacheDir();
    if (!fs.existsSync(cacheDir)) {
      return { ok: true, data: [] };
    }

    const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('cognitive_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
        const record = JSON.parse(content);
        records.push(record);
      } catch (err) {
        console.error(`Error reading ${file}:`, err);
      }
    }

    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { ok: true, data: records.slice(0, limit) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('cognitive:importPdf', async () => {
  // Just show dialog, then return success. No real parsing.
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  
  // Return some mock data to populate the form, simulating extraction
  return { 
    ok: true, 
    data: {
      wm_correct: Math.floor(Math.random() * 10) + 5,
      wm_time: (Math.random() * 10 + 20).toFixed(1),
      obj_correct: Math.floor(Math.random() * 10) + 5,
      obj_time: (Math.random() * 10 + 15).toFixed(1),
      tmta_correct: Math.floor(Math.random() * 25),
      tmta_time: (Math.random() * 30 + 30).toFixed(1),
      delay_correct: Math.floor(Math.random() * 10),
      delay_time: (Math.random() * 10 + 10).toFixed(1),
      nback_correct: Math.floor(Math.random() * 20) + 10,
      stroop_correct: Math.floor(Math.random() * 40) + 20,
      reasoning_correct: Math.floor(Math.random() * 15) + 5
    }
  };
});

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  let config = { ...getDefaultPaths() };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const userConfig = JSON.parse(data);
      
      const executableKeys = ['emg', 'ecg', 'eye'];
      const directoryKeys = ['emgDataPath', 'ecgDataPath', 'eyeDataPath', 'gameDataPath', 'cacheDir'];

      Object.keys(userConfig).forEach(key => {
        if (executableKeys.includes(key)) {
          if (userConfig[key] && fs.existsSync(userConfig[key])) config[key] = userConfig[key];
          return;
        }

        if (directoryKeys.includes(key)) {
          if (userConfig[key]) config[key] = userConfig[key];
          return;
        }

        if (Object.prototype.hasOwnProperty.call(userConfig, key)) {
          config[key] = userConfig[key];
        }
      });
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  ensureDataDirs(config);
  return config;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

ipcMain.handle('config:selectPath', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Executables', extensions: ['exe'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectFile', async (_, options = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('config:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('config:getPaths', () => {
  return loadConfig();
});

ipcMain.handle('config:setPath', (_, module, path) => {
  const config = loadConfig();
  config[module] = path;
  if (['emgDataPath', 'ecgDataPath', 'eyeDataPath', 'gameDataPath', 'cacheDir'].includes(module)) {
    ensureDirSafe(path);
  }
  saveConfig(config);
  return true;
});

// Duplicate launch-software handler removed

// --- Game Score Parsing Helpers ---

function parseShootingContent(content) {
  const result = {
    Shooting_TotalScore_Score: 'Error',
    Shooting_Accuracy_Score: '0.00',
    Shooting_AvgScore_Score: '0.00'
  };
  try {
    const lines = content.trim().split('\n').filter(l => l.trim().length > 0);
    let totalScore = 0;
    let lastCount = '';
    
    lines.forEach(line => {
      const cleanLine = line.replace(/"/g, '');
      const parts = cleanLine.split(',');
      if(parts.length >= 3) {
        const scoreVal = parseFloat(parts[2]);
        if (!isNaN(scoreVal)) {
          totalScore += scoreVal;
        }
      }
      if (parts.length >= 2) {
        lastCount = parts[1];
      }
    });
    
    result.Shooting_TotalScore_Score = totalScore.toFixed(2);
    
    if (lastCount) {
      let hits = 0, total = 0;
      if (lastCount.includes('-/-')) {
        const [hitsStr, totalStr] = lastCount.split('-/-');
        hits = parseFloat(hitsStr);
        total = parseFloat(totalStr);
      } else if (lastCount.includes('/')) {
        const [hitsStr, totalStr] = lastCount.split('/');
        hits = parseFloat(hitsStr);
        total = parseFloat(totalStr);
      }

      if (total > 0) {
        result.Shooting_Accuracy_Score = (hits / total).toFixed(2);
        result.Shooting_AvgScore_Score = (totalScore / total).toFixed(2);
      }
    }
  } catch (e) {
    console.error('Error parsing shooting content:', e);
  }
  return result;
}

function parseGame5Content(content) {
  const result = {
    Game5_TotalScore_Score: 'Error',
    Game5_LifeSum_Score: '未找到'
  };
  try {
    const lines = content.trim().split('\n');
    let score = 0;
    let lifeSum = 0;
    
    lines.forEach(line => {
      const lowerLine = line.toLowerCase();
      const successMatch = lowerLine.match(/success[^\d]*\+[^\d]*(\d+)/);
      if (successMatch) score += parseInt(successMatch[1]);

      const failMatch = lowerLine.match(/failed[^\d]*-[^\d]*(\d+)/);
      if (failMatch) score -= parseInt(failMatch[1]);
      
      if (lowerLine.includes('lifesum')) {
        const match = lowerLine.match(/lifesum[^\d]*(\d+)/);
        if (match) lifeSum = parseInt(match[1]);
      }
    });
    result.Game5_TotalScore_Score = score;
    result.Game5_LifeSum_Score = lifeSum;
  } catch (e) {
    console.error('Error parsing game5 content:', e);
  }
  return result;
}

function parseTask4Content(content) {
  const result = {
    Task4_BallAndRing_Score: '未找到',
    Task4_NumberLine_Score: '未找到',
    Task4_Total_Score: 'Error',
    Task4_Accuracy_Score: '0.00'
  };
  try {
    const lines = content.split('\n').map(l => l.trim());
    let parsed = false;

    let headerIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('BallandRing') && lines[i].includes('NumberLine')) {
        headerIndex = i;
        break;
      }
    }
    
    if (headerIndex !== -1 && headerIndex + 1 < lines.length) {
      const dataLine = lines[headerIndex + 1];
      const parts = dataLine.split(',');
      if (parts.length >= 4) {
        const ball = parseFloat(parts[0]);
        const lineScore = parseFloat(parts[1]);
        const total = parseFloat(parts[2]);
        const maxPossible = parseFloat(parts[3]);
        
        if (!isNaN(ball) && !isNaN(lineScore) && !isNaN(total)) {
          result.Task4_BallAndRing_Score = ball;
          result.Task4_NumberLine_Score = lineScore;
          result.Task4_Total_Score = total;
          result.Task4_Accuracy_Score = (maxPossible > 0) ? (total / maxPossible).toFixed(2) : "0.00";
          parsed = true;
        }
      }
    }

    if (!parsed) {
      let ballScore = 0;
      let numberLineScore = 0;
      let maxPossible = 0;
      let numberLineEvents = 0;

      lines.forEach(line => {
        const lower = line.toLowerCase();
        if (lower.includes('success')) {
          const match = lower.match(/success[^\d]*\+[^\d]*(\d+)/);
          if (match) {
            numberLineScore += parseFloat(match[1]);
            numberLineEvents++;
          }
        } else if (lower.includes('failed')) {
          const match = lower.match(/failed[^\d]*-[^\d]*(\d+)/);
          if (match) {
            numberLineScore -= parseFloat(match[1]);
            numberLineEvents++;
          }
        }
        
        if (line.includes('Match!')) {
          const scoreMatch = line.match(/score:\s*([\d.]+)/);
          const maxMatch = line.match(/max score:\s*([\d.]+)/);
          if (scoreMatch) ballScore += parseFloat(scoreMatch[1]);
          if (maxMatch) maxPossible += parseFloat(maxMatch[1]);
        } else if (line.includes('Hitted!')) {
          const penMatch = line.match(/penalty:\s*([\d.]+)/);
          if (penMatch) ballScore -= parseFloat(penMatch[1]);
        }
      });

      maxPossible += (numberLineEvents * 50);

      result.Task4_BallAndRing_Score = ballScore.toFixed(2);
      result.Task4_NumberLine_Score = numberLineScore;
      result.Task4_Total_Score = (ballScore + numberLineScore).toFixed(2);
      result.Task4_Accuracy_Score = (maxPossible > 0) ? ((ballScore + numberLineScore) / maxPossible).toFixed(2) : "0.00";
    }
  } catch (e) {
    console.error('Error parsing score_data content:', e);
  }
  return result;
}

// Game Score Analysis Handlers
ipcMain.handle('game:analyze', async (_, subjectId) => {
  try {
    const config = loadConfig();
    const baseRoot = (config && config.gameDataPath) || 'D:\\ccho_RECORD\\SCOREresult';
    const subjectDir = path.join(baseRoot, subjectId);

    if (!fs.existsSync(subjectDir)) {
      return { ok: false, error: `未找到该被试文件夹: ${subjectDir}` };
    }

    const files = fs.readdirSync(subjectDir);
    let foundFilesCount = 0;
    
    const findLatest = (pattern) => {
      const matched = files.filter(f => f.match(pattern));
      if (matched.length === 0) return null;
      matched.sort().reverse(); 
      return matched[0];
    };

    const game5File = findLatest(/^game5_.*\.csv$/);
    const shootingFile = findLatest(/^shooting_.*\.csv$/);
    const scoreDataFile = findLatest(/^score_data_.*\.csv$/);

    const result = {
      Shooting_TotalScore_Score: '未找到',
      Shooting_Accuracy_Score: '未找到',
      Shooting_AvgScore_Score: '未找到',
      Task4_BallAndRing_Score: '未找到',
      Task4_NumberLine_Score: '未找到',
      Task4_Total_Score: '未找到',
      Task4_Accuracy_Score: '未找到',
      Game5_TotalScore_Score: '未找到',
      Game5_LifeSum_Score: '未找到'
    };

    if (shootingFile) {
      foundFilesCount++;
      try {
        const content = fs.readFileSync(path.join(subjectDir, shootingFile), 'utf-8');
        Object.assign(result, parseShootingContent(content));
      } catch (e) { console.error(e); }
    }

    if (game5File) {
      foundFilesCount++;
      try {
        const content = fs.readFileSync(path.join(subjectDir, game5File), 'utf-8');
        Object.assign(result, parseGame5Content(content));
      } catch (e) { console.error(e); }
    }

    if (scoreDataFile) {
      foundFilesCount++;
      try {
        const content = fs.readFileSync(path.join(subjectDir, scoreDataFile), 'utf-8');
        Object.assign(result, parseTask4Content(content));
      } catch (e) { console.error(e); }
    }

    if (foundFilesCount === 0) {
        return { ok: false, error: "未找到该被试的任何游戏数据" };
    }

    return { ok: true, data: result };

  } catch (e) {
    console.error('Game analysis failed:', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('game:analyzeFile', async (_, type, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: '文件不存在' };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    let data = {};
    
    if (type === 'shooting') {
      data = parseShootingContent(content);
    } else if (type === 'task4') {
      data = parseTask4Content(content);
    } else if (type === 'game5') {
      data = parseGame5Content(content);
    } else {
      return { ok: false, error: '未知的文件类型' };
    }
    
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('game:save', async (_, data) => {
    try {
        ensureCacheDir();
        const timestamp = getCNTimestampForFile();
        const filename = `game_${data.subject_id}_${timestamp}.json`;
        const filePath = path.join(getCacheDir(), filename);
        
        const record = {
            id: Date.now(),
            ...data,
            created_at: getCNISOString()
        };
        
        fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
        return { ok: true, id: record.id };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('game:listHistory', async (_, limit = 50) => {
    try {
        const cacheDir = getCacheDir();
        if (!fs.existsSync(cacheDir)) return { ok: true, data: [] };
        
        const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('game_') && f.endsWith('.json'));
        const records = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
                records.push(JSON.parse(content));
            } catch(e) {}
        }
        records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return { ok: true, data: records.slice(0, limit) };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});
