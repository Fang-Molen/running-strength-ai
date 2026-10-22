// Official Strava personal MCP authorization; server-only configuration and cookies.
import { handleStravaMcp } from '../../../src/lib/health/strava-mcp-server.ts';

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join('/');
  return handleStravaMcp(request, path, {
    fetch: (url, init) => fetch(url, init),
    stateKey: env.STATE_KEY,
    personalUse: env.STRAVA_MCP_PERSONAL_USE,
    personalOwner: env.STRAVA_MCP_PERSONAL_OWNER,
    personalAccessKey: env.STRAVA_MCP_PERSONAL_ACCESS_KEY,
  });
}
