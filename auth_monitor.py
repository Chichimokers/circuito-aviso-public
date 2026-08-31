"""Autenticar la sesion del monitor por primera vez.
Ejecutar: python auth_monitor.py
Te pedira el codigo que Telegram envia a tu app.
"""
import asyncio
from pyrogram import Client
from dotenv import load_dotenv
import os

load_dotenv()

async def main():
    c = Client(
        os.getenv("SESSION_NAME", "circuito_monitor"),
        api_id=int(os.getenv("API_ID")),
        api_hash=os.getenv("API_HASH"),
        phone_number=os.getenv("PHONE"),
        workdir=".",
    )
    await c.start()
    me = await c.get_me()
    print(f"\nAUTENTICADO: {me.first_name} (@{me.username}) ID: {me.id}")
    await c.stop()

if __name__ == "__main__":
    asyncio.run(main())
