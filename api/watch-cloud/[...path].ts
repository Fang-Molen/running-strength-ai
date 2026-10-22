// Vercel adapter for the same Web Request/Response handler used by Cloudflare Pages.
import { handleWatchCloudRequest } from '../../src/lib/health/cloud-server.ts'

// Node.js is Vercel's default runtime; standalone Edge Functions are deprecated.
export const config = { maxDuration: 60 }

async function watchCloud(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/watch-cloud\/?/, '')
  return handleWatchCloudRequest(request, path, { fetch: (input, init) => fetch(input, init), env: {
    WATCH_CLOUD_PUBLIC_ORIGIN: process.env.WATCH_CLOUD_PUBLIC_ORIGIN,
    WATCH_CLOUD_STATE_KEY: process.env.WATCH_CLOUD_STATE_KEY,
    STATE_KEY: process.env.STATE_KEY,
    POLAR_CLIENT_ID: process.env.POLAR_CLIENT_ID,
    POLAR_CLIENT_SECRET: process.env.POLAR_CLIENT_SECRET,
    SUUNTO_CLIENT_ID: process.env.SUUNTO_CLIENT_ID,
    SUUNTO_CLIENT_SECRET: process.env.SUUNTO_CLIENT_SECRET,
    SUUNTO_SUBSCRIPTION_KEY: process.env.SUUNTO_SUBSCRIPTION_KEY,
  } })
}

export { watchCloud as GET, watchCloud as POST }
