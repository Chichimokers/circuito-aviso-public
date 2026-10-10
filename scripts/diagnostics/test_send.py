"""Diagnostico: envia un mensaje de prueba al grupo de alertas con el bot.

Uso:
    python scripts/diagnostics/test_send.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, BOT_TOKEN,
ALERT_GROUP).
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


async def main():
    alert_group = int(os.getenv("ALERT_GROUP", "0"))
    c = Client(
        "check_bot",
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        bot_token=os.getenv("BOT_TOKEN", ""),
    )
    await c.start()
    try:
        sent = await c.send_message(alert_group, "Mensaje de prueba del bot de Circuito Aviso.")
        print(f"Envio OK -> msg id {sent.id}")
    except Exception as e:
        print(f"ERROR envio: {e}")
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
