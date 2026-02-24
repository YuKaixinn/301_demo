# 认知优势类型预测模型报告

## 1. 项目摘要

- **目标**: 认知优势类型（记忆强/执行强/推理强）
- **样本量**: 60
- **类型分布**: {'推理强': 24, '记忆强': 22, '执行强': 14}
- **最佳模型**: HybridOvRClassifier (集成 AdaBoost, SVM, BalancedRF)
- **AUC(OVR)**: 0.802 - 0.836 (平均 > 0.81)
- **特征数量**: 10-15 (依类别动态调整)

## 2. One-vs-Rest (OvR) 二分类模型优化结果
针对每个认知类型单独训练二分类模型，以识别特定类型的敏感指标。

| 认知类型 | 最佳模型 | 特征数 | AUC | 关键策略 |
| :--- | :--- | :--- | :--- | :--- |
| 记忆强 vs Rest | SVM (RBF) | 15 | **0.836** | SVMSMOTE过采样, Tree特征选择 |
| 执行强 vs Rest | BalancedRF | 15 | **0.802** | 互信息特征选择, 类别平衡RF |
| 推理强 vs Rest | AdaBoost (n=100) | 10 | **0.816** | BorderlineSMOTE, Tree特征选择 |

## 3. 三类型构建方式

- **分类规则**: 先按三类计算标准化均值分数，再以分数最高者作为类型标签

### 3.1 子测验归类

- **记忆强**: 工作记忆(正确数)_Cog, 工作记忆(时长s)_Cog, 物品再认(正确数)_Cog, 物品再认(时长s)_Cog, 延迟回忆(正确数)_Cog, 延迟回忆(时长s)_Cog
- **执行强**: TMT-A(正确数)_Cog, TMT-A(时长s)_Cog, 回溯测试(正确数)_Cog, 色词干扰(正确数)_Cog
- **推理强**: 语法推理(正确数)_Cog

### 3.2 三类分数统计

- **记忆强**: mean=0.000, std=0.488, min=-1.571, max=0.790
- **执行强**: mean=-0.000, std=0.505, min=-1.209, max=1.156
- **推理强**: mean=0.000, std=1.008, min=-2.207, max=1.933

## 4. 关键预测因子 (多分类模型)

- **输入特征数量**: 15

| 排名 | 特征 | 权重/重要性 |
| :--- | :--- | :--- |
| 1 | Arm_MDF_EMG | 0.3074 |
| 2 | Game5_LifeSum_Score | 0.2374 |
| 3 | sampling_rate_est_Eye | 0.2325 |
| 4 | Neck_Max_Amp_EMG | 0.1975 |
| 5 | fixation_count_Eye | 0.1426 |
| 6 | saccade_count_Eye | 0.1426 |
| 7 | 乐观_Psy | 0.1378 |
| 8 | blink_freq_Eye | 0.1293 |
| 9 | Neck_iEMG_EMG | 0.1195 |
| 10 | avg_pupil_L_Eye | 0.1069 |

## 5. 模型文件

- **模型路径**: d:\code\python\301_data_analy\model\predict_cog\Cog_Type_HybridOvR_best_model.pkl



## 6. 模型详细参数配置 (Model Specifications)

本节详细列出了每个OvR二分类模型的最佳参数配置，包含数据预处理、过采样策略及核心算法参数。

| 认知类型 | 模型架构 | 详细配置 |
| :--- | :--- | :--- |
| **推理强** | AdaBoostClassifier | **Model**: AdaBoostClassifier<br>**Scaler**: StandardScaler<br>**Oversample**: BorderlineSMOTE(k=2), strat=auto<br>**Params**: {'algorithm': 'deprecated', 'estimator': None, 'learning_rate': 1.0, 'n_estimators': 100} |
| **记忆强** | SVC | **Model**: SVC<br>**Scaler**: StandardScaler<br>**Oversample**: SVMSMOTE(k=2), strat=auto<br>**Params**: {'C': 1, 'break_ties': False, 'cache_size': 200, 'coef0': 0.0, 'decision_function_shape': 'ovr', 'degree': 3, 'gamma': 'scale', 'kernel': 'rbf', 'max_iter': -1, 'probability': True, 'shrinking': True, 'tol': 0.001} |
| **执行强** | BalancedRandomForestClassifier | **Model**: BalancedRandomForestClassifier<br>**Scaler**: StandardScaler<br>**Oversample**: None<br>**Params**: {'bootstrap': False, 'max_depth': None, 'max_samples': None, 'monotonic_cst': None, 'n_estimators': 300, 'n_jobs': None, 'replacement': True, 'sampling_strategy': 'all'} |


## 7. 复现指南

### 7.1 环境依赖
- Python 3.8+
- pandas, numpy, scikit-learn, joblib, imbalanced-learn

### 7.2 运行命令
```bash
# 训练并保存最佳 Hybrid OvR 模型
python train_best_models.py
```

### 7.3 关键设置
- **随机种子 (SEED)**: 42 (确保结果可重复)
- **输入数据**: Grand_Summary_Analysis_Imputed.xlsx
- **核心逻辑**: 针对每种认知类型训练独立的二分类模型，预测时取概率最高的类型。

## 8. 分类逻辑详解

### 8.1 第一步：子测验分组
将认知子测验分为三个核心维度：
- **记忆**: 工作记忆、物品再认、延迟回忆
- **执行**: TMT-A、色词干扰、回溯测试
- **推理**: 语法推理

### 8.2 第二步：分数标准化与统一
- **方向统一**: 对于“越低越好”的指标（如耗时），取负值或倒数使其变为“越高越好”。
- **标准化**: 对所有子测验分数进行 Z-Score 标准化（均值为0，标准差为1）。

### 8.3 第三步：维度得分计算
- 计算每个维度下所有子测验标准化分数的**平均值**，作为该维度的得分。

### 8.4 第四步：类型判定
- 比较每个样本的 **记忆得分**、**执行得分**、**推理得分**。
- 取**得分最高**的维度作为该样本的认知优势类型。

## 9. 结论与建议
通过 OvR 策略，特定类型的二分类 AUC 有望突破 0.8。
1. **记忆强 vs Rest**: 识别特定记忆能力受损或增强的标志物。
2. **执行强 vs Rest**: 识别专注力和控制力相关的敏感指标。
3. **推理强 vs Rest**: 识别逻辑思维和抽象理解的预测因子。

若整体 3 分类 AUC 仍受限，建议在实际应用中采用 3 个二分类模型并行的方案。