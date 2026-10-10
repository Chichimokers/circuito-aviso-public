"""Diagnostico: lista los grupos y canales del userbot.

Uso:
    python scripts/diagnostics/list_dialogs.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, PHONE,
SESSION_NAME).
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


async def main():
    c = Client(
        os.getenv("SESSION_NAME", "circuito_monitor"),
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        phone_number=os.getenv("PHONE", ""),
        workdir=str(ROOT),
    )
    await c.start()
    print("=== Dialogos del userbot (grupos / canales) ===")
    async for d in c.get_dialogs():
        if d.chat.type in ("group", "supergroup", "channel"):
            print(f"  {d.chat.title} | id={d.chat.id} | type={d.chat.type}")
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
