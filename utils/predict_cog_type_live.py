import sys
import json
import os
import joblib
import pandas as pd
import numpy as np

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODEL_DIR = os.path.join(PROJECT_ROOT, "model", "predict_cog")
MODEL_PATH = os.path.join(MODEL_DIR, "cog_model_v2.joblib")
ENCODER_PATH = os.path.join(MODEL_DIR, "label_encoder.joblib")
MEDIANS_PATH = os.path.join(MODEL_DIR, "feature_medians.json")

# Feature Mapping (from predict_single_cog.py)
FEATURE_RENAME_MAP = {
    'Arm_MAV_EMG': 'Arm_MAV',
    'Arm_MDF_EMG': 'Arm_MDF',
    'Arm_MPF_EMG': 'Arm_MPF',
    'Arm_RMS_EMG': 'Arm_RMS',
    'Arm_iEMG_EMG': 'Arm_iEMG',
    'Arm_Max_Amp_EMG': 'Arm_Max_Amp',
    'Neck_MAV_EMG': 'Neck_MAV',
    'Neck_MDF_EMG': 'Neck_MDF',
    'Neck_MPF_EMG': 'Neck_MPF',
    'Neck_RMS_EMG': 'Neck_RMS',
    'Neck_iEMG_EMG': 'Neck_iEMG',
    'Neck_Max_Amp_EMG': 'Neck_Max_Amp',
    'blink_freq_Eye': 'blink_rate_Hz_Eye',
    'avg_blink_dur_ms_Eye': 'blink_dur_ms_Eye',
    'fixation_freq_Eye': 'fixation_rate_Hz_Eye',
    'Pre_SBP_BPHR': 'sbp_pre',
    'Pre_DBP_BPHR': 'dbp_pre',
    'Post_SBP_BPHR': 'sbp_post',
    'Post_DBP_BPHR': 'dbp_post'
}

def load_resources():
    if not os.path.exists(MODEL_PATH) or not os.path.exists(ENCODER_PATH) or not os.path.exists(MEDIANS_PATH):
        raise FileNotFoundError("Model, encoder or medians file not found.")
    
    # Use stderr for debug logs to avoid polluting stdout (JSON output)
    print(f"DEBUG: Loading model from {MODEL_PATH}", file=sys.stderr)
    bundle = joblib.load(MODEL_PATH)
    # Handle bundle format vs standalone model
    if isinstance(bundle, dict) and 'model' in bundle:
        model = bundle['model']
        feature_columns = bundle.get('feature_columns', [])
    else:
        model = bundle
        feature_columns = getattr(model, 'feature_names_in_', [])

    print(f"DEBUG: Loading encoder from {ENCODER_PATH}", file=sys.stderr)
    encoder = joblib.load(ENCODER_PATH)
    
    print(f"DEBUG: Loading medians from {MEDIANS_PATH}", file=sys.stderr)
    with open(MEDIANS_PATH, 'r', encoding='utf-8') as f:
        medians = json.load(f)
        
    return model, encoder, medians, feature_columns

def preprocess_input(features, medians, feature_columns):
    # 1. Rename features
    mapped_features = {}
    for k, v in features.items():
        new_key = FEATURE_RENAME_MAP.get(k, k)
        mapped_features[new_key] = v
        
    # 2. Convert to DataFrame (single row)
    # Initialize with NaNs
    df = pd.DataFrame([np.nan] * len(feature_columns), index=feature_columns).T
    
    # 3. Fill values
    for col in feature_columns:
        if col in mapped_features:
            val = mapped_features[col]
            # Handle categorical mapping immediately
            if col == '性别':
                if val == '男': val = 1
                elif val == '女': val = 0
                else: val = np.nan # Or default?
            elif col == '学历':
                edu_map = {'初中': 1, '高中': 2, '中专': 2, '大专': 3, '本科': 4, '硕士': 5, '博士': 6}
                val = edu_map.get(str(val), 3) # Default to 3 (大专) if unknown or missing
            
            try:
                df.at[0, col] = float(val)
            except:
                pass # Keep NaN if conversion fails
    
    # 4. Fill Missing Values with Medians
    for col in feature_columns:
        if pd.isna(df.at[0, col]):
            if col in medians:
                df.at[0, col] = medians[col]
            else:
                df.at[0, col] = 0 # Fallback
                
    return df

def predict(features):
    try:
        model, encoder, medians, feature_columns = load_resources()
        
        X = preprocess_input(features, medians, feature_columns)
        
        # Predict
        y_pred_idx = model.predict(X)
        y_pred_label = encoder.inverse_transform(y_pred_idx)[0]
        y_prob = model.predict_proba(X)[0]
        
        # Construct probability dictionary
        prob_dict = {}
        for i, cls in enumerate(encoder.classes_):
            prob_dict[str(cls)] = float(y_prob[i])
            
        return {
            "ok": True,
            "label": str(y_pred_label),
            "label_text": str(y_pred_label),
            "probs": prob_dict,
            "input_features": features # Return original features for debug/display
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": f"Prediction failed: {str(e)}"}

def main():
    try:
        # Check if running interactively or via pipe
        if sys.stdin.isatty():
            # For testing/debugging manually
            print("Waiting for JSON input from stdin...", file=sys.stderr)
            
        payload = sys.stdin.read()
        if not payload:
            return
            
        data = json.loads(payload)
        features = data.get("features", {})
        
        result = predict(features)
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        out = {"ok": False, "error": f"Input parsing failed: {str(e)}"}
        print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()