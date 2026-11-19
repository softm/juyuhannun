const CACHE_NAME='juyuhannun-shell-source';
const BUILD_ASSETS=[];
const SHELL=[...new Set(['./','./?source=pwa','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png',...BUILD_ASSETS])];

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('juyuhannun-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin||url.pathname.includes('/data/')||url.pathname.includes('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(response=>{
   if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put('./',response.clone()));
   return response;
  }).catch(()=>caches.match('./')));
  return;
 }
 event.respondWith(caches.match(request).then(cached=>{
  const refresh=fetch(request).then(response=>{
   if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
   return response;
  });
  if(cached){event.waitUntil(refresh.catch(()=>{}));return cached;}
  return refresh;
 }));
});
