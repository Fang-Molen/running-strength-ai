// @ts-nocheck -- Pages JS entry; request/response boundary is validated and exercised in vision-v73.test.ts.
import { TRAINING_IMAGE_PROMPT, validTrainingOutput } from '../../src/lib/vision/training-prompt.ts';
// Cloudflare Pages Function. API key stays in server secrets; no images/keys logged or stored.
import { validateVisionResult, VISION_PROMPT } from '../../src/lib/vision/contract.ts';
const MAX_BODY = 4 * 1024 * 1024;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const fail = (message, status) => json({ ok: false, message }, status);
// v79.1：默认用 DeepSeek 视觉（deepseek-flash，OpenAI 兼容 /chat/completions + image_url，图片只放 user 消息），复用服务端 DEEPSEEK_API_KEY。
// 三个 VISION_*（VISION_API_KEY、VISION_BASE_URL https、VISION_MODEL）都配置时整体覆盖。密钥只在服务端；同源 + 每 IP 限频 + 体积上限。
const DEEPSEEK_BASE = 'https://api.deepseek.com', DEEPSEEK_VISION_MODEL = 'deepseek-flash';
function visionOverride(env) { return Boolean(env.VISION_API_KEY?.trim()) && /^https:\/\/[^/]+/.test(env.VISION_BASE_URL || '') && Boolean(env.VISION_MODEL?.trim()); }
export function visionConfig(env) {
  if (visionOverride(env)) return { key: env.VISION_API_KEY.trim(), base: env.VISION_BASE_URL, model: env.VISION_MODEL.trim(), provider: env.VISION_PROVIDER_NAME || new URL(env.VISION_BASE_URL).hostname };
  if (env.DEEPSEEK_API_KEY?.trim()) return { key: env.DEEPSEEK_API_KEY.trim(), base: DEEPSEEK_BASE, model: DEEPSEEK_VISION_MODEL, provider: 'DeepSeek' };
  return null;
}
// 菜品照片：客户端已缩到 ≤1024px；单张 data URL 上限 1.5MB（训练截图仍按整体 4MB）。
const FOOD_IMAGE_MAX = 1.5 * 1024 * 1024;
const visionHits = new Map();
function limited(ip, now = Date.now()) { const h = (visionHits.get(ip) || []).filter(t => now - t < 864e5); const minute = h.filter(t => now - t < 6e4).length; if (minute >= 6 || h.length >= 120) { visionHits.set(ip, h); return true; } h.push(now); visionHits.set(ip, h); return false; }
const endpoint = (cfg) => cfg.base.replace(/\/+$/, '') + '/chat/completions';
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
  if (request.method === 'GET') { const cfg = visionConfig(env); return json({ ok: true, configured: !!cfg, provider: cfg?.provider ?? null, model: cfg?.model ?? null, needs: cfg ? [] : ['DEEPSEEK_API_KEY'], note: cfg ? '点识别才上传所选图片；结果是估算，需核对。' : '服务端未配置 DEEPSEEK_API_KEY（或 VISION_*）。' }); }
  if (request.method !== 'POST') return fail('不支持的请求。', 405);
  const cfg = visionConfig(env); if (!cfg) return fail('图片识别未配置（服务端缺 DEEPSEEK_API_KEY）。可先用本机识字，或输入菜名用联网估算。', 503);
  if (limited(request.headers.get('cf-connecting-ip') || 'anon')) return fail('识别次数过多，请稍后再试。', 429);
  if (!/application\/json/i.test(request.headers.get('content-type') || '')) return fail('请求格式错误。', 415);
  if (Number(request.headers.get('content-length')) > MAX_BODY) return fail('图片过大，请裁剪后重试。', 413);
  let input;
  try { input = JSON.parse(await boundedText(request.body, MAX_BODY)); } catch { return fail('图片或请求过大／损坏，请重新选择。', 400); }
  const training = input?.mode === 'training';
  if (training) {
    if (typeof input.text !== 'string' || input.text.length > 6000 || !Array.isArray(input.images) || input.images.length > 4 || (!input.text.trim() && !input.images.length) || input.images.some((x, i) => !x || x.sourceId !== `image-${i + 1}` || !imageOK(x.image))) return fail('训练文字或图片不完整。', 400);
  } else if (!input || !['food', 'text'].includes(input.mode) || !imageOK(input.image) || (input.hint != null && (typeof input.hint !== 'string' || input.hint.length > 600))) return fail('图片格式不支持，请选择JPG、PNG或WebP。', 400);
  if (!training && input.mode === 'food' && input.image.length > FOOD_IMAGE_MAX) return fail('图片过大，请重新选择（会自动压缩）。', 413);
  const content = training ? [{type:'text',text:`text来源：${input.text || '无'}。图片按顺序为${input.images.map(x=>x.sourceId).join('、')}。`}, ...input.images.map(x=>({type:'image_url',image_url:{url:x.image,detail:'high'}}))] : [{ type:'text', text:`模式：${input.mode}。用户补充（仅供核对）：${input.hint || '无'}` }, {type:'image_url',image_url:{url:input.image,detail:input.mode==='food'?'low':'high'}}];
  // Optional Cloudflare rate-limiter binding. Public/multi-user launch requires a durable quota service.
  if (env.VISION_RATE_LIMITER) { try { const r = await env.VISION_RATE_LIMITER.limit({ key: 'fangkun-vision' }); if (!r.success) return fail('识别次数过多，请稍后再试。', 429); } catch { return fail('识别额度检查暂不可用。', 503); } }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  const stop = () => controller.abort(); request.signal.addEventListener('abort', stop, { once: true });
  try {
    if (request.signal.aborted) controller.abort();
    const r = await fetcher(endpoint(cfg), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` }, body: JSON.stringify({ model: cfg.model, stream: false, temperature: 0.1, max_tokens: training ? 6000 : 2500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: training ? TRAINING_IMAGE_PROMPT : VISION_PROMPT }, { role: 'user', content }] }) });
    if (!r.ok) { await r.body?.cancel(); return fail(r.status === 429 ? '服务繁忙或额度不足，请稍后重试。' : r.status === 401 || r.status === 402 ? '识别服务的密钥或余额需管理员检查。' : '识别服务暂不可用，请稍后重试。', 502); }
    const envelope = JSON.parse(await boundedText(r.body, 150000));
    const c = envelope.choices?.[0]; if (c?.finish_reason !== 'stop' || typeof c.message?.content !== 'string') return fail('结果未完整返回，请缩小图片范围重试。', 502);
    const raw = JSON.parse(c.message.content);
    if (training) { if (!validTrainingOutput(raw)) return fail('训练提取不完整，请缩小范围重试。', 502); return json({ok:true,candidate:raw,model:cfg.model}); }
    const result = validateVisionResult(raw, input.mode);
    return json({ ok: true, result, provider: cfg.provider, model: cfg.model, usage: envelope.usage ? { prompt: envelope.usage.prompt_tokens ?? null, completion: envelope.usage.completion_tokens ?? null } : null, at: new Date().toISOString() });
  } catch { return fail(controller.signal.aborted ? '识别已取消或超时，尚未保存任何记录。' : '没有拿到完整可信的识别结果，请重试或手动填写。', 502); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', stop); }
}
export const onRequest = ({ request, env }) => handleVision(request, env);
