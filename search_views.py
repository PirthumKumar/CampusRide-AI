import os

views_path = os.path.join('core', 'views.py')
if os.path.exists(views_path):
    print("Found views.py, searching...")
    with open(views_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        for i, line in enumerate(lines, 1):
            if 'predict_price' in line or 'predictPrice' in line:
                print(f"Line {i}: {line.strip()}")
                # Print 20 lines after the match
                for j in range(i, min(i + 35, len(lines))):
                    print(f"  {j+1}: {lines[j].rstrip()}")
else:
    print("views.py not found")
