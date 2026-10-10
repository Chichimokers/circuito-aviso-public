# Scripts de utilidad

Herramientas de diagnóstico y mantenimiento. **No** forman parte del runtime de
producción; se ejecutan manualmente para depurar o administrar el despliegue.

Todas leen la configuración del archivo `.env` en la raíz del proyecto
(ver `.env.example`). Nunca hardcodees credenciales en estos scripts.

## `diagnostics/`

Requieren las credenciales de Telegram del monitor (`API_ID`, `API_HASH`,
`PHONE`, `BOT_TOKEN`, `WATCH_GROUPS`, `ALERT_GROUP`).

| Script | Descripción |
|--------|-------------|
| `check_bot.py` | Verifica que el bot puede conectarse y acceder al grupo de alertas. |
| `check_group.py` | Verifica que el userbot ve el grupo de alertas. |
| `check_dialogs.py` | Lista los diálogos accesibles por el bot. |
| `check_both_groups.py` | Membresía del bot en los grupos monitorizados y de alertas. |
| `fetch_messages.py` | Vuelca los últimos mensajes de los grupos monitorizados (para afinar keywords). |
| `find_group.py` | Busca un grupo por título entre los diálogos del userbot. |
| `list_dialogs.py` | Lista grupos y canales del userbot. |
| `test_send.py` | Envía un mensaje de prueba al grupo de alertas con el bot. |
| `test_send_userbot.py` | Envía un mensaje de prueba con el userbot. |

```bash
python scripts/diagnostics/check_bot.py
python scripts/diagnostics/find_group.py "Informacion Luz"
```

## `maintenance/`

| Script | Descripción |
|--------|-------------|
| `cleanup_db.py` | Elimina marcadores de usuario y circuitos huérfanos de la BD. |
| `insert_nginx.py` | Inserta el snippet de nginx dentro de una config existente. |

```bash
python scripts/maintenance/cleanup_db.py
python scripts/maintenance/insert_nginx.py /etc/nginx/conf.d/site.conf circuito-web/nginx_circuito.conf
```

## `tests/`

Pruebas manuales contra una instancia local del backend (por defecto
`http://127.0.0.1:8781`).

| Script | Descripción |
|--------|-------------|
| `test_api.py` | Prueba endpoints públicos (alertas, markers, codes). |
| `test_admin.py` | Prueba las operaciones protegidas con `ADMIN_KEY`. |
