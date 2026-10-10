"""Estadisticas de los circuitos. SOLO se usan notificaciones oficiales
(source = 'oficial') para calcular caidas, restablecimientos y horas de corte.

Metodologia de horas sin servicio:
- Se recorren los eventos oficiales de un circuito ordenados por created_at.
- Un estado AFECTADO abre un "corte abierto"; un RESTABLECIDO posterior lo cierra.
- La duracion del corte (en horas) se asigna al/os dia/s natural/es que atraviesa.
- horasCorriente_dia = MONITORING_HOURS - horasCorte_dia.
- Un corte que sigue abierto cuenta hasta "ahora".
Los estados INFO se ignoran (no abren ni cierran cortes).
MONITORING_HOURS = 12 (7am-7pm, horario de monitoreo del bot).
"""

import logging
from datetime import datetime, timezone

from . import db

log = logging.getLogger(__name__)

SOURCE_OFFICIAL = "oficial"
MONITORING_HOURS = 12.0  # 7am a 7pm


def _parse_ts(value: str):
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _range_days(range_key):
    return {"7d": 7, "14d": 14, "30d": 30}.get(range_key, 7)


def _fetch_official(range_days):
    """Devuelve las notificaciones oficiales dentro de la ventana de dias."""
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT id, circuit, status, created_at FROM notifications "
        "WHERE source = ? ORDER BY created_at ASC",
        (SOURCE_OFFICIAL,),
    ).fetchall()
    conn.close()

    cutoff = None
    if range_days and range_days > 0:
        cutoff = datetime.now(timezone.utc).timestamp() - range_days * 86400

    out = []
    for r in rows:
        ts = _parse_ts(r["created_at"])
        if ts is None:
            continue
        if cutoff is not None and ts.timestamp() < cutoff:
            continue
        if r["status"] not in ("AFECTADO", "RESTABLECIDO", "INFO"):
            continue
        out.append({"circuit": r["circuit"].strip(), "status": r["status"], "at": ts})
    return out


def _day_key(dt):
    return dt.date().isoformat()


def compute_periods(official_events):
    """Convierte la lista de eventos oficiales de un circuito en periodos de corte.

    Devuelve la lista de periodos: {start, end, hours} donde end puede ser "open".
    """
    periods = []
    open_court = None  # datetime del AFECTADO abierto
    for ev in official_events:
        if ev["status"] == "AFECTADO":
            if open_court is None:
                open_court = ev["at"]
            # si ya habia un corte abierto y llega otro AFECTADO, se mantiene el primero
        elif ev["status"] == "RESTABLECIDO":
            if open_court is not None:
                periods.append({"start": open_court, "end": ev["at"]})
                open_court = None
    # corte abierto pendiente
    if open_court is not None:
        periods.append({"start": open_court, "end": None})
    return periods


def _split_hours_by_day(start, end, now):
    """Reparte horas entre [start, end] por dia natural, recortado a la ventana de monitoreo (7am-7pm).

    end=None = abierto hasta now. Solo cuenta horas dentro de 07:00-19:00 UTC.
    """
    end = end if end is not None else now
    if end <= start:
        return {}
    days = {}
    cur = start
    MONITOR_START = 7  # 7am UTC
    MONITOR_END = 19   # 7pm UTC
    while cur < end:
        day_start = cur.replace(hour=0, minute=0, second=0, microsecond=0)
        day_monitor_start = day_start.replace(hour=MONITOR_START)
        day_monitor_end = day_start.replace(hour=MONITOR_END)
        seg_start = max(cur, day_monitor_start)
        seg_end = min(day_monitor_end, end)
        if seg_end > seg_start:
            h = (seg_end - seg_start).total_seconds() / 3600.0
            k = _day_key(cur)
            days[k] = days.get(k, 0.0) + h
        # avanzar al inicio del dia siguiente
        cur = min(day_start + __import__("datetime").timedelta(days=1), end) if end > day_monitor_end else end
    return days


def _hours_by_day(official_events, now):
    """dict date->horasDeCorte (acumulado), para un circuito dado."""
    periods = compute_periods(official_events)
    acc = {}
    for p in periods:
        for day, h in _split_hours_by_day(p["start"], p["end"], now).items():
            acc[day] = acc.get(day, 0.0) + h
    return acc


