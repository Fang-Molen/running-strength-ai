import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyCoachBackend } from '../../functions/api/coach-backend.js';
import { onRequestPost, onRequestGet } from '../../functions/api/coach-chat.js';
import { onRequestDelete } from '../../functions/api/coach-snapshot.js';
import { restoreCoachProxyRequest } from './coach-proxy.server.ts';

test('Cloudflare binding preserves URL, same-origin identity headers and method, without provider I/O', async () => {
  let calls = 0;
  const request = new Request('https://coach.test/api/coach-snapshot', { method: 'DELETE', headers: { origin: 'https://coach.test', cookie: 'synthetic-session', 'content-type': 'application/json' }, body: '{"snapshotId":"synthetic"}' });
  const env = { FANGKUN_COACH_BACKEND: { fetch: async (/** @type {Request} */ forwarded) => {
    calls++;
    assert.equal(forwarded.url, request.url); assert.equal(forwarded.method, 'DELETE');
    assert.equal(forwarded.headers.get('origin'), 'https://coach.test'); assert.equal(forwarded.headers.get('cookie'), 'synthetic-session');
    assert.equal(forwarded.redirect, 'manual'); assert.deepEqual(await forwarded.json(), { snapshotId: 'synthetic' });
    return Response.json({ ok: true, revoked: true });
  } } };
  assert.equal((await onRequestDelete({ request, env })).status, 200); assert.equal(calls, 1);
});
test('JSON cannot install service binding; backend redirect and failures stay explicit', async () => {
  const request = () => new Request('https://coach.test/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ FANGKUN_COACH_BACKEND: { fetch: 'forged' } }) });
  assert.equal((await proxyCoachBackend({ request: request() })).status, 503);
  assert.equal((await onRequestPost({ request: request(), env: { FANGKUN_DEEPSEEK_ENABLED: 'true' } })).status, 503);
  const redirect = await proxyCoachBackend({ request: request(), env: { FANGKUN_COACH_BACKEND: { fetch: async () => Response.redirect('https://untrusted.test', 302) } } });
  assert.equal(redirect.status, 503); assert.equal((await redirect.json()).error, 'BACKEND_UNAVAILABLE');
});
test('Pages status checks use bound backend and do not post data', async () => {
  let calls = 0;
  const response = await onRequestGet({ request: new Request('https://coach.test/api/coach-chat'), env: { FANGKUN_COACH_BACKEND: { fetch: async (/** @type {Request} */ request) => {
    calls++; assert.equal(request.method, 'GET'); assert.equal(request.body, null);
    return Response.json({ configured: false, reason: 'POLICY_UNVERIFIED', connectionVerified: false });
  } } } });
  assert.equal(calls, 1); assert.equal((await response.json()).reason, 'POLICY_UNVERIFIED');
});

test('auth callback forwards a safe browser redirect and its session cookie without following it', async () => {
  let calls=0;
  const request=new Request('https://coach.test/api/auth/callback/grok');
  const response=await proxyCoachBackend({request,env:{FANGKUN_COACH_BACKEND:{fetch:async incoming=>{
    calls++;assert.equal(incoming.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'https://coach.test/','set-cookie':'synthetic-session=ok; Secure; HttpOnly; Path=/'}});
  }}}});
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),'https://coach.test/');assert.match(response.headers.get('set-cookie')??'',/HttpOnly/);assert.equal(calls,1);
});
test('auth redirects allow only public origin or the configured HTTPS issuer',async()=>{
 /** @type {Array<[string,number]>} */
 const redirects=[['/login',302],['https://issuer.test/authorize',302],['https://untrusted.test/steal',503],['http://coach.test/',503],['javascript:alert(1)',503]];
 for(const [location,expected] of redirects){
  const response=await proxyCoachBackend({request:new Request('https://coach.test/api/auth/callback/grok'),env:{GROK_AUTH_ISSUER:'https://issuer.test',FANGKUN_COACH_BACKEND:{fetch:async()=>new Response(null,{status:302,headers:{location}})}}});
  assert.equal(response.status,expected,location);
 }
});

test('Pages HTTPS proxy uses configured destination and Node restores only its configured public origin', async () => {
  const previousFetch = globalThis.fetch;
  const secret = 'synthetic-proxy-secret-never-a-real-secret';
  globalThis.fetch = async input => {
    assert.ok(input instanceof Request);
    assert.equal(input.url, 'https://backend.test/api/coach-snapshot');
    assert.equal(input.redirect, 'manual');
    const restored = restoreCoachProxyRequest(input, { FANGKUN_COACH_PROXY_SECRET: secret, FANGKUN_COACH_PUBLIC_ORIGIN: 'https://public.test' });
    assert.equal(restored.url, 'https://public.test/api/coach-snapshot');
    assert.equal(restored.headers.get('origin'), 'https://public.test');
    assert.equal(restored.headers.get('x-fangkun-coach-proxy'), null);
    assert.equal(restored.headers.get('cookie'), 'synthetic-session');
    assert.deepEqual(await restored.json(), { consent: 'synthetic' });
    return Response.json({ ok: true });
  };
  try {
    const request = new Request('https://public.test/api/coach-snapshot', { method: 'POST', headers: { origin: 'https://public.test', cookie: 'synthetic-session', 'content-type': 'application/json' }, body: JSON.stringify({ consent: 'synthetic' }) });
    assert.equal((await proxyCoachBackend({ request, env: { FANGKUN_COACH_BACKEND_ORIGIN: 'https://backend.test', FANGKUN_COACH_PROXY_SECRET: secret } })).status, 200);
    assert.throws(() => restoreCoachProxyRequest(new Request('https://backend.test/api/coach-chat', { headers: { 'x-fangkun-coach-proxy': 'forged' } }), { FANGKUN_COACH_PROXY_SECRET: secret, FANGKUN_COACH_PUBLIC_ORIGIN: 'https://public.test' }));
  } finally { globalThis.fetch = previousFetch; }
});
