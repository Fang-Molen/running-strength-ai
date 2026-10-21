// 高驰官方 MCP OAuth 中转（v89.10）：逻辑在 src/lib/health/coros-mcp-server.ts。不记录日志、不保存任何数据到服务器。
import { handleCorosMcp } from '../../../src/lib/health/coros-mcp-server.ts';
export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join('/');
  return handleCorosMcp(request, path, { fetch: (u, i) => fetch(u, i), stateKey: env.STATE_KEY });
}
