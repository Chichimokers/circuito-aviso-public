# Circuito Aviso

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Node](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%2018-61dafb.svg)](https://react.dev/)

Mapa colaborativo en tiempo real que monitorea los **circuitos eléctricos de
Cuba**: afectaciones y restablecimientos del servicio. Los avisos llegan desde
grupos y canales oficiales de Telegram mediante un userbot, y se publican al
instante en un mapa web interactivo con notificaciones, sonidos, validación
comunitaria, historial y un panel de estadísticas.

> Demo en producción: **https://inventory.cloudns.be/circuitos/**

---

## Tabla de contenidos

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Configuración](#configuración)
- [Ejecución local](#ejecución-local)
- [Despliegue en producción](#despliegue-en-producción)
- [Referencia de la API](#referencia-de-la-api)
- [Eventos en tiempo real (SSE)](#eventos-en-tiempo-real-sse)
- [Web Push (VAPID)](#web-push-vapid)
- [Metodología de las estadísticas](#metodología-de-las-estadísticas)
- [Seguridad](#seguridad)
- [Scripts de utilidad](#scripts-de-utilidad)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

---

## Características

### Tiempo real

- **Alertas instantáneas** — los avisos (afectado / restablecido) aparecen sin
  recargar mediante **Server-Sent Events (SSE)**, con reconexión automática y
  backoff exponencial.
- **Presencia en vivo** — contador de personas conectadas, difundido por SSE.
- **Colores persistentes** — el último post de un **canal oficial** fija el
  estado (verde/rojo) de cada circuito.

### Mapa

- **Mapa interactivo** (Leaflet) con marcadores por circuito.
- **Puntos de usuario** — cualquiera puede marcar dónde está su circuito.
- **Municipios / zonas** — avisos generales sin punto específico (ej. Boyeros).
- **Validación comunitaria** — votos para confirmar el estado de un circuito,
  con anti-spam por IP.

### Notificaciones y sonidos

- **Toasts flotantes** y badge de avisos pendientes.
- **Sonidos por circuito** — predefinidos o personalizados (sube tu propio
  audio, guardado en IndexedDB). Por defecto todo silenciado.
- **PWA instalable** con service worker y **Web Push** para recibir avisos con
  la app cerrada.
- **Onboarding guiado** en el primer uso para configurar sonido y push.

### Historial y estadísticas

- **Historial** por circuito, filtrable entre avisos **oficiales** y **todos**.
- **Panel de estadísticas** a pantalla completa con KPIs, anillo de
  disponibilidad, ranking de circuitos, desglose diario y gráficos:
  dona, barras apiladas, área acumulada y disponibilidad por día.

---

## Arquitectura

```
                    Telegram (grupos + canales oficiales)
                                  |
                                  v
                 +-------------------------------+
                 |   Monitor userbot (Pyrogram)  |
                 |   monitor_bot.py              |
                 +-------------------------------+
                      |                     |
              HTTP POST /api/alert   HTTP POST /api/oficial
                      |                     |
                      v                     v
                 +-------------------------------+
                 |   Backend FastAPI + SQLite    |
                 |   circuito-web/app            |
                 +-------------------------------+
                      |                     ^
              SSE /api/events/stream   REST /api/*
                      |                     |
                      v                     |
                 +-------------------------------+
                 |   Frontend React (SPA)        |
                 |   Leaflet + Vite              |
                 +-------------------------------+
                                  ^
                                  |
                    nginx  /circuitos/  ->  estáticos
                    nginx  /circuitos-api/  ->  :8781
```

El monitor escucha los grupos de Telegram, detecta códigos de circuito y
municipios, normaliza el estado (AFECTADO / RESTABLECIDO / INFO), deduplica y
envía el aviso al backend. El backend lo persiste y lo difunde por SSE a todos
los navegadores conectados. El frontend pinta el mapa y dispara notificaciones
y sonidos según la configuración del usuario.

---

## Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Monitor de Telegram | Python · [kurigram](https://github.com/nteuev/kurigram) (Pyrogram, MTProto) |
| Backend (API + SSE) | Python · FastAPI · Uvicorn · SQLite |
| Web Push | pywebpush (VAPID) |
| Frontend | React 18 · Vite · Leaflet / react-leaflet · lucide-react |
| Reverse proxy / estáticos | nginx · systemd |

---

## Estructura del proyecto

```
circuito-aviso/
├── monitor_bot.py                  # Userbot: vigila grupos/canales y emite avisos
├── auth_monitor.py                 # Login inicial del userbot
├── requirements.txt                # Dependencias del monitor
├── circuito-monitor.service        # Unidad systemd del monitor
├── .env.example                    # Plantilla de configuración del monitor
│
├── circuito-web/
│   ├── app/                        # Backend FastAPI
│   │   ├── main.py                 # API REST + flujo SSE
│   │   ├── config.py               # Configuración (puerto, admin key, rutas)
│   │   ├── db.py                   # Esquema y acceso a SQLite
│   │   ├── push.py                 # Web Push (VAPID)
│   │   └── stats.py                # Cálculo de estadísticas
│   ├── config/circuits.json        # Circuitos semilla (invisibles) y coordenadas
│   ├── frontend/                   # SPA React (Vite)
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── src/
│   │       ├── App.jsx             # Componente principal
│   │       ├── api.js              # Cliente REST
│   │       ├── notifications.js    # Motor de sonidos
│   │       ├── provincias.js       # Datos de provincias/municipios
│   │       └── hooks/
│   │           ├── useRealtime.js  # SSE con reconexión
│   │           └── usePush.js      # Suscripción Web Push
│   ├── nginx_circuito.conf         # Snippet de nginx
│   ├── circuito-web.service        # Unidad systemd del backend
│   └── requirements.txt            # Dependencias del backend
│
└── scripts/                        # Utilidades de diagnóstico y mantenimiento
    ├── diagnostics/
    ├── maintenance/
    └── tests/
```

---

## Requisitos

- **Python 3.10+**
- **Node.js 18+** (solo para construir el frontend)
- **nginx** (para el despliegue de producción)
- Una cuenta de Telegram y credenciales de la
  [API de Telegram](https://my.telegram.org) para el userbot
- Un bot creado con [@BotFather](https://t.me/BotFather) para publicar alertas

---

## Configuración

Toda la configuración sensible se lee de variables de entorno. Las plantillas
están versionadas como `.env.example`; **el `.env` real nunca se sube**.

### Monitor de Telegram — `.env` en la raíz

```env
API_ID=123456
API_HASH=tu_api_hash
PHONE=+5355555555
SESSION_NAME=circuito_monitor
BOT_TOKEN=123456:ABC-DEF...

WATCH_GROUPS=-1001234567890,-1009876543210
ALERT_GROUP=-1001234567890
OFFICIAL_CHANNELS=canal_oficial_1,canal_oficial_2
WATCH_MUNICIPALITIES=Boyeros,Cenpalab
TAG_CIRCUITS=M2044,D1190,A1496
SPECIAL_TAG=

WEB_API=http://127.0.0.1:8781
CODES_REFRESH=60
```

Copia la plantilla y rellénala:

```bash
cp .env.example .env
```

### Backend web — `circuito-web/.env`

```env
PORT=8781
ADMIN_KEY=cambia_esta_clave
VAPID_SUBJECT=mailto:tu_correo@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

```bash
cp circuito-web/.env.example circuito-web/.env
```

---

## Ejecución local

### 1. Monitor de Telegram

```bash
python -m venv venv
# Linux/macOS
source venv/bin/activate
# Windows
venv\Scripts\activate

pip install -r requirements.txt
python auth_monitor.py      # primer arranque: login interactivo
python monitor_bot.py
```

### 2. Backend

```bash
cd circuito-web
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8781
```

### 3. Frontend

```bash
cd circuito-web/frontend
npm install
npm run dev        # desarrollo (Vite dev server)
npm run build      # producción -> ./circuito-web/static
```

Durante el desarrollo, el frontend espera la API en `/circuitos-api/api`. Ajusta
el proxy de Vite o sirve el SPA detrás de nginx como en producción.

---

## Despliegue en producción

Ejemplo de despliegue en un VPS con **systemd** y **nginx**.

1. **Código**

   ```bash
   mkdir -p /opt/circuito-web /opt/circuito-monitor
   # copia el backend y el frontend en /opt/circuito-web
   # copia el monitor en /opt/circuito-monitor
   ```

2. **Backend**

   ```bash
   cd /opt/circuito-web
   python -m venv venv
   ./venv/bin/pip install -r requirements.txt
   cp .env.example .env        # edita PORT, ADMIN_KEY y las claves VAPID
   cp circuito-web.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now circuito-web.service
   ```

3. **Frontend**

   ```bash
   cd /opt/circuito-web/frontend
   npm install
   npm run build               # genera /opt/circuito-web/static
   ```

4. **nginx** — incluye el snippet `nginx_circuito.conf` en tu server:

   ```nginx
   location = /circuitos { return 301 /circuitos/; }
   location /circuitos/ {
       alias /opt/circuito-web/static/;
       try_files $uri $uri/ /circuitos/index.html;
   }
   location /circuitos-api/ {
       proxy_pass http://127.0.0.1:8781/;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 600s;
       proxy_buffering off;
   }
   ```

   ```bash
   nginx -t && systemctl reload nginx
   ```

5. **Monitor**

   ```bash
   cd /opt/circuito-monitor
   python -m venv venv
   ./venv/bin/pip install -r requirements.txt
   python auth_monitor.py      # login (una sola vez)
   cp circuito-monitor.service /etc/systemd/system/
   # edita WorkingDirectory/ExecStart si usas otra ruta
   systemctl daemon-reload
   systemctl enable --now circuito-monitor.service
   ```

   El monitor refresca la lista de circuitos a monitorear desde
   `/api/codes` cada `CODES_REFRESH` segundos.

---

## Referencia de la API

Todos los endpoints cuelgan de `/circuitos-api/` en producción (alias de `/`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/health` | Estado del servicio. |
| `GET` | `/api/codes` | Códigos/circuitos que se deben monitorear. |
| `GET` | `/api/circuits` | Circuitos (semilla + usuarios). |
| `GET` | `/api/markers` | Marcadores de usuario. |
| `POST` | `/api/markers` | Crear un marcador / punto de usuario. |
| `POST` | `/api/markers/vote` | Votar / validar el estado de un circuito. |
| `DELETE` | `/api/markers/{id}` | Eliminar un marcador (requiere `X-Admin-Key`). |
| `POST` | `/api/admin/verify` | Verificar la clave administrativa. |
| `POST` | `/api/alert` | Recibir un aviso (lo usa el monitor). |
| `POST` | `/api/oficial` | Fijar el estado oficial (color) de un circuito. |
| `GET` | `/api/notifications` | Historial (`circuit`, `kind`, `source`, `limit`). |
| `GET` | `/api/stats/overview` | Resumen global y ranking de circuitos. |
| `GET` | `/api/stats` | Series diarias de un circuito. |
| `GET` | `/api/events/stream` | Flujo **SSE** en tiempo real. |
| `GET` | `/api/online` | Número de conexiones activas. |
| `GET` | `/api/push/vapid-public-key` | Clave pública VAPID. |
| `POST` | `/api/push/subscribe` | Registrar una suscripción Web Push. |
| `POST` | `/api/push/unsubscribe` | Eliminar una suscripción. |
| `GET` | `/api/push/prefs` | Preferencias de sonido de una suscripción. |
| `POST` | `/api/push/prefs` | Guardar preferencias de sonido por circuito. |

---

## Eventos en tiempo real (SSE)

Conecta a `/api/events/stream`. El servidor envía líneas `data:` con JSON:

```jsonc
// Conexión inicial
data: {"type": "hello", "status": "ok", "count": 4}

// Cambio de presencia
data: {"type": "online", "count": 4}

// Nueva alerta (grupos y canales oficiales)
data: {"type": "alert", "code": "M2044", "status": "AFECTADO", "text": "...", "time": "...", "lat": 22.95, "lng": -82.38, "points": [], "source": null}

// Cambió el estado oficial (color del punto)
data: {"type": "oficial", "code": "M2044", "status": "RESTABLECIDO", "source": "Canal Oficial", "time": "..."}

// Marcadores
data: {"type": "marker_new", "marker": {"id": 1, "lat": 22.9, "lng": -82.4, "circuit": "M2044", "votes": 0}}
data: {"type": "marker_vote", "marker_id": 1, "votes": 3}
data: {"type": "marker_del", "id": 1}
```

El servidor mantiene la conexión con un `: ping` cada 15 s.

---

## Web Push (VAPID)

1. Genera un par de claves VAPID y colócalas en `circuito-web/.env`
   (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
2. El frontend pide la clave pública en `/api/push/vapid-public-key`, registra
   el service worker (`/circuitos/sw.js`) y se suscribe.
3. Al dispararse una alerta, el backend envía el push a todas las suscripciones
   que tengan ese circuito con sonido activo. Las suscripciones expiradas
   (404/410) se eliminan automáticamente.

---

## Metodología de las estadísticas

Las estadísticas se calculan **solo con avisos oficiales** (`source = oficial`):

- Un mensaje **AFECTADO** abre un corte; un **RESTABLECIDO** posterior lo cierra.
  Los mensajes **INFO** se ignoran.
- La duración del corte se reparte por día natural, **recortada a la ventana de
  monitoreo (07:00–19:00)**.
- `horasCorriente = 12 h - horasSinServicio` por día.
- Un corte sin restablecer cuenta hasta el momento actual.
- El panel ofrece rangos de 7, 14 y 30 días.

---

## Seguridad

- Todos los secretos se leen de variables de entorno (`.env`), **nunca** se
  versionan. Las plantillas `.env.example` no contienen valores reales.
- Las operaciones destructivas de la API requieren la cabecera `X-Admin-Key`.
- La presencia muestra solo un **conteo agregado y anónimo**.
- La validación comunitaria limita a **un voto por IP y punto**.
- El monitor solo procesa posts escritos por los canales oficiales configurados,
  no comentarios ni reenvíos de usuarios.

---

## Scripts de utilidad

El directorio `scripts/` reúne herramientas de diagnóstico y mantenimiento
(ver [`scripts/README.md`](scripts/README.md)):

```bash
# Diagnóstico de Telegram
python scripts/diagnostics/check_bot.py
python scripts/diagnostics/find_group.py "Informacion Luz"

# Mantenimiento
python scripts/maintenance/cleanup_db.py

# Pruebas contra una instancia local
python scripts/tests/test_api.py
ADMIN_KEY=tu_clave python scripts/tests/test_admin.py
```

---

## Contribuir

1. Haz un fork del repositorio.
2. Crea una rama: `git checkout -b feature/mi-cambio`.
3. Verifica que no incluyes secretos (`.env`, sesiones, tokens).
4. Abre un Pull Request describiendo el cambio.

---

## Licencia

Distribuido bajo la licencia **MIT**. Ver [`LICENSE`](LICENSE).

---

Hecho para la comunidad cubana.
