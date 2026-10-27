// ParkFree service worker: works with a weak signal, always prefers fresh data when online.
const V = 'parkfree-v1';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'vendor/leaflet.js', 'vendor/leaflet.css',
  'data/streets.json', 'data/zones.json', 'data/bays.json', 'data/events.json', 'icons/icon-192.png'];
const TILE_HOSTS = ['tiles.openfreemap.org', 'tile.openstreetmap.org', 'tile.openstreetmap.fr'];
const MAX_TILES = 600;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'parkfree-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const c = await caches.open(V);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch (e) {
    return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
  }
}
async function cacheFirst(req) {
  const c = await caches.open(V);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}
async function tiles(req) {
  const c = await caches.open('parkfree-tiles');
  const hit = await c.match(req);
  const net = fetch(req).then(async r => {
    if (r.ok) { c.put(req, r.clone()); const ks = await c.keys(); if (ks.length > MAX_TILES) ks.slice(0, ks.length - MAX_TILES).forEach(k => c.delete(k)); }
    return r;
  }).catch(() => hit || Response.error());
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.endsWith('version.json')) return;                       // update check: always live
    if (req.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.includes('/data/') || u.pathname.endsWith('.webmanifest'))
      return e.respondWith(networkFirst(req));
    if (u.pathname.includes('/vendor/') || u.pathname.includes('/icons/')) return e.respondWith(cacheFirst(req));
    return;
  }
  if (TILE_HOSTS.some(h => u.hostname.endsWith(h))) return e.respondWith(tiles(req));
});
