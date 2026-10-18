import { DecimalInput } from './decimal-input';
import { useEffect, useRef, useState } from 'react';
import { ImageIntake, type RecognizedImage } from './image-intake';
import { foodTotals, NUTRIENTS, type VisionFood } from '@/lib/vision/contract';
import { addEntriesBatch, PENDING_LABEL, type Meal } from '@/lib/nutrition/log';
import { loadCn, search, scale, defaultAmount, sourceLabel, type FoodRow } from '@/lib/nutrition/food-db';
import { savePhoto, deletePhoto } from '@/lib/nutrition/food-photo';
import { prepareImage } from '@/lib/vision/client';
const LABEL = { kcal: '热量 kcal', protein: '蛋白质 g', carb: '碳水 g', fat: '脂肪 g', fiber: '纤维 g' };
type Row = VisionFood & { uiId:string; foodId?: string; sourceName?: string };
export function FoodPhotoReview({ meal, date, onSaved }: { meal: Meal; date?: string; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null), [data, setData] = useState<RecognizedImage | null>(null), [rows, setRows] = useState<Row[]>([]), [ack, setAck] = useState(false);
  const [reading, setReading] = useState(false);
  const [pending,setPending]=useState<Record<string,boolean>>({});
  const pendingInput=Object.values(pending).some(Boolean);
  const trackDraft=(key:string,dirty:boolean)=>{setPending(p=>({...p,[key]:dirty}));if(dirty)setAck(false)};
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [db, setDb] = useState(false); const guard = useRef(false);
  useEffect(() => { void loadCn().then(() => setDb(true)).catch(() => setError('食物库暂未加载，仍可核对识别结果。')); }, []);
  function update(i: number, patch: Partial<Row>) { setRows(r => r.map((v, j) => i === j ? { ...v, ...patch } : v)); setAck(false); }
  function match(i: number, f: FoodRow) { const amount = defaultAmount(f), totals = scale(f, f.b === 'g' ? 100 : 1); update(i, { name: f.n, brand: f.br || '', amount, unit: f.b === 'g' ? 'g' : '份', basis: f.b === 'g' ? '100g' : 'portion', nutrients: totals, foodId: f.i, sourceName: sourceLabel(f), evidence: f.uri || sourceLabel(f), uncertainty: '请核对品牌、规格和实际摄入份量。' }); }
  async function save() {
    if (guard.current || reading || pendingInput || !ack || !rows.length) return; guard.current = true; setBusy(true); setError(''); let photoId: string | undefined, committed = false;
    try {
      const items = rows.map(r => { if (!r.name.trim()) throw Error('食物名称不能为空。'); const n = foodTotals(r); return { meal, name: (r.brand && !r.name.includes(r.brand) ? `${r.brand} ${r.name}` : r.name).trim(), amount: r.amount!, unit: r.unit, grams: r.unit === 'g' ? r.amount! : undefined, kcal: n.kcal, protein: n.protein ?? undefined, carb: n.carb, fat: n.fat, fiber: n.fiber, foodId: r.foodId, label: n.kcal == null ? PENDING_LABEL : r.sourceName || (r.source === 'label' ? '图片标签·已核对' : '照片估算·已核对'), nutritionSource: { kind: r.sourceName ? 'DATABASE' : r.source === 'label' ? 'IMAGE_LABEL' : 'PHOTO_ESTIMATE', model: data?.model, at: data?.at, evidence: r.evidence, uncertainty: r.uncertainty, reviewed: true } }; });
      if (file) { photoId = `ph-${crypto.randomUUID()}`; await savePhoto(photoId, await prepareImage(file, 1000)); }
      const saved = addEntriesBatch(items.map(r => ({ ...r, photo: photoId })), date);
      if (!saved) throw Error('保存失败，请检查本机存储，输入已保留。'); committed = true;
      setRows([]);setPending({}); setData(null); setFile(null); setAck(false); setError(`已记入${date || '今天'} · ${meal}，共${items.length}项。`); onSaved();
    } catch (e) { if (photoId && !committed) await deletePhoto(photoId).catch(() => {}); setError(e instanceof Error ? e.message : '保存失败，输入已保留。'); }
    finally { guard.current = false; setBusy(false); }
  }
  return <div><fieldset disabled={busy}><ImageIntake mode="food" onBusyChange={v => { setReading(v); if (v) setAck(false); }} file={file} onFile={f => { if (busy) return; setFile(f); setRows([]);setPending({}); setData(null); setAck(false); }} onFoods={(d) => { setData(d); setRows(d.result.foods.map(r=>({...r,uiId:crypto.randomUUID()})));setPending({}); setAck(false); setError(''); }} onText={text => setError(`已读取标签文字，可据此填写下方手动营养：${text.slice(0, 240)}`)} /></fieldset>
    {rows.length ? <section className="space-y-3 rounded-2xl border border-accent/40 p-3" aria-label="核对食物识别结果"><h3 className="font-bold">核对食物、份量和营养</h3><p className="text-xs text-muted">同名食物因品牌和做法会不同。未知营养留空；下方数值可修改。保存到 {date || '今天'} · {meal}。</p>
    {rows.map((r, i) => { let total: ReturnType<typeof foodTotals> | null = null; try { total = foodTotals(r); } catch { /* show pending */ }
      return <article key={r.uiId} className="space-y-2 rounded-xl border border-line p-3"><div className="flex gap-2"><input aria-label={`食物${i + 1}名称`} value={r.name} disabled={busy} onChange={e => update(i, { name: e.target.value, foodId: undefined, sourceName: undefined })} className="fk-cell min-h-11 min-w-0 flex-1 text-base" /><button type="button" className="min-h-11 text-accent" disabled={busy} onClick={() => { setRows(rows.filter((_, n) => n !== i)); setPending(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!k.startsWith(r.uiId+":")))); setAck(false); }}>移除</button></div>
      <label className="block text-xs">品牌（未知可留空）<input value={r.brand} disabled={busy} onChange={e => update(i, { brand: e.target.value, foodId: undefined, sourceName: undefined })} className="fk-cell mt-1 min-h-11 w-full text-base" /></label>
      {db ? <details><summary className="min-h-10 cursor-pointer text-xs text-accent">在食物库中选择准确品牌 / 规格</summary>{search(r.brand ? `${r.brand}${r.name}` : r.name, 4).map(f => <button type="button" key={f.i} disabled={busy} onClick={() => match(i, f)} className="my-1 block min-h-11 w-full rounded-lg border border-line px-2 text-left text-xs">{f.n} · {sourceLabel(f)}</button>)}<p className="text-xs text-muted">只在你选中时采用食物库数值。</p></details> : null}
      <div className="grid grid-cols-2 gap-2"><label className="text-xs">摄入份量（{r.unit}）<DecimalInput min={.01} max={10000} value={r.amount} disabled={busy} onDraftState={v=>trackDraft(r.uiId+":amount",v)} onCommit={amount=>update(i,{amount})} className="fk-cell mt-1 min-h-11 w-full text-base" /></label><div className="self-center text-xs">营养基准：{r.basis === '100g' ? '每100g' : '每1份'}<p className="text-muted">修改份量会重新折算</p></div></div>
      <div className="grid grid-cols-2 gap-2">{NUTRIENTS.map(k => <label key={k} className="text-xs">{LABEL[k]}<DecimalInput min={0} nullable aria-label={`${r.name}${LABEL[k]}`} value={r.nutrients[k]} placeholder="未知" disabled={busy} onDraftState={v=>trackDraft(r.uiId+":"+k,v)} onCommit={value=>update(i,{nutrients:{...r.nutrients,[k]:value},sourceName:r.sourceName?`${r.sourceName}·人工修改`:undefined})} className="fk-cell mt-1 min-h-11 w-full text-base" /></label>)}</div>
      <p className="text-sm font-bold">本次：{NUTRIENTS.map(k=>`${LABEL[k]} ${total?.[k]??'待补充'}`).join(' · ')}</p><p className="break-words text-xs text-muted">{r.sourceName || (r.source === 'label' ? '标签读取' : '图片粗估')} · {r.evidence}</p>{r.uncertainty ? <p className="text-xs text-amber-400">{r.uncertainty}</p> : null}</article>;
    })}
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />已核对食物、品牌、份量和营养；接受标明的估算。</label>
    <button type="button" disabled={!ack || busy || reading || pendingInput} onClick={() => void save()} className="fk-orange-btn min-h-12 w-full rounded-xl font-bold disabled:opacity-40">{busy ? '保存中…' : `确认保存${rows.length}项到${meal}`}</button></section> : null}
    {error ? <p role="status" className="my-2 break-words text-sm">{error}</p> : null}
  </div>;
}
