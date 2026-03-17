import pandas as pd
import json
import os
import numpy as np

def main():
    source_path = r'd:\code\python\301_data_analy\since310\认知\X_v3.csv'
    target_path = r'd:\code\python\301_data_analy\301_demo\model\predict_cog\feature_medians.json'

    if not os.path.exists(source_path):
        print(f"Error: Source file {source_path} not found.")
        return

    try:
        df = pd.read_csv(source_path)
        
        # Preprocess features (Copy logic from preprocess_cog.py)
        if '姓名' in df.columns:
            df = df.drop(columns=['姓名'])
            
        if '性别' in df.columns:
            df['性别'] = df['性别'].map({'男': 1, '女': 0})
            
        if '学历' in df.columns:
            edu_map = {'初中': 1, '高中': 2, '中专': 2, '大专': 3, '本科': 4, '硕士': 5, '博士': 6}
            df['学历'] = df['学历'].map(lambda x: edu_map.get(x, 3) if pd.notnull(x) else 3)
            
        # Drop duplicates if any (though usually fine for median calculation)
        df = df.drop_duplicates(subset=['Subject_ID'])
        
        # Calculate medians for all numeric columns
        medians = df.median(numeric_only=True).to_dict()
        
        # Save to JSON
        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(medians, f, ensure_ascii=False, indent=2)
            
        print(f"Successfully calculated medians for {len(medians)} features (including mapped categorical) and saved to {target_path}")
        
    except Exception as e:
        print(f"Error calculating medians: {e}")

if __name__ == "__main__":
    main()