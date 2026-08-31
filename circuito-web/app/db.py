import sqlite3
import os
from datetime import datetime, timezone

from . import config

DB_PATH = config.DB_PATH


def _utcnow_iso():
    return datetime.now(timezone.utc).isoformat()


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS circuits (
            code TEXT PRIMARY KEY,
            name TEXT,
            location TEXT,
            lat REAL,
            lng REAL,
            visible INTEGER DEFAULT 1,
            monitor INTEGER DEFAULT 1,
            status TEXT DEFAULT 'INACTIVO',
            last_event TEXT DEFAULT NULL,
            last_event_time TEXT DEFAULT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS markers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            circuit TEXT,
            note TEXT,
            votes INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)
    # migracion: añadir columna votes si no existe (tablas antiguas)
    cols = [r[1] for r in cur.execute("PRAGMA table_info(markers)").fetchall()]
    if "votes" not in cols:
        cur.execute("ALTER TABLE markers ADD COLUMN votes INTEGER DEFAULT 0")
    conn.commit()

    # migracion: estado oficial (de canales oficiales) en circuits
    ccols = [r[1] for r in cur.execute("PRAGMA table_info(circuits)").fetchall()]
    if "oficial_status" not in ccols:
        cur.execute("ALTER TABLE circuits ADD COLUMN oficial_status TEXT DEFAULT NULL")
    if "oficial_time" not in ccols:
        cur.execute("ALTER TABLE circuits ADD COLUMN oficial_time TEXT DEFAULT NULL")
    if "oficial_source" not in ccols:
        cur.execute("ALTER TABLE circuits ADD COLUMN oficial_source TEXT DEFAULT NULL")
    conn.commit()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT
        )
    """)
    conn.commit()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            circuit TEXT NOT NULL,
            status TEXT NOT NULL,
            text TEXT,
            lat REAL,
            lng REAL,
            created_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_circuit ON notifications(circuit, created_at DESC)")
    conn.commit()

    # Suscripciones Web Push + preferencias de sonido por circuito (por suscripcion)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            created_at TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS circuit_prefs (
            sub_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
            circuit TEXT NOT NULL,
            mode TEXT NOT NULL,
            tone TEXT,
            PRIMARY KEY (sub_id, circuit)
        )
    """)
    conn.commit()

    # Seed: circuitos de config como circuitos "invisibles" de monitoreo base
    for c in config.load_seed_circuits():
        cur.execute("""
            INSERT OR IGNORE INTO circuits (code, name, location, lat, lng, visible, monitor)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (c["code"], c.get("name", c["code"]), c.get("location", ""),
              c.get("lat"), c.get("lng"), 1 if c.get("visible") else 0,
              1 if c.get("monitor") else 0))
    conn.commit()
    conn.close()
