import { useEffect, useRef, useState } from 'react';
import { hasVisionAccess, recognizeImage, setVisionAccess, visionStatus } from '@/lib/vision/client';
import { ocr } from '@/lib/vision/local-ocr';
import type { VisionMode, VisionResult } from '@/lib/vision/contract';
export type RecognizedImage = { result: VisionResult; model: string; at: string };
/** All uploads remain pending until the user applies a reviewed result. */
export function ImageIntake({ mode = 'text', onText, onFoods, onFile, file: externalFile, title = '拍照 / 图片识别', onBusyChange }: { mode?: VisionMode; title?: string; onBusyChange?: (busy: boolean) => void; file?: File | null; onFile?: (f: File | null) => void; onText?: (text: string, file: File | null, origin: "network" | "local") => void; onFoods?: (data: RecognizedImage, file: File) => void }) {
  const [ownFile, setOwnFile] = useState<File | null>(null), file = externalFile === undefined ? ownFile : externalFile;
  const [preview, setPreview] = useState(''), [text, setText] = useState(''), [hint, setHint] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [configured, setConfigured] = useState<boolean | null>(null);
  const [code, setCode] = useState(''), [authorized, setAuthorized] = useState(hasVisionAccess), [modeUsed, setModeUsed] = useState('');
  const busyListener = useRef(onBusyChange); busyListener.current = onBusyChange;
  useEffect(() => { busyListener.current?.(busy); }, [busy]);
  const current = useRef(0), controller = useRef<AbortController | null>(null), inFlight = useRef(false);
  function cancel() { current.current++; controller.current?.abort(); controller.current = null; inFlight.current = false; setBusy(false); }
  useEffect(() => { const c = new AbortController(), t = setTimeout(() => c.abort(), 5000); void visionStatus(c.signal).then(setConfigured).catch(() => setConfigured(false)).finally(() => clearTimeout(t)); return () => c.abort(); }, []);
  useEffect(() => { cancel(); setText(''); setMessage(''); if (!file) { setPreview(''); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  useEffect(() => () => { current.current++; controller.current?.abort(); }, []);
  function choose(f: File | null) { cancel(); if (f && (!f.type.startsWith('image/') || f.size > 20 * 1024 * 1024)) { setMessage('请选择20MB以内的图片。'); return; } setOwnFile(f); onFile?.(f); }
  async function run(online: boolean) {
    if (!file || inFlight.current) return;
    const selected = file, n = ++current.current; inFlight.current = true; setBusy(true); setMessage(online ? '联网识别中，结果需核对后保存…' : '本地识字中…'); setText('');
    const c = new AbortController(); controller.current = c; const t = setTimeout(() => c.abort(), 55000);
    try {
      if (online) {
        const data = await recognizeImage(selected, mode, hint, c.signal); if (n !== current.current) return;
        setModeUsed('联网'); setText(data.result.text); setMessage(data.result.warnings.join('；') || '识别完成，尚未保存。请核对下方内容。');
        if (mode === 'food' && data.result.foods.length) onFoods?.(data, selected);
        else if (mode === 'food') setMessage('没有可用的食物估算。可核对识别文字、手动填写食物和份量。');
      } else { const raw = await ocr(selected, s => { if (n === current.current) setMessage(s); }); if (n !== current.current) return; setModeUsed('本地'); setText(raw); setMessage(raw.trim() ? '已识字，请核对后使用。' : '未读到文字，可用联网识别或手动输入。'); }
    } catch (e) { if (n === current.current) setMessage(c.signal.aborted ? '识别已超时或取消；未保存记录，可重试。' : e instanceof Error ? e.message : '识别失败，请重试。'); }
    finally { clearTimeout(t); if (n === current.current) { inFlight.current = false; setBusy(false); controller.current = null; } }
  }
  return <section className="my-3 rounded-2xl border border-line bg-surface p-3 text-sm" aria-label={title}>
    <h3 className="font-bold">{title}</h3>
    <div className="mt-2 flex flex-wrap gap-2">{[true, false].map(camera => <label key={String(camera)} className="fk-chip min-h-11 cursor-pointer">{camera ? '拍照' : '从相册选择'}<input type="file" accept="image/*" capture={camera ? 'environment' : undefined} className="sr-only" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) choose(f); }} /></label>)}</div>
    {file ? <><div className="mt-2 flex items-center gap-3"><img src={preview} alt="待识别图片预览" className="h-28 w-28 rounded-lg object-contain bg-black/20" /><div className="min-w-0"><p className="break-all text-xs text-muted">{file.name}</p><button type="button" className="min-h-11 text-accent" onClick={() => choose(null)}>移除图片</button></div></div>
    {mode === 'food' ? <label className="mt-2 block text-xs">补充品牌、规格或吃了多少（可选）<input value={hint} onChange={e => setHint(e.target.value.slice(0, 600))} placeholder="如：华莱士鸡腿堡1个，去掉一半酱" className="fk-cell mt-1 min-h-11 w-full text-base" disabled={busy} /></label> : null}
    <p className="mt-2 text-xs text-muted">点“联网识别”会把这张图片及补充内容发给DeepSeek；结果经你确认后才记入。普通照片的热量是估算。</p>
    {!authorized ? <div className="mt-2 flex gap-2"><input type="password" autoComplete="off" aria-label="识别访问码" placeholder="识别访问码（向部署者获取）" value={code} onChange={e => setCode(e.target.value)} className="fk-cell min-h-11 min-w-0 flex-1 text-base" /><button type="button" className="fk-chip" disabled={!code.trim()} onClick={() => { setVisionAccess(code); setAuthorized(true); setCode(''); }}>使用</button></div> : <button type="button" className="mt-1 min-h-9 text-xs text-muted" onClick={() => { cancel(); setVisionAccess(''); setAuthorized(false); }}>清除本次访问码</button>}
    {configured === false ? <p className="mt-1 text-xs text-amber-400">尚未连接识别服务，可先本地识字或手动填。部署完成后可重试联网识别。</p> : null}
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="fk-orange-btn min-h-11 rounded-xl px-3 font-bold disabled:opacity-50" disabled={busy || !hasVisionAccess()} onClick={() => void run(true)}>联网识别{mode === 'food' ? '食物' : '文字'}</button><button type="button" className="fk-chip min-h-11" disabled={busy} onClick={() => void run(false)}>本地识字</button>{busy ? <button type="button" className="fk-chip min-h-11" onClick={() => { cancel(); setMessage('已取消本次识别，未保存。'); }}>取消识别</button> : null}</div></> : null}
    {message ? <p role="status" className="mt-2 break-words text-xs">{message}</p> : null}
    {text ? <details open={mode !== 'food'} className="mt-2"><summary className="min-h-10 cursor-pointer">{modeUsed}识别文字 · 核对后使用</summary><textarea aria-label="识别原文" value={text} onChange={e => setText(e.target.value)} rows={5} className="fk-cell w-full text-base" />{onText ? <button type="button" className="fk-chip mt-2 min-h-11" disabled={busy || !text.trim()} onClick={() => { onText(text, file, modeUsed === "联网" ? "network" : "local"); setText(''); setMessage('已采用核对文字，请继续确认记录。'); }}>采用核对后的文字</button> : null}</details> : null}
  </section>;
}
