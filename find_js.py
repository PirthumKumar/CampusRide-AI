import os

js_path = os.path.join('core', 'static', 'js', 'app.js')
if os.path.exists(js_path):
    print("Found app.js, searching...")
    with open(js_path, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            if 'copilot' in line.lower():
                print(f"{i}: {line.strip()}")
else:
    print("app.js not found")
