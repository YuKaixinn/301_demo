import sys
import json
import os
import pandas as pd
import numpy as np
import joblib

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODEL_DIR = os.path.join(PROJECT_ROOT, "model", "predict_ele")
MODEL_PATH = os.path.join(MODEL_DIR, "best_model.pkl")
FEATURE_LIST_PATH = os.path.join(MODEL_DIR, "feature_list.pkl")

# Mapping from System Input Keys (Old) to Model Feature Names (New)
# System Input Key -> Model Feature Name
FEATURE_MAPPING = {
    # BPHR (Physio)
    "Pre_SBP_BPHR": "sbp_pre",
    "Pre_DBP_BPHR": "dbp_pre",
    "Pre_HR_BPHR": "hr_pre", # Assuming new model has hr_pre? Let's check feature list again. 
                             # Feature list has: sbp_pre, dbp_pre, sbp_post, dbp_post. No hr_pre?
                             # Let's check feature list output again: ... 'sbp_pre', 'dbp_pre', 'sbp_post', 'dbp_post']
                             # It seems HR is NOT in the new model's feature list based on the print output I saw earlier.
                             # Wait, the print output ended with ... 'sbp_post', 'dbp_post']. 
                             # But earlier it had 'n_peaks_ECG', 'Mean_RR_ms_ECG'... 
                             # Let's re-read the print output carefully.
                             # ... '乐业', 'sbp_pre', 'dbp_pre', 'sbp_post', 'dbp_post']
                             # So HR is likely not used or named differently. 
                             # The old model had Pre_HR_BPHR. The new one doesn't seem to have it in the last few features.
                             # It has 'HR_Mean_ECG' though.
    "Post_SBP_BPHR": "sbp_post",
    "Post_DBP_BPHR": "dbp_post",
    
    # Eye Tracking Mismatches
    "blink_freq_Eye": "blink_rate_Hz_Eye",
    "avg_blink_dur_ms_Eye": "blink_dur_ms_Eye",
    "fixation_freq_Eye": "fixation_rate_Hz_Eye",
    # "saccade_freq_Eye": "saccade_rate_Hz_Eye", # If exists
    
    # EMG (Suffix Removal handled by logic, but specific ones if needed)
    # Psy (Suffix Removal handled by logic)
}

def load_resources():
    if not os.path.exists(MODEL_PATH) or not os.path.exists(FEATURE_LIST_PATH):
        raise FileNotFoundError("Model or feature list file not found.")
    
    model = joblib.load(MODEL_PATH)
    feature_cols = joblib.load(FEATURE_LIST_PATH)
    return model, feature_cols

def transform_features(input_features, target_cols):
    """
    Transform input dictionary to a DataFrame matching the model's expected columns.
    """
    # Initialize with 0s (missing value strategy)
    row = pd.DataFrame([0.0] * len(target_cols), index=target_cols).T
    
    # Helper to clean suffixes
    def clean_suffix(key):
        for suffix in ["_Psy", "_EMG", "_ECG", "_Eye", "_Score", "_BPHR", "_Ele"]:
            if key.endswith(suffix):
                return key[:-len(suffix)] # Remove suffix
        return key

    # Fill data
    for key, value in input_features.items():
        if value is None or value == "":
            continue
            
        try:
            val = float(value)
        except:
            # Skip non-numeric values (like names, IDs)
            continue
            
        # Strategy 1: Exact Match
        if key in target_cols:
            row.at[0, key] = val
            continue
            
        # Strategy 2: Explicit Mapping
        if key in FEATURE_MAPPING:
            target_key = FEATURE_MAPPING[key]
            if target_key in target_cols:
                row.at[0, target_key] = val
                continue
                
        # Strategy 3: Suffix Removal (for _Psy, _EMG matching new names like '神经质', 'Arm_MAV')
        # New model uses: '神经质', 'Arm_MAV' (no suffix)
        # Old input uses: '神经质_Psy', 'Arm_MAV_EMG'
        base_name = clean_suffix(key)
        if base_name in target_cols:
            row.at[0, base_name] = val
            continue
            
        # Strategy 4: Specific logic for Eye/ECG if they kept suffixes in new model
        # New model has: 'n_peaks_ECG', 'duration_sec_Eye' (kept suffix)
        # So if exact match failed, and suffix removal failed, it might be a mismatch.
        
    return row

def predict(features):
    try:
        model, cols = load_resources()
    except Exception as e:
        return {"ok": False, "error": f"加载模型失败: {e}"}

    try:
        X = transform_features(features, cols)
        
        # Predict
        # The model might be a Pipeline or Classifier
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba(X)
            # Check shape of probs
            if probs.shape[1] == 2:
                prob_high = float(probs[0, 1]) # Probability of class 1 (High)
            else:
                prob_high = float(probs[0, 0]) # Fallback
        else:
            # If model doesn't support proba (unlikely for classification)
            pred = model.predict(X)[0]
            prob_high = 1.0 if pred == 1 else 0.0
            
        label = int(prob_high >= 0.5)
        label_text = "高水平" if label == 1 else "低水平"
        
        # Get actual used features (non-zero) for verification
        used_features = X.iloc[0].to_dict()
        used_features_filtered = {k: v for k, v in used_features.items() if v != 0}
        
        # Safe input features extraction
        safe_input_features = {}
        for k, v in features.items():
            if k in cols or (k in FEATURE_MAPPING and FEATURE_MAPPING[k] in cols):
                try:
                    safe_input_features[k] = float(v)
                except:
                    pass
        
        return {
            "ok": True,
            "label": label,
            "label_text": label_text,
            "prob_high": prob_high,
            "prob_low": 1.0 - prob_high,
            "used_features": used_features_filtered,
            "input_features": safe_input_features
        }
        
    except Exception as e:
        return {"ok": False, "error": f"预测过程出错: {e}"}

def main():
    try:
        # Check if running interactively or via pipe
        if sys.stdin.isatty():
            # For testing/debugging manually
            print("Waiting for JSON input from stdin...")
            
        payload = sys.stdin.read()
        if not payload:
            return
            
        data = json.loads(payload)
        features = data.get("features", {})
    except Exception as e:
        out = {"ok": False, "error": f"解析输入失败: {e}"}
        print(json.dumps(out, ensure_ascii=False))
        return

    out = predict(features)
    print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
