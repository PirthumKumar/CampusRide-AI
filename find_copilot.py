import os

css_path = os.path.join('core', 'static', 'css', 'styles.css')
if os.path.exists(css_path):
    print("Found styles.css, searching...")
    with open(css_path, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            if 'copilot' in line.lower() or 'ai-' in line.lower():
                print(f"{i}: {line.strip()}")
else:
    print("styles.css not found")
