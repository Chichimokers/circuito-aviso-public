let audioCtx

function getCtx() {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

function beep(type, freq, when, dur, vol) {
  const ctx = getCtx()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  osc.connect(gain)
  gain.connect(ctx.destination)
  const t0 = ctx.currentTime + when
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

// Tonos predefinidos por circuito
const TONES = {
  alarma: () => ([0, 0.55, 1.1].forEach((off) => {
    beep('square', 520, off, 0.22, 0.7)
    beep('square', 620, off + 0.26, 0.22, 0.7)
  })),
  bip: () => {
    beep('square', 880, 0, 0.18, 0.5)
    beep('square', 880, 0.3, 0.18, 0.5)
  },
  chime: () => {
    beep('sine', 660, 0, 0.3, 0.45)
    beep('sine', 990, 0.22, 0.4, 0.45)
  },
  doble: () => {
    beep('square', 700, 0, 0.15, 0.5)
    beep('square', 700, 0.2, 0.15, 0.5)
  },
  timbre: () => {
    beep('triangle', 523, 0, 0.5, 0.5)
    beep('triangle', 784, 0.4, 0.6, 0.5)
  },
}

export const PREDEFINED_TONES = Object.keys(TONES)

function playTone(name) {
  const fn = TONES[name]
  if (fn) fn()
}

function playDefault(status) {
  if (status === 'AFECTADO') {
    [0, 0.55, 1.1].forEach((off) => {
      beep('square', 520, off, 0.22, 0.7)
      beep('square', 620, off + 0.26, 0.22, 0.7)
    })
  } else if (status === 'RESTABLECIDO') {
    beep('square', 880, 0, 0.3, 0.5)
    beep('square', 880, 0.42, 0.3, 0.5)
  } else {
    beep('square', 988, 0, 0.18, 0.4)
  }
}

// ---- Configuración persistida por circuito (localStorage, solo meta pequeña) ----
// cfg: { mode: 'default'|'none'|'predefined'|'custom', tone?, name? }
const KEY = 'cav_sounds'
export const DEFAULT_CIRCUIT_SOUND = { mode: 'default' }

export function loadCircuitSounds() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

export function getCircuitSound(circuit) {
  return loadCircuitSounds()[circuit] || DEFAULT_CIRCUIT_SOUND
}

function persistSounds(all) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch (e) {
    return false
  }
  return true
}

export function setCircuitSound(circuit, cfg) {
  const all = loadCircuitSounds()
  if (!cfg || !cfg.mode || cfg.mode === 'default') {
    delete all[circuit]
  } else {
    all[circuit] = cfg
  }
  return persistSounds(all)
}

// ---- Audio personalizado: se guarda en IndexedDB (cuota grande) ----
const DB_NAME = 'cav_audio_db'
const DB_VER = 1
const STORE = 'audio'
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexdb'))
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
async function getAudioRecord(circuit) {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(circuit)
    r.onsuccess = () => resolve(r.result || null)
    r.onerror = () => reject(r.error)
  })
}

// Guarda el audio de un circuito y marca la config como custom
export async function saveCustomAudio(circuit, arrayBuffer, name) {
  const db = await openDb()
  await txDone(db.transaction(STORE, 'readwrite').objectStore(STORE)
    .put({ buf: arrayBuffer, name, ts: Date.now() }, circuit).transaction)
  const all = loadCircuitSounds()
  all[circuit] = { mode: 'custom', name }
  return persistSounds(all)
}

// Elimina el audio de un circuito y vuelve la config a predeterminado
export async function clearCustomAudio(circuit) {
  const db = await openDb()
  await txDone(db.transaction(STORE, 'readwrite').objectStore(STORE)
    .delete(circuit).transaction)
  const all = loadCircuitSounds()
  delete all[circuit]
  persistSounds(all)
  bufferCache.delete(circuit)
}

const bufferCache = new Map()
async function playCustom(circuit) {
  const ctx = getCtx()
  if (!ctx) return
  let buf = bufferCache.get(circuit)
  if (!buf) {
    let rec
    try { rec = await getAudioRecord(circuit) } catch (e) { return }
    if (!rec || !rec.buf) return
    try {
      buf = await ctx.decodeAudioData(rec.buf.slice(0))
    } catch (e) {
      return
    }
    bufferCache.set(circuit, buf)
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
}

// Reproduce el sonido de un circuito según su config.
// - 'none'      : silenciado
// - 'predefined': tono predefinido (tone)
// - 'custom'    : audio subido por el usuario (desde IndexedDB)
// - 'default'   : sonido por defecto según el estado
export function playNotifySoundForCircuit(circuit, cfg, status) {
  if (!cfg || !cfg.mode) { playDefault(status); return }
  if (cfg.mode === 'none') return
  if (cfg.mode === 'predefined' && cfg.tone) { playTone(cfg.tone); return }
  if (cfg.mode === 'custom') { playCustom(circuit); return }
  playDefault(status)
}

// Mantener compatibilidad con llamadas que no pasan config
export function playNotifySound(status, circuit) {
  const cfg = circuit ? getCircuitSound(circuit) : null
  playNotifySoundForCircuit(circuit, cfg, status)
}

export function statusMeta(status) {
  if (status === 'AFECTADO') return { tone: 'red' }
  if (status === 'RESTABLECIDO') return { tone: 'green' }
  return { tone: 'blue' }
}
