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

export async function apiNotifications(circuit, limit = 50, kind) {
  let p = `limit=${limit}`
  if (circuit) p += `&circuit=${encodeURIComponent(circuit)}`
  if (kind) p += `&kind=${encodeURIComponent(kind)}`
  const data = await apiGet(`/notifications?${p}`)
  return data
}

export const EVENT_STREAM_URL = API_BASE + '/events/stream'