def series_for_circuit(circuit, range_key):
    """Series diarias para un circuito (solo oficiales)."""
    range_days = _range_days(range_key)
    events = [e for e in _fetch_official(range_days) if e["circuit"].upper() == circuit.upper()]
    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - range_days * 86400

    by_day = {}
    for e in events:
        k = _day_key(e["at"])
        d = by_day.setdefault(k, {"caidas": 0, "restablecimientos": 0, "info": 0})
        if e["status"] == "AFECTADO":
            d["caidas"] += 1
        elif e["status"] == "RESTABLECIDO":
            d["restablecimientos"] += 1
        else:
            d["info"] += 1

    hours = _hours_by_day(events, now)

    days_out = []
    start_dt = datetime.fromtimestamp(cutoff, tz=timezone.utc)
    for i in range(range_days):
        d = start_dt.date()
        from datetime import timedelta
        d = start_dt.date() + timedelta(days=i)
        k = d.isoformat()
        corte = round(hours.get(k, 0.0), 2)
        dias = _cur_key_has_data(by_day, hours, k)
        entries = by_day.get(k, {})
        hours_day = MONITORING_HOURS - corte
        days_out.append({
            "date": k,
            "caidas": entries.get("caidas", 0),
            "restablecimientos": entries.get("restablecimientos", 0),
            "info": entries.get("info", 0),
            "horasSinServicio": corte,
            "horasCorriente": round(max(hours_day, 0.0), 2),
            "hasData": dias,
        })
    # quitar columnas sin pasado
    days_out = [x for x in days_out if x["hasData"] or x["horasSinServicio"] > 0]

    total_caidas = sum(d["caidas"] for d in days_out)
    total_rest = sum(d["restablecimientos"] for d in days_out)
    total_horas = round(sum(d["horasSinServicio"] for d in days_out), 2)

    # duracion media/max de cortes cerrados
    durations = []
    periods = compute_periods(events)
    for p in periods:
        if p["end"] is None:
            h = (now - p["start"]).total_seconds() / 3600.0
        else:
            h = (p["end"] - p["start"]).total_seconds() / 3600.0
        durations.append(h)
    dur_media = round(sum(durations) / len(durations), 2) if durations else 0.0
    dur_max = round(max(durations), 2) if durations else 0.0

    return {
        "circuit": circuit.upper(),
        "days": days_out,
        "totals": {
            "caidas": total_caidas,
            "restablecimientos": total_rest,
            "horasSinServicio": total_horas,
            "duracionMediaCorte": dur_media,
            "duracionMaxCorte": dur_max,
            "cortes": len(periods),
        },
    }


def _cur_key_has_data(by_day, hours, k):
    return k in by_day or hours.get(k, 0) > 0


def overview(range_key):
    """Resumen global + ranking de circuitos mas afectados (solo oficiales)."""
    range_days = _range_days(range_key)
    events = _fetch_official(range_days)
    now = datetime.now(timezone.utc)

    by_circuit = {}
    for e in events:
        c = by_circuit.setdefault(e["circuit"].upper(), [])
        c.append(e)

    rows = []
    for code, evs in by_circuit.items():
        caidas = sum(1 for e in evs if e["status"] == "AFECTADO")
        rests = sum(1 for e in evs if e["status"] == "RESTABLECIDO")
        info = sum(1 for e in evs if e["status"] == "INFO")
        hours = _hours_by_day(evs, now)
        total_horas = round(sum(hours.values()), 2)

        durations = []
        periods = compute_periods(evs)
        for p in periods:
            h = ((now - p["start"]).total_seconds() / 3600.0) if p["end"] is None else ((p["end"] - p["start"]).total_seconds() / 3600.0)
            durations.append(h)
        rows.append({
            "circuit": code,
            "caidas": caidas,
            "restablecimientos": rests,
            "info": info,
            "horasSinServicio": total_horas,
            "duracionMediaCorte": round(sum(durations) / len(durations), 2) if durations else 0.0,
            "duracionMaxCorte": round(max(durations), 2) if durations else 0.0,
            "cortes": len(periods),
        })

    # ranking por horas sin servicio desc, luego por caidas
    rows.sort(key=lambda r: (-r["horasSinServicio"], -r["caidas"]))

    total_caidas = sum(r["caidas"] for r in rows)
    total_rest = sum(r["restablecimientos"] for r in rows)
    total_info = sum(r["info"] for r in rows)
    total_horas = round(sum(r["horasSinServicio"] for r in rows), 2)
    circuitos_con_datos = len(rows)

    return {
        "range": range_key,
        "totals": {
            "caidas": total_caidas,
            "restablecimientos": total_rest,
            "info": total_info,
            "horasSinServicio": total_horas,
            "circuitos": circuitos_con_datos,
        },
        "circuits": rows,
    }
