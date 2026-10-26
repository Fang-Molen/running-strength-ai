import { createFileRoute } from '@tanstack/react-router';
import { restoreCoachProxyRequest } from '../../../../server/coach-deepseek/coach-proxy.server';

async function handleAuthRequest(request: Request) {
  try { request = restoreCoachProxyRequest(request); }
  catch { return Response.json({ error: 'PROXY_AUTH_FAILED' }, { status: 403, headers: { 'cache-control': 'no-store' } }); }
  return (await import('../../../lib/auth/server')).auth.handler(request);
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: {
    GET: ({ request }) => handleAuthRequest(request),
    POST: ({ request }) => handleAuthRequest(request),
  } },
});
