# 训练成绩水平预测模型报告

## 1. 项目摘要

- **目标**: 训练成绩水平
- **分组策略**: Top/Bottom 15%
- **样本量**: 18 (高=9, 低=9)
- **最佳模型**: LogisticRegression_Poly
- **AUC**: 0.800

## 2. 目标构成与降维

- **目标变量**: 训练成绩水平
- **构建方式**: Custom_Weighted_Optimized

### 2.1 目标维度主要载荷

| 排名 | 变量 | 载荷 |
| :--- | :--- | :--- |
| 1 | 30x2_Ele | 0.4000 |
| 2 | 仰卧卷腹_Ele | 0.3000 |
| 3 | 引体向上_Ele | 0.1500 |
| 4 | 3000米_Ele | 0.1000 |
| 5 | 单兵训练综合成绩_Ele | 0.0500 |

## 3. 关键预测因子

- **输入特征数量**: 68

| 排名 | 特征 | 权重/重要性 |
| :--- | :--- | :--- |
| 1 | duration_sec_Eye^2 | -0.0469 |
| 2 | Neck_MPF_EMG^2 | 0.0436 |
| 3 | Arm_MPF_EMG Pre_SBP_BPHR | -0.0431 |
| 4 | 外向性_Psy 主动_Psy | -0.0429 |
| 5 | Neck_Max_Amp_EMG avg_blink_dur_ms_Eye | 0.0416 |
| 6 | n_peaks_ECG Arm_MPF_EMG | -0.0409 |
| 7 | Neck_MPF_EMG 进取_Psy | 0.0383 |
| 8 | 外向性_Psy 求精_Psy | -0.0355 |
| 9 | gaze_pitch_std_Eye | -0.0354 |
| 10 | SDNN_ms_ECG Pre_SBP_BPHR | -0.0354 |

## 4. 模型文件

- **模型路径**: d:\code\python\301_data_analy\model\predict_ele\Ele_Level_Custom_Weighted_Optimized_Extreme_1515_best_model.pkl

## 5. 模型详细信息

### 5.1 算法与参数
- **算法**: ExtraTreesClassifier
- **核心参数**: n_estimators=400, random_state=42 (SEED)
- **特征处理**: SimpleImputer(mean) -> StandardScaler
- **交叉验证**: StratifiedKFold(n_splits=5)

### 5.2 训练流程
1. **特征筛选**: 遍历 Top 10-30 特征组合，选择 AUC 最高的特征子集。
2. **模型评估**: 使用 ROC-AUC (OVR) 作为评价指标。
3. **最终模型**: 使用最佳特征子集在全量数据上重新训练。

## 6. 复现指南

### 6.1 环境依赖
- Python 3.8+
- pandas, numpy, scikit-learn, joblib

### 6.2 运行命令
```bash
python train_domain_model.py
```

### 6.3 关键设置
- **随机种子 (SEED)**: 42 (确保结果可重复)
- **输入数据**: Grand_Summary_Analysis_Imputed.xlsx

## 7. 分类逻辑详解

### 7.1 第一步：子测验分组
将认知子测验分为三个核心维度：
- **记忆**: 工作记忆、物品再认、延迟回忆
- **执行**: TMT-A、色词干扰、回溯测试
- **推理**: 语法推理

### 7.2 第二步：分数标准化与统一
- **方向统一**: 对于“越低越好”的指标（如耗时），取负值或倒数使其变为“越高越好”。
- **标准化**: 对所有子测验分数进行 Z-Score 标准化（均值为0，标准差为1）。

### 7.3 第三步：维度得分计算
- 计算每个维度下所有子测验标准化分数的**平均值**，作为该维度的得分。

## 5. 模型详细信息

### 5.1 算法与参数
- **算法**: LogisticRegression_Poly
- **优化方法**: GridSearchCV + RepeatedStratifiedKFold
- **特征处理**: SimpleImputer(mean) -> StandardScaler -> (Optional) PolynomialFeatures/Selection

### 5.2 训练流程
1. **特征筛选**: 遍历 Top 10-80 特征组合，选择 AUC 最高的特征子集。
2. **模型评估**: 使用 ROC-AUC (OVR) 作为评价指标，采用 RepeatedStratifiedKFold(5折3次重复) 交叉验证。
3. **最终模型**: 使用最佳特征子集在全量数据上重新训练。

## 6. 复现指南

### 6.1 环境依赖
- Python 3.8+
- pandas, numpy, scikit-learn, joblib

### 6.2 运行命令
```bash
python train_domain_model.py
```

### 6.3 关键设置
- **随机种子 (SEED)**: 42 (确保结果可重复)
- **输入数据**: Grand_Summary_Analysis_Imputed.xlsx

## 7. 分类逻辑详解

### 7.1 第一步：子测验分组
将认知子测验分为三个核心维度：
- **记忆**: 工作记忆、物品再认、延迟回忆
- **执行**: TMT-A、色词干扰、回溯测试
- **推理**: 语法推理

### 7.2 第二步：分数标准化与统一
- **方向统一**: 对于“越低越好”的指标（如耗时），取负值或倒数使其变为“越高越好”。
- **标准化**: 对所有子测验分数进行 Z-Score 标准化（均值为0，标准差为1）。

### 7.3 第三步：维度得分计算
- 计算每个维度下所有子测验标准化分数的**平均值**，作为该维度的得分。

### 7.4 第四步：类型判定
- 比较每个样本的 **记忆得分**、**执行得分**、**推理得分**。
- 取**得分最高**的维度作为该样本的认知优势类型。

## 8. 结论与建议
当前最佳模型 AUC 为 0.000。
若未达到 0.8 目标，建议：
1. 增加样本量 (当前 n=60)。
2. 引入更多生理特征或进行更复杂的特征工程。