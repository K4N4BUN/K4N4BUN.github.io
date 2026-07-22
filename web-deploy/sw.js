"use strict";
const CACHE_NAME="zandaka-yohou-v0-8-2";
const APP_SHELL=[
  "./","./index.html","./manifest.json","./version.json",
  "./features.css","./src/features.js","./src/core/analytics.js","./src/core/crypto.js","./src/native/security.js","./src/native/notifications.js","./cloud.css","./cloud-config.js","./cloud.js","./billing.css","./billing-config.js","./legal.css",
  "./assets/app.js","./assets/web.js",
  "./privacy.html","./terms.html","./delete-account.html",
  "./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon-180.png"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.endsWith("/version.json")||url.pathname.endsWith("/cloud-config.js")||url.pathname.endsWith("/billing-config.js")||url.pathname.endsWith("/sw.js")){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }

  if(event.request.mode==="navigate"){
    event.respondWith(
      fetch(event.request,{cache:"no-store"})
        .then(response=>{
          if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));
          return response;
        })
        .catch(()=>caches.match(event.request).then(x=>x||caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
      if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));
      return response;
    }))
  );
});

self.addEventListener("message",event=>{
  if(event.data&&event.data.type==="SKIP_WAITING")self.skipWaiting();
});
