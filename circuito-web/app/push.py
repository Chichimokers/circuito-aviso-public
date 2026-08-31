import asyncio
import json
import logging
import os

from . import db

log = logging.getLogger(__name__)

VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:circuito@inventory.cloudns.be")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")

# Modos que cuentan como "suena" (respecto al push filtrado)
_LOUD_MODES = {"default", "predefined", "custom"}


def _sub_id_for_endpoint(endpoint):
    conn = db.get_conn()
    row = conn.execute(
        "SELECT id FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
    ).fetchone()
    conn.close()
    return row["id"] if row else None


def upsert_subscription(endpoint, p256dh, auth, user_agent=None):
    conn = db.get_conn()
    now = db._utcnow_iso()
    conn.execute(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at) "
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth",
        (endpoint, p256dh, auth, user_agent, now),
    )
    row = conn.execute("SELECT id FROM push_subscriptions WHERE endpoint = ?", (endpoint,)).fetchone()
    conn.commit()
    conn.close()
    return row["id"] if row else None


def delete_subscription(endpoint):
    conn = db.get_conn()
    sub_id = _sub_id_for_endpoint(endpoint)
    if sub_id:
        conn.execute("DELETE FROM circuit_prefs WHERE sub_id = ?", (sub_id,))
        conn.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub_id,))
    conn.commit()
    conn.close()


def set_prefs(sub_id, circuit, mode, tone=None):
    conn = db.get_conn()
    conn.execute(
        "INSERT INTO circuit_prefs (sub_id, circuit, mode, tone) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(sub_id, circuit) DO UPDATE SET mode=excluded.mode, tone=excluded.tone",
        (sub_id, circuit, mode, tone),
    )
    conn.commit()
    conn.close()


def get_prefs(sub_id):
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT circuit, mode, tone FROM circuit_prefs WHERE sub_id = ?", (sub_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def subscriptions_that_sound_for(circuit):
    """Suscripciones cuyo circuito de preferencia 'suena' (mode en loud)."""
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT s.endpoint, s.p256dh, s.auth FROM push_subscriptions s "
        "JOIN circuit_prefs p ON p.sub_id = s.id "
        "WHERE UPPER(p.circuit) = UPPER(?) AND p.mode IN ('default','predefined','custom')",
        (circuit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _webpush_sync(sub, payload):
    from pywebpush import WebPushException, webpush
    info = {
        "endpoint": sub["endpoint"],
        "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
    }
    webpush(
        subscription_info=info,
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims={"sub": VAPID_SUBJECT},
    )


def send_push_sync(sub, title, body, tag, data=None):
    try:
        _webpush_sync(
            sub,
            {"title": title, "body": body, "tag": tag, "data": data or {}, "icon": "/circuitos/icon-192.png"},
        )
        return True
    except Exception as e:
        code = getattr(e, "response", None)
        status = getattr(code, "status_code", None) if code is not None else None
        # 404/410: suscripcion expirada -> limpiar
        if status in (404, 410):
            try:
                delete_subscription(sub["endpoint"])
                log.info(f"Suscripcion push eliminada (expirada): {status}")
            except Exception:
                pass
        else:
            log.warning(f"Error push: {e}")
        return False
