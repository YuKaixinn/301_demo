import sys
import json
import os
import numpy as np
import pandas as pd
import joblib

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODEL_PATH = os.path.join(PROJECT_ROOT, "model", "predict_cog", "Cog_Type_HybridOvR_best_model.pkl")

# Ensure we can import HybridOvRClassifier for unpickling
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

try:
    from train_best_models import HybridOvRClassifier  # noqa: F401
except Exception:
    try:
        from train_domain_model import HybridOvRClassifier  # noqa: F401
    except Exception:
        HybridOvRClassifier = None  # type: ignore


def load_model():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(MODEL_PATH)
    if HybridOvRClassifier is not None:
        import types
        main_mod = sys.modules.get("__main__")
        if main_mod is not None and not hasattr(main_mod, "HybridOvRClassifier"):
            setattr(main_mod, "HybridOvRClassifier", HybridOvRClassifier)
    model = joblib.load(MODEL_PATH)
    if not hasattr(model, "estimators_info"):
        raise ValueError("Loaded model is missing estimators_info")
    if not hasattr(model, "classes_"):
        raise ValueError("Loaded model is missing classes_")
    return model


def build_row(features, needed_cols):
    row = pd.DataFrame([np.nan] * len(needed_cols), index=needed_cols).T
    for k, v in features.items():
        if k in row.columns and v is not None:
            try:
                row.at[0, k] = float(v)
            except Exception:
                continue
    return row


def predict_from_features(features: dict):
    try:
        model = load_model()
    except Exception as e:
        return {"ok": False, "error": f"加载认知优势模型失败: {e}"}

    needed_cols = set()
    for info in getattr(model, "estimators_info", {}).values():
        cols = info.get("features", [])
        needed_cols.update(cols)
    needed_cols = sorted(list(needed_cols))

    try:
        row = build_row(features, needed_cols)
        probas = model.predict_proba(row)[0]
        classes = list(model.classes_)
        idx = int(np.argmax(probas))
        best_label = classes[idx]
        prob_dict = {str(c): float(p) for c, p in zip(classes, probas)}
    except Exception as e:
        return {"ok": False, "error": f"模型预测失败: {e}"}

    return {
        "ok": True,
        "label": best_label,
        "label_text": best_label,
        "probs": prob_dict,
    }


def main():
    try:
        payload = sys.stdin.read()
        if not payload.strip():
            raise ValueError("输入为空")
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
