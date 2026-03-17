import sys
import json
import os
import joblib
import pandas as pd
import numpy as np

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODEL_DIR = os.path.join(PROJECT_ROOT, "model", "predict_motivation")
TYPE_MODEL_PATH = os.path.join(MODEL_DIR, "best_motivation_model_v2.pkl")
LEVEL_MODEL_PATH = os.path.join(MODEL_DIR, "motivation_level_model_v2.joblib")
MEDIANS_PATH = os.path.join(MODEL_DIR, "feature_medians.json")

# Feature Mapping (same as cognitive for consistency)
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

def load_resources(mode='type'):
    if not os.path.exists(MEDIANS_PATH):
        raise FileNotFoundError("Medians file not found.")
        
    print(f"DEBUG: Loading medians from {MEDIANS_PATH}", file=sys.stderr)
    with open(MEDIANS_PATH, 'r', encoding='utf-8') as f:
        medians = json.load(f)
        
    if mode == 'type':
        if not os.path.exists(TYPE_MODEL_PATH):
            raise FileNotFoundError("Type model file not found.")
        print(f"DEBUG: Loading type model from {TYPE_MODEL_PATH}", file=sys.stderr)
        model = joblib.load(TYPE_MODEL_PATH)
        return model, medians
    elif mode == 'level':
        if not os.path.exists(LEVEL_MODEL_PATH):
            raise FileNotFoundError("Level model file not found.")
        print(f"DEBUG: Loading level model from {LEVEL_MODEL_PATH}", file=sys.stderr)
        model = joblib.load(LEVEL_MODEL_PATH)
        return model, medians
    else:
        raise ValueError(f"Unknown mode: {mode}")

def preprocess_input(features, medians, model):
    # 1. Rename features
    mapped_features = {}
    for k, v in features.items():
        new_key = FEATURE_RENAME_MAP.get(k, k)
        mapped_features[new_key] = v
        
    # Determine feature columns from model
    feature_columns = []
    if hasattr(model, 'feature_names_in_'):
        feature_columns = list(model.feature_names_in_)
    elif hasattr(model, 'feature_columns'): # Custom attribute if added
        feature_columns = model.feature_columns
    elif hasattr(model, 'steps'): # Pipeline
        # Try to find step with feature names
        try:
             # Often the first step or the classifier has feature names
             # If SelectFromModel is used, it might be tricky to get input feature names directly from pipeline object
             # But usually pipeline.feature_names_in_ exists if fitted on DataFrame
             feature_columns = list(model.feature_names_in_)
        except:
             # Fallback: use keys from medians (assuming medians cover all training features)
             feature_columns = list(medians.keys())
             # Filter out non-features like Subject_ID if model doesn't expect them
             # Actually, best effort
    
    if not feature_columns:
         feature_columns = list(medians.keys())

    # 2. Convert to DataFrame (single row)
    df = pd.DataFrame([np.nan] * len(feature_columns), index=feature_columns).T
    
    # 3. Fill values
    for col in feature_columns:
        if col in mapped_features:
            val = mapped_features[col]
            # Handle categorical mapping
            if col == '性别':
                if val == '男': val = 1
                elif val == '女': val = 0
            elif col == '学历':
                edu_map = {'初中': 1, '高中': 2, '中专': 2, '大专': 3, '本科': 4, '硕士': 5, '博士': 6}
                val = edu_map.get(str(val), 3)
            
            try:
                df.at[0, col] = float(val)
            except:
                pass
    
    # 4. Fill Missing Values with Medians
    for col in feature_columns:
        if pd.isna(df.at[0, col]):
            if col in medians:
                df.at[0, col] = medians[col]
            else:
                df.at[0, col] = 0
                
    return df

def predict_type(features):
    model, medians = load_resources('type')
    X = preprocess_input(features, medians, model)
    
    y_pred = model.predict(X)[0]
    y_prob = model.predict_proba(X)[0]
    
    # Mapping based on motivation_labels.csv: 0 -> 外在调节型, 1 -> 主动动机型
    # But wait, what if there are more classes?
    # The pipeline.classes_ should tell us.
    classes = model.classes_
    prob_dict = {}
    
    # Define mapping
    # Note: Training data had 0 and 1.
    label_map = {0: "外在调节型", 1: "主动动机型"}
    
    label_text = label_map.get(y_pred, str(y_pred))
    
    for i, cls in enumerate(classes):
        cls_name = label_map.get(cls, str(cls))
        prob_dict[cls_name] = float(y_prob[i])
        
    return {
        "ok": True,
        "label": int(y_pred),
        "label_text": label_text,
        "probs": prob_dict
    }

def predict_level(features):
    model, medians = load_resources('level')
    X = preprocess_input(features, medians, model)
    
    y_pred = model.predict(X)[0]
    score = float(y_pred)
    
    # Determine level text (heuristic based on score distribution)
    # 36-84 range in sample. Let's say < 50 Low, >= 50 High?
    # Or just return score and let frontend decide.
    # We'll return a simple text for now.
    label_text = "高自主动机水平" if score >= 50 else "较低自主动机水平"
    
    return {
        "ok": True,
        "score": score,
        "label_text": label_text
    }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: python script.py [type|level]"}))
        return

    mode = sys.argv[1]
    
    try:
        if sys.stdin.isatty():
            print("Waiting for JSON input from stdin...", file=sys.stderr)
            
        payload = sys.stdin.read()
        if not payload:
            return
            
        data = json.loads(payload)
        features = data.get("features", {})
        
        if mode == 'type':
            result = predict_type(features)
        elif mode == 'level':
            result = predict_level(features)
        else:
            result = {"ok": False, "error": f"Unknown mode: {mode}"}
            
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        out = {"ok": False, "error": f"Prediction failed: {str(e)}"}
        print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()