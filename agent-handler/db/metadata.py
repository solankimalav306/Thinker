import json
import os

def save_metadata(path, data):
    with open(path, "w") as f:
        json.dump(data, f)

def load_metadata(path):
    with open(path, "r") as f:
        return json.load(f)