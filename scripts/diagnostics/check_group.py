"""Diagnostico: verifica que el userbot ve el grupo de alertas.

Uso:
    python scripts/diagnostics/check_group.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, PHONE,
SESSION_NAME, ALERT_GROUP). Ver .env.example.
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
    me = await c.get_me()
    print(f"Userbot: {me.first_name} (@{me.username})")

    try:
        chat = await c.get_chat(int(os.getenv("ALERT_GROUP", "0")))
        print(f"Grupo de alertas: {chat.title} (type={chat.type})")
    except Exception as e:
        print(f"Grupo de alertas: ERROR - {e}")

    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
