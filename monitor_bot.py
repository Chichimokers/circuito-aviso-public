# -*- coding: utf-8 -*-
import os
import re
import json
import time
import asyncio
import logging
import urllib.request
from datetime import datetime, timedelta
from pyrogram import Client, filters
from pyrogram.types import Message
from pyrogram.handlers import MessageHandler
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")
PHONE = os.getenv("PHONE")
SESSION_NAME = os.getenv("SESSION_NAME", "circuito_monitor")
BOT_TOKEN = os.getenv("BOT_TOKEN")

WATCH_GROUPS = [int(x.strip()) for x in os.getenv("WATCH_GROUPS", "").split(",") if x.strip()]
ALERT_GROUP = int(os.getenv("ALERT_GROUP", "0"))
WATCH_MUNICIPALITIES = [x.strip() for x in os.getenv("WATCH_MUNICIPALITIES", "").split(",") if x.strip()]

# Canales oficiales: sus posts generan notificaciones NORMALES y ADEMAS
# fijan el color persistente (verde/rojo) de los puntos (post mas reciente gana).
OFFICIAL_CHANNELS = [x.strip().lstrip("@") for x in os.getenv("OFFICIAL_CHANNELS", "").split(",") if x.strip()]
official_chat_ids: set = set()

STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stats.json")

# Backend web (lista dinamica de circuitos + registro de eventos)
WEB_API = os.getenv("WEB_API", "http://127.0.0.1:8781")
CODES_REFRESH = int(os.getenv("CODES_REFRESH", "60"))  # segundos

# Lista de circuitos a monitorear, obtenida dinamicamente del backend.
# = circuitos base de la BD (ej. M2044 invisible) + circuitos de puntos de usuarios.
monitored_codes: list = []
known_codes: set = set()


def _http_json(path, method="GET", payload=None, timeout=8):
    """Llama a la API web y devuelve dict/list o None en error."""
    url = WEB_API + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log.warning(f"API {method} {path}: {e}")
        return None


def fetch_monitored_codes():
    """Actualiza la lista de circuitos a monitorear desde el backend."""
    global monitored_codes, known_codes
    res = _http_json("/api/codes")
    if res and isinstance(res, dict) and "codes" in res:
        new_list = [str(c) for c in res["codes"] if str(c).strip()]
        # detectar codigos nuevos -> anunciar en Telegram
        if known_codes:
            new_codes = [c for c in new_list if c not in known_codes]
            for nc in new_codes:
                log.info(f"Nuevo circuito detectado: {nc}")
                _announce_new_circuit(nc)
        known_codes = set(new_list)
        monitored_codes = new_list
        log.info(f"Circuitos a monitorear ({len(monitored_codes)}): {monitored_codes}")
        return monitored_codes
    return monitored_codes


def _announce_new_circuit(code):
    """Anuncia en el canal de alerta un circuito nuevo (punto creado por usuario)."""
    async def _do():
        try:
            await bot.send_message(ALERT_GROUP, f"\U0001F195 Nuevo circuito monitoreado: **{code}**")
        except Exception as e:
            log.warning(f"Error anuncio nuevo circuito {code}: {e}")
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(_do())
    except Exception:
        pass


async def _periodic_refresh():
    while True:
        await asyncio.sleep(CODES_REFRESH)
        try:
            fetch_monitored_codes()
        except Exception as e:
            log.warning(f"Error refresh codigos: {e}")

_location_cache = {}
_location_cache_time = 0

def _circuit_location(code):
    """Devuelve la ubicacion de un circuito desde el backend (cacheada cada 5 min)."""
    global _location_cache, _location_cache_time
    now = time.time()
    if not _location_cache or now - _location_cache_time > 300:
        res = _http_json("/api/circuits")
        if res and isinstance(res, list):
            _location_cache = {str(c["code"]): c.get("location", "") for c in res}
            _location_cache_time = now
    return _location_cache.get(code, "")

AFFECT_KEYWORDS = [
    "se afect", "afectando", "se localiza aver", "localiza aver",
    "deficit", "disparo", "rotura", "partido", "danado",
    "se afecto", "se afecta", "sin servicio", "sin corriente",
    "sin luz", "se fue la luz", "se quedo sin",
]

RESTORE_KEYWORDS = [
    "restablecido", "queda restablecido", "queda el servicio",
    "restablecer", "se restablece", "ya hay luz",
]

app = Client(SESSION_NAME, api_id=API_ID, api_hash=API_HASH,
             phone_number=PHONE, workdir=os.path.dirname(os.path.abspath(__file__)))

bot = Client("alert_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN,
             workdir=os.path.dirname(os.path.abspath(__file__)))

hourly_events = []

recent_alerts = {}

DEDUP_WINDOW = 600  # segundos

