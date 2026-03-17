import pandas as pd
import json
import os

def main():
    # Source files for features
    # Assuming both models use the same feature set (X_v3.csv)
    source_path = r'd:\code\python\301_data_analy\since310\动机\X_v3.csv'
    target_path = r'd:\code\python\301_data_analy\301_demo\model\predict_motivation\feature_medians.json'

    if not os.path.exists(source_path):
        print(f"Error: Source file {source_path} not found.")
        return

    try:
        df = pd.read_csv(source_path)
        
        # Preprocess features (same as cognitive model)
        if '姓名' in df.columns:
            df = df.drop(columns=['姓名'])
            
        if '性别' in df.columns:
            df['性别'] = df['性别'].map({'男': 1, '女': 0})
            
        if '学历' in df.columns:
            edu_map = {'初中': 1, '高中': 2, '中专': 2, '大专': 3, '本科': 4, '硕士': 5, '博士': 6}
            df['学历'] = df['学历'].map(lambda x: edu_map.get(x, 3) if pd.notnull(x) else 3)
            
        df = df.drop_duplicates(subset=['Subject_ID'])
        
        # Calculate medians for all numeric columns
        medians = df.median(numeric_only=True).to_dict()
        
        # Save to JSON
        with open(target_path, 'w', encoding='utf-8') as f:
            json.dump(medians, f, ensure_ascii=False, indent=2)
            
        print(f"Successfully calculated medians for {len(medians)} features and saved to {target_path}")
        
    except Exception as e:
        print(f"Error calculating medians: {e}")

if __name__ == "__main__":
    main()