import { useEffect, useMemo, useRef, useState, useCallback, useReducer } from 'react'
import {
  MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiGet, apiPost, apiDeleteAdmin, apiVerifyAdmin, apiVote, apiNotifications } from './api.js'
import { useRealtime } from './hooks/useRealtime.js'
import { usePush } from './hooks/usePush.js'
import {
  playNotifySoundForCircuit, getCircuitSound, setCircuitSound, loadCircuitSounds,
  saveCustomAudio, clearCustomAudio,
  PREDEFINED_TONES, statusMeta
} from './notifications.js'
import { PROVINCIAS, CUBA_CENTER, getProvincia } from './provincias.js'
import {
  Zap, Menu, X, Plus, Volume2, VolumeX, Music, KeyRound, MapPin, Maximize2, Building2,
  Search, History, Bell, Upload, Trash2, Play, Check, FileText, Map, Copy, RefreshCw, CheckCheck,
  ChevronDown, Navigation, Users, User
} from 'lucide-react'

function circleIcon(color, unread, name) {
  const cnt = Number(unread) || 0
  const has = cnt > 0
  const badge = has ? `<span class="mkr-badge">${cnt}</span>` : ''
  const nm = (has && name) ? `<span class="mkr-name">${name}</span>` : ''
  return L.divIcon({
    className: '',
    html: `<div class="mkr${has ? ' has-unread' : ''}"><span class="dot" style="--c:${color}"></span>${badge}${nm}</div>`,
    iconSize: has ? [68, 48] : [22, 22],
    iconAnchor: has ? [34, 11] : [11, 11],
    popupAnchor: has ? [0, -12] : [0, -12]
  })
}

function FlyTo({ center, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.flyTo(center, zoom || 14, { duration: 1 })
  }, [center, zoom])
  return null
}

function ClickHandler({ onCreate, active }) {
  useMapEvents({
    click(e) {
      if (active) onCreate(e.latlng)
    },
    contextmenu(e) {
      e.originalEvent.preventDefault()
      if (active) onCreate(e.latlng)
    }
  })
  return null
}

// Divide el texto en segmentos planos y enlaces (t.me / http / www) clicables
function splitLinks(text) {
  const re = /((?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)[^\s<>"'()]+)/gi
  const parts = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), url: null })
    parts.push({ t: m[0], url: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ t: text.slice(last), url: null })
  if (!parts.length) parts.push({ t: text, url: null })
  return parts
}

function Spinner({ label }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {label && <span className="spinner-label">{label}</span>}
    </div>
  )
}

function StatusDot({ status }) {
  const tone = status === 'AFECTADO' ? 'red' : status === 'RESTABLECIDO' ? 'green' : 'blue'
  return <span className={`status-dot ${tone}`} />
}

// Notificación flotante anclada a un punto real del mapa (pixel = latLngToContainerPoint)
function FloatNotif({ point, notice, onOpen }) {
  return (
    <div
      className="float-alert notif"
      style={{ left: point.x, top: point.y }}
      onClick={(e) => { e.stopPropagation(); onOpen && onOpen(notice) }}
    >
      <StatusDot status={notice.status} />
      <div className="notif-body">
        <strong>{notice.circuit}</strong>
        {notice.source === 'oficial' && <span className="oficial-badge">Canal oficial</span>}
        <div className="notif-text">{notice.text}</div>
      </div>
    </div>
  )
}

// Bola direccional en el borde del mapa para un circuito fuera del viewport
function EdgeNeedle({ point, size, latlng, map, notice, onFly }) {
  const w = size.x
  const h = size.y
  const cx = w / 2
  const cy = h / 2
  const dx = point.x - cx
  const dy = point.y - cy
  const angle = Math.atan2(dy, dx)

  let bx, by
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { bx = cx; by = cy }
  else {
    const t = Math.min(
      dx > 0 ? (w - 22) / dx : dx < 0 ? -22 / dx : Infinity,
      dy > 0 ? (h - 22) / dy : dy < 0 ? -22 / dy : Infinity
    )
    bx = cx + dx * t
    by = cy + dy * t
  }
  const edge = { x: bx, y: by, angle }
  return (
    <div
      className="edge-needle"
      style={{ left: edge.x, top: edge.y, transform: 'translate(-50%,-50%)' }}
      title={notice.circuit}
      onClick={(e) => { e.stopPropagation(); onFly && onFly(latlng, notice.circuit, notice) }}
    >
      <Navigation size={16} className={`needle-arrow ${statusMeta(notice.status).tone}`} style={{ transform: `rotate(${angle}rad)` }} />
      <span className="needle-label">{notice.circuit}</span>
    </div>
  )
}

// Renderiza alertas flotantes (dentro del viewport) y bolas direccionales (fuera)
function AlertOverlay({ notices, onOpen, onFly }) {
  const map = useMap()
  const [, force] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    const onChange = () => force()
    map.on('move zoom resize', onChange)
    return () => { map.off('move zoom resize', onChange) }
  }, [map])

  const noticeList = Object.values(notices)
  if (!noticeList.length) return null

  const bounds = map.getBounds()
  const size = map.getSize()
  const out = []
  const inn = []

  for (const n of noticeList) {
    const latlngs = (n.points && n.points.length)
      ? n.points.map((p) => [p.lat, p.lng])
      : (n.lat != null ? [[n.lat, n.lng]] : [])
    for (const ll of latlngs) {
      const p = map.latLngToContainerPoint(ll)
      if (bounds.contains(ll)) inn.push({ ll, p, n })
      else out.push({ ll, p, n })
    }
  }

  return (
    <>
      {inn.map((it, i) => (
        <FloatNotif key={`${it.n.key}-${i}`} point={it.p} notice={it.n} onOpen={onOpen} />
      ))}
      {out.map((it, i) => (
        <EdgeNeedle key={`e${it.n.key}-${i}`} point={it.p} size={size} latlng={it.ll} map={map} notice={it.n} onFly={onFly} />
      ))}
    </>
  )
}