def _load_stats():
    try:
        with open(STATS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"total": 0, "afectado": 0, "restablecido": 0, "by_code": {}, "by_municipality": {}, "by_hour": {}}

def _save_stats(stats):
    try:
        with open(STATS_FILE, "w") as f:
            json.dump(stats, f, indent=2)
    except Exception as e:
        log.warning(f"Error guardando stats: {e}")

def _record_event(code, status, municipality):
    stats = _load_stats()
    stats["total"] = stats.get("total", 0) + 1
    if status == "AFECTADO":
        stats["afectado"] = stats.get("afectado", 0) + 1
    elif status == "RESTABLECIDO":
        stats["restablecido"] = stats.get("restablecido", 0) + 1
    by_code = stats.setdefault("by_code", {})
    cs = by_code.setdefault(code, {"afectado": 0, "restablecido": 0})
    if status == "AFECTADO":
        cs["afectado"] += 1
    elif status == "RESTABLECIDO":
        cs["restablecido"] += 1
    if municipality:
        by_muni = stats.setdefault("by_municipality", {})
        ms = by_muni.setdefault(municipality, {"afectado": 0, "restablecido": 0})
        if status == "AFECTADO":
            ms["afectado"] += 1
        elif status == "RESTABLECIDO":
            ms["restablecido"] += 1
    hk = datetime.now().strftime("%H:00")
    by_hour = stats.setdefault("by_hour", {})
    by_hour[hk] = by_hour.get(hk, 0) + 1
    _save_stats(stats)
    hourly_events.append({"code": code, "status": status, "municipality": municipality, "time": datetime.now().isoformat()})

def _detect_status(text):
    t = text.lower()
    for kw in RESTORE_KEYWORDS:
        if kw in t:
            return "RESTABLECIDO"
    for kw in AFFECT_KEYWORDS:
        if kw in t:
            return "AFECTADO"
    return "INFO"

def _extract_municipality(text, muni_match=None):
    return muni_match or ""

def _find_matching_codes(text):
    t = text.upper()
    return [code for code in monitored_codes if code.upper() in t]

def _check_municipality_match(text):
    t_lower = text.lower()
    for muni in WATCH_MUNICIPALITIES:
        if muni.lower() in t_lower:
            return muni
    return None

def _dedup_key(matched, muni_match, status, txt):
    return status + "|" + "|".join(sorted(matched)) + "|" + (muni_match or "") + "|" + txt.strip()[:300]

def _is_duplicate(matched, muni_match, status, txt):
    key = _dedup_key(matched, muni_match, status, txt)
    now = time.time()
    if key in recent_alerts and now - recent_alerts[key] < DEDUP_WINDOW:
        return True
    recent_alerts[key] = now
    for k in list(recent_alerts.keys()):
        if now - recent_alerts[k] > DEDUP_WINDOW:
            del recent_alerts[k]
    return False

def _build_alert_text(codes, status, municipality, sender_name, chat_title, msg_id, chat_id, msg_text, time_str):
    if status == "RESTABLECIDO":
        icon, action = "\U0001f7e2", "RESTABLECIDO"
    elif status == "AFECTADO":
        icon, action = "\U0001f534", "AFECTADO"
    else:
        icon, action = "\u2139\ufe0f", "INFORMADO"
    clean_id = str(chat_id).replace("-100", "")
    link = f"https://t.me/c/{clean_id}/{msg_id}"

    if len(codes) > 1:
        header = f"{icon} **{action}: {len(codes)} circuitos**"
    else:
        header = f"{icon} **{action}: {codes[0]}**"
    if municipality:
        header += f" ({municipality})"

    lines = [header, ""]

    if len(codes) > 1:
        for code in codes:
            location = _circuit_location(code)
            if location:
                lines.append(f"  \u2022 **{code}:** {location}")
            else:
                lines.append(f"  \u2022 **{code}**")
        lines.append("")
    else:
        location = _circuit_location(codes[0])
        if location:
            lines.append(f"**Ubicacion:** {location}")
            lines.append("")

    lines.extend([
        f"**Grupo:** {chat_title}",
        f"**De:** {sender_name}",
        f"**Hora:** {time_str}",
        f"**Link:** [Ir al mensaje]({link})", "",
        "**Mensaje original:**", msg_text[:2500],
    ])
    return "\n".join(lines)

