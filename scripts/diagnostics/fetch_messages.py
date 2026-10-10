"""Diagnostico: vuelca los ultimos mensajes de los grupos monitorizados.

Util para afinar las palabras clave de deteccion (AFECTADO / RESTABLECIDO).

Uso:
    python scripts/diagnostics/fetch_messages.py [limite]

Requiere las variables de entorno del monitor (API_ID, API_HASH, PHONE,
SESSION_NAME, WATCH_GROUPS).
"""
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


async def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    groups = [int(x) for x in os.getenv("WATCH_GROUPS", "").split(",") if x.strip()]

    c = Client(
        os.getenv("SESSION_NAME", "circuito_monitor"),
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        phone_number=os.getenv("PHONE", ""),
        workdir=str(ROOT),
    )
    await c.start()
    for gid in groups:
        try:
            chat = await c.get_chat(gid)
            print(f"=== {chat.title} ({gid}) ===")
            count = 0
            async for msg in c.get_chat_history(gid, limit=limit):
                txt = msg.text or msg.caption or ""
                if txt:
                    fwd = ""
                    if msg.forward_from_chat:
                        fwd = f" [fwd from {msg.forward_from_chat.title}]"
                    print(f"--- msg {msg.id}{fwd} ---")
                    print(txt[:1200])
                    print()
                    count += 1
            print(f"Total mensajes con texto: {count}")
        except Exception as e:
            print(f"Error en {gid}: {e}")
        print()
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
