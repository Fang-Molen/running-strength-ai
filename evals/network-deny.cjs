// Preloaded into the evaluation CLI. Every transport stays blocked, including
// promptfoo's opt-out acknowledgement; classification never permits a request.
const { appendFileSync } = require('node:fs')
function classify(args, transport) {
  if (transport === 'socket' && typeof args[0] === 'string' && /^\/tmp\/tsx-[^/]+\/\d+\.pipe$/.test(args[0])) return 'LOCAL_IPC'
  if (transport === 'fetch') {
    try {
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0]?.url)
      if (/^(?:api\.openai\.com|api\.x\.ai|api\.anthropic\.com|generativelanguage\.googleapis\.com)$/.test(url.hostname)) return 'MODEL_NETWORK'
      const body = JSON.parse(args[1]?.body || '{}')
      if (url.href === 'https://r.promptfoo.app/' && args[1]?.method === 'POST'
        && body.event === 'feature_used' && body.meta?.feature === 'telemetry disabled') return 'DISABLED_TELEMETRY'
    } catch {}
  }
  return 'UNEXPECTED_NETWORK'
}
const blocked = transport => function (...args) {
  const category = classify(args, transport)
  if (process.env.FANGKUN_EVAL_NETWORK_LOG) appendFileSync(process.env.FANGKUN_EVAL_NETWORK_LOG,
    JSON.stringify({ blocked: true, category, transport }) + '\n')
  throw new Error('FANGKUN_EVAL_NETWORK_DISABLED: this evaluation permits local application functions only')
}
for (const name of ['node:http', 'node:https']) { const mod = require(name); mod.request = blocked('http'); mod.get = blocked('http') }
const net = require('node:net'); net.connect = blocked('socket'); net.createConnection = blocked('socket'); net.Socket.prototype.connect = blocked('socket')
require('node:tls').connect = blocked('tls')
globalThis.fetch = blocked('fetch')
require('node:module').syncBuiltinESMExports()
