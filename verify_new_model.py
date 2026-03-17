import sys
import os
import json
import random
from utils.predict_ele_live import predict

def test_prediction():
    print("=== Testing New Physical Fitness Model Integration ===")
    
    # Simulate System Input (Old Feature Names)
    # Based on what we know about the old system's data keys
    dummy_input = {
        # Physio (BPHR)
        "Pre_SBP_BPHR": 120,
        "Pre_DBP_BPHR": 80,
        "Post_SBP_BPHR": 130,
        "Post_DBP_BPHR": 85,
        "Pre_HR_BPHR": 70, # Might not be used but let's provide it
        
        # Psy
        "神经质_Psy": 20,
        "尽责性_Psy": 30,
        "宜人性_Psy": 30,
        "开放性_Psy": 25,
        "外向性_Psy": 28,
        "坚韧_Psy": 15,
        "力量_Psy": 18,
        "乐观_Psy": 12,
        
        # ECG
        "n_peaks_ECG": 150,
        "Mean_RR_ms_ECG": 800,
        "SDNN_ms_ECG": 50,
        "RMSSD_ms_ECG": 40,
        "pNN50_pct_ECG": 10,
        
        # EMG
        "Arm_MAV_EMG": 0.05,
        "Arm_MDF_EMG": 60,
        "Arm_MPF_EMG": 70,
        "Neck_MAV_EMG": 0.04,
        
        # Eye
        "duration_sec_Eye": 60,
        "blink_freq_Eye": 0.5, # Should map to blink_rate_Hz_Eye
        "avg_blink_dur_ms_Eye": 200, # Should map to blink_dur_ms_Eye
        "fixation_freq_Eye": 2.0,
        "avg_fixation_dur_ms_Eye": 300,
        "saccade_count_Eye": 100,
        "avg_saccade_amp_deg_Eye": 5.0,
        
        # Score
        "Shooting_TotalScore_Score": 500,
        "Game5_TotalScore_Score": 1000,
        
        # Irrelevant keys
        "Some_Random_Key": 123,
        "Name": "Test User",
        "Subject_ID": "12345"
    }
    
    print("\n[Input Features Sample]")
    print(json.dumps({k:v for k,v in list(dummy_input.items())[:5]}, indent=2, ensure_ascii=False))
    print("...")
    
    # Run Prediction
    try:
        result = predict(dummy_input)
        
        print("\n[Prediction Result]")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        if result["ok"]:
            print("\n✅ Prediction Successful!")
            print(f"Label: {result['label_text']} ({result['label']})")
            print(f"Probability: {result['prob_high']:.4f}")
            
            # Verify input features were used
            used_features = result["used_features"]
            print(f"\nFeatures used by model: {len(used_features)}")
            # Check a few mappings
            if "sbp_pre" in used_features:
                print(f"Mapping Check: Pre_SBP_BPHR ({dummy_input['Pre_SBP_BPHR']}) -> sbp_pre ({used_features['sbp_pre']}) [OK]")
            else:
                print("Mapping Check: sbp_pre NOT found in used features! [FAIL]")
                
            if "神经质" in used_features:
                 print(f"Mapping Check: 神经质_Psy ({dummy_input['神经质_Psy']}) -> 神经质 ({used_features['神经质']}) [OK]")
            else:
                 print("Mapping Check: 神经质 NOT found! [FAIL]")
                 
            if "blink_rate_Hz_Eye" in used_features:
                print(f"Mapping Check: blink_freq_Eye ({dummy_input['blink_freq_Eye']}) -> blink_rate_Hz_Eye ({used_features['blink_rate_Hz_Eye']}) [OK]")
            else:
                print("Mapping Check: blink_rate_Hz_Eye NOT found! [FAIL]")
                
        else:
            print("\n❌ Prediction Failed!")
            print(f"Error: {result.get('error')}")
            
    except Exception as e:
        print(f"\n❌ Execution Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_prediction()
