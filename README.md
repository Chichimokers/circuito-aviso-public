# ⚡ Circuito Aviso

Mapa colaborativo en tiempo real que monitorea los **circuitos eléctricos de Cuba** (afectaciones y restablecimientos del servicio). Los avisos llegan desde grupos de Telegram mediante un bot userbot, y se publican al instante en un mapa web interactivo con notificaciones, sonidos, validación comunitaria e histórico.

> **En producción:** https://inventory.cloudns.be/circuitos/

---

## ✨ Características

- **Alertas en tiempo real** — Los avisos de Telegram (afectado / restablecido) aparecen al instante en el mapa vía **Server-Sent Events (SSE)**, sin recargar.
- **Mapa interactivo** — Mapa Leaflet con marcadores por circuito, colores por estado y popups con detalle.
- **Presencia en vivo** — Contador de "personas en línea" con avatares, para ver cuántos están viendo el mapa ahora.
- **Validación comunitaria** — Los usuarios pueden votar/confirmar el estado de un circuito (X votos validan un aviso).
- **Notificaciones y sonidos** — Toast flotantes, sonidos configurables **por circuito** (predefinidos y personalizados con IndexedDB), y badge de pendientes.
- **Historial** — Registro persistente de avisos por circuito con vista detallada.
- **Municipios / zonas** — Avisos generales sin punto específico (ej. Boyeros), con panel de "zona" y refuerzo visual.
- **UI moderna** — Tema claro, iconos [lucide-react](https://lucide.dev), diseño adaptable a móvil.
- **Persistencia** — Backend **FastAPI** + **SQLite**, con `nginx` como proxy y servido de estáticos.

---

## 🏗️ Arquitectura

```
Monitor de Telegram  ──HTTP──▶  FastAPI (:8781)  ◀──SSE───  Frontend React
 (bot userbot)                    │  SQLite               (Leaflet + Vite)
                       nginx /circuitos-api/  ──▶  navegador
```

| Capa | Tecnología |
|------|-----------|
| Monitor de Telegram | Python · [kurigram](https://github.com/nteuev/kurigram) (MTProto userbot) |
| Backend (API + SSE) | Python · FastAPI · Uvicorn |
| Base de datos | SQLite |
| Frontend | React 18 · Vite · Leaflet / react-leaflet · lucide-react |
| Reverse proxy / estáticos | nginx |

- **`monitor_bot.py`** — Escucha grupos de Telegram, detecta códigos de circuito y municipios en los mensajes, aplica deduplicación y envía el aviso normalizado al backend (`/api/alert`).
- **`circuito-web/app/`** — API REST + flujo SSE en tiempo real.
- **`circuito-web/frontend/`** — Aplicación web (SPA) del mapa.

---

## 📁 Estructura del proyecto

```
circuito-aviso/
├── monitor_bot.py              # Bot userbot que vigila grupos de Telegram
├── auth_monitor.py             # Autorización/login del userbot
├── requirements.txt            # Dependencias del monitor
├── circuito-web/
│   ├── app/                    # Backend FastAPI
│   │   ├── main.py             # API REST + eventos SSE
│   │   ├── config.py           # Configuración (puerto, admin key, rutas)
│   │   └── db.py               # Acceso a SQLite
│   ├── config/circuits.json    # Circuitos semilla y coordenadas
│   ├── frontend/               # SPA React (Vite)
│   │   └── src/
│   │       ├── App.jsx         # Componente principal
│   │       ├── hooks/useRealtime.js  # Cliente SSE con reconexión
│   │       └── styles.css
│   ├── nginx_circuito.conf     # Config de nginx (proxy + estáticos)
│   └── requirements.txt        # Dependencias del backend
└── .env                        # Secretos (NO versionado)
```

---

## 🧰 Requisitos

- Python 3.10+
- Node.js 18+ (solo para construir el frontend)
- nginx (para el despliegue de producción)
- Una cuenta de Telegram para el userbot y credenciales de la [API de Telegram](https://my.telegram.org)

---

## ⚙️ Configuración

### Monitor (`monitor_bot.py`)

Crea un archivo `.env` con:

```env
# API de Telegram (https://my.telegram.org)
API_ID=123456
API_HASH=tu_api_hash
PHONE=+5355555555
SESSION_NAME=circuito_monitor

# Grupos a monitorear (separados por coma)
WATCH_GROUPS=-1001234567890

# Grupo destino para alertas
ALERT_GROUP=-1001234567890

# Códigos que activan alerta inmediata (separados por coma)
ALERT_CODES=C0001,C0002

# Códigos que reenvían el mensaje original + tag a todos (separados por coma)
FORWARD_CODES=C0003

# Municipios a detectar por nombre (separados por coma)
WATCH_MUNICIPALITIES=Boyeros,Cenpalab
```

### Backend (`circuito-web/app/`)

```env
PORT=8781
ADMIN_KEY=clave_administrativa   # para operaciones protegidas (borrar markers, etc.)
```

---

## 🚀 Ejecución local

### Monitor

```bash
pip install -r requirements.txt
python auth_monitor.py    # primer arranque: iniciar sesión
python monitor_bot.py
```

### Backend

```bash
cd circuito-web
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8781
```

### Frontend

```bash
cd circuito-web/frontend
npm install
npm run dev        # entorno de desarrollo
npm run build      # producción (Vite → dist/static)
```

---

## 🔌 API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/health` | Estado del servicio |
| `GET` | `/api/codes` | Códigos/circuitos monitoreados |
| `GET` | `/api/circuits` | Circuitos semilla |
| `GET` | `/api/markers` | Lista de marcadores de usuario |
| `POST` | `/api/markers` | Crear un marcador / punto de usuario |
| `POST` | `/api/markers/vote` | Votar / validar el estado de un circuito |
| `DELETE` | `/api/markers/{id}` | Eliminar un marcador (requiere `X-Admin-Key`) |
| `POST` | `/api/admin/verify` | Verificar clave administrativa |
| `POST` | `/api/alert` | Recibir un aviso (usado por el monitor) |
| `GET` | `/api/notifications` | Historial de avisos (`kind=alert\|municipio\|point`) |
| `GET` | `/api/events/stream` | Flujo **SSE** en tiempo real (alertas, markers, presencia `online`) |
| `GET` | `/api/online` | Conteo de conexiones activas |

### Formato de eventos SSE

```json
// Conexión inicial
data: {"type": "hello", "status": "ok", "count": 4}

// Cambio de presencia
data: {"type": "online", "count": 4}

// Nueva alerta
data: {"type": "alert", "code": "C0001", "status": "afectado", "text": "...", "time": "...", "points": []}

// Alta / baja / voto de marcador
data: {"type": "marker_new"}
data: {"type": "marker_del"}
data: {"type": "marker_vote"}
```

---

## ☁️ Despliegue (VPS con nginx)

1. Coloca el backend en `/opt/circuito-web` y corre el servicio (p. ej. con `systemd`).
2. Construye el frontend y deja los estáticos en `/opt/circuito-web/static`.
3. Aplica la config de nginx (`nginx_circuito.conf`): sirve los estáticos en `/circuitos/` y hace proxy a la API en `/circuitos-api/`.
4. Ejecuta el monitor (`monitor_bot.py`) conectado a la cuenta de Telegram.

---

## 🛡️ Seguridad

- Las claves/secrets se leen de variables de entorno (`.env`), **nunca** se versionan.
- Las operaciones destructivas del API requieren `X-Admin-Key`.
- La presencia muestra solo **conteo agregado y anónimo**, sin datos personales de los usuarios.

---

## 📄 Licencia

Privado / uso interno. Proyecto de comunidad.

---

_Hecho con ❤️ para la comunidad cubana._
