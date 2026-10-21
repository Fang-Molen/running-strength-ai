import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
const cacheName = vm.runInNewContext(source + "\nCACHE", {self: {addEventListener() {}}})

function boot() {
  const handlers = new Map()
  const stores = new Map()
  function makeRes(body, status, headers, type = "basic") {
    const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
    return {
      ok: status >= 200 && status < 300,
      status,
      type,
      headers: { get: (name) => values.get(String(name).toLowerCase()) ?? null },
      clone() { return makeRes(body, status, headers, type) },
      text: async () => body,
    }
  }
  function open(name) {
    if (!stores.has(name)) stores.set(name, new Map())
    const box = stores.get(name)
    return {
      async put(request, response) { box.set(request.url, await response.text()) },
      async match(request) {
        const body = box.get(request.url)
        return body == null ? undefined : makeRes(body, 200, { "content-type": "application/javascript" })
      },
    }
  }
  let fetchImpl = async () => { throw new Error("offline") }
  const sandbox = {
    URL,
    Response,
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch: (request) => fetchImpl(request),
    self: {
      location: { origin: "https://example.test" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name, fn) => handlers.set(name, fn),
    },
  }
  vm.runInNewContext(source, sandbox)
  return { handlers, stores, setFetch: (next) => { fetchImpl = next } }
}

test("the shell cache version moves off fr255-shell-1 and only owns its own prefix", () => {
  assert.match(cacheName, /^fr255-shell-v[0-9]+(?:-[a-z0-9]+)+$/)
  assert.notEqual(cacheName, "fr255-shell-1")
  assert.doesNotMatch(source, /fr255-shell-1/)
  assert.doesNotMatch(source, /localStorage|indexedDB|sessionStorage/)
  assert.match(source, /ownedShellCache\(key\) && key !== CACHE/)
})

test("activation deletes old shell caches, keeps foreign caches, and drops poisoned JavaScript", async () => {
  const { handlers, stores } = boot()
  stores.set("fr255-shell-1", new Map([["https://example.test/assets/app.js", "<html>poison</html>"]]))
  stores.set("other-app-cache", new Map([["https://example.test/other.js", "leave-me"]]))
  let ready
  handlers.get("activate")({ waitUntil: (promise) => { ready = promise } })
  await ready
  assert.equal(stores.has("fr255-shell-1"), false)
  assert.equal(stores.get("other-app-cache").get("https://example.test/other.js"), "leave-me")
  let response
  handlers.get("fetch")({
    request: { url: "https://example.test/assets/app.js", method: "GET", destination: "script", mode: "cors", headers: { get: () => null } },
    respondWith: (promise) => { response = promise },
  })
  const missed = await response
  assert.equal(missed.status, 503)
  assert.equal((await missed.text()).includes("poison"), false)
})

test("a rebuilt shell restores a valid script offline and still rejects HTML and archives", async () => {
  const { handlers, stores, setFetch } = boot()
  setFetch(async () => ({
    ok: true,
    status: 200,
    type: "basic",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/javascript" : "public, max-age=10" },
    clone() { return this },
    text: async () => "export const fresh = 1",
  }))
  let cached
  handlers.get("fetch")({
    request: { url: "https://example.test/assets/fresh.js", method: "GET", destination: "script", mode: "cors", headers: { get: () => null } },
    respondWith: (promise) => { cached = promise },
  })
  assert.equal(await (await cached).text(), "export const fresh = 1")
  assert.equal(stores.get(cacheName).get("https://example.test/assets/fresh.js"), "export const fresh = 1")
  setFetch(async () => { throw new Error("offline") })
  let offline
  handlers.get("fetch")({
    request: { url: "https://example.test/assets/fresh.js", method: "GET", destination: "script", mode: "cors", headers: { get: () => null } },
    respondWith: (promise) => { offline = promise },
  })
  assert.equal(await (await offline).text(), "export const fresh = 1")
  setFetch(async () => ({
    ok: true,
    status: 200,
    type: "basic",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "text/html" : "" },
    clone() { return this },
    text: async () => "<html>nope</html>",
  }))
  let html
  handlers.get("fetch")({
    request: { url: "https://example.test/assets/bad.js", method: "GET", destination: "script", mode: "cors", headers: { get: () => null } },
    respondWith: (promise) => { html = promise },
  })
  await html
  assert.equal(stores.get(cacheName).has("https://example.test/assets/bad.js"), false)
  let intercepted = false
  handlers.get("fetch")({
    request: { url: "https://example.test/backup.zip", method: "GET", destination: "document", mode: "navigate", headers: { get: () => null } },
    respondWith: () => { intercepted = true },
  })
  assert.equal(intercepted, false)
})

