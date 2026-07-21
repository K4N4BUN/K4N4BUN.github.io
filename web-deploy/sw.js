"use strict";
const CACHE_NAME="zandaka-yohou-v0-8-0-20260721";
const APP_SHELL=[
  "./","./index.html","./manifest.json","./version.json",
  "./features.css","./cloud.css","./cloud-config.js","./cloud.js",
  "./billing.css","./billing-config.js","./legal.css","./design-v080.css","./design-v080.js",
  "./assets/app.js","./privacy.html","./terms.html","./delete-account.html",
  "./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon-180.png"
];
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const url of APP_SHELL){
      try{const response=await fetch(url,{cache:"reload"});if(response.ok)await cache.put(url,response);}catch(_){/* do not fail the whole install */}
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request,{cache:"no-store"}).catch(()=>caches.match("./index.html")));
    return;
  }
  if(url.pathname.endsWith("/version.json")||url.pathname.endsWith("/cloud-config.js")||url.pathname.endsWith("/billing-config.js")||url.pathname.endsWith("/sw.js")){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));}
    return response;
  })));
});
self.addEventListener("message",event=>{if(event.data&&event.data.type==="SKIP_WAITING")self.skipWaiting();});
