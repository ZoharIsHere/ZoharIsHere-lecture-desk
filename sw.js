// sw.js — lets Lecture Desk open offline and start fast.
// App files: network first (updates arrive at once), cached copy when offline.
// Libraries and fonts from CDNs: cache first (versioned URLs never change).
// The backend (Supabase) and AI calls are never cached.
const APP = 'ld-app-v1';
const LIB = 'ld-lib-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'css/katex.css', 'js/main.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![APP, LIB].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('googleapis.com') && url.pathname.includes('generativelanguage')) return;
  const isLib = /(^|\.)jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (isLib) {
    e.respondWith(caches.open(LIB).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(APP).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
