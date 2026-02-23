# 动机类型预测模型报告

## 1. 项目摘要

- **样本量**: 60
- **聚类数**: 2
- **聚类轮廓系数**: 0.302
- **最佳模型**: SVM_RBF
- **AUC**: 0.797

## 2. 动机类型画像

| 类型 | 样本数 | 画像名称 |
| :--- | :--- | :--- |
| 1 | 46 | 自主动机型 |
| 0 | 14 | 外在调节型 |

## 3. 画像均值特征

| 类型 | 内部动机_Psy | 整合调节_Psy | 认同动机_Psy | 内摄调节_Psy | 外在调节_Psy | 无动机_Psy | 自主动机_Psy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 0 | 14.86 | 14.36 | 12.79 | 11.79 | 10.29 | 7.43 | 31.43 |
| 1 | 15.96 | 15.07 | 14.54 | 9.52 | 5.74 | 4.20 | 58.96 |

## 4. 关键预测因子

- **输入特征数量**: 25

- 当前最佳模型未提供可解释的重要性。

## 5. 模型详细参数

- **模型类型**: Pipeline
- **核心参数**:
  - `clf__C`: 50
  - `clf__break_ties`: False
  - `clf__cache_size`: 200
  - `clf__class_weight`: balanced
  - `clf__coef0`: 0.0
  - `clf__decision_function_shape`: ovr
  - `clf__degree`: 3
  - `clf__gamma`: 0.2
  - `clf__kernel`: rbf
  - `clf__max_iter`: -1
  - `clf__probability`: True
  - `clf__random_state`: 42
  - `clf__shrinking`: True
  - `clf__tol`: 0.001
  - `clf__verbose`: False

## 6. 训练流程说明

1. **数据预处理**:
   - 缺失值填补 (SimpleImputer)
   - 标准化 (StandardScaler)
2. **特征工程**:
   - 自动化特征选择 (RFE/SelectFromModel)
3. **模型训练**:
   - 交叉验证: RepeatedStratifiedKFold (n_splits=5, n_repeats=5)
   - 评估指标: Accuracy, Macro F1, AUC

## 7. 复现指南

- **操作系统**: Windows 10
- **Python版本**: 3.10.19
- **执行命令**:
  ```bash
  python train_domain_model.py
  ```

## 8. 模型文件

- **模型路径**: d:\code\python\301_data_analy\model\predict_motivation\Motivation_Type_Classification_best_model.pkl