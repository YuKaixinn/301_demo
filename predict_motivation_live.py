import sys
import json
import os
from typing import Dict, List, Any

import numpy as np
import pandas as pd
import joblib


PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODEL_DIR = os.path.join(PROJECT_ROOT, "model", "predict_motivation")

PATH_TYPE = os.path.join(MODEL_DIR, "Motivation_Type_Classification_best_model.pkl")
PATH_LEVEL = os.path.join(MODEL_DIR, "Motivation_Level_Extreme_4040_best_model.pkl")
PATH_REG = os.path.join(MODEL_DIR, "Autonomous_Motivation_Regression_best_model.pkl")


def load_model(path: str):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return joblib.load(path)


def get_feature_names(model) -> List[str]:
    names = getattr(model, "feature_names_in_", None)
    if names is None:
        return []
    return list(names)


def build_row(features: Dict[str, Any], cols: List[str]) -> pd.DataFrame:
    row = pd.DataFrame([np.nan] * len(cols), index=cols).T
    for k, v in features.items():
        if k in row.columns and v is not None:
            try:
                row.at[0, k] = float(v)
            except Exception:
                continue
    return row


def predict_motivation_type(features: Dict[str, Any]) -> Dict[str, Any]:
    try:
        model = load_model(PATH_TYPE)
    except Exception as e:
        return {"ok": False, "error": f"加载动机类型模型失败: {e}"}

    cols = get_feature_names(model)
    if not cols:
        return {"ok": False, "error": "动机类型模型缺少特征名信息"}

    try:
        row = build_row(features, cols)
        if hasattr(model, "predict_proba"):
            probas = model.predict_proba(row)[0]
            classes = list(model.classes_)
            idx = int(np.argmax(probas))
            best_label = classes[idx]
            if hasattr(best_label, "item"):
                best_label = best_label.item()
            prob_dict = {str(c): float(p) for c, p in zip(classes, probas)}
        else:
            y = model.predict(row)[0]
            if hasattr(y, "item"):
                y = y.item()
            best_label = y
            prob_dict = {str(y): 1.0}
    except Exception as e:
        return {"ok": False, "error": f"动机类型预测失败: {e}"}

    return {
        "ok": True,
        "label": best_label,
        "label_text": str(best_label),
        "probs": prob_dict,
        "used_features": cols,
    }


def predict_motivation_level(features: Dict[str, Any]) -> Dict[str, Any]:
    try:
        cls_model = load_model(PATH_LEVEL)
        reg_model = load_model(PATH_REG)
    except Exception as e:
        return {"ok": False, "error": f"加载动机水平模型失败: {e}"}

    cls_cols = get_feature_names(cls_model)
    reg_cols = get_feature_names(reg_model)
    cols = sorted(set(cls_cols) | set(reg_cols))
    if not cols:
        return {"ok": False, "error": "动机水平模型缺少特征名信息"}

    try:
        prob_high = None
        label = None
        label_text = None

        if hasattr(cls_model, "predict_proba"):
            row_cls = build_row(features, cls_cols)
            probas = cls_model.predict_proba(row_cls)[0]
            classes = list(cls_model.classes_)
            if 1 in classes:
                pos_index = classes.index(1)
            else:
                pos_index = int(np.argmax(classes))
            prob_high = float(probas[pos_index])
            label = int(prob_high >= 0.5)
            label_text = "高自主动机水平" if label == 1 else "较低自主动机水平"
        else:
            row_cls = build_row(features, cls_cols)
            y = cls_model.predict(row_cls)[0]
            if hasattr(y, "item"):
                y = y.item()
            label = int(y)
            prob_high = None
            label_text = "高自主动机水平" if label == 1 else "较低自主动机水平"

        score = None
        try:
            row_reg = build_row(features, reg_cols)
            y_reg = reg_model.predict(row_reg)[0]
            if hasattr(y_reg, "item"):
                y_reg = y_reg.item()
            score = float(y_reg)
        except Exception:
            score = None
    except Exception as e:
        return {"ok": False, "error": f"动机水平预测失败: {e}"}

    return {
        "ok": True,
        "label": label,
        "label_text": label_text,
        "prob_high": prob_high,
        "score": score,
        "used_features": cols,
    }


def main():
    mode = "type"
    if len(sys.argv) > 1:
        mode = str(sys.argv[1]).strip().lower() or "type"

    try:
        payload = sys.stdin.read()
        data = json.loads(payload) if payload.strip() else {}
        features = data.get("features", {})
        if not isinstance(features, dict):
            raise ValueError("features 字段格式错误")
    except Exception as e:
        out = {"ok": False, "error": f"解析输入失败: {e}"}
        print(json.dumps(out, ensure_ascii=False))
        return

    if mode == "type":
        out = predict_motivation_type(features)
    elif mode == "level":
        out = predict_motivation_level(features)
    else:
        out = {"ok": False, "error": f"未知 mode: {mode}"}

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
