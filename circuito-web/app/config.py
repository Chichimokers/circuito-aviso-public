import os
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "circuits.json")
DB_PATH = os.path.join(BASE_DIR, "circuito.db")

PORT = int(os.getenv("PORT", "8781"))

ADMIN_KEY = os.getenv("ADMIN_KEY", "").strip()

def load_seed_circuits():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f).get("circuits", [])
    except Exception:
        return []
