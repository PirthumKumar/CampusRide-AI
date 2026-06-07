import re

with open('core/static/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
for i, line in enumerate(lines):
    if 'this.notifications' in line:
        print(f"Line {i+1}: {line.strip()}")
