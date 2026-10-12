const CACHE = "fr255-shell-2"
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

function cacheable(request, url) {
  // Never intercept downloadable archives or user data exports.
  if (/\.(?:zip|tar|gz|7z|pdf|csv|jsonl?)(?:$)/i.test(url.pathname)) return false
  if (request.method !== "GET" || url.origin !== self.location.origin || blocked(url)) return false
  if (request.headers.get("authorization")) return false
  if (request.mode === "navigate" || request.destination === "document") return true
  return ["script", "style", "image", "font", "manifest"].includes(request.destination)
    || url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/__grok/")
    || url.pathname.startsWith("/fangshen/")
    || url.pathname === "/favicon.svg"
    || url.pathname === "/sw.js"
}

async function fromNetwork(request) {
  const cache = await caches.open(CACHE)
  const response = await fetch(request)
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
