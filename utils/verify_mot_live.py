import json
import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.predict_motivation_live import predict_type, predict_level

def test_prediction():
    # Mock feature data
    features = {
        "Subject_ID": "24380110", # From labels csv, is 主动动机型 (68)
        "性别": "男",
        "学历": "本科",
        "年龄": 23,
        "n_peaks_ECG": 1600,
        "Mean_RR_ms_ECG": 700,
        # ... other features will be filled by medians
    }
    
    print("Testing Motivation Type prediction...")
    try:
        res_type = predict_type(features)
        print(json.dumps(res_type, ensure_ascii=False, indent=2))
    except Exception as e:
        print(f"Type Prediction Failed: {e}")

    print("\nTesting Motivation Level prediction...")
    try:
        res_level = predict_level(features)
        print(json.dumps(res_level, ensure_ascii=False, indent=2))
    except Exception as e:
        print(f"Level Prediction Failed: {e}")

if __name__ == "__main__":
    test_prediction()