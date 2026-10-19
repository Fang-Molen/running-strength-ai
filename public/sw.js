const CACHE = "fr255-shell-v77"
const DEMO_CACHE="fk-demo3d-v74-paired"
const CACHE_PREFIX = "fr255-shell-"

function blocked(url) {
  return url.pathname.startsWith("/api")
    || url.pathname.includes("/_server")
    || url.pathname.includes("serverFn")
    || url.pathname.includes("server-fn")
}

function ownedShellCache(key) {
  return key.startsWith(CACHE_PREFIX)
}

// A browser fetch has no document destination. Only this explicit, same-origin
// root-shell prefetch may cache HTML before the user's first online reload.
function shellPrefetch(request, url) {
  return request.method === "GET" && url.origin === self.location.origin
    && url.pathname === "/" && !url.search
    && request.headers.get("x-fangkun-shell-prefetch") === "1"
    && /text\/html/i.test(request.headers.get("accept") || "")
}

function cacheable(request, url) {
  // An approval may be revoked: never serve a stale approval/GLB from the shell cache.
  if (url.pathname.startsWith("/fangkun-motion/") || url.pathname.startsWith("/demo3d/models/")) return false
  // Never intercept downloadable archives or user data exports.
  if (!url.pathname.startsWith("/demo3d/") && !url.pathname.startsWith("/exercise-sources/") && !url.pathname.startsWith("/food/") && /\.(?:zip|tar|gz|7z|pdf|csv|jsonl?)(?:$)/i.test(url.pathname)) return false
  if (request.method !== "GET" || url.origin !== self.location.origin || blocked(url)) return false
  if (request.headers.get("authorization")) return false
  if (request.mode === "navigate" || request.destination === "document" || shellPrefetch(request, url)) return true
  return ["script", "style", "image", "font", "manifest"].includes(request.destination)
    || url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/__grok/")
    || url.pathname.startsWith("/fangshen/")
    || url.pathname.startsWith("/fangkun-new-visual/")
    || url.pathname.startsWith("/exercise-sources/")
    || url.pathname.startsWith("/food/")
    || url.pathname.startsWith("/demo3d/")
    || url.pathname.startsWith("/fangkun-bodylab/")
    || url.pathname === "/favicon.svg"
    || url.pathname === "/sw.js"
}

async function fromNetwork(request) {
  const cache = await caches.open(CACHE)
  const response = await fetch(request)
  const isDoc = request.mode === "navigate" || request.destination === "document" || shellPrefetch(request, new URL(request.url))
  const htmlBody = /text\/html/i.test(response.headers.get("content-type") || "")
  // An asset URL answered with HTML is a stale/missing chunk: never cache it, surface a 404.
  if (!isDoc && htmlBody) return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
  if (response && response.ok && response.type === "basic") {
    const contentType = response.headers.get("content-type") || ""
    const isScript = request.destination === "script" || /\.(?:m?js)(?:$)/i.test(new URL(request.url).pathname)
    const validScript = !isScript || /(?:javascript|ecmascript)/i.test(contentType)
    const cacheControl = response.headers.get("cache-control") || ""
    if (validScript && !/\bno-store\b/i.test(cacheControl)) try {
      await cache.put(request, response.clone())
    } catch {
      /* 缓存写满时仍返回网络结果，不把在线访问变成失败。 */
    }
  }
  return response
}

async function networkFirst(request) {
  try {
    return await fromNetwork(request)
  } catch {
    const cache = await caches.open(CACHE)
    return (await cache.match(request, { ignoreVary: true }))
      || (["/demo3d/", "/exercise-sources/"].some(p=>new URL(request.url).pathname.startsWith(p)) ? await (await caches.open(DEMO_CACHE)).match(request,{ignoreVary:true}) : undefined)
      || (request.mode === "navigate" ? await cache.match("/", { ignoreVary: true }) : undefined)
      || new Response("离线且没有可用缓存", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ownedShellCache(key) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!cacheable(event.request, url)) return
  event.respondWith(networkFirst(event.request))
})

// R9：推送与通知点击。目前没有推送服务器，提醒由页面在打开期间调用 showNotification；
// 将来服务器用 VAPID 发 Web Push 时，这里直接显示（iOS 16.4+ 需添加到主屏幕）。
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "方坤", { body: data.body || "看看今天的课", tag: data.tag || "fk-reminder", data: { url: data.url || "/" } }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
