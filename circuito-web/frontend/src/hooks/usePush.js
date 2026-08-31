import { useEffect, useRef, useState, useCallback } from 'react'
import { apiGetVapid, apiPushSubscribe, apiPushUnsubscribe, apiPushGetPrefs, apiPushSetPref } from '../api.js'

const SUB_KEY = 'cav_subid'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePush() {
  const [subId, setSubId] = useState(() => {
    const v = localStorage.getItem(SUB_KEY)
    return v ? Number(v) : null
  })
  const [enabled, setEnabled] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const swRegRef = useRef(null)
  const subIdRef = useRef(subId)
  subIdRef.current = subId

  // Registrar service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/circuitos/sw.js')
      .then((reg) => { swRegRef.current = reg })
      .catch(() => {})
  }, [])

  const subscribe = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
      const perm = await Notification.requestPermission()
      setEnabled(perm === 'granted')
      if (perm !== 'granted') return null
      const reg = swRegRef.current || await navigator.serviceWorker.ready
      const key = await apiGetVapid()
      if (!key) return null
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key)
        })
      }
      const data = await apiPushSubscribe(sub)
      const id = data.sub_id
      setSubId(id)
      localStorage.setItem(SUB_KEY, String(id))
      return id
    } catch (e) {
      return null
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    try {
      const reg = swRegRef.current || (navigator.serviceWorker ? await navigator.serviceWorker.ready : null)
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await apiPushUnsubscribe(sub)
          await sub.unsubscribe()
        }
      }
    } catch (e) {}
    setSubId(null)
    localStorage.removeItem(SUB_KEY)
  }, [])

  // Sincronizar prefs locales al servidor (subir las que "suenan" o esten definidas)
  const syncPrefs = useCallback(async (localSounds) => {
    const id = subIdRef.current
    if (!id) return
    try {
      const tasks = []
      for (const [circuit, cfg] of Object.entries(localSounds || {})) {
        if (cfg && cfg.mode) {
          tasks.push(apiPushSetPref(id, circuit, cfg))
        }
      }
      // circuitos ausentes = silenciado -> no se suben (servidor los trata como none por default)
      await Promise.all(tasks)
    } catch (e) {}
  }, [])

  // Descargar prefs del servidor (para rellenar lo guardado en otro dispositivo)
  const pullPrefs = useCallback(async () => {
    const id = subIdRef.current
    if (!id) return null
    try {
      return await apiPushGetPrefs(id)
    } catch (e) {
      return null
    }
  }, [])

  const setServerPref = useCallback((circuit, cfg) => {
    const id = subIdRef.current
    if (!id) return
    apiPushSetPref(id, circuit, cfg)
  }, [])

  return { subId, enabled, subscribe, unsubscribe, syncPrefs, pullPrefs, setServerPref }
}
