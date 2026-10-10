"""Diagnostico: envia un mensaje de prueba con el userbot.

Uso:
    python scripts/diagnostics/test_send_userbot.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, PHONE,
SESSION_NAME, ALERT_GROUP).
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


async def main():
    alert_group = int(os.getenv("ALERT_GROUP", "0"))
    c = Client(
        os.getenv("SESSION_NAME", "circuito_monitor"),
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        phone_number=os.getenv("PHONE", ""),
        workdir=str(ROOT),
    )
    await c.start()
    try:
        chat = await c.get_chat(alert_group)
        print(f"Userbot ve: {chat.title} | id={alert_group} | type={chat.type}")
        sent = await c.send_message(alert_group, "Prueba desde el userbot de Circuito Aviso.")
        print(f"  -> Envio OK msg id {sent.id}")
    except Exception as e:
        print(f"Userbot en {alert_group}: ERROR - {e}")
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
