"""Diagnostico: membresia del bot en los grupos monitorizados y de alertas.

Uso:
    python scripts/diagnostics/check_both_groups.py

Requiere las variables de entorno del monitor (API_ID, API_HASH, BOT_TOKEN,
WATCH_GROUPS, ALERT_GROUP).
"""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from pyrogram import Client

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


async def main():
    watch = [int(x) for x in os.getenv("WATCH_GROUPS", "").split(",") if x.strip()]
    alert = os.getenv("ALERT_GROUP", "0")
    groups = watch + ([int(alert)] if alert and alert != "0" else [])

    c = Client(
        "check_bot",
        api_id=int(os.getenv("API_ID", "0")),
        api_hash=os.getenv("API_HASH", ""),
        bot_token=os.getenv("BOT_TOKEN", ""),
    )
    await c.start()
    me = await c.get_me()
    for gid in groups:
        try:
            chat = await c.get_chat(gid)
            member = await c.get_chat_member(gid, me.id)
            print(f"{chat.title} ({gid}): {member.status}")
        except Exception as e:
            print(f"{gid}: ERROR {e}")
    await c.stop()


if __name__ == "__main__":
    asyncio.run(main())
