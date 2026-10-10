"""Prueba manual de endpoints publicos del backend.

Uso:
    python scripts/tests/test_api.py

Usa la variable de entorno API_BASE (por defecto http://127.0.0.1:8781).
"""
import json
import os
import urllib.request


def get(path):
    url = os.getenv("API_BASE", "http://127.0.0.1:8781") + path
    return json.loads(urllib.request.urlopen(url, timeout=8).read().decode())


def post(path, payload):
    url = os.getenv("API_BASE", "http://127.0.0.1:8781") + path
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=8).read().decode())


if __name__ == "__main__":
    print("alerta ->", post("/api/alert", {"code": "TEST01", "status": "AFECTADO"}))
    print("marker new ->", post("/api/markers", {"lat": 22.96, "lng": -82.39, "circuit": "TEST01", "note": "prueba"}))
    print("codes ->", get("/api/codes"))
    print("markers ->", get("/api/markers"))
