# CSV 指标说明

本文档说明统一 CSV 导出的全部字段含义。字段列表来源于 CSV 导出列定义 [main.js:L623-L695](file:///c:/Users/vrtrain2/Desktop/301_demo-main-2/main.js#L623-L695)。若某字段在被试数据中缺失，则导出为空值。

## 说明原则
- 量表类指标：按照问卷配置的计分规则求和（反向题先按量表规则反向），详见问卷配置 [questionnaire.json](file:///c:/Users/vrtrain2/Desktop/301_demo-main-2/data/questionnaire.json)
- 预测类指标：记录模型预测输出的数值编码
- 生理/眼动/游戏类指标：来自对应数据导入或设备采集结果

## 字段详解

| 指标 | 含义 | 单位/取值 | 来源 |
| --- | --- | --- | --- |
| id | 被试编号 | 文本 | 基本信息 |
| 姓名 | 被试姓名 | 文本 | 基本信息 |
| 性别 | 被试性别 | 文本 | 基本信息 |
| 民族 | 被试民族 | 文本 | 基本信息 |
| 年龄 | 被试年龄 | 年 | 基本信息 |
| 军龄 | 从军年限 | 年 | 基本信息 |
| 学历 | 被试学历 | 文本 | 基本信息 |
| 神经质 | 五大人格维度：情绪波动、焦虑等倾向总分 | 分 | 问卷（五大人格） |
| 尽责性 | 五大人格维度：自律、责任感等倾向总分 | 分 | 问卷（五大人格） |
| 宜人性 | 五大人格维度：合作、同理等倾向总分 | 分 | 问卷（五大人格） |
| 开放性 | 五大人格维度：好奇、创新等倾向总分 | 分 | 问卷（五大人格） |
| 外向性 | 五大人格维度：社交与活跃倾向总分 | 分 | 问卷（五大人格） |
| 坚韧 | 心理弹性子维度：坚持与抗挫能力总分 | 分 | 问卷（心理弹性） |
| 力量 | 心理弹性子维度：自我效能与能力感总分 | 分 | 问卷（心理弹性） |
| 乐观 | 心理弹性子维度：积极与希望感总分 | 分 | 问卷（心理弹性） |
| 心理弹性总分 | 心理弹性量表总分 | 分 | 问卷（心理弹性） |
| 成就动机 | 成就动机量表总分 | 分 | 问卷（成就动机） |
| 体能水平预测 | 体能水平预测结果 | 0=低水平，1=高水平 | 模型预测 |
| 认知优势预测 | 认知优势预测结果 | 0=记忆强，1=执行强，2=推理强 | 模型预测 |
| 动机类型预测 | 动机类型预测结果 | 0/1 编码 | 模型预测 |
| 动机水平预测 | 动机水平预测结果 | 0=低水平，1=高水平 | 模型预测 |
| Pre_SBP_BPHR | 训练前收缩压 | mmHg | 血压心率记录 |
| Pre_DBP_BPHR | 训练前舒张压 | mmHg | 血压心率记录 |
| Pre_HR_BPHR | 训练前心率 | bpm | 血压心率记录 |
| Post_SBP_BPHR | 训练后收缩压 | mmHg | 血压心率记录 |
| Post_DBP_BPHR | 训练后舒张压 | mmHg | 血压心率记录 |
| Post_HR_BPHR | 训练后心率 | bpm | 血压心率记录 |
| n_peaks_ECG | 心电 R 峰数量 | 次 | ECG |
| Mean_RR_ms_ECG | 平均 RR 间期 | ms | ECG |
| SDNN_ms_ECG | RR 间期标准差（心率变异性） | ms | ECG |
| RMSSD_ms_ECG | 相邻 RR 差值均方根（短期 HRV） | ms | ECG |
| pNN50_pct_ECG | 相邻 RR 间期差值 >50ms 的比例 | % | ECG |
| HR_Mean_ECG | 平均心率 | bpm | ECG |
| HR_Std_ECG | 心率标准差 | bpm | ECG |
| HR_Change_Rate_ECG | 心率变化率 | % | ECG |
| Arm_MAV_EMG | 上肢肌电平均绝对值 | 依设备输出 | EMG |
| Arm_MDF_EMG | 上肢肌电中值频率 | Hz | EMG |
| Arm_MPF_EMG | 上肢肌电平均功率频率 | Hz | EMG |
| Arm_Max_Amp_EMG | 上肢肌电最大幅值 | 依设备输出 | EMG |
| Arm_RMS_EMG | 上肢肌电均方根 | 依设备输出 | EMG |
| Arm_iEMG_EMG | 上肢肌电积分 | 依设备输出 | EMG |
| Neck_MAV_EMG | 颈部肌电平均绝对值 | 依设备输出 | EMG |
| Neck_MDF_EMG | 颈部肌电中值频率 | Hz | EMG |
| Neck_MPF_EMG | 颈部肌电平均功率频率 | Hz | EMG |
| Neck_Max_Amp_EMG | 颈部肌电最大幅值 | 依设备输出 | EMG |
| Neck_RMS_EMG | 颈部肌电均方根 | 依设备输出 | EMG |
| Neck_iEMG_EMG | 颈部肌电积分 | 依设备输出 | EMG |
| duration_sec_Eye | 眼动记录时长 | 秒 | 眼动 |
| sampling_rate_est_Eye | 眼动估计采样率 | Hz | 眼动 |
| blink_count_Eye | 眨眼次数 | 次 | 眼动 |
| short_blink_count_Eye | 短眨眼次数 | 次 | 眼动 |
| blink_freq_Eye | 眨眼频率 | Hz | 眼动 |
| avg_blink_dur_ms_Eye | 平均眨眼时长 | ms | 眼动 |
| fixation_count_Eye | 注视次数 | 次 | 眼动 |
| fixation_freq_Eye | 注视频率 | Hz | 眼动 |
| avg_fixation_dur_ms_Eye | 平均注视时长 | ms | 眼动 |
| saccade_count_Eye | 扫视次数 | 次 | 眼动 |
| avg_saccade_amp_deg_Eye | 平均扫视幅度 | 度 | 眼动 |
| avg_pupil_L_Eye | 左眼平均瞳孔直径 | 依设备输出 | 眼动 |
| gaze_yaw_std_Eye | 水平方向视线角度标准差 | 度 | 眼动 |
| gaze_pitch_std_Eye | 竖直方向视线角度标准差 | 度 | 眼动 |
| avg_pupil_R_Eye | 右眼平均瞳孔直径 | 依设备输出 | 眼动 |
| Shooting_TotalScore_Score | 射击任务总分 | 分 | 游戏任务 |
| Shooting_Accuracy_Score | 射击任务准确率得分 | 比例或分 | 游戏任务 |
| Shooting_AvgScore_Score | 射击任务平均分 | 分 | 游戏任务 |
| Task4_BallAndRing_Score | 套圈任务得分 | 分 | 游戏任务 |
| Task4_NumberLine_Score | 连线任务得分 | 分 | 游戏任务 |
| Task4_Total_Score | 任务4总分 | 分 | 游戏任务 |
| Task4_Accuracy_Score | 任务4准确率 | 比例 | 游戏任务 |
| Game5_TotalScore_Score | 游戏5总分 | 分 | 游戏任务 |
| Game5_LifeSum_Score | 游戏5剩余生命/存活得分 | 分 | 游戏任务 |
