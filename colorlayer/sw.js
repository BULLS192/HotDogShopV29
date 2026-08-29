const CACHE = "colorlayer-v0.3.1";
const ASSETS = ["./","./index.html","./styles.css","./loader.js","./pwa.js","./manifest.webmanifest","./icons/icon.svg","./app.part1.js.txt","./app.part2.js.txt","./app.part3.js.txt","./app.part4.js.txt","./app.part5.js.txt"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then(r => r || caches.match("./index.html"))));
});
