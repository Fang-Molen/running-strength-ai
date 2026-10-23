// Cloudflare Pages adapter. Secrets remain in the server environment and encrypted HttpOnly cookies.
import { handleWatchCloudRequest } from '../../../src/lib/health/cloud-server.ts'

export async function onRequest({ request, env, params, data }) {
  const path = [].concat(params.path || []).join('/')
  return handleWatchCloudRequest(request, path, {
    fetch: (input, init) => fetch(input, init),
    env,
    requireTrustedHost: true,
    ...(typeof data?.watchCloudConsumeState === 'function' ? { consumeState: data.watchCloudConsumeState } : {}),
  })
}
