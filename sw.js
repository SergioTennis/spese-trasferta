const CACHE='spese-v7';
const ASSETS=['./?v=7','./index.html','./style.css?v=7','./manifest.json','./app.js?v=7'];
self.addEventListener('install',(event)=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(ASSETS)))});
self.addEventListener('activate',(event)=>event.waitUntil(Promise.all([caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key!==CACHE).map((key)=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('fetch',(event)=>{if(event.request.url.includes('firebase')||event.request.url.includes('googleapis'))return;event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match(event.request))) });
