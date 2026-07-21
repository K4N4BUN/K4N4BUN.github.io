"use strict";
const CACHE_NAME="zandaka-yohou-v1-3-0";
const APP_SHELL=["./","./index.html","./manifest.json","./icon.svg","./icon-192.png","./icon-512.png","./apple-touch-icon-180.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{if(event.request.method!=="GET")return;const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;if(event.request.mode==="navigate"){event.respondWith(fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put("./index.html",response.clone()));return response}).catch(()=>caches.match("./index.html")));return}event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));return response})))});
