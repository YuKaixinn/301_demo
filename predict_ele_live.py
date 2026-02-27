import sys
import json
import os
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler, PolynomialFeatures
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
import joblib

PROJECT_ROOT = os.path.dirname(__file__)
INPUT_FILE = os.path.join(PROJECT_ROOT, "Grand_Summary_Analysis_Imputed.xlsx")
MODEL_PATH = os.path.join(PROJECT_ROOT, "model", "predict_ele", "Ele_Level_Custom_Weighted_Optimized_Extreme_1515_best_model.pkl")
SEED = 42


def get_cols_by_suffix(df, suffix):
    return [c for c in df.columns if c.endswith(suffix)]


def direction_unify(df, cols, keywords):
    work = df[cols].copy()
    for col in cols:
        if any(k in col for k in keywords):
            work[col] = -1 * work[col]
    return work


def build_feature_space():
    df = pd.read_excel(INPUT_FILE)

    psy_cols = get_cols_by_suffix(df, "_Psy")
    ecg_cols = get_cols_by_suffix(df, "_ECG")
    emg_cols = get_cols_by_suffix(df, "_EMG")
    eye_cols = get_cols_by_suffix(df, "_Eye")
    bphr_cols = [c for c in df.columns if c.endswith("_BPHR")]
    score_cols = get_cols_by_suffix(df, "_Score")

    motivation_cols = [
        "内部动机_Psy",
        "整合调节_Psy",
        "认同动机_Psy",
        "内摄调节_Psy",
        "外在调节_Psy",
        "无动机_Psy",
        "自主动机_Psy",
    ]
    other_psy_cols = [c for c in psy_cols if c not in motivation_cols]

    base_feature_cols = ecg_cols + emg_cols + eye_cols + bphr_cols + score_cols + other_psy_cols
    base_feature_cols = [c for c in base_feature_cols if pd.api.types.is_numeric_dtype(df[c])]

    ele_cols = get_cols_by_suffix(df, "_Ele")
    invert_keywords = [
        "时长",
        "Time",
        "Duration",
        "TMT",
        "3000",
        "Seconds",
        "sec",
        "RT",
        "Reaction",
        "Latency",
        "30x2",
    ]
    return df, base_feature_cols


def load_trained_model():
    df, base_feature_cols = build_feature_space()
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(MODEL_PATH)
    model = joblib.load(MODEL_PATH)
    return model, base_feature_cols


def build_training_model():
    df, base_feature_cols = build_feature_space()

    ele_cols = get_cols_by_suffix(df, "_Ele")
    invert_keywords = [
        "时长",
        "Time",
        "Duration",
        "TMT",
        "3000",
        "Seconds",
        "sec",
        "RT",
        "Reaction",
        "Latency",
        "30x2",
    ]
    ele_unified = direction_unify(df, ele_cols, invert_keywords)
    ele_unified = ele_unified.apply(pd.to_numeric, errors="coerce")

    imputer = SimpleImputer(strategy="mean")
    ele_unified_imputed = pd.DataFrame(imputer.fit_transform(ele_unified), columns=ele_cols)

    scaler = StandardScaler()
    ele_unified_scaled = pd.DataFrame(scaler.fit_transform(ele_unified_imputed), columns=ele_cols)

    weights = {
        "30x2_Ele": 0.40,
        "仰卧卷腹_Ele": 0.30,
        "引体向上_Ele": 0.15,
        "3000米_Ele": 0.10,
        "单兵训练综合成绩_Ele": 0.05,
    }

    weighted_scores = pd.Series(0.0, index=df.index)
    for col, w in weights.items():
        if col in ele_unified_scaled.columns:
            weighted_scores += ele_unified_scaled[col].values * w

    threshold = weighted_scores.mean()
    y_binary = (weighted_scores >= threshold).astype(int)

    pipeline = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="mean")),
            ("scaler", StandardScaler()),
            ("poly", PolynomialFeatures(degree=2, include_bias=False)),
            ("clf", LogisticRegression(random_state=SEED, solver="liblinear", C=1.0)),
        ]
    )

    X = df[base_feature_cols]
    y = y_binary

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    cross_val_score(pipeline, X, y, cv=cv, scoring="roc_auc")

    pipeline.fit(X, y)
    return pipeline, base_feature_cols


def predict_from_features(features):
    try:
        try:
            model, cols = load_trained_model()
        except Exception:
            model, cols = build_training_model()
    except Exception as e:
        return {"ok": False, "error": f"加载训练数据或模型失败: {e}"}

    row = pd.DataFrame([np.nan] * len(cols), index=cols).T
    for k, v in features.items():
        if k in row.columns and v is not None:
            try:
                row.at[0, k] = float(v)
            except Exception:
                continue

    probs = model.predict_proba(row)[0]
    prob_high = float(probs[1])
    label = int(prob_high >= 0.5)
    label_text = "高水平" if label == 1 else "低水平"

    return {
        "ok": True,
        "label": label,
        "label_text": label_text,
        "prob_high": prob_high,
    }


def main():
    try:
        payload = sys.stdin.read()
        data = json.loads(payload)
        features = data.get("features", {})
    except Exception as e:
        out = {"ok": False, "error": f"解析输入失败: {e}"}
        print(json.dumps(out, ensure_ascii=False))
        return

    out = predict_from_features(features)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
