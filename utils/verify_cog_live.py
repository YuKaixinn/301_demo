import json
import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.predict_cog_type_live import predict

def test_prediction():
    # Mock feature data
    # Based on medians or some random values
    features = {
        "Subject_ID": "24380316",
        "性别": "男",
        "学历": "本科",
        "年龄": 23,
        "n_peaks_ECG": 1600,
        "Mean_RR_ms_ECG": 700,
        "SDNN_ms_ECG": 68,
        "RMSSD_ms_ECG": 65,
        "pNN50_pct_ECG": 17,
        "HR_Mean_ECG": 86,
        "HR_Std_ECG": 10,
        "Arm_MAV_EMG": 5,
        "Arm_MDF_EMG": 60,
        # Add some specific strong features for "Execution Strong" (e.g. fast TMT-A)
        # But wait, TMT-A is not in the feature list shown in model_report.md table?
        # The table lists TMT-A as a quick judge criteria, but maybe not in the final model features?
        # Let's check feature_medians.json for available features.
    }
    
    print("Testing prediction with mock data...")
    result = predict(features)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    if result.get('ok'):
        print("\nPrediction SUCCESS!")
    else:
        print("\nPrediction FAILED!")

if __name__ == "__main__":
    test_prediction()