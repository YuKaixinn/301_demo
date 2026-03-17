import sys
import os
import pandas as pd
import numpy as np

# Add the directory to sys.path so we can import predict_cog_type_live
sys.path.append(os.path.dirname(__file__))

from predict_cog_type_live import predict_from_features, load_model

def test_live_prediction():
    print("Testing live prediction integration...")
    
    # 1. Test Model Loading
    try:
        model = load_model()
        print("Model loaded successfully.")
    except Exception as e:
        print(f"FAILED to load model: {e}")
        return

    # 2. Prepare Dummy Features
    # We need to know what features are expected.
    if hasattr(model, 'feature_columns'):
        feats = model.feature_columns
    else:
        feats = ['性别', '年龄', '学历'] # Minimal set
        
    print(f"Preparing dummy data for {len(feats)} features...")
    dummy_features = {}
    for f in feats:
        dummy_features[f] = np.random.rand() # Random float
        
    # Set categorical/special features reasonably
    dummy_features['性别'] = 1
    dummy_features['学历'] = 3
    
    # 3. Test Prediction
    result = predict_from_features(dummy_features)
    print("\nPrediction Result:")
    print(result)
    
    if result['ok']:
        print("\nSUCCESS: Prediction pipeline works.")
    else:
        print(f"\nFAILURE: {result.get('error')}")

if __name__ == "__main__":
    test_live_prediction()
