/* Circuito Aviso - Service Worker */
const CACHE = 'circuito-aviso-v1'
const ASSET_BASE = '/circuitos/'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then((c) => {
      return c.addAll([
        `${ASSET_BASE}manifest.webmanifest`,
        `${ASSET_BASE}icon-192.png`,
        `${ASSET_BASE}icon-512.png`
      ])
    })
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Solo interferir en assets propios de /circuitos/ y en modo navegacion
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith(ASSET_BASE + 'assets/')) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached
        return fetch(e.request).then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
          return res
        })
      }).catch(() => caches.match(`${ASSET_BASE}index.html`))
    )
    return
  }
  // App shell: red a index, fallback a cache
  if (url.pathname === ASSET_BASE || url.pathname === `${ASSET_BASE}index.html`) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(`${ASSET_BASE}index.html`))
    )
  }
})

self.addEventListener('push', (e) => {
  let data = { title: 'Circuito Aviso', body: '', icon: `${ASSET_BASE}icon-192.png` }
  if (e.data) {
    try { data = { ...data, ...e.data.json() } } catch (err) {}
  }
  if (data.icon && !data.icon.startsWith('/') && !data.icon.includes('://')) {
    data.icon = ASSET_BASE + data.icon
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Circuito Aviso', {
      body: data.body || '',
      icon: data.icon || `${ASSET_BASE}icon-192.png`,
      badge: `${ASSET_BASE}icon-192.png`,
      tag: data.tag || 'circuito-aviso',
      data: data.data || {},
      renotify: true
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = `${ASSET_BASE}`
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus() }
      }
      return clients.openWindow(url)
    })
  )
})
