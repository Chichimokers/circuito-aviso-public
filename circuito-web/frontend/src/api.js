const API_BASE = '/circuitos-api/api'

export async function apiGet(path) {
  const res = await fetch(API_BASE + path)
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`)
  return res.json()
}

export async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`)
  return res.json()
}

export async function apiDelete(path) {
  const res = await fetch(API_BASE + path, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`)
  return res.json()
}

export async function apiDeleteAdmin(path, adminKey) {
  const res = await fetch(API_BASE + path, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': adminKey }
  })
  if (!res.ok) throw new Error(`API ${path} -> ${res.status}`)
  return res.json()
}

export async function apiVerifyAdmin(key) {
  try {
    const data = await apiPost('/admin/verify', { key })
    return data.ok === true
  } catch (e) {
    return false
  }
}

export async function apiVote(markerId) {
  const data = await apiPost('/markers/vote', { marker_id: markerId })
  return data
}

export async function apiNotifications(circuit, limit = 50, kind, source) {
  let p = `limit=${limit}`
  if (circuit) p += `&circuit=${encodeURIComponent(circuit)}`
  if (kind) p += `&kind=${encodeURIComponent(kind)}`
  if (source) p += `&source=${encodeURIComponent(source)}`
  const data = await apiGet(`/notifications?${p}`)
  return data
}

export const EVENT_STREAM_URL = API_BASE + '/events/stream'

export async function apiGetVapid() {
  const data = await apiGet('/push/vapid-public-key')
  return data.key || ''
}

export async function apiPushSubscribe(subscription) {
  return apiPost('/push/subscribe', {
    endpoint: subscription.endpoint,
    p256dh: subscription.getKey('p256dh') ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')))) : '',
    auth: subscription.getKey('auth') ? btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')))) : '',
    user_agent: navigator.userAgent || ''
  })
}

export async function apiPushUnsubscribe(subscription) {
  try {
    await apiPost('/push/unsubscribe', {
      endpoint: subscription.endpoint,
      p256dh: '',
      auth: ''
    })
  } catch (e) {}
}

export async function apiPushGetPrefs(subId) {
  const data = await apiGet(`/push/prefs?sub_id=${subId}`)
  return data.prefs || []
}

export async function apiPushSetPref(subId, circuit, cfg) {
  try {
    await apiPost('/push/prefs', {
      sub_id: subId,
      circuit,
      mode: cfg && cfg.mode ? cfg.mode : 'none',
      tone: (cfg && cfg.tone) || null
    })
  } catch (e) {}
}