async def _send_alert(msg, codes, muni_match=None):
    txt = msg.text or msg.caption or ""
    status = _detect_status(txt)
    municipality = _extract_municipality(txt, muni_match)
    sender = msg.from_user
    sender_name = sender.first_name if sender else "Desconocido"
    chat_title = msg.chat.title or str(msg.chat.id)
    time_str = msg.date.strftime("%Y-%m-%d %H:%M:%S") if msg.date else ""
    codes_to_alert = list(codes)
    if not codes_to_alert:
        codes_to_alert = [f"[{municipality}]"] if municipality else [f"[{chat_title}]"]
    for code in codes_to_alert:
        _record_event(code, status, municipality)
    alert = _build_alert_text(codes_to_alert, status, municipality, sender_name, chat_title, msg.id, msg.chat.id, txt, time_str)
    try:
        await bot.send_message(ALERT_GROUP, alert)
        log.info(f"Alerta: {codes_to_alert} -> {status} en {chat_title}")
    except Exception as e:
        log.error(f"Error alerta {codes_to_alert}: {e}")
    # Notificar al backend web (para notificacion flotante en el mapa)
    for code in codes_to_alert:
        clean_code = code.strip("[]")
        location = _circuit_location(clean_code)
        _http_json("/api/alert", method="POST",
                   payload={"code": clean_code, "status": status, "location": location, "text": txt}, timeout=6)

async def _on_official_channel(client, msg):
    """Post de un canal oficial. Solo se procesa si lo escribio el canal mismo.

    - Genera la notificacion NORMAL (igual que los grupos): /api/alert -> toasts, badge, historial.
    - Ademas fija el color persistente del punto: /api/oficial (post mas reciente gana).
    """
    txt = msg.text or msg.caption or ""
    if not txt:
        return
    # Solo posts escritos por el propio canal (no comentarios/reenvios de usuarios).
    # Un post llega como msg.chat == canal, o por un grupo vinculado donde
    # msg.sender_chat es el canal. Comentarios de usuarios traen from_user.
    sender_id = (msg.sender_chat.id if msg.sender_chat else None)
    is_official_post = (
        (msg.chat.id in official_chat_ids or sender_id in official_chat_ids)
        and (msg.from_user is None or sender_id in official_chat_ids)
    )
    if not is_official_post:
        return
    matched = _find_matching_codes(txt)
    muni_match = _check_municipality_match(txt)
    status = _detect_status(txt)
    if not matched and not muni_match:
        return
    log.info(f"[OFICIAL] {msg.chat.title or msg.chat.username}: {matched} muni={muni_match} -> {status}")
    # Notificacion normal (+ /api/alert internamente)
    await _send_alert(msg, matched, muni_match)
    # Color persistente para cada circuito mencionado
    source = msg.chat.title or msg.chat.username or ""
    for code in matched:
        clean = code.strip("[]")
        _http_json("/api/oficial", method="POST",
                   payload={"code": clean, "status": status, "source": source}, timeout=6)


# Usuario que se taguea (en vez de taguear a todo el grupo)
SPECIAL_TAG = os.getenv("SPECIAL_TAG", "@Ramsomware1575")
# Circuitos que disparan el tagueo especial
TAG_CIRCUITS = [x.strip().upper() for x in os.getenv("TAG_CIRCUITS", "M2044,D1190,A1496").split(",") if x.strip()]


async def _send_tags(codes=None):
    try:
        codes = [str(c).strip().upper() for c in (codes or [])]
        if not any(c in TAG_CIRCUITS for c in codes):
            return
        await bot.send_message(ALERT_GROUP, SPECIAL_TAG)
    except Exception as e:
        log.warning(f"Error tags: {e}")

async def _hourly_summary():
    while True:
        await asyncio.sleep(3600)
        try:
            now = datetime.now()
            hour_ago = now - timedelta(hours=1)
            events = [e for e in hourly_events if datetime.fromisoformat(e["time"]) >= hour_ago]
            if not events:
                hourly_events.clear()
                continue
            afectados = [e for e in events if e["status"] == "AFECTADO"]
            restablecidos = [e for e in events if e["status"] == "RESTABLECIDO"]
            lines = ["**RESUMEN HORARIO**", f"{hour_ago.strftime('%H:%M')} - {now.strftime('%H:%M')}", ""]
            if afectados:
                lines.append("**AFECTADOS:**")
                cc = {}
                for e in afectados:
                    cc[e["code"]] = cc.get(e["code"], 0) + 1
                for code, count in sorted(cc.items(), key=lambda x: -x[1]):
                    loc = _circuit_location(code)
                    line = f"  {code}"
                    if loc:
                        line += f" ({loc[:50]})"
                    line += f" -- {count} vez(es)"
                    lines.append(line)
                lines.append("")
            if restablecidos:
                lines.append("**RESTABLECIDOS:**")
                cc = {}
                for e in restablecidos:
                    cc[e["code"]] = cc.get(e["code"], 0) + 1
                for code, count in sorted(cc.items(), key=lambda x: -x[1]):
                    loc = _circuit_location(code)
                    line = f"  {code}"
                    if loc:
                        line += f" ({loc[:50]})"
                    line += f" -- {count} vez(es)"
                    lines.append(line)
                lines.append("")
            lines.append(f"**Total: {len(events)} eventos**")
            await bot.send_message(ALERT_GROUP, "\n".join(lines))
            hourly_events.clear()
        except Exception as e:
            log.error(f"Error resumen: {e}")

