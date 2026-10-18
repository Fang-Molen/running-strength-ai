// @ts-nocheck -- Pages JS entry; request/response boundary is validated and exercised in vision-v73.test.ts.
import { TRAINING_IMAGE_PROMPT, validTrainingOutput } from '../../src/lib/vision/training-prompt.ts';
// Cloudflare Pages Function. API key stays in server secrets; no images/keys logged or stored.
import { validateVisionResult, VISION_PROMPT } from '../../src/lib/vision/contract.ts';
const MAX_BODY = 4 * 1024 * 1024;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const fail = (message, status) => json({ ok: false, message }, status);
function configured(env) { return env.VISION_ENABLED === 'true' && Boolean(env.DEEPSEEK_API_KEY?.trim()) && (env.VISION_ACCESS_TOKEN?.length ?? 0) >= 24; }
async function boundedText(stream, limit) {
  if (!stream) throw Error('EMPTY');
  const reader = stream.getReader(), parts = []; let bytes = 0;
  try { while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; if (bytes > limit) { await reader.cancel(); throw Error('TOO_LARGE'); } parts.push(r.value); } }
  finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes); let at = 0; for (const part of parts) { all.set(part, at); at += part.byteLength; } return new TextDecoder().decode(all);
}
function imageOK(url) {
  if (typeof url !== 'string' || url.length > MAX_BODY) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url); if (!match || match[2].length % 4) return false;
  let s; try { s = atob(match[2].slice(0, 32)); } catch { return false; }
  return match[1] === 'jpeg' ? s.startsWith('\xff\xd8\xff') : match[1] === 'png' ? s.startsWith('\x89PNG\r\n\x1a\n') : s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP';
}
export async function handleVision(request, env, fetcher = fetch) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return fail('请从方坤页面发起识别。', 403);
  if (request.method === 'GET') return json({ ok: true, configured: configured(env), provider: 'DeepSeek', model: env.DEEPSEEK_VISION_MODEL || 'deepseek-flash' });
  if (request.method !== 'POST') return fail('不支持的请求。', 405);
  if (!configured(env)) return fail('联网识别尚未配置。可先使用本地识字或手动记录。', 503);
  if (request.headers.get('authorization') !== `Bearer ${env.VISION_ACCESS_TOKEN}`) return fail('请填写正确的识别访问码（不是API密钥）。', 401);
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) return fail('请求格式错误。', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return fail('图片过大，请裁剪后重试。', 413);
  let input;
  try { input = JSON.parse(await boundedText(request.body, MAX_BODY)); } catch { return fail('图片或请求过大／损坏，请重新选择。', 400); }
  const training = input?.mode === 'training';
  if (training) {
    if (typeof input.text !== 'string' || input.text.length > 6000 || !Array.isArray(input.images) || input.images.length > 4 || (!input.text.trim() && !input.images.length) || input.images.some((x, i) => !x || x.sourceId !== `image-${i + 1}` || !imageOK(x.image))) return fail('训练文字或图片不完整。', 400);
  } else if (!input || !['food', 'text'].includes(input.mode) || !imageOK(input.image) || (input.hint != null && (typeof input.hint !== 'string' || input.hint.length > 600))) return fail('图片格式不支持，请选择JPG、PNG或WebP。', 400);
  const content = training ? [{type:'text',text:`text来源：${input.text || '无'}。图片按顺序为${input.images.map(x=>x.sourceId).join('、')}。`}, ...input.images.map(x=>({type:'image_url',image_url:{url:x.image,detail:'high'}}))] : [{ type:'text', text:`模式：${input.mode}。用户补充（仅供核对）：${input.hint || '无'}` }, {type:'image_url',image_url:{url:input.image,detail:'high'}}];
  // Optional Cloudflare rate-limiter binding. Public/multi-user launch requires a durable quota service.
  if (env.VISION_RATE_LIMITER) { try { const r = await env.VISION_RATE_LIMITER.limit({ key: 'fangkun-vision' }); if (!r.success) return fail('识别次数过多，请稍后再试。', 429); } catch { return fail('识别额度检查暂不可用。', 503); } }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  const stop = () => controller.abort(); request.signal.addEventListener('abort', stop, { once: true });
  try {
    if (request.signal.aborted) controller.abort();
    const r = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${env.DEEPSEEK_API_KEY}` }, body: JSON.stringify({ model: env.DEEPSEEK_VISION_MODEL || 'deepseek-flash', stream: false, thinking: {type:'disabled'}, temperature: 0.1, max_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: training ? TRAINING_IMAGE_PROMPT : VISION_PROMPT }, { role: 'user', content }] }) });
    if (!r.ok) { await r.body?.cancel(); return fail(r.status === 429 ? '服务繁忙或额度不足，请稍后重试。' : r.status === 401 || r.status === 402 ? '识别服务的密钥或余额需管理员检查。' : '识别服务暂不可用，请稍后重试。', 502); }
    const envelope = JSON.parse(await boundedText(r.body, 150000));
    const c = envelope.choices?.[0]; if (c?.finish_reason !== 'stop' || typeof c.message?.content !== 'string') return fail('结果未完整返回，请缩小图片范围重试。', 502);
    const raw = JSON.parse(c.message.content);
    if (training) { if (!validTrainingOutput(raw)) return fail('训练提取不完整，请缩小范围重试。', 502); return json({ok:true,candidate:raw,model:env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'}); }
    const result = validateVisionResult(raw, input.mode);
    return json({ ok: true, result, provider: 'DeepSeek', model: env.DEEPSEEK_VISION_MODEL || 'deepseek-flash', at: new Date().toISOString() });
  } catch { return fail(controller.signal.aborted ? '识别已取消或超时，尚未保存任何记录。' : '没有拿到完整可信的识别结果，请重试或手动填写。', 502); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', stop); }
}
export const onRequest = ({ request, env }) => handleVision(request, env);
