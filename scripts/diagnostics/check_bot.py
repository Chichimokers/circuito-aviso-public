"""Diagnostico: verifica que el bot de alertas puede conectarse y acceder al
grupo de alertas.

Uso:
    python scripts/diagnostics/check_bot.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, BOT_TOKEN,
ALERT_GROUP). Ver .env.example.
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


async def main():
    api_id = int(os.getenv("API_ID", "0"))
    api_hash = os.getenv("API_HASH", "")
    bot_token = os.getenv("BOT_TOKEN", "")
    alert_group = int(os.getenv("ALERT_GROUP", "0"))

    c = Client("check_bot", api_id=api_id, api_hash=api_hash, bot_token=bot_token)
    await c.start()
    me = await c.get_me()
    print(f"Bot: {me.first_name} (@{me.username}) ID: {me.id}")

    try:
        chat = await c.get_chat(alert_group)
        member = await c.get_chat_member(alert_group, me.id)
        print(f"Grupo {chat.title} ({alert_group}): {member.status}")
    except Exception as e:
        print(f"Grupo {alert_group}: ERROR - {e}")

    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
