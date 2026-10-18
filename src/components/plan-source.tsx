import { useEffect, useRef, useState } from 'react';
import { FileUp, Sparkles } from 'lucide-react';
import { ImageIntake } from './image-intake';
import { readPhoto, savePhoto, deletePhoto } from '@/lib/nutrition/food-photo';
type Imp = { id: string; name: string; type: string; size: number; at: string; text?: string; attachmentId?: string };
const KEY = 'fk-plan-imports-v1';
function load(): Imp[] { const rows = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(rows)) throw Error('已有课表来源无法读取，请先备份核对。'); return rows; }
const LABEL: Record<string, string> = { '400m-v4': '400米专项计划 V4（已导入）', generated: '方坤生成计划' };
/** Imported source documents stay distinct from active/executed plans. */
export function PlanSourceCard({ active, onChange, onGenerate }: { active: string; onChange: (v: string) => void; onGenerate: () => void }) {
 const [imports, setImports] = useState<Imp[]>([]), [open, setOpen] = useState(false), [msg, setMsg] = useState(''), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false); const saving = useRef(false);
 useEffect(() => { try { setImports(load()); } catch (e) { setMsg((e as Error).message); } }, []);
 async function add(f: File, reviewedText?: string) {
  if (saving.current) return; saving.current = true; setBusy(true); let attachmentId: string | undefined, committed = false;
  try {
   if (f.size > 20 * 1024 * 1024) throw Error('请选择20MB以内的课表文件。');
   const old = load(), text = reviewedText ?? (/text|json|csv/.test(f.type) || /\.(txt|md|csv)$/i.test(f.name) ? await f.text() : undefined);
   if (text && text.length > 200000) throw Error('课表文字过长，请拆分后导入。');
   attachmentId = `plan-${crypto.randomUUID()}`; await savePhoto(attachmentId, f);
   const next = [...old, { id: crypto.randomUUID(), name: f.name, type: f.type, size: f.size, at: new Date().toISOString(), text, attachmentId }];
   const raw = JSON.stringify(next); localStorage.setItem(KEY, raw); if (localStorage.getItem(KEY) !== raw) throw Error('保存校验失败。'); committed = true;
   setImports(next); setMsg(`已保存「${f.name}」原文件${text ? '及核对文字' : ''}。这是课表资料，尚未转成可执行训练。`); setFile(null);
  } catch (e) { if (attachmentId && !committed) await deletePhoto(attachmentId).catch(() => {}); setMsg((e as Error).message); }
  finally { saving.current = false; setBusy(false); }
 }
 async function download(row: Imp) { try { if (!row.attachmentId) throw Error('旧版本只保存了文件名，原文件未保留，请重新导入。'); const blob = await readPhoto(row.attachmentId); if (!blob) throw Error('原文件暂不可读，请检查当前浏览器。'); const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = row.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); } catch(e) { setMsg((e as Error).message); } }
 return <section className="home-card mb-3 p-3" aria-label="计划来源"><div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs text-muted">当前计划</p><b className="block truncate">{LABEL[active] ?? active}</b></div><button type="button" className="min-h-11 shrink-0 rounded-full border border-line px-3 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>切换 / 替换</button></div>
 {open ? <div className="mt-3 space-y-2"><label className="fk-orange-btn flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl font-bold"><FileUp className="size-4" />保存课表资料（PDF / 文本）<input disabled={busy} type="file" accept=".pdf,.txt,.md,.csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add(f); }} /></label>
 <fieldset disabled={busy}><ImageIntake title="课表图片识别" file={file} onFile={setFile} onText={(text, f) => { if (f) void add(f, text); }} /></fieldset>
 {file ? <button type="button" disabled={busy} className="fk-chip min-h-11" onClick={() => void add(file)}>仅保存原图资料</button> : null}
 <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={onGenerate}><Sparkles className="size-4" />让方坤生成</button>
 <div className="space-y-1 text-sm">{['400m-v4', 'generated'].map(k => <button key={k} type="button" aria-pressed={active === k} onClick={() => onChange(k)} className={'flex min-h-11 w-full items-center justify-between rounded-lg border px-3 ' + (active === k ? 'border-accent' : 'border-line')}><span>{LABEL[k]}</span><span>{active === k ? '使用中' : '切换'}</span></button>)}</div>
 {imports.map(i => <details key={i.id} className="rounded-lg border border-line p-2 text-sm"><summary className="min-h-10 cursor-pointer break-all">{i.name} · 资料</summary>{i.text ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{i.text}</pre> : <p className="text-xs text-muted">尚未解析文字；PDF可选取页面截图识别。</p>}<button type="button" className="min-h-11 text-accent" onClick={() => void download(i)}>导出原文件</button></details>)}
 <p className="text-xs text-muted">资料保存在本机。这里的识别文字不会自动替换计划或生成已完成记录。旧版只存文件名的资料需重新导入。</p></div> : null}{msg ? <p className="mt-2 text-xs" role="status">{msg}</p> : null}</section>;
}