test('legacy GLB is not intercepted by the shell and private health APIs bypass it', async()=>{
 const {handlers}=boot();let intercepted=false;
 const mk=url=>({url:'https://example.test'+url,method:'GET',destination:'',mode:'cors',headers:{get:()=>null}});
 for(const url of ['/demo3d/models/athlete-female.glb','/api/health']){
  handlers.get('fetch')({request:mk(url),respondWith:()=>{intercepted=true}})
 }
 assert.equal(intercepted,false)
});

test('revocable new motion manifest / models bypass stale service worker cache',()=>{
 const {handlers}=boot();let intercepts=0;
 const mk=(url)=>({url:'https://example.test'+url,method:'GET',destination:'',mode:'cors',headers:{get:()=>null}});
 for(const url of ['/fangkun-motion/manifest.json','/fangkun-motion/assets/back-squat-female.glb']){
   handlers.get('fetch')({request:mk(url),respondWith:()=>{intercepts++}})
 }
 assert.equal(intercepts,0)
});

test('explicit root prefetch caches the shell before any controlled navigation', async () => {
  const {handlers, stores, setFetch} = boot()
  setFetch(async () => ({ok: true, type: 'basic', headers: {get: name => name === 'content-type' ? 'text/html' : ''}, clone() {return this}, text: async () => '<html>public shell</html>'}))
  const request = {url: 'https://example.test/', method: 'GET', destination: '', mode: 'cors', headers: {get: name => ({'x-fangkun-shell-prefetch': '1', accept: 'text/html'})[name] ?? null}}
  let response
  handlers.get('fetch')({request, respondWith: promise => {response = promise}})
  assert.equal(await (await response).text(), '<html>public shell</html>')
  assert.equal(stores.get(cacheName).get(request.url), '<html>public shell</html>')
  setFetch(async () => {throw new Error('offline')})
  handlers.get('fetch')({request: {...request, mode: 'navigate', destination: 'document'}, respondWith: promise => {response = promise}})
  assert.equal(await (await response).text(), '<html>public shell</html>')
})

test('prefetch marker does not cache unmarked requests, queries, other paths, private responses or writes', async () => {
  const {handlers, stores, setFetch} = boot()
  const base = {url: 'https://example.test/', method: 'GET', destination: '', mode: 'cors', headers: {get: name => ({'x-fangkun-shell-prefetch': '1', accept: 'text/html'})[name] ?? null}}
  for (const request of [
    {...base, headers: {get: () => null}}, {...base, method: 'POST'}, {...base, url: 'https://elsewhere.test/'},
    {...base, url: 'https://example.test/?token=x'}, {...base, url: 'https://example.test/account'}, {...base, url: 'https://example.test/api/health'},
    {...base, headers: {get: name => name === 'authorization' ? 'Bearer private' : base.headers.get(name)}},
  ]) {
    let intercepted = false
    handlers.get('fetch')({request, respondWith: () => {intercepted = true}})
    assert.equal(intercepted, false)
  }
  setFetch(async () => ({ok: true, type: 'basic', headers: {get: name => name === 'content-type' ? 'text/html' : name === 'cache-control' ? 'private, no-store' : ''}, clone() {return this}, text: async () => 'private content'}))
  let response
  handlers.get('fetch')({request: base, respondWith: promise => {response = promise}})
  assert.equal(await (await response).text(), 'private content')
  assert.equal(stores.get(cacheName).has(base.url), false)
})