def _build_statics():
    stats = _load_stats()
    now = datetime.now()
    lines = ["**ESTADISTICAS**", f"Desde: {now.strftime('%Y-%m-%d')}", "",
        f"**Total: {stats.get('total', 0)}**",
        f"  Red: {stats.get('afectado', 0)}", f"  Verde: {stats.get('restablecido', 0)}", ""]
    by_code = stats.get("by_code", {})
    if by_code:
        lines.append("**Por codigo:**")
        for code, data in sorted(by_code.items(), key=lambda x: -(x[1].get("afectado", 0) + x[1].get("restablecido", 0))):
            a = data.get('afectado', 0)
            r = data.get('restablecido', 0)
            loc = _circuit_location(code)
            line = f"  {code}"
            if loc:
                line += f" ({loc[:40]})"
            line += f": {a} afect / {r} restablec"
            lines.append(line)
        lines.append("")
    by_muni = stats.get("by_municipality", {})
    if by_muni:
        lines.append("**Por municipio:**")
        for muni, data in sorted(by_muni.items(), key=lambda x: -(x[1].get("afectado", 0) + x[1].get("restablecido", 0))):
            lines.append(f"  {muni}: {data.get('afectado',0) + data.get('restablecido',0)} eventos")
        lines.append("")
    by_hour = stats.get("by_hour", {})
    if by_hour:
        peak = max(by_hour, key=by_hour.get)
        lines.append(f"**Hora pico:** {peak} ({by_hour[peak]} eventos)")
    return "\n".join(lines)

@app.on_message(filters.chat(WATCH_GROUPS))
async def on_monitored_message(client, msg):
    # Los posts de canales oficiales (aunque entren por un grupo vinculado en
    # WATCH_GROUPS) los maneja _on_official_channel: aqui solo se ignoran para
    # no notificar dos veces. El color solo lo cambia el canal oficial.
    if official_chat_ids:
        _s_id = (msg.sender_chat.id if msg.sender_chat else None)
        if msg.chat.id in official_chat_ids or _s_id in official_chat_ids:
            return
    txt = msg.text or msg.caption or ""
    if not txt:
        return
    matched = _find_matching_codes(txt)
    muni_match = _check_municipality_match(txt)
    if not matched and not muni_match:
        return
    status = _detect_status(txt)
    if _is_duplicate(matched, muni_match, status, txt):
        log.info(f"Duplicado ignorado: {matched} -> {status} en {msg.chat.title}")
        return
    log.info(f"Detectado: {matched} muni={muni_match} -> {status} en {msg.chat.title}")
    asyncio.create_task(_send_alert(msg, matched, muni_match))
    asyncio.create_task(_send_tags(matched))

@bot.on_message(filters.chat(ALERT_GROUP) & filters.command(["statics"]))
async def on_statics(client, msg):
    await bot.send_message(ALERT_GROUP, _build_statics())

@app.on_start()
async def on_start(client):
    me = await client.get_me()
    log.info(f"Userbot: {me.first_name} (@{me.username})")
    await bot.start()
    bot_me = await bot.get_me()
    log.info(f"Bot: {bot_me.first_name} (@{bot_me.username})")
    log.info(f"Monitoreando: {WATCH_GROUPS}")
    log.info(f"Alertas a: {ALERT_GROUP}")
    fetch_monitored_codes()
    log.info(f"Municipios: {WATCH_MUNICIPALITIES}")
    log.info(f"Canales oficiales: {OFFICIAL_CHANNELS}")
    # Resolver username -> id de cada canal oficial (post mas reciente gana)
    for uname in OFFICIAL_CHANNELS:
        try:
            chat = await app.get_chat(uname)
            official_chat_ids.add(chat.id)
            log.info(f"Canal oficial registrado: {uname} -> {chat.id} ({chat.title})")
        except Exception as e:
            log.warning(f"No se pudo registrar canal oficial {uname}: {e}")
    # El handler oficial vigila los canales oficiales y los chats de WATCH_GROUPS:
    # los posts del canal pueden entrar directo, o replicados en un grupo de
    # discusion vinculado (que suele estar en WATCH_GROUPS). La validacion
    # interna distingue si el post es del canal oficial (sender_chat/chat id).
    if official_chat_ids:
        official_scope = list(set(WATCH_GROUPS + list(official_chat_ids)))
        app.add_handler(MessageHandler(_on_official_channel, filters.chat(official_scope)))
        log.info(f"Handler oficial vigila: {official_scope}")
    asyncio.create_task(_hourly_summary())
    asyncio.create_task(_periodic_refresh())

if __name__ == "__main__":
    log.info("Iniciando monitor de circuito...")
    app.run()
