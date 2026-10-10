"""Diagnostico: lista los dialogos accesibles por el bot de alertas.

Uso:
    python scripts/diagnostics/check_dialogs.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, BOT_TOKEN).
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


async def main():
    c = Client(
        "check_bot",
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        bot_token=os.getenv("BOT_TOKEN", ""),
    )
    await c.start()
    me = await c.get_me()
    print(f"Bot: {me.first_name} (@{me.username}) ID: {me.id}")

    async for dialog in c.get_dialogs():
        print(f"Dialogo: {dialog.chat.title} ({dialog.chat.id}) type={dialog.chat.type}")

    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
