import { handleStravaMcp } from '../../src/lib/health/strava-mcp-server'

function stravaMcp(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/api\/strava-mcp\/?/, '')
  return handleStravaMcp(request, path, {
    fetch: (url, init) => fetch(url, init),
    stateKey: process.env.STATE_KEY,
    personalUse: process.env.STRAVA_MCP_PERSONAL_USE,
    personalOwner: process.env.STRAVA_MCP_PERSONAL_OWNER,
    personalAccessKey: process.env.STRAVA_MCP_PERSONAL_ACCESS_KEY,
  })
}

export { stravaMcp as GET, stravaMcp as POST }
