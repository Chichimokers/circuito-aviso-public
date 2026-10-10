"""Mantenimiento: elimina marcadores de usuario y circuitos huerfanos de la BD.

Uso:
    python scripts/maintenance/cleanup_db.py [ruta_a_circuito.db]

Por defecto usa la variable de entorno DB_PATH o `circuito-web/circuito.db`.
"""
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.getenv(
        "DB_PATH", str(ROOT / "circuito-web" / "circuito.db")
    )
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("DELETE FROM markers")
    cur.execute(
        "DELETE FROM circuits WHERE visible = 1 AND NOT EXISTS "
        "(SELECT 1 FROM markers WHERE markers.circuit = circuits.code)"
    )
    conn.commit()
    print("markers restantes:", cur.execute("SELECT COUNT(*) FROM markers").fetchone()[0])
    print("circuits:")
    for r in cur.execute("SELECT code, visible, monitor FROM circuits").fetchall():
        print(" ", r)
    conn.close()


if __name__ == "__main__":
    main()
