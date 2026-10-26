import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const env = { ...process.env, PORT: '8093', HOST: '127.0.0.1', FANGKUN_DEEPSEEK_ENABLED: 'false' };
for (const key of ['DATABASE_URL', 'DEEPSEEK_API_KEY', 'XAI_API_KEY']) delete env[key];
const server = spawn(process.execPath, ['.output/server/index.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
const origin = 'http://127.0.0.1:8093';
try {
  let status;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { status = await fetch(origin + '/api/coach-chat'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(status, 'built Node server must start');
  assert.equal(status.status, 200);
  assert.match(status.headers.get('content-type'), /application\/json/);
  const body = await status.json();
  assert.equal(body.configured, false);
  assert.equal(body.reason, 'SERVICE_DISABLED');
  assert.equal(body.connectionVerified, false);
  const rejected = await fetch(origin + '/api/coach-chat', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
  const rejectedBody = await rejected.json();
  assert.equal(rejected.status, 503);
  assert.equal(rejectedBody.error, 'SERVICE_DISABLED');
  const result = { synthetic: true, actualBuiltNodeServer: true, paidCalls: 0, status: { http: status.status, body }, disabledPost: { http: rejected.status, body: rejectedBody }, startup: output };
  await writeFile('verification/coach-qa-20261026/node-runtime-results.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally {
  server.kill('SIGTERM');
}
