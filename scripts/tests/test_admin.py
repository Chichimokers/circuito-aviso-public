"""Prueba manual de las operaciones protegidas con ADMIN_KEY.

Uso:
    ADMIN_KEY=tu_clave python scripts/tests/test_admin.py

Usa las variables de entorno API_BASE y ADMIN_KEY. La ruta de la BD se toma de
DB_PATH o `circuito-web/circuito.db` para la limpieza final.
"""
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.getenv("API_BASE", "http://127.0.0.1:8781")
ADMIN_KEY = os.getenv("ADMIN_KEY", "CHANGE_ME")
DB_PATH = os.getenv("DB_PATH", str(Path(__file__).resolve().parents[2] / "circuito-web" / "circuito.db"))


def req(method, path, payload=None, headers=None):
    h = headers or {}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=8) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


if __name__ == "__main__":
    print("verify correcta ->", req("POST", "/api/admin/verify", {"key": ADMIN_KEY}))
    print("verify incorrecta ->", req("POST", "/api/admin/verify", {"key": "xxxx"}))

    st, m = req("POST", "/api/markers", {"lat": 22.99, "lng": -82.10, "circuit": "TST99", "note": "prueba admin"})
    print("crear marker ->", st, m)
    mid = m["id"]

    print("delete sin clave ->", req("DELETE", "/api/markers/%d" % mid))
    print("delete clave mala ->", req("DELETE", "/api/markers/%d" % mid, headers={"X-Admin-Key": "bad"}))
    print("delete clave buena ->", req("DELETE", "/api/markers/%d" % mid, headers={"X-Admin-Key": ADMIN_KEY}))

    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM markers WHERE circuit='TST99'")
    conn.commit()
    print("limpieza ok")
    conn.close()
