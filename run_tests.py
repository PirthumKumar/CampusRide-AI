import subprocess
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
python_path = r"C:\Users\pirth\AppData\Local\Python\pythoncore-3.14-64\python.exe"

print("Running tests from script dir:", script_dir)
res = subprocess.run(
    [python_path, "manage.py", "test"],
    cwd=script_dir,
    capture_output=True,
    text=True
)

output_file = os.path.join(script_dir, "test_results_details.txt")
with open(output_file, "w") as f:
    f.write(f"Exit code: {res.returncode}\n")
    f.write("--- STDOUT ---\n")
    f.write(res.stdout)
    f.write("\n--- STDERR ---\n")
    f.write(res.stderr)

print("Done writing results to", output_file)
