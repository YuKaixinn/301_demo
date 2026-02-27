// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { analyzeECG, analyzeEMG, analyzeEye } = require('./utils/physio_analysis');

const CACHE_DIR = 'D:\\ccho_RECORD\\cache';

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
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

function collectFeaturesForSubject(subjectIdRaw) {
  if (!fs.existsSync(CACHE_DIR)) {
    throw new Error('未找到缓存目录，请先保存数据');
  }

  const subjectId = String(subjectIdRaw || '').trim();
  if (!subjectId) {
    throw new Error('被试编号为空');
  }

  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error('缓存目录中没有 JSON 数据');
  }

  const row = { Subject_ID: subjectId };

  for (const file of files) {
    let record;
    try {
      const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
      record = JSON.parse(content);
    } catch (e) {
      continue;
    }
    if (!record || typeof record !== 'object') continue;

    let sid = record.subject_id || record.basic_subject_id || record.Subject_ID;
    sid = String(sid || '').trim();
    if (!sid || sid !== subjectId) continue;

    if (file.startsWith('physio_')) {
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
      const scores = record.scores || {};
      const psy = scores.psy_results || {};
      Object.keys(psy).forEach(k => {
        row[k] = psy[k];
      });
    } else if (file.startsWith('ecg_') || file.startsWith('emg_') || file.startsWith('eye_')) {
      const metrics = record.metrics || {};
      Object.keys(metrics).forEach(k => {
        row[k] = metrics[k];
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
    if (!fs.existsSync(CACHE_DIR)) {
      return { ok: false, error: '未找到缓存目录' };
    }
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
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
        const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
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
          if (s === 'elementary' || s === 'primary' || s === '小学') cn = '小学';
          else if (s === 'middle' || s === 'junior' || s === '初中') cn = '初中';
          else if (s === 'high' || s === '高中') cn = '高中';
          else if (s === 'bachelor' || s === '本科') cn = '本科';
          else if (s === 'master' || s === '硕士') cn = '硕士';
          else if (s === 'phd' || s === '博士' || s === 'doctor') cn = '博士';
          else if (s === 'other' || s === '其他') cn = '其他';
          row.basic_grade = cn || eduRaw;
        }

        const scores = record.scores || {};
        const subNamed = scores.subscales_named || {};
        const compNamed = scores.composites_named || {};
        Object.keys(subNamed).forEach(k => {
          row[k] = subNamed[k];
        });
        Object.keys(compNamed).forEach(k => {
          row[k] = compNamed[k];
        });
      } else if (file.startsWith('ecg_') || file.startsWith('emg_') || file.startsWith('eye_')) {
        const metrics = record.metrics || {};
        Object.keys(metrics).forEach(k => {
          row[k] = metrics[k];
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

    if (rowsBySubject.size === 0) {
      return { ok: false, error: '未能从缓存数据中提取任何被试记录' };
    }

    const rows = Array.from(rowsBySubject.values());

    const columnDefs = [
      { header: 'Subject_ID_Basic', key: 'subject_id' },
      { header: '姓名_Basic', key: 'basic_name' },
      { header: '性别_Basic', key: 'basic_gender' },
      { header: '年龄_Basic', key: 'basic_age' },
      { header: '学历_Basic', key: 'basic_grade' },
      { header: '工作记忆(正确数)_Cog', key: 'wm_correct' },
      { header: '工作记忆(时长s)_Cog', key: 'wm_time' },
      { header: '物品再认(正确数)_Cog', key: 'obj_correct' },
      { header: '物品再认(时长s)_Cog', key: 'obj_time' },
      { header: 'TMT-A(正确数)_Cog', key: 'tmta_correct' },
      { header: 'TMT-A(时长s)_Cog', key: 'tmta_time' },
      { header: '延迟回忆(正确数)_Cog', key: 'delay_correct' },
      { header: '延迟回忆(时长s)_Cog', key: 'delay_time' },
      { header: '回溯测试(正确数)_Cog', key: 'nback_correct' },
      { header: '色词干扰(正确数)_Cog', key: 'stroop_correct' },
      { header: '语法推理(正确数)_Cog', key: 'reasoning_correct' },
      { header: 'n_peaks_ECG', key: 'n_peaks_ECG' },
      { header: 'Mean_RR_ms_ECG', key: 'Mean_RR_ms_ECG' },
      { header: 'SDNN_ms_ECG', key: 'SDNN_ms_ECG' },
      { header: 'RMSSD_ms_ECG', key: 'RMSSD_ms_ECG' },
      { header: 'pNN50_pct_ECG', key: 'pNN50_pct_ECG' },
      { header: 'HR_Mean_ECG', key: 'HR_Mean_ECG' },
      { header: 'HR_Std_ECG', key: 'HR_Std_ECG' },
      { header: 'HR_Change_Rate_ECG', key: 'HR_Change_Rate_ECG' },
      { header: 'Resp_Mean_ECG', key: 'Resp_Mean_ECG' },
      { header: 'Resp_Std_ECG', key: 'Resp_Std_ECG' },
      { header: 'Resp_Change_Rate_ECG', key: 'Resp_Change_Rate_ECG' },
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
      { header: 'Game5_LifeSum_Score', key: 'Game5_LifeSum_Score' },
      { header: '内部动机_Psy', key: '内部动机' },
      { header: '整合调节_Psy', key: '整合调节' },
      { header: '内摄调节_Psy', key: '内摄调节' },
      { header: '外在调节_Psy', key: '外在调节' },
      { header: '无动机_Psy', key: '无动机' },
      { header: '认同动机_Psy', key: '认同调节' },
      { header: '自主动机_Psy', key: '自主动机' },
      { header: '神经质_Psy', key: '神经质' },
      { header: '尽责性_Psy', key: '尽责性' },
      { header: '宜人性_Psy', key: '宜人性' },
      { header: '开放性_Psy', key: '开放性' },
      { header: '外向性_Psy', key: '外向性' },
      { header: '心理弹性总分_Psy', key: '心理弹性总分' },
      { header: '坚韧_Psy', key: '坚韧' },
      { header: '力量_Psy', key: '力量' },
      { header: '乐观_Psy', key: '乐观' },
      { header: '进取_Psy', key: '进取' },
      { header: '主动_Psy', key: '主动' },
      { header: '求精_Psy', key: '求精' },
      { header: '坚韧.1_Psy', key: '坚韧.1' },
      { header: '奉献_Psy', key: '奉献' },
      { header: '乐业_Psy', key: '乐业' },
      { header: '持续学习_Psy', key: '持续学习' },
      { header: '30x2_Ele', key: 'run_30x2' },
      { header: '仰卧卷腹_Ele', key: 'sit_ups' },
      { header: '引体向上_Ele', key: 'pull_ups' },
      { header: '3000米_Ele', key: 'run_3000' },
      { header: '单兵训练综合成绩_Ele', key: 'composite_score' },
      { header: 'Pre_SBP_BPHR', key: 'pre_sbp' },
      { header: 'Pre_DBP_BPHR', key: 'pre_dbp' },
      { header: 'Pre_HR_BPHR', key: 'pre_hr' },
      { header: 'Post_SBP_BPHR', key: 'post_sbp' },
      { header: 'Post_DBP_BPHR', key: 'post_dbp' },
      { header: 'Post_HR_BPHR', key: 'post_hr' }
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

ipcMain.handle('ele:predictLevel', async (_event, subjectId) => {
  try {
    ensureCacheDir();
    const features = collectFeaturesForSubject(subjectId);
    if (!features || Object.keys(features).length <= 1) {
      return { ok: false, error: '未找到该被试的有效特征，请先完成并保存相关数据' };
    }

    return await new Promise(resolve => {
      const py = spawn('python', ['-X', 'utf8', path.join(__dirname, 'predict_ele_live.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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
      const py = spawn('python', ['-X', 'utf8', path.join(__dirname, 'predict_cog_type_live.py')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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
      const py = spawn('python', ['-X', 'utf8', path.join(__dirname, 'predict_motivation_live.py'), 'type'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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
      const py = spawn('python', ['-X', 'utf8', path.join(__dirname, 'predict_motivation_live.py'), 'level'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
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
    const filename = `${module}_${safeSubject || 'unknown'}_${timestamp}.json`;
    const filePath = path.join(CACHE_DIR, filename);
    const record = {
      id: Date.now(),
      module,
      subject_id: safeSubject,
      ...payload,
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
    const filePath = path.join(CACHE_DIR, filename);
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
    if (!fs.existsSync(CACHE_DIR)) {
      return { ok: true, data: [] };
    }
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('questionnaire_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
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
    if (!fs.existsSync(CACHE_DIR)) return { ok: false, error: '暂无数据' };
    
    const prefix = `questionnaire_${subjectId}_`;
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
    
    if (files.length === 0) return { ok: false, error: '未找到该被试的问卷数据' };
    
    // Sort reverse to get latest
    files.sort().reverse();
    
    const latestFile = files[0];
    const content = fs.readFileSync(path.join(CACHE_DIR, latestFile), 'utf-8');
    const data = JSON.parse(content);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('questionnaire:getDefault', async () => {
  try {
    const filePath = path.join(__dirname, 'default_questionnaire.json');
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
    const filePath = path.join(CACHE_DIR, filename);

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
    if (!fs.existsSync(CACHE_DIR)) {
      return { ok: true, data: [] };
    }

    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('physio_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
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
      return analysis;
    });

    const metricSums = {};
    const metricCounts = {};
    results.forEach(res => {
      const m = res.metrics || {};
      Object.keys(m).forEach(key => {
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
    const filePath = path.join(CACHE_DIR, filename);

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
    if (!fs.existsSync(CACHE_DIR)) {
      return { ok: true, data: [] };
    }

    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('cognitive_') && f.endsWith('.json'));
    const records = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
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
const DEFAULT_PATHS = {
  emg: 'C:\\Users\\vrtrain2\\Desktop\\肌电软件-标准\\软件\\EmgServer采集-64位\\Release\\EmgServer.exe',
  ecg: 'C:\\Users\\vrtrain2\\Desktop\\运动风险评估系统\\Release\\HeartCapture.exe',
  eye: 'C:\\Users\\vrtrain2\\Desktop\\vrpack3\\CCHO_DEMO.exe',
  game: 'D:\\soft\\wechat\\app\\Weixin\\Weixin.exe',
  emgDataPath: 'D:\\ccho_RECORD\\EMG',
  ecgDataPath: 'D:\\ccho_RECORD\\ECG',
  eyeDataPath: 'D:\\ccho_RECORD\\eyetrack'
};

function loadConfig() {
  let config = { ...DEFAULT_PATHS };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const userConfig = JSON.parse(data);
      
      // Merge user config but validate paths
      Object.keys(userConfig).forEach(key => {
        const isPathKey = ['emg', 'ecg', 'eye', 'game', 'emgDataPath', 'ecgDataPath', 'eyeDataPath'].includes(key);
        
        if (isPathKey) {
          // Only accept user config path if it exists
          if (userConfig[key] && fs.existsSync(userConfig[key])) {
            config[key] = userConfig[key];
          }
        } else {
          config[key] = userConfig[key];
        }
      });
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
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
    const baseRoot = 'D:\\ccho_RECORD\\SCOREresult';
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
        const filePath = path.join(CACHE_DIR, filename);
        
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
        if (!fs.existsSync(CACHE_DIR)) return { ok: true, data: [] };
        
        const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('game_') && f.endsWith('.json'));
        const records = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
                records.push(JSON.parse(content));
            } catch(e) {}
        }
        records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return { ok: true, data: records.slice(0, limit) };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});
