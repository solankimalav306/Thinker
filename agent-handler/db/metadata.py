import json
import os

def save_metadata(path, data):
    # Write to a temp file and rename, so a crash never leaves a half-written file.
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)

def load_metadata(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
