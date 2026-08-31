import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, config
from . import push as pushmod

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

CONFIG_PATH = config.CONFIG_PATH

# SSE: colas de clientes suscritos (por conexion se usa un asyncio.Queue)
subscribers: set[asyncio.Queue] = set()

# Anti-spam de validaciones: marker_id -> conjunto de IPs que ya validaron
vote_by_ip: dict[int, set] = {}

DUP_RADIUS = 0.0005  # ~50 m en lat/lng (cercania para considerar duplicado)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    ip = request.client.host if request.client else "?"
    return ip


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en metros entre dos coordenadas (Haversine)."""
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Circuito Aviso Web", lifespan=lifespan)


class MarkerIn(BaseModel):
    lat: float
    lng: float
    circuit: Optional[str] = None
    note: Optional[str] = None
    force: Optional[bool] = False


class AlertIn(BaseModel):
    code: str
    status: str
    location: Optional[str] = None
    text: Optional[str] = None


class OficialIn(BaseModel):
    code: str
    status: str
    source: Optional[str] = None


class PushSubscribeIn(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
    user_agent: Optional[str] = None


class PushPrefIn(BaseModel):
    sub_id: int
    circuit: str
    mode: str
    tone: Optional[str] = None


def _broadcast(payload: dict):
    data = json.dumps(payload, ensure_ascii=False)
    for q in list(subscribers):
        if q.full():
            try:
                q.get_nowait()
            except Exception:
                pass
        try:
            q.put_nowait(data)
        except Exception:
            pass


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/codes")
def get_codes():
    """Lista de circuitos a monitorear = circuitos base (seed invisible) + circuitos de puntos activos."""
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT code FROM circuits WHERE visible = 0 AND monitor = 1 "
        "UNION SELECT DISTINCT circuit FROM markers WHERE circuit IS NOT NULL AND circuit != ''"
    ).fetchall()
    conn.close()
    codes = [r["code"] for r in rows if r["code"]]
    return {"codes": codes}


@app.get("/api/circuits")
def get_circuits():
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM circuits").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/markers")
def get_markers():
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM markers ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/markers")
async def create_marker(m: MarkerIn):
    if not m.circuit or not m.circuit.strip():
        raise HTTPException(status_code=400, detail="El código de circuito es obligatorio")

    conn = db.get_conn()

    # Marcador con el mismo codigo de circuito (en cualquier lugar)
    same_circuit_row = None
    if m.circuit:
        same_circuit_row = conn.execute(
            "SELECT * FROM markers WHERE UPPER(circuit) = ? ORDER BY votes DESC LIMIT 1",
            (m.circuit.strip().upper(),),
        ).fetchone()

    # Marcador mas cercano (dentro del radio de duplicado)
    near_row = conn.execute(
        "SELECT * FROM markers WHERE ABS(lat - ?) <= ? AND ABS(lng - ?) <= ? "
        "ORDER BY ABS(lat - ?) + ABS(lng - ?) LIMIT 1",
        (m.lat, DUP_RADIUS, m.lng, DUP_RADIUS, m.lat, m.lng),
    ).fetchone()

    # Si hay un punto cercano y NO se pidio crear a la fuerza -> preguntar
    if near_row and not m.force:
        near = dict(near_row)
        d = round(_haversine_m(m.lat, m.lng, near["lat"], near["lng"]))
        conn.close()
        return {
            "ask": True,
            "reason": "nearby",
            "same_circuit": bool(same_circuit_row),
            "marker": near,
            "distance": d,
            "votes": near["votes"],
        }

    # Caso C: se pidio fuerza (crear duplicado) pero el mismo circuito esta a <5 m
    # -> fuerzo a validar en vez de crear basura superpuesta
    if near_row and m.force and same_circuit_row:
        d = _haversine_m(m.lat, m.lng, near_row["lat"], near_row["lng"])
        if d < 5:
            conn.close()
            return {
                "blocked": True,
                "reason": "too_close_same_circuit",
                "marker": dict(near_row),
                "distance": round(d),
                "votes": near_row["votes"],
            }

    # Crear el punto
    created = db._utcnow_iso()
    cur = conn.execute(
        "INSERT INTO markers (lat, lng, circuit, note, votes, created_at) VALUES (?,?,?,?,0,?)",
        (m.lat, m.lng, m.circuit, m.note, created),
    )
    conn.commit()
    marker_id = cur.lastrowid
    conn.close()

    # Si el marcador tiene un circuito -> asegurarlo en circuits como monitor-on
    if m.circuit:
        add_monitored(m.circuit)

    payload = {"type": "marker_new", "marker": {"id": marker_id, "lat": m.lat, "lng": m.lng, "circuit": m.circuit, "note": m.note, "votes": 0}}
    _broadcast(payload)
    return {"ok": True, "marker": payload["marker"]}


class VoteIn(BaseModel):
    marker_id: int


@app.post("/api/markers/vote")
async def vote_marker(v: VoteIn, request: Request):
    ip = _client_ip(request)
    conn = db.get_conn()
    row = conn.execute("SELECT id FROM markers WHERE id = ?", (v.marker_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Punto no encontrado")

    # anti-spam: 1 validacion por punto por IP
    if ip in vote_by_ip.setdefault(v.marker_id, set()):
        conn.close()
        return {"ok": False, "already": True, "votes": None}

    vote_by_ip[v.marker_id].add(ip)
    conn.execute("UPDATE markers SET votes = votes + 1 WHERE id = ?", (v.marker_id,))
    conn.commit()
    new_votes = conn.execute("SELECT votes FROM markers WHERE id = ?", (v.marker_id,)).fetchone()["votes"]
    conn.close()

    payload = {"type": "marker_vote", "marker_id": v.marker_id, "votes": new_votes}
    _broadcast(payload)
    return {"ok": True, "votes": new_votes}


@app.delete("/api/markers/{marker_id}")
def delete_marker(marker_id: int, x_admin_key: str = Header(default="")):
    if not config.ADMIN_KEY or x_admin_key != config.ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Solo el administrador puede eliminar")
    conn = db.get_conn()
    # obtener circuito del marker antes de borrar
    row = conn.execute("SELECT circuit FROM markers WHERE id = ?", (marker_id,)).fetchone()
    circuit = row["circuit"] if row else None
    conn.execute("DELETE FROM markers WHERE id = ?", (marker_id,))
    # limpiar circuitos de usuario huerfanos (visible=1 ya sin puntos)
    if circuit:
        conn.execute(
            "DELETE FROM circuits WHERE code = ? AND visible = 1 "
            "AND NOT EXISTS (SELECT 1 FROM markers WHERE markers.circuit = circuits.code)",
            (circuit,),
        )
    conn.commit()
    conn.close()
    _broadcast({"type": "marker_del", "id": marker_id})
    return {"ok": True}


class AdminVerifyIn(BaseModel):
    key: str


@app.post("/api/admin/verify")
def admin_verify(a: AdminVerifyIn):
    ok = bool(config.ADMIN_KEY) and a.key == config.ADMIN_KEY
    return {"ok": ok}


@app.post("/api/alert")
async def receive_alert(a: AlertIn):
    """El monitor notifica una alerta para un circuito."""
    code = a.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="code requerido")

    conn = db.get_conn()
    now = db._utcnow_iso()
    conn.execute(
        "INSERT INTO circuits (code, name, location, visible, monitor, status, last_event, last_event_time) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(code) DO UPDATE SET status=excluded.status, last_event=excluded.last_event, last_event_time=excluded.last_event_time",
        (code, code, a.location or "", 1, 1, a.status, code, now),
    )

    # Historial de notificaciones para el circuito
    row = conn.execute(
        "SELECT lat, lng FROM circuits WHERE code = ?",
        (code,),
    ).fetchone()
    lat, lng = (row["lat"], row["lng"]) if row else (None, None)
    # Si el circuito (semilla) no tiene coords, tomar la de sus markers de usuario
    if lat is None or lng is None:
        mp = conn.execute(
            "SELECT lat, lng FROM markers WHERE UPPER(circuit) = ? ORDER BY votes DESC LIMIT 1",
            (code.upper(),),
        ).fetchone()
        if mp:
            lat, lng = mp["lat"], mp["lng"]

    text = a.text or code
    conn.execute(
        "INSERT INTO notifications (circuit, status, text, lat, lng, created_at) VALUES (?,?,?,?,?,?)",
        (code, a.status, text, lat, lng, now),
    )

    # Prune: conservar max ~200 notificaciones de ESTE circuito (sin borrar otros)
    conn.execute(
        "DELETE FROM notifications WHERE circuit = ? AND id NOT IN "
        "(SELECT id FROM notifications WHERE circuit = ? ORDER BY created_at DESC LIMIT 200)",
        (code, code),
    )

    # Puntos de usuario de este circuito (para mostrar el alert sobre todos)
    points = [
        {"id": r["id"], "lat": r["lat"], "lng": r["lng"]}
        for r in conn.execute(
            "SELECT id, lat, lng FROM markers WHERE UPPER(circuit) = ?",
            (code.upper(),),
        ).fetchall()
    ]
    conn.commit()
    conn.close()

    payload = {"type": "alert", "code": code, "status": a.status, "text": text, "time": now, "lat": lat, "lng": lng, "points": points}
    _broadcast(payload)
    log.info(f"Alerta recibida: {code} -> {a.status}")

    # Web Push (fondo / app cerrada): solo a suscripciones que "sueñan" este circuito
    try:
        _push_for_circuit(code, a.status, text)
    except Exception as e:
        log.warning(f"Push fail: {e}")

    return {"ok": True}


def _push_for_circuit(code, status, text):
    title = f"{code}"
    if status == "AFECTADO":
        title = f"🔴 Afectado: {code}"
    elif status == "RESTABLECIDO":
        title = f"🟢 Restablecido: {code}"
    else:
        title = f"ℹ️ Informado: {code}"
    body = (text or code)[:160]
    for sub in pushmod.subscriptions_that_sound_for(code):
        pushmod.send_push_sync(sub, title, body, tag=f"circ-{code}", data={"code": code, "status": status, "time": db._utcnow_iso()})


@app.post("/api/oficial")
async def receive_oficial(o: OficialIn):
    """El bot informa el estado OFICIAL (desde un canal oficial) de un circuito.

    Este estado es el que pinta los puntos en el mapa (verde/rojo) y es persistente
    en BD: el último post de cualquier canal oficial gana. No crea notificaciones
    (el mismo post ya pasa por /api/alert para notificar); solo fija el color.
    """
    code = o.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="code requerido")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    conn = db.get_conn()
    prev = conn.execute(
        "SELECT oficial_status FROM circuits WHERE code = ?", (code,)
    ).fetchone()
    prev_status = prev["oficial_status"] if prev else None
    conn.execute(
        "INSERT INTO circuits (code, name, location, visible, monitor, status, last_event, last_event_time, oficial_status, oficial_time, oficial_source) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(code) DO UPDATE SET "
        "status=excluded.status, last_event=excluded.last_event, last_event_time=excluded.last_event_time, "
        "oficial_status=excluded.oficial_status, oficial_time=excluded.oficial_time, oficial_source=excluded.oficial_source",
        (code, code, "", 1, 1, o.status, code, now, o.status, now, o.source or ""),
    )
    conn.commit()
    conn.close()

    if prev_status != o.status:
        payload = {"type": "oficial", "code": code, "status": o.status, "source": o.source or "", "time": now}
        _broadcast(payload)
        log.info(f"Estado oficial: {code} -> {o.status} (fuente: {o.source or '?'})")
    return {"ok": True, "status": o.status}


@app.get("/api/notifications")
def get_notifications(circuit: Optional[str] = None, limit: int = 50, kind: Optional[str] = None):
    """Historial de notificaciones.
    - circuit: historial de un circuito concreto.
    - kind='municipio': solo avisos sin punto de usuario (pseudo-códigos [Municipio]).
    - kind='point': solo avisos que sí corresponden a un punto de usuario.
    - sin circuit y sin kind: últimas globales.
    """
    conn = db.get_conn()
    if circuit:
        rows = conn.execute(
            "SELECT * FROM notifications WHERE circuit = ? ORDER BY created_at DESC LIMIT ?",
            (circuit, limit),
        ).fetchall()
    elif kind == "municipio":
        rows = conn.execute(
            "SELECT * FROM notifications n WHERE NOT EXISTS ("
            "SELECT 1 FROM markers m WHERE m.circuit IS NOT NULL AND m.circuit != '' AND UPPER(m.circuit) = UPPER(n.circuit)"
            ") ORDER BY n.created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    elif kind == "point":
        rows = conn.execute(
            "SELECT * FROM notifications n WHERE EXISTS ("
            "SELECT 1 FROM markers m WHERE m.circuit IS NOT NULL AND m.circuit != '' AND UPPER(m.circuit) = UPPER(n.circuit)"
            ") ORDER BY n.created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _online_count() -> int:
    return len(subscribers)


def _broadcast_online():
    _broadcast({"type": "online", "count": _online_count()})


@app.get("/api/push/vapid-public-key")
def push_vapid_public():
    return {"key": pushmod.VAPID_PUBLIC_KEY}


@app.post("/api/push/subscribe")
def push_subscribe(p: PushSubscribeIn):
    sub_id = pushmod.upsert_subscription(p.endpoint, p.p256dh, p.auth, p.user_agent)
    if sub_id is None:
        raise HTTPException(status_code=500, detail="no se pudo guardar")
    return {"ok": True, "sub_id": sub_id}


@app.post("/api/push/unsubscribe")
def push_unsubscribe(p: PushSubscribeIn):
    pushmod.delete_subscription(p.endpoint)
    return {"ok": True}


@app.post("/api/push/prefs")
def push_set_pref(p: PushPrefIn):
    pushmod.set_prefs(p.sub_id, p.circuit, p.mode, p.tone)
    return {"ok": True}


@app.get("/api/push/prefs")
def push_get_prefs(sub_id: int):
    return {"prefs": pushmod.get_prefs(sub_id)}


@app.get("/api/events/stream")
async def stream_events():
    """SSE: empuja alertas en tiempo real hacia el frontend."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    subscribers.add(q)
    _broadcast_online()

    async def gen():
        try:
            # Primer byte inmediato: confirma la conexion (onopen) al navegador
            # y a cualquier proxy/CDN intermedio.
            yield f"data: {json.dumps({'type': 'hello', 'status': 'ok', 'count': _online_count()})}\n\n"
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat: comentario SSE que mantiene viva la conexion
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            raise
        finally:
            subscribers.discard(q)
            _broadcast_online()

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/online")
def online():
    return {"online": _online_count()}


@app.get("/")
def index():
    return FileResponse(app.static_root + "/index.html") if hasattr(app, "static_root") else {"msg": "ok"}


def add_monitored(code):
    conn = db.get_conn()
    now = db._utcnow_iso()
    conn.execute(
        "INSERT INTO circuits (code, name, location, visible, monitor, last_event_time) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(code) DO UPDATE SET monitor=1",
        (code, code, "", 1, 1, now),
    )
    conn.commit()
    conn.close()


# Exponer ruta base si existe dist
import os as _os
_static_dir = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "static")
if _os.path.isdir(_static_dir):
    app.static_root = _static_dir
    app.mount("/static", StaticFiles(directory=_static_dir), name="static")
