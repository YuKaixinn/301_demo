import sys
import json
import os
import numpy as np
import pandas as pd
import joblib
from imblearn.pipeline import Pipeline as ImbPipeline
from sklearn.ensemble import ExtraTreesClassifier

PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
# Updated to point to the new model location
MODEL_PATH = r"d:\code\python\301_data_analy\since310\认知\cog_model.joblib"

# Ensure we can import HybridOvRClassifier for unpickling
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

try:
    from train_best_models import HybridOvRClassifier  # noqa: F401
except Exception:
    try:
        from train_domain_model import HybridOvRClassifier  # noqa: F401
    except Exception:
        import types

        class HybridOvRClassifier:
            def __init__(self, estimators_info=None, classes_=None, estimators=None):
                self.estimators_info = estimators_info or {}
                self.classes_ = classes_ or []
                self.estimators = estimators or {}

            def _get_estimator(self, key, info):
                if isinstance(info, dict):
                    if "estimator" in info:
                        return info["estimator"]
                    if "model" in info:
                        return info["model"]
                if hasattr(self, "estimators_") and isinstance(self.estimators_, dict) and key in self.estimators_:
                    return self.estimators_[key]
                if isinstance(self.estimators, dict) and key in self.estimators:
                    return self.estimators[key]
                return None

            def _predict_score(self, est, X):
                if hasattr(est, "predict_proba"):
                    proba = est.predict_proba(X)
                    if len(proba.shape) == 2 and proba.shape[1] > 1:
                        return proba[:, 1]
                    return proba[:, 0]
                if hasattr(est, "decision_function"):
                    return est.decision_function(X)
                return est.predict(X)

            def predict_proba(self, X):
                classes = list(self.classes_) if len(self.classes_) else list(self.estimators_info.keys())
                scores = []
                for cls in classes:
                    info = self.estimators_info.get(cls, {})
                    cols = info.get("features") or info.get("feature_names") or []
                    X_sub = X[cols] if cols else X
                    est = self._get_estimator(cls, info)
                    if est is None:
                        raise ValueError(f"Missing estimator for class {cls}")
                    score = self._predict_score(est, X_sub)
                    score = np.array(score).reshape(-1)
                    scores.append(score)
                scores = np.vstack(scores).T
                exp = np.exp(scores - np.max(scores, axis=1, keepdims=True))
                return exp / exp.sum(axis=1, keepdims=True)

        for module_name in ("train_best_models", "train_domain_model"):
            if module_name not in sys.modules:
                mod = types.ModuleType(module_name)
                setattr(mod, "HybridOvRClassifier", HybridOvRClassifier)
                sys.modules[module_name] = mod


def load_model():
    print(f"DEBUG: Attempting to load model from {MODEL_PATH}")
    if not os.path.exists(MODEL_PATH):
        print(f"DEBUG: Model file not found at {MODEL_PATH}")
        raise FileNotFoundError(MODEL_PATH)

    # Add HybridOvRClassifier to main module if not present, for compatibility
    if HybridOvRClassifier is not None:
        import types
        main_mod = sys.modules.get("__main__")
        if main_mod is not None and not hasattr(main_mod, "HybridOvRClassifier"):
            setattr(main_mod, "HybridOvRClassifier", HybridOvRClassifier)
    
    try:
        obj = joblib.load(MODEL_PATH)
        print(f"DEBUG: Loaded object of type {type(obj)}")
    except Exception as e:
        print(f"DEBUG: Failed to load model with joblib: {e}")
        raise e

    if isinstance(obj, dict) and 'model' in obj:
        print("DEBUG: Detected model bundle dictionary.")
        model = obj['model']
        # Attach metadata if available
        if 'feature_columns' in obj:
            model.feature_columns = obj['feature_columns']
            print(f"DEBUG: Attached {len(model.feature_columns)} feature columns.")
        if 'class_order' in obj:
            try:
                model.classes_ = np.array(obj['class_order'])
                print(f"DEBUG: Set classes to {model.classes_}")
            except AttributeError:
                print(f"DEBUG: Could not set classes_ (read-only?). Current classes: {getattr(model, 'classes_', 'Unknown')}")
        return model
    else:
        print("DEBUG: Detected standalone model object.")
        model = obj
        if not hasattr(model, "estimators_info") and not hasattr(model, "predict_proba"):
             print("WARNING: Model might be missing required methods.")
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
    print("DEBUG: Starting prediction from features...")
    try:
        model = load_model()
    except Exception as e:
        print(f"DEBUG: Load model failed: {e}")
        return {"ok": False, "error": f"加载认知优势模型失败: {e}"}

    needed_cols = []
    # Support both old HybridOvR (estimators_info) and new Pipeline (feature_columns)
    if hasattr(model, "feature_columns"):
        needed_cols = list(model.feature_columns)
        print(f"DEBUG: Using feature_columns from model attribute. Count: {len(needed_cols)}")
    elif hasattr(model, "estimators_info"):
        col_set = set()
        for info in getattr(model, "estimators_info", {}).values():
            cols = info.get("features", [])
            col_set.update(cols)
        needed_cols = sorted(list(col_set))
        print(f"DEBUG: Using estimators_info. Count: {len(needed_cols)}")
    else:
        # Try to infer from model if possible, or fail gracefully
        if hasattr(model, "feature_names_in_"):
             needed_cols = list(model.feature_names_in_)
             print(f"DEBUG: Using feature_names_in_. Count: {len(needed_cols)}")
        else:
             print("WARNING: Could not determine feature columns from model. Using all input features.")
             needed_cols = sorted(list(features.keys()))

    # needed_cols is now a list in correct order
    
    input_features = {}
    try:
        row = build_row(features, needed_cols)
        # Debug missing features
        missing = [c for c in needed_cols if c not in features]
        if missing:
             print(f"DEBUG: Missing features in input: {missing[:5]}... (Total {len(missing)})")
        
        for c in row.columns:
            val = row.at[0, c]
            if pd.notna(val):
                input_features[c] = float(val)

        print("DEBUG: Calling predict_proba...")
        probas = model.predict_proba(row)[0]
        print(f"DEBUG: Probabilities: {probas}")
        
        if hasattr(model, "classes_"):
            classes = list(model.classes_)
        else:
            # Fallback for old model if classes_ missing but estimators_info present
            classes = list(getattr(model, "estimators_info", {}).keys())
            
        idx = int(np.argmax(probas))
        best_label = classes[idx]
        prob_dict = {str(c): float(p) for c, p in zip(classes, probas)}
        print(f"DEBUG: Prediction result: {best_label}")
    except Exception as e:
        print(f"DEBUG: Prediction logic failed: {e}")
        return {"ok": False, "error": f"模型预测失败: {e}"}

    return {
        "ok": True,
        "label": best_label,
        "label_text": best_label,
        "probs": prob_dict,
        "input_features": input_features,
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