export default function App() {
  const [markers, setMarkers] = useState([])
  const [oficialState, setOficialState] = useState({})
  const [incoming, setIncoming] = useState({})
  const [notices, setNotices] = useState({})
  const [muted, setMuted] = useState(() => localStorage.getItem('cav_muted') === '1')
  const [soundOpen, setSoundOpen] = useState(false)
  const [soundsVersion, setSoundsVersion] = useState(0)
  const [notifCircuit, setNotifCircuit] = useState(null)
  const [historial, setHistorial] = useState([])
  const [historialOpen, setHistorialOpen] = useState(false)
  const [munList, setMunList] = useState([])
  const [munOpen, setMunOpen] = useState(false)
  const [munLoading, setMunLoading] = useState(false)
  const [muniToasts, setMuniToasts] = useState([])
  const [drawerTab, setDrawerTab] = useState('puntos')
  const [markersLoading, setMarkersLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailAlert, setDetailAlert] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [unread, setUnread] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('cav_unread') || '{}')
      const norm = {}
      for (const k of Object.keys(raw)) {
        const v = raw[k]
        norm[k] = typeof v === 'number' ? v : (v ? 1 : 0)
      }
      return norm
    } catch { return {} }
  })
  const markUnread = useCallback((code) => {
    if (!code) return
    setUnread((prev) => {
      const cur = prev[code]
      const curNum = (typeof cur === 'number') ? cur : (cur ? 1 : 0)
      const n = { ...prev, [code]: curNum + 1 }
      localStorage.setItem('cav_unread', JSON.stringify(n))
      return n
    })
  }, [])
  const clearUnread = useCallback((code) => {
    if (!code) return
    setUnread((prev) => {
      if (!prev[code]) return prev
      const n = { ...prev }
      delete n[code]
      localStorage.setItem('cav_unread', JSON.stringify(n))
      return n
    })
  }, [])
  const markAllRead = useCallback(() => {
    setUnread({})
    localStorage.setItem('cav_unread', JSON.stringify({}))
  }, [])
  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    localStorage.setItem('cav_muted', next ? '1' : '0')
  }, [muted])
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const pushApi = usePush()
  const updateCircuitSound = useCallback((circuit, cfg) => {
    if (!circuit) return
    setCircuitSound(circuit, cfg)
    pushApi.setServerPref(circuit, cfg)
    setSoundsVersion((v) => v + 1)
  }, [pushApi])
  const handleCustomUpload = useCallback(async (circuit, file) => {
    if (!circuit || !file) return
    try {
      const ab = await file.arrayBuffer()
      const ok = await saveCustomAudio(circuit, ab, file.name)
      setSoundsVersion((v) => v + 1)
      if (ok) setToast({ text: `Audio de ${circuit} guardado` })
      else setToast({ text: 'No se pudo guardar el audio', err: true })
    } catch (e) {
      setToast({ text: 'Error al leer el audio', err: true })
    }
  }, [])
  const handleClearCustom = useCallback(async (circuit) => {
    if (!circuit) return
    await clearCustomAudio(circuit)
    setSoundsVersion((v) => v + 1)
  }, [])
  const notifRef = useRef(null)
  notifRef.current = notifCircuit
  const [panelOpen, setPanelOpen] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [lastUpdate, setLastUpdate] = useState(null)

  // Onboarding / provincia
  const [provincia, setProvincia] = useState(() => localStorage.getItem('cav_provincia') || '')
  const [showIntro, setShowIntro] = useState(() => !localStorage.getItem('cav_provincia'))
  const [welcomeSeen, setWelcomeSeen] = useState(false)
  // Tutorial de notificaciones/sonido (asistente por pasos, clave propia)
  // 0=cerrado, 1=sonido, 2=notificaciones, 3=confirmacion
  const [setupStep, setSetupStep] = useState(0)

  // Marcado de punto
  const [addingMode, setAddingMode] = useState(false)
  const [creating, setCreating] = useState(null)
  const [formCircuit, setFormCircuit] = useState('')
  const [formNote, setFormNote] = useState('')

  // Duplicado -> sugerir validar
  const [dupSuggest, setDupSuggest] = useState(null)

  // Puntos validados por este navegador (no volver a ofrecer validar)
  const [validated, setValidated] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cav_validated') || '[]') } catch { return [] }
  })
  const [guide, setGuide] = useState(false)

  // Admin
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminKey, setAdminKey] = useState('')
  const [adminAuth, setAdminAuth] = useState('') // clave persistente para poder eliminar

  const [toast, setToast] = useState(null)
  const mapRef = useRef()
  const markerRefs = useRef({})
  const [wasConnected, setWasConnected] = useState(false)
  const [locating, setLocating] = useState(false)
  const onMapChange = null

  const markValidated = (id) => {
    const next = Array.from(new Set([...validated, id]))
    setValidated(next)
    localStorage.setItem('cav_validated', JSON.stringify(next))
  }

  const canVote = (id) => !validated.includes(id)

  const reloadMarkers = useCallback(async () => {
    setMarkersLoading(true)
    try {
      const data = await apiGet('/markers')
      setMarkers(data)
      setLastUpdate(new Date())
    } catch (e) {
      setToast({ text: 'No se pudieron cargar los puntos', err: true })
    }
    setMarkersLoading(false)
  }, [])

  useEffect(() => { reloadMarkers() }, [reloadMarkers])

  const reloadOficial = useCallback(async () => {
    try {
      const data = await apiGet('/circuits')
      const map = {}
      for (const c of data || []) map[String(c.code).toUpperCase()] = c.oficial_status || null
      setOficialState(map)
    } catch (e) { /* el color queda neutro si falla */ }
  }, [])

  useEffect(() => { reloadOficial() }, [reloadOficial])

  const loadHistorial = useCallback(async (circuit) => {
    setHistoryLoading(true)
    try {
      const list = await apiNotifications(circuit, 50)
      setHistorial(list)
    } catch (e) {
      setHistorial([])
    }
    setHistoryLoading(false)
  }, [])

  const loadMunicipios = useCallback(async () => {
    setMunLoading(true)
    try {
      const list = await apiNotifications(null, 50, 'municipio')
      setMunList(list)
    } catch (e) {
      setMunList([])
    }
    setMunLoading(false)
  }, [])

  // Panel de municipios: carga inicial al montar y refresco periódico mientras esté abierto
  useEffect(() => {
    loadMunicipios()
  }, [loadMunicipios])

  useEffect(() => {
    if (!(panelOpen && drawerTab === 'municipios')) return undefined
    const t = setInterval(loadMunicipios, 30000)
    return () => clearInterval(t)
  }, [panelOpen, drawerTab, loadMunicipios])

  const openHistorial = useCallback((circuit) => {
    setNotifCircuit(circuit)
    setHistorialOpen(true)
    clearUnread(circuit)
    loadHistorial(circuit)
  }, [loadHistorial])

  const openDetail = useCallback((alert) => {
    setDetailAlert(alert)
    setDetailOpen(true)
    if (alert && alert.circuit) clearUnread(alert.circuit)
  }, [])

  const openLastAlert = async (circuit) => {
    setDetailLoading(true)
    try {
      const list = await apiNotifications(circuit, 1)
      if (list && list.length) openDetail({ ...list[0], circuit })
      else setToast({ text: 'Sin alertas registradas para este circuito' })
    } catch {
      setToast({ text: 'No se pudo cargar la alerta', err: true })
    }
    setDetailLoading(false)
  }

  const flyToAlert = (alert) => {
    const pts = (alert && alert.points && alert.points.length)
      ? alert.points
      : (alert && alert.lat != null ? [{ lat: alert.lat, lng: alert.lng }] : [])
    if (!pts.length || !mapRef.current) return
    mapRef.current.flyTo([pts[0].lat, pts[0].lng], Math.max(mapRef.current.getZoom(), 14), { duration: 1 })
    setDetailOpen(false)
  }

  const handleEvent = useCallback((ev) => {
    if (ev.type === 'online' || ev.type === 'hello') {
      setOnlineUsers(Number(ev.count) || 0)
      return
    }
    if (ev.type === 'oficial') {
      setOficialState((prev) => ({ ...prev, [String(ev.code).toUpperCase()]: ev.status || null }))
      return
    }
    if (ev.type === 'alert') {
      setIncoming((prev) => ({ ...prev, [ev.code]: { status: ev.status, key: Date.now() } }))
      markUnread(ev.code)
      // Master mute global. Si está desmutado, aplica la config de sonido por circuito.
      if (!mutedRef.current) playNotifySoundForCircuit(ev.code, getCircuitSound(ev.code), ev.status)
      const nkey = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const points = (ev.points && ev.points.length)
        ? ev.points
        : (ev.lat != null ? [{ lat: ev.lat, lng: ev.lng }] : [])
      setNotices((prev) => ({ ...prev, [nkey]: { key: nkey, circuit: ev.code, status: ev.status, text: ev.text || ev.code, time: ev.time, points, source: ev.source } }))
      setTimeout(() => {
        setNotices((prev) => { const n = { ...prev }; delete n[nkey]; return n })
      }, 9000)
      if (notifRef.current === ev.code) loadHistorial(ev.code)
      // Aviso de municipio (sin punto): refrescar el panel y mostrar toast flotante
      if (!points.length && ev.lat == null) {
        const mkey = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        setMuniToasts((prev) => [...prev.slice(-3), { key: mkey, circuit: ev.code, status: ev.status, text: ev.text || ev.code, source: ev.source }])
        setTimeout(() => {
          setMuniToasts((prev) => prev.filter((t) => t.key !== mkey))
        }, 9000)
        loadMunicipios()
      }
    } else if (ev.type === 'marker_new') {
      reloadMarkers()
    } else if (ev.type === 'marker_del') {
      reloadMarkers()
    } else if (ev.type === 'marker_vote') {
      reloadMarkers()
    }
  }, [reloadMarkers, loadHistorial, markUnread, clearUnread, loadMunicipios])

  const connected = useRealtime(handleEvent)

  const prevConn = useRef(connected)
  const [connDown, setConnDown] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(0)

  useEffect(() => {
    const was = prevConn.current
    if (was && !connected) {
      setToast({ text: 'Sin conexión en vivo. Reintentando…', err: true })
      setOnlineUsers(0)
    } else if (!was && connected) {
      if (wasConnected) setToast({ text: 'Conexión en vivo restablecida' })
      setWasConnected(true)
    } else if (connected) {
      setWasConnected(true)
    }
    prevConn.current = connected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // Sólo muestra el banner tras 8s sostenidos de desconexión (evita parpadeos en micro-cortes)
  useEffect(() => {
    if (!connected) {
      const t = setTimeout(() => setConnDown(true), 8000)
      return () => clearTimeout(t)
    }
    setConnDown(false)
  }, [connected])

  const markersWithCode = useMemo(() => markers.filter((m) => m.circuit), [markers])
  const byCode = useMemo(() => {
    const m = {}
    for (const mk of markersWithCode) { m[mk.circuit] = (m[mk.circuit] || 0) + 1 }
    return m
  }, [markersWithCode])

  // Sonar todos / silenciar todos (por defecto todo está silenciado)
  const soundAll = useCallback(() => {
    for (const code of Object.keys(byCode)) {
      setCircuitSound(code, { mode: 'default' })
      pushApi.setServerPref(code, { mode: 'default' })
    }
    setSoundsVersion((v) => v + 1)
  }, [byCode, pushApi])
  const soundNone = useCallback(() => {
    for (const code of Object.keys(byCode)) {
      setCircuitSound(code, { mode: 'none' })
      pushApi.setServerPref(code, { mode: 'none' })
    }
    setSoundsVersion((v) => v + 1)
  }, [byCode, pushApi])

  // Sincronizar preferencias de sonido locales con el servidor al montar
  useEffect(() => {
    if (pushApi.subId) pushApi.syncPrefs(loadCircuitSounds())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const munCodes = useMemo(() => {
    const seen = {}
    for (const h of munList) { if (h.circuit) seen[h.circuit] = true }
    return Object.keys(seen)
  }, [munList])

  const filteredMarkers = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = markers
    if (filter === 'usuario') list = markers.filter((m) => m.circuit)
    if (filter === 'sin') list = markers.filter((m) => !m.circuit)
    if (q) {
      list = list.filter((m) =>
        (m.circuit || '').toLowerCase().includes(q) ||
        (m.note || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [markers, filter, search])

  const mapCenter = provincia ? getProvincia(provincia) : CUBA_CENTER

  const handleChooseProvincia = (name) => {
    setProvincia(name)
    localStorage.setItem('cav_provincia', name)
    setShowIntro(false)
  }

  const handleCreate = (latlng) => {
    setCreating({ lat: latlng.lat, lng: latlng.lng })
    setFormCircuit('')
    setFormNote('')
    setAddingMode(false)
  }

  const submitCreate = async (e, force = false) => {
    if (e) e.preventDefault()
    if (!creating) return
    const code = formCircuit.trim()
    if (!code) {
      setToast({ text: 'Debes poner el código del circuito (ej. M2044)', err: true })
      return
    }
    try {
      const res = await apiPost('/markers', {
        lat: creating.lat,
        lng: creating.lng,
        circuit: code,
        note: formNote.trim() || null,
        force
      })
      if (res && res.ask) {
        setDupSuggest({ ...res, blocked: false })
        return // mantener creating/form para poder "continuar con el mío"
      }
      if (res && res.blocked) {
        setDupSuggest({ ...res, blocked: true })
        setCreating(null)
        return
      }
      setCreating(null)
      reloadMarkers()
      setToast({ text: 'Punto guardado. ¡Gracias por compartir!' })
    } catch (err) {
      setToast({ text: 'Error al guardar el punto', err: true })
    }
  }

  const continueCreate = () => {
    setDupSuggest(null)
    submitCreate(null, true)
  }

  const doVote = async (id) => {
    try {
      const res = await apiVote(id)
      if (res.ok !== false) {
        markValidated(id)
        reloadMarkers()
        setToast({ text: `Punto validado (${res.votes} validaciones)` })
      } else if (res.already) {
        markValidated(id)
        setToast({ text: 'Ya validaste este punto' })
      }
    } catch (err) {
      setToast({ text: 'No se pudo validar', err: true })
    }
  }

  const removeMarker = async (id) => {
    try {
      await apiDeleteAdmin(`/markers/${id}`, adminAuth)
      reloadMarkers()
      setToast({ text: 'Punto eliminado' })
    } catch (err) {
      setToast({ text: 'Solo el administrador puede eliminar', err: true })
    }
  }

  const locateMe = () => {
    if (!('geolocation' in navigator)) {
      setToast({ text: 'Tu dispositivo no permite ubicación', err: true })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const ll = [pos.coords.latitude, pos.coords.longitude]
        if (mapRef.current) mapRef.current.flyTo(ll, Math.max(mapRef.current.getZoom(), 14), { duration: 1 })
        setToast({ text: 'Mostrando tu ubicación' })
      },
      () => {
        setLocating(false)
        setToast({ text: 'No se pudo obtener tu ubicación', err: true })
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const toggleFullscreen = () => {
    const el = document.querySelector('.map')
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen().catch(() => {})
    }
  }

  const flyToMarker = (m) => {
    if (!mapRef.current) return
    mapRef.current.flyTo([m.lat, m.lng], Math.max(mapRef.current.getZoom(), 15), { duration: 1 })
    const mk = markerRefs.current[m.id]
    if (mk && mk.openPopup) setTimeout(() => mk.openPopup({ autoPan: true }), 300)
  }

  const submitAdmin = async (e) => {
    e.preventDefault()
    const ok = await apiVerifyAdmin(adminKey)
    if (ok) {
      setIsAdmin(true)
      setAdminAuth(adminKey)
      setAdminOpen(false)
      setAdminKey('')
      setToast({ text: 'Modo administrador activado' })
    } else {
      setToast({ text: 'Clave incorrecta', err: true })
    }
  }

  const finishOnboarding = (name) => {
    handleChooseProvincia(name)
    setWelcomeSeen(true)
    setGuide(true)
  }

  const reopenOnboarding = () => {
    setShowIntro(true)
  }

  // ---- Tutorial de notificaciones / sonido (primera configuracion) ----
  const finishSetup = useCallback(() => {
    localStorage.setItem('cav_setup_done', '1')
    setSetupStep(0)
    setSoundOpen(false)
  }, [])

  const nextSetupStep = useCallback(() => {
    setSetupStep((s) => s + 1)
  }, [])

  useEffect(() => {
    // Se muestra SIEMPRE que no este configurado (cav_setup_done), aunque el
    // usuario ya haya hecho el onboarding de provincia. Esperamos a que el intro
    // de provincia termine para no pisarlo.
    if (localStorage.getItem('cav_setup_done')) return
    if (showIntro) return
    setSetupStep(1)
  }, [showIntro])

  // Al estar en el paso 1, abrir el panel real de sonidos para configurar de verdad
  useEffect(() => {
    if (setupStep === 1) setSoundOpen(true)
  }, [setupStep])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className={`app ${panelOpen ? 'panel-open' : ''}`}>
      <header className="topbar">
        <button className="hamburger" onClick={() => setPanelOpen((v) => !v)} aria-label="Mostrar u ocultar panel"><Menu size={20} /></button>
        <div className="brand">
          <span className="brand-title"><Zap size={18} /> Circuito Aviso</span>
          <button className="brand-sub btn-ghost" onClick={reopenOnboarding} title="Cambiar de provincia">
            {provincia || 'Selecciona tu provincia'} <ChevronDown size={13} />
          </button>
        </div>
        <div className="top-actions">
          <button className="addpoint" onClick={() => { setAddingMode(true); setPanelOpen(false); }}>
            <Plus size={16} /> Agregar mi punto
          </button>
          <button
            className="admin-toggle"
            title={muted ? 'Activar sonido' : 'Silenciar sonido'}
            onClick={() => {
              const next = !muted
              setMuted(next)
              localStorage.setItem('cav_muted', next ? '1' : '0')
            }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="admin-toggle" title="Configurar sonidos por circuito" onClick={() => setSoundOpen((v) => !v)}><Music size={18} /></button>
          <button
            className="admin-toggle"
            title={pushApi.enabled ? 'Desactivar notificaciones push' : 'Activar notificaciones push (fuera de la web)'}
            onClick={() => { if (pushApi.enabled) pushApi.unsubscribe(); else pushApi.subscribe().then((id) => { if (id) setToast({ text: 'Notificaciones activadas. Las elegidas sonarán aunque cierres la web.' }); }) }}
          >
            {pushApi.enabled ? <Bell size={18} /> : <Bell size={18} style={{ opacity: 0.45 }} />}
          </button>
          <button className="admin-toggle" onClick={() => setAdminOpen((v) => !v)}><KeyRound size={18} /></button>
          <div className="status-pill" title="Personas viendo Circuito Aviso ahora">
            <Users size={14} />
            <span className="avatar-stack">
              {Array.from({ length: Math.min(onlineUsers, 4) }).map((_, i) => (
                <span className="avatar" key={i} style={{ background: `hsl(${(i * 67) % 360} 70% 52%)` }}>
                  <User size={12} />
                </span>
              ))}
              {onlineUsers > 4 && <span className="avatar more">+{onlineUsers - 4}</span>}
            </span>
            <span className="online-count">{onlineUsers > 0 ? onlineUsers : '–'}</span>
            <span className="online-label">en línea</span>
            <span className={`pulse ${connected ? 'on' : ''}`}></span>
          </div>
        </div>
      </header>

      <MapContainer
        center={[mapCenter.lat, mapCenter.lng]}
        zoom={mapCenter.zoom}
        className="map"
        whenCreated={(m) => (mapRef.current = m)}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onCreate={handleCreate} active={addingMode} />

        <AlertOverlay
          notices={notices}
          onOpen={(alert) => openDetail(alert)}
          onFly={(latlng, circuit, alert) => {
            mapRef.current && mapRef.current.flyTo(latlng, Math.max(mapRef.current.getZoom(), 14), { duration: 1 })
            openDetail(alert)
          }}
        />

        {filteredMarkers.map((m) => {
          const validated = (m.votes || 0) >= 10
          const oficialStatus = oficialState[m.circuit ? String(m.circuit).toUpperCase() : null]
          let color
          if (oficialStatus === 'RESTABLECIDO') color = '#34c759'
          else if (oficialStatus === 'AFECTADO') color = '#ff3b30'
          else if (!m.circuit) color = validated ? '#34c759' : '#4aa3ff'
          else color = '#4aa3ff'
          return (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={circleIcon(color, unread[m.circuit] || 0, m.circuit)}
              ref={(r) => {
                if (r) markerRefs.current[m.id] = r
                else if (markerRefs.current[m.id]) delete markerRefs.current[m.id]
              }}
            >
              <Popup>
                <div className="popup">
                  <strong>{m.circuit || 'Punto sin circuito'}</strong>
                  {oficialStatus && (
                    <div className={`popup-oficial ${oficialStatus === 'AFECTADO' ? 'red' : 'green'}`}>
                      {oficialStatus === 'AFECTADO' ? 'Afectado' : 'Restablecido'} · según canal oficial
                    </div>
                  )}
                  {m.note && <div className="popup-note">{m.note}</div>}
                  <div className="vote-row">
                    <span className={`vote-badge ${validated ? 'good' : ''}`}>
                      {validated ? <><Check size={14} className="ic" /> Validado</> : <><FileText size={14} className="ic" /> Por validar</>} · {m.votes || 0}/10
                    </span>
                    {canVote(m.id) && (
                      <button className="vote-btn" onClick={() => doVote(m.id)}><Check size={14} /> Validar</button>
                    )}
                  </div>
                  {m.circuit && (
                    <button className="link-btn" onClick={() => openHistorial(m.circuit)}><History size={14} /> Historial de alertas</button>
                  )}
                  {m.circuit && (
                    <button className="link-btn" onClick={() => openLastAlert(m.circuit)}><Bell size={14} /> Última alerta</button>
                  )}
                  {m.circuit && (
                    <div className="popup-sound" onClick={(e) => e.stopPropagation()}>
                      <label className="popup-sound-label"><Volume2 size={14} /> Sonido</label>
                      <select
                        className="sound-select"
                        value={(getCircuitSound(m.circuit).mode) || 'default'}
                        onChange={(e) => {
                          const mode = e.target.value
                          if (mode === 'default') updateCircuitSound(m.circuit, { mode: 'default' })
                          else if (mode === 'none') updateCircuitSound(m.circuit, { mode: 'none' })
                          else if (mode === 'predefined') updateCircuitSound(m.circuit, { mode: 'predefined', tone: PREDEFINED_TONES[0] })
                          else if (mode === 'custom') updateCircuitSound(m.circuit, { mode: 'custom' })
                        }}
                      >
                        <option value="default">Predeterminado</option>
                        <option value="none">Silenciado</option>
                        <option value="predefined">Tono</option>
                        <option value="custom">Mi audio…</option>
                      </select>
                      {getCircuitSound(m.circuit).mode === 'predefined' && (
                        <select
                          className="sound-select"
                          value={getCircuitSound(m.circuit).tone || PREDEFINED_TONES[0]}
                          onChange={(e) => updateCircuitSound(m.circuit, { mode: 'predefined', tone: e.target.value })}
                        >
                          {PREDEFINED_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      )}
                      {getCircuitSound(m.circuit).mode === 'custom' && (
                        <span className="sound-file">
                          <label className="sound-upload">Subir audio
                            <input
                              type="file" accept="audio/*"
                              key={getCircuitSound(m.circuit).name || 'upload'}
                              onChange={(e) => {
                                const f = e.target.files && e.target.files[0]
                                if (f) handleCustomUpload(m.circuit, f)
                              }}
                            />
                          </label>
                          <span className="sound-fname" title={getCircuitSound(m.circuit).name || ''}>
                            {getCircuitSound(m.circuit).name ? <><Check size={12} /> {getCircuitSound(m.circuit).name.slice(0, 20)}</> : 'Sube tu audio…'}
                          </span>
                          {getCircuitSound(m.circuit).name && (
                            <button className="sound-remove" title="Quitar audio"
                              onClick={() => handleClearCustom(m.circuit)}><Trash2 size={14} /></button>
                          )}
                          <button className="sound-test" title="Probar" onClick={() => { if (!mutedRef.current) playNotifySoundForCircuit(m.circuit, getCircuitSound(m.circuit), 'AFECTADO') }}><Play size={14} /></button>
                        </span>
                      )}
                    </div>
                  )}
                  {isAdmin && (
                    <button className="link-btn" onClick={() => removeMarker(m.id)}>Eliminar punto</button>
                  )}
                </div>
              </Popup>
            </Marker>
          )
        })}

        <FlyTo center={creating ? [creating.lat, creating.lng] : null} zoom={creating ? 16 : null} />
      </MapContainer>

      {/* Overlay de carga de puntos */}
      {markersLoading && markers.length === 0 && (
        <div className="map-loading">
          <span className="spinner" />
          <span>Cargando puntos…</span>
        </div>
      )}

      {/* Controles flotantes del mapa: ubicación + fullscreen */}
      <div className="map-controls">
        <button
          className="map-ctrl"
          title="Centrar en mi ubicación"
          aria-label="Centrar en mi ubicación"
          onClick={locateMe}
        >{locating ? <span className="spin-sm" /> : <MapPin size={18} />}</button>
        <button
          className="map-ctrl"
          title="Pantalla completa"
          aria-label="Pantalla completa"
          onClick={toggleFullscreen}
        ><Maximize2 size={18} /></button>
      </div>

      {/* Leyenda de colores del mapa */}
      <div className="legend">
        <span className="lg-item"><span className="lg-dot red"></span>Afectado</span>
        <span className="lg-item"><span className="lg-dot green"></span>Validado</span>
        <span className="lg-item"><span className="lg-dot blue"></span>Por validar</span>
      </div>

      {/* Toasts flotantes de avisos de municipio/zona (unos segundos) */}
      <div className="muni-toast-stack">
        {muniToasts.map((t) => (
          <div className="muni-toast" key={t.key} onClick={() => openDetail(t)}>
            <Building2 size={16} className="muni-toast-ic" />
            <div className="muni-toast-body">
              <div className="muni-toast-head">
                <StatusDot status={t.status} />
                <strong>{t.circuit}</strong>
              </div>
              <div className="muni-toast-text">{t.text}</div>
            </div>
            <button
              className="muni-toast-x"
              onClick={(e) => { e.stopPropagation(); setMuniToasts((prev) => prev.filter((x) => x.key !== t.key)) }}
            ><X size={14} /></button>
          </div>
        ))}
      </div>

      {/* Modo marcar punto */}
      {addingMode && !creating && (
        <div className="add-banner">
          Haz clic en el mapa donde está tu zona para poner tu punto.
          <button className="primary small" onClick={() => setAddingMode(false)}>Cancelar</button>
        </div>
      )}

      {creating && (
        <div className="create-card">
          <button className="close" onClick={() => setCreating(null)}>×</button>
          <h3>Nuevo punto</h3>
          <p className="coords">{creating.lat.toFixed(5)}, {creating.lng.toFixed(5)}</p>
          <form onSubmit={submitCreate}>
            <input
              required
              value={formCircuit}
              onChange={(e) => setFormCircuit(e.target.value.toUpperCase())}
              placeholder="Circuito (ej. M2044, D836…) *"
              autoFocus
            />
            <input
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Nota opcional"
            />
            <button className="primary" type="submit">Guardar punto</button>
          </form>
          <div className="hint">El circuito es obligatorio. Al guardar, se vigila su estado en el canal y se notifica aquí y en Telegram.</div>
        </div>
      )}

      {/* Guía post-provincia: invitar a agregar punto */}
      {guide && !addingMode && !creating && (
        <div className="guide">
          <div className="guide-content">
            <span className="guide-icon"><MapPin size={18} /></span>
            <span className="guide-text">
              <strong>¿Dónde vives?</strong> Marca tu punto y escribe tu circuito para
              recibir avisos en tiempo real.
            </span>
          </div>
          <button className="primary small" onClick={() => { setAddingMode(true); setGuide(false); setPanelOpen(false); }}>
            Agregar mi punto
          </button>
          <button className="close" onClick={() => setGuide(false)}>×</button>
        </div>
      )}

      {/* Sugerencia: punto duplicado/cercano -> validar o continuar */}
      {dupSuggest && dupSuggest.marker && (
        <div className="dup-card">
          <button className="close" onClick={() => setDupSuggest(null)}>×</button>
          <h3>{dupSuggest.blocked ? 'Demasiado cerca del mismo circuito' : 'Hay un punto muy cerca'}</h3>
          <p>
            {dupSuggest.blocked
              ? 'El mismo circuito está a menos de 5 m de donde marcaste. Debes validar el punto existente en lugar de crear otro.'
              : dupSuggest.same_circuit
                ? `Ya existe el circuito "${dupSuggest.marker.circuit}" a ${dupSuggest.distance ?? '~'} m de donde marcaste.`
                : `Hay un punto a ${dupSuggest.distance ?? '~'} m de donde marcaste (menos de 50 m).`}
          </p>
          <div className="dup-info">
            <div><strong>{dupSuggest.marker.circuit || 'Sin circuito'}</strong></div>
            {dupSuggest.marker.note && <div className="popup-note">{dupSuggest.marker.note}</div>}
            <div className="vote-row">
              <span className="vote-badge"><FileText size={13} /> {dupSuggest.marker.votes || 0} validaciones</span>
            </div>
          </div>
          {dupSuggest.blocked ? (
            <div className="dup-actions">
              <button className="primary" onClick={() => { doVote(dupSuggest.marker.id); setDupSuggest(null); }}>
                <Check size={14} /> Validar este punto (+1)
              </button>
              <button className="ghost" onClick={() => setDupSuggest(null)}>Cerrar</button>
            </div>
          ) : (
            <>
              <p className="hint">Marca ahora:</p>
              <div className="dup-actions">
                <button className="primary" onClick={() => { doVote(dupSuggest.marker.id); setDupSuggest(null); }}>
                  <Check size={14} /> Validar el punto cercano (+1)
                </button>
                <button className="ghost" onClick={continueCreate}>
                  Continuar con el mío
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Panel admin */}
      {adminOpen && (
        <div className="admin-card">
          <h3><KeyRound size={16} /> Acceso administrador</h3>
          <form onSubmit={submitAdmin}>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Clave de administrador"
              autoFocus
            />
            <button className="primary" type="submit">Entrar</button>
          </form>
          {isAdmin && <div className="hint admin-on">Modo admin activo · puedes eliminar puntos</div>}
        </div>
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} role="status">{toast.text}</div>}

      {/* Aviso de conexión en vivo */}
      {connDown && (
        <div className="conn-banner" role="alert">
          <span className="conn-dot"></span> Sin conexión en vivo. Reintentando…
        </div>
      )}

      {/* Detalle de la alerta (información completa de Telegram) */}
      {detailOpen && detailAlert && (
        <div className="hist-card">
          <button className="close" onClick={() => setDetailOpen(false)}>×</button>
          {detailLoading ? (
            <Spinner label="Cargando alerta…" />
          ) : (() => { const meta = statusMeta(detailAlert.status); return (
            <div className="alert-detail">
              <div className="alert-detail-head">
                <StatusDot status={detailAlert.status} />
                <div>
                  <h3>{detailAlert.circuit}</h3>
                  <div className={`alert-detail-status ${meta.tone}`}>{detailAlert.status}</div>
                  {detailAlert.source === 'oficial' && <span className="oficial-badge">Canal oficial</span>}
                </div>
              </div>
              <div className="alert-detail-text">
                {splitLinks(detailAlert.text || detailAlert.circuit).map((seg, i) =>
                  seg.url ? (
                    <a key={i} href={seg.url} target="_blank" rel="noopener noreferrer" className="tlink">{seg.t}</a>
                  ) : (
                    <span key={i}>{seg.t}</span>
                  )
                )}
              </div>
              {detailAlert.time && <div className="alert-detail-time">{new Date(detailAlert.time).toLocaleString()}</div>}
              <div className="detail-actions">
                <button className="link-btn" onClick={() => flyToAlert(detailAlert)}><Map size={14} /> Ver en el mapa</button>
                <button
                  className="link-btn"
                  onClick={() => { navigator.clipboard && navigator.clipboard.writeText(detailAlert.text || '').then(() => setToast({ text: 'Texto copiado' })).catch(() => {}) }}
                ><Copy size={14} /> Copiar</button>
              </div>
            </div>
          ) })()}
        </div>
      )}

      {/* Historial de alertas de un circuito */}
      {historialOpen && notifCircuit && (
        <div className="hist-card">
          <button className="close" onClick={() => setHistorialOpen(false)}>×</button>
          <h3><History size={16} /> Historial · {notifCircuit}</h3>
          {historyLoading ? (
            <Spinner label="Cargando historial…" />
          ) : historial.length === 0 ? (
            <p className="hist-empty">Sin alertas registradas todavía.</p>
          ) : (
            <ul className="hist-list">
              {historial.map((h) => {
                return (
                  <li key={h.id} className="hist-item">
                    <StatusDot status={h.status} />
                    <div className="hist-body">
                      <div className="hist-text">
                        {splitLinks(h.text || h.circuit).map((seg, i) =>
                          seg.url ? (
                            <a key={i} href={seg.url} target="_blank" rel="noopener noreferrer" className="tlink">{seg.t}</a>
                          ) : (
                            <span key={i}>{seg.t}</span>
                          )
                        )}
                      </div>
                      {h.source === 'oficial' && <span className="oficial-badge">Canal oficial</span>}
                      <div className="hist-time">{new Date(h.created_at).toLocaleString()}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Panel central de sonidos por circuito */}
      {soundOpen && (
        <div className="sound-card">
          <div className="sound-head">
            <h3><Volume2 size={16} /> Sonidos por circuito</h3>
            <button className="close" onClick={() => setSoundOpen(false)}>×</button>
          </div>
          <p className="sound-hint">
            Por defecto todos los circuitos están <b>silenciados</b>. Elige cuáles quieres que suenen
            (o súbelos todos abajo). "Silenciado" = no suena; "Predeterminado" = tono según el estado;
            o sube tu propio audio. {" "}<button className="link-btn" onClick={toggleMute}>{muted ? <><VolumeX size={14} /> Activar sonido (global)</> : <><Volume2 size={14} /> Silenciar todo (global)</>}</button>
          </p>
          <div className="sound-bulk">
            <button className="sound-bulk-btn" onClick={soundAll}><Volume2 size={14} /> Sonar todos</button>
            <button className="sound-bulk-btn" onClick={soundNone}><VolumeX size={14} /> Silenciar todos</button>
          </div>
          <div className="sound-list">
            {Object.keys(byCode).length === 0 && (
              <div className="empty">No hay circuitos aún. Agrega tu punto primero.</div>
            )}
            {Object.keys(byCode).map((code) => {
              const cfg = getCircuitSound(code)
              return (
                <div className="sound-row" key={code}>
                  <div className="sound-row-name" title={code}>{code}</div>
                  <select
                    className="sound-select"
                    value={cfg.mode || 'default'}
                    onChange={(e) => {
                      const mode = e.target.value
                          if (mode === 'default') updateCircuitSound(code, { mode: 'default' })
                      else if (mode === 'none') updateCircuitSound(code, { mode: 'none' })
                      else if (mode === 'predefined') updateCircuitSound(code, { mode: 'predefined', tone: PREDEFINED_TONES[0] })
                      else if (mode === 'custom') updateCircuitSound(code, { mode: 'custom' })
                    }}
                  >
                    <option value="default">Predeterminado</option>
                    <option value="none">Silenciado</option>
                    <option value="predefined">Tono</option>
                    <option value="custom">Mi audio</option>
                  </select>
                  {cfg.mode === 'predefined' && (
                    <select
                      className="sound-select"
                      value={cfg.tone || PREDEFINED_TONES[0]}
                      onChange={(e) => updateCircuitSound(code, { mode: 'predefined', tone: e.target.value })}
                    >
                      {PREDEFINED_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  {cfg.mode === 'custom' && (
                    <span className="sound-file">
                      <label className="sound-upload">Subir audio
                        <input
                          type="file" accept="audio/*"
                          key={cfg.name || 'upload'}
                          onChange={(e) => {
                            const f = e.target.files && e.target.files[0]
                            if (f) handleCustomUpload(code, f)
                          }}
                        />
                      </label>
                      <span className="sound-fname" title={cfg.name || ''}>
                        {cfg.name ? <><Check size={12} /> {cfg.name.slice(0, 22)}</> : (cfg.mode === 'custom' && !cfg.name ? 'Sube tu audio…' : '')}
                      </span>
                      {cfg.name && (
                        <button className="sound-remove" title="Quitar audio"
                          onClick={() => handleClearCustom(code)}><Trash2 size={14} /></button>
                      )}
                    </span>
                  )}
                  <button
                    className="sound-test" title="Probar sonido"
                    onClick={() => { if (!mutedRef.current) playNotifySoundForCircuit(code, cfg, 'AFECTADO') }}
                  ><Play size={14} /> Probar</button>
                </div>
              )
            })}
            {munCodes.length > 0 && (
              <>
                <div className="sound-subhead"><Building2 size={14} /> Avisos de municipio</div>
                {munCodes.map((code) => {
                  const cfg = getCircuitSound(code)
                  return (
                    <div className="sound-row" key={`m-${code}`}>
                      <div className="sound-row-name" title={code}>{code}</div>
                      <select
                        className="sound-select"
                        value={cfg.mode || 'default'}
                        onChange={(e) => {
                          const mode = e.target.value
                      if (mode === 'default') updateCircuitSound(code, { mode: 'default' })
                          else if (mode === 'none') updateCircuitSound(code, { mode: 'none' })
                          else if (mode === 'predefined') updateCircuitSound(code, { mode: 'predefined', tone: PREDEFINED_TONES[0] })
                          else if (mode === 'custom') updateCircuitSound(code, { mode: 'custom' })
                        }}
                      >
                        <option value="default">Predeterminado</option>
                        <option value="none">Silenciado</option>
                        <option value="predefined">Tono</option>
                        <option value="custom">Mi audio</option>
                      </select>
                      {cfg.mode === 'predefined' && (
                        <select
                          className="sound-select"
                          value={cfg.tone || PREDEFINED_TONES[0]}
                          onChange={(e) => updateCircuitSound(code, { mode: 'predefined', tone: e.target.value })}
                        >
                          {PREDEFINED_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      )}
                      {cfg.mode === 'custom' && (
                        <span className="sound-file">
                          <label className="sound-upload">Subir audio
                            <input
                              type="file" accept="audio/*"
                              key={cfg.name || 'upload'}
                              onChange={(e) => {
                                const f = e.target.files && e.target.files[0]
                                if (f) handleCustomUpload(code, f)
                              }}
                            />
                          </label>
                          <span className="sound-fname" title={cfg.name || ''}>
                            {cfg.name ? <><Check size={12} /> {cfg.name.slice(0, 22)}</> : 'Sube tu audio…'}
                          </span>
                          {cfg.name && (
                            <button className="sound-remove" title="Quitar audio"
                              onClick={() => handleClearCustom(code)}><Trash2 size={14} /></button>
                          )}
                        </span>
                      )}
                      <button
                        className="sound-test" title="Probar sonido"
                        onClick={() => { if (!mutedRef.current) playNotifySoundForCircuit(code, cfg, 'AFECTADO') }}
                      ><Play size={14} /> Probar</button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {(() => {
        const muniUnread = Object.keys(unread).filter((c) => !byCode[c]).reduce((s, c) => s + (Number(unread[c]) || 0), 0)
        return (
          <>
            <div className={`drawer-scrim ${panelOpen ? 'show' : ''}`} onClick={() => setPanelOpen(false)} />
            <aside className={`drawer ${panelOpen ? 'open' : ''}`}>
              <div className="drawer-head">
                <div className="drawer-tabs">
                  <button className={drawerTab === 'puntos' ? 'active' : ''} onClick={() => setDrawerTab('puntos')}>
                    <MapPin size={15} /> Mis puntos
                  </button>
                  <button className={drawerTab === 'municipios' ? 'active' : ''} onClick={() => { setDrawerTab('municipios'); if (!munList.length) loadMunicipios() }}>
                    <Building2 size={15} /> Municipios
                    {muniUnread > 0 && <span className="tab-badge">{muniUnread}</span>}
                  </button>
                </div>
                <div className="drawer-tools">
                  <button className="icon-btn" title="Marcar todo como leído" onClick={markAllRead}><CheckCheck size={16} /></button>
                  <button className="icon-btn" title="Cerrar" onClick={() => setPanelOpen(false)}><X size={16} /></button>
                </div>
              </div>

              {drawerTab === 'puntos' ? (
                <div className="drawer-pane">
                  <div className="sidebar-head">
                    <h2>Circuitos</h2>
                    <span className="count">{markers.length} puntos</span>
                  </div>
                  <div className="filters">
                    <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
                    <button className={filter === 'usuario' ? 'active' : ''} onClick={() => setFilter('usuario')}>Con circuito</button>
                  </div>
                  <div className="searchbox">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar circuito o nota…"
                      aria-label="Buscar circuito o nota"
                    />
                  </div>
                  <div className="stats">
                    <div className="stat"><span className="st-num">{markersWithCode.length}</span><span className="st-label">con circuito</span></div>
                    <div className="stat"><span className="st-num">{Object.keys(byCode).length}</span><span className="st-label">circuitos únicos</span></div>
                    <div className="stat"><span className={`st-num ${Object.keys(incoming).length ? 'red' : ''}`}>{Object.keys(incoming).length}</span><span className="st-label">alertas activas</span></div>
                  </div>
                  <div className="marker-list">
                    {markersLoading && markers.length === 0 && <Spinner label="Cargando puntos…" />}
                    {!markersLoading && markers.length === 0 && (
                      <div className="empty">Aún no hay puntos. Toca "Agregar mi punto" y marca tu ubicación.</div>
                    )}
                    {filteredMarkers.length === 0 && markers.length > 0 && (
                      <div className="empty">Sin resultados para "{search}".</div>
                    )}
                    {filteredMarkers.map((m) => {
                      const status = incoming[m.circuit] && incoming[m.circuit].status
                      const stColor = status === 'AFECTADO' ? 'red' : status === 'RESTABLECIDO' ? 'green' : null
                      return (
                        <div className="marker-row" key={m.id} onClick={() => flyToMarker(m)}>
                          <div className="mr-left">
                            <div className="mr-title">
                              {m.circuit || 'Sin circuito'}
                              {unread[m.circuit] > 0 && <span className="row-unread" title="Alerta(s) no leída(s)">●{unread[m.circuit] > 1 ? unread[m.circuit] : ''}</span>}
                              {stColor && <span className={`row-status ${stColor}`} title={status}>●</span>}
                            </div>
                            <div className="mr-sub">{m.note || `${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}`}</div>
                          </div>
                          <div className="mr-right">
                            {m.circuit && (
                              <button
                                className="row-hist"
                                title="Historial de alertas"
                                aria-label="Ver historial de alertas"
                                onClick={(e) => { e.stopPropagation(); openHistorial(m.circuit) }}
                              ><History size={14} /></button>
                            )}
                            {isAdmin && <button className="del" onClick={(e) => { e.stopPropagation(); removeMarker(m.id) }}>×</button>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="sidebar-foot">
                    {lastUpdate && <span>Actualizado {lastUpdate.toLocaleTimeString()}</span>}
                    <button className="foot-reload" title="Actualizar puntos" onClick={() => { reloadMarkers(); setToast({ text: 'Lista actualizada' }) }}><RefreshCw size={14} /> Actualizar</button>
                  </div>
                </div>
              ) : (
                <div className="drawer-pane">
                  <div className="drawer-sub">
                    <span>Avisos de zona / municipio</span>
                    <button className="icon-btn" title="Actualizar" onClick={loadMunicipios}>
                      {munLoading ? <span className="spin-sm" /> : <RefreshCw size={15} />}
                    </button>
                  </div>
                  <p className="muni-hint">Avisos generales sin punto específico (ej. Boyeros, Cerro…)</p>
                  <div className="muni-list">
                    {munLoading && munList.length === 0 && <Spinner label="Cargando avisos…" />}
                    {!munLoading && munList.length === 0 && <div className="empty">Sin avisos de municipio.</div>}
                    {munList.map((h) => (
                      <button className="muni-row" key={h.id} onClick={() => openDetail({ ...h })}>
                        <StatusDot status={h.status} />
                        <div className="muni-body">
                          <div className="muni-code">
                            {h.circuit}
                            {unread[h.circuit] > 0 && <span className="row-unread" title="Alerta(s) no leída(s)">●{unread[h.circuit] > 1 ? unread[h.circuit] : ''}</span>}
                          </div>
                          <div className="muni-text">{h.text}</div>
                          <div className="muni-time">{new Date(h.created_at).toLocaleString()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </>
        )
      })()}

      {/* Onboarding: bienvenida */}
      {showIntro && (
        <div className="intro">
          <div className="intro-card">
            <div className="intro-logo"><Zap size={28} /></div>
            <h1>Circuito Aviso</h1>
            <p className="intro-desc">
              Esta web sirve para que juntos localicemos nuestras zonas y circuitos eléctricos.
              Comparte cuál es tu circuito y dónde está para que, en tiempo real, podamos
              avisarte cuando haya afectaciones o restablecimientos de la luz en tu área.
            </p>
            <div className="intro-step">
              <span className="step-num">1</span>
              <span>Selecciona tu provincia</span>
            </div>
            <div className="prov-grid">
              {PROVINCIAS.map((p) => (
                <button key={p.name} className="prov-btn" onClick={() => finishOnboarding(p.name)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="intro-foot">
              �Quieres agregar tu punto? Hazlo desde el mapa con el bot�n
              <strong> "Agregar mi punto"</strong>.
            </div>
          </div>
        </div>
      )}

      {/* Onboarding: asistente de notificaciones / sonido (banner flotante, abre paneles reales) */}
      {setupStep === 1 && (
        <div className="setup-banner">
          <div className="setup-banner-head">
            <span className="setup-banner-step">Paso 1 de 3</span>
            <b><Volume2 size={15} /> ¿Qué circuitos suenan?</b>
          </div>
          <p className="setup-banner-text">
            En el panel de arriba <b>eliges de verdad</b> qué circuitos suenan. Toca
            <b> "Sonar todos"</b> o <b>"Silenciar todos"</b>, o elige circuito por circuito. Cuando
            termines, avanza.
          </p>
          <div className="setup-actions">
            <button className="prov-btn setup-btn yes" onClick={soundAll}><Volume2 size={16} /> Sonar todos</button>
            <button className="prov-btn setup-btn" onClick={soundNone}><VolumeX size={16} /> Silenciar todos</button>
          </div>
          <button className="prov-btn setup-btn done" onClick={nextSetupStep}>Siguiente →</button>
        </div>
      )}

      {setupStep === 2 && (
        <div className="setup-banner">
          <div className="setup-banner-head">
            <span className="setup-banner-step">Paso 2 de 3</span>
            <b><Bell size={15} /> Activa las notificaciones</b>
          </div>
          <p className="setup-banner-text">
            Así recibirás el aviso <b>aunque cierres la web</b> (en tu móvil). Pulga el botón y
            acepta el permiso del navegador.
          </p>
          {('serviceWorker' in navigator && 'PushManager' in window) ? (
            <div className="setup-actions">
              <button
                className="prov-btn setup-btn yes"
                onClick={() => pushApi.subscribe().then((id) => { if (id) setToast({ text: 'Notificaciones activadas' }); })}
              >
                <Bell size={16} /> {pushApi.enabled ? 'Reactivar notificaciones' : 'Activar notificaciones'}
              </button>
            </div>
          ) : (
            <p className="setup-banner-text">Tu navegador no soporta notificaciones; puedes continuar igual.</p>
          )}
          {pushApi.enabled && <p className="setup-banner-ok"><Check size={14} /> Notificaciones activadas</p>}
          <button className="prov-btn setup-btn done" onClick={nextSetupStep}>Siguiente →</button>
        </div>
      )}

      {setupStep === 3 && (
        <div className="setup-banner">
          <div className="setup-banner-head">
            <span className="setup-banner-step">Paso 3 de 3</span>
            <b><Check size={15} /> ¡Todo listo!</b>
          </div>
          <p className="setup-banner-text">
            Configuración guardada. Siempre podrás cambiarla desde el icono de sonido, circuito por circuito.
          </p>
          <button className="prov-btn setup-btn done" onClick={finishSetup}>
            <Check size={16} /> ¡Comenzar!
          </button>
        </div>
      )}
    </div>
  )
}
