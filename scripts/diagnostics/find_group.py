"""Diagnostico: busca un grupo por titulo entre los dialogos del userbot.

Uso:
    python scripts/diagnostics/find_group.py "Informacion Luz"

Requiere las variables de entorno del monitor (API_ID, API_HASH, PHONE,
SESSION_NAME).
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
    term = (sys.argv[1] if len(sys.argv) > 1 else "informacion").lower()

    c = Client(
        os.getenv("SESSION_NAME", "circuito_monitor"),
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        phone_number=os.getenv("PHONE", ""),
        workdir=str(ROOT),
    )
    await c.start()
    print(f"Buscando '{term}' en dialogos del userbot...")
    found = 0
    async for d in c.get_dialogs():
        title = d.chat.title or ""
        if term in title.lower():
            print(f"MATCH: {title} | id={d.chat.id} | type={d.chat.type}")
            found += 1
    if found == 0:
        print("Sin coincidencias. Listando todos los grupos:")
        async for d in c.get_dialogs():
            if d.chat.type in ("group", "supergroup"):
                print(f"  GPO: {d.chat.title} | id={d.chat.id}")
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
