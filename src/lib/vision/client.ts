import { validateVisionResult, type VisionMode, type VisionResult } from './contract';
// v78：不再需要访问码（服务端同源 + 限频）。保留这两个导出以兼容旧调用，访问码不再使用、不存储。
export const setVisionAccess = (_value: string) => { void _value; };
export const hasVisionAccess = () => true;
export type VisionStatus = { configured: boolean; provider: string | null; model: string | null; needs: string[] };
export async function visionInfo(signal?: AbortSignal): Promise<VisionStatus> {
  try { const r = await fetch('/api/vision', { cache: 'no-store', signal }); if (!r.ok || !/application\/json/.test(r.headers.get('content-type') || '')) return { configured: false, provider: null, model: null, needs: [] }; const j = await r.json(); return { configured: j.configured === true, provider: j.provider ?? null, model: j.model ?? null, needs: Array.isArray(j.needs) ? j.needs : [] } } catch { return { configured: false, provider: null, model: null, needs: [] } }
}
export async function visionStatus(signal?: AbortSignal): Promise<boolean> {
  const r = await fetch('/api/vision', { cache: 'no-store', signal });
  if (!r.ok || !/application\/json/.test(r.headers.get('content-type') || '')) return false;
  return (await r.json()).configured === true;
}
export async function prepareImage(file: Blob, max = 1600): Promise<Blob> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw Error('请选择20MB以内的图片。');
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw Error('请选择JPG、PNG、WebP或可读取的iPhone照片。');
  let img: ImageBitmap | HTMLImageElement, release: () => void;
  try { const bmp = await createImageBitmap(file); img = bmp; release = () => bmp.close(); }
  catch {
    const url = URL.createObjectURL(file), el = new Image();
    try { await new Promise<void>((resolve, reject) => { const t = setTimeout(() => reject(Error('图片读取超时')), 15000); el.onload = () => { clearTimeout(t); resolve(); }; el.onerror = () => { clearTimeout(t); reject(Error('无法读取此格式，请导出JPG或截图后重试。')); }; el.src = url; }); img = el; release = () => URL.revokeObjectURL(url); }
    catch (e) { URL.revokeObjectURL(url); throw e; }
  }
  try { const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width, h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
    if (!w || !h || w * h > 60_000_000) throw Error('图片尺寸过大，请先裁剪。');
    const ratio = Math.min(1, max / Math.max(w, h)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * ratio)); canvas.height = Math.max(1, Math.round(h * ratio));
    const ctx = canvas.getContext('2d'); if (!ctx) throw Error('无法处理图片。');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('图片压缩失败')), 'image/jpeg', 0.88));
    if (blob.size > 2.5 * 1024 * 1024) throw Error('压缩后仍过大，请裁剪图片。'); return blob;
  } finally { release(); }
}
export async function imageDataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(Error('图片读取失败')); r.readAsDataURL(blob); }); }
export async function recognizeImage(file: Blob, mode: VisionMode, hint: string, signal: AbortSignal): Promise<{ result: VisionResult; model: string; at: string }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Error('当前离线，可用本地识字或手动填写，联网后重试。');
  // v79.1：菜品照片在本机先缩到长边 ≤1024px（服务端用 detail=low），省流量和费用。
  const image = await imageDataUrl(await prepareImage(file, mode === 'food' ? 1024 : 1600)); signal.throwIfAborted();
  const r = await fetch('/api/vision', { method: 'POST', cache: 'no-store', signal, headers: { 'content-type': 'application/json'}, body: JSON.stringify({ mode, image, hint: hint.slice(0, 600) }) });
  if (!/application\/json/.test(r.headers.get('content-type') || '')) throw Error('此版本尚未部署联网识别接口。');
  const data = await r.json(); if (!r.ok || !data.ok) throw Error(typeof data.message === 'string' ? data.message : '识别失败，请重试。');
  return { result: validateVisionResult(data.result, mode), model: String(data.model || 'deepseek-flash'), at: String(data.at || '') };
}
export async function extractTrainingViaVision(input: { text: string; images: Array<{ dataUrl: string; sourceId: string }> }, signal?: AbortSignal): Promise<{ ok: true; candidate: unknown; model: string } | { ok: false; reason: 'NETWORK' | 'UPSTREAM'; detail?: string }> {
  const c = new AbortController(), timer = setTimeout(() => c.abort(), 48000), abort = () => c.abort(); signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) c.abort();
    const body = JSON.stringify({ mode: 'training', text: input.text.slice(0, 6000), images: input.images.map(x => ({ image: x.dataUrl, sourceId: x.sourceId })) });
    if (new TextEncoder().encode(body).length > 4 * 1024 * 1024) return { ok: false, reason: 'UPSTREAM', detail: '图片合计过大，请减少图片或裁剪后重试。' };
    const r = await fetch('/api/vision', { method: 'POST', cache: 'no-store', signal: c.signal, headers: { 'content-type': 'application/json'}, body });
    if (!/application\/json/.test(r.headers.get('content-type') || '')) return { ok: false, reason: 'UPSTREAM', detail: '此版本尚未部署联网识别接口。' };
    const data = await r.json(); if (!r.ok || !data.ok) return { ok: false, reason: 'UPSTREAM', detail: data.message || '识别失败。' };
    return { ok: true, candidate: data.candidate, model: data.model };
  } catch { return { ok: false, reason: 'NETWORK', detail: c.signal.aborted ? '识别已取消或超时，尚未写入。' : '网络连接失败，尚未写入。' }; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
