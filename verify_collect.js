const fs = require('fs');
const path = require('path');

const CACHE_DIR = 'D:\\ccho_RECORD\\cache';

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
      const scores = record.scores || {};
      const psy = scores.psy_results || {};
      Object.keys(psy).forEach(k => {
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

try {
    const data = collectFeaturesForSubject('24380301');
    console.log(JSON.stringify(data, null, 2));
} catch (e) {
    console.error(e);
}
