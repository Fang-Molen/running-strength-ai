import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { muscleDisplay } from "@/lib/body/muscle-display";
import { FOOT_CATEGORIES, FOOT_LIBRARY, loadDose, saveDose, type FootExercise } from "@/lib/body/foot-library";
import { MUS } from "@/lib/body/muscles";
import { FangkunExerciseVideo } from './fangkun-unified-video';
import { MuscleActionList } from "@/components/muscle-action-list";
import type { MuscleAction } from "@/lib/body/muscle-actions";

type Pick = { id: number | string; k: string; zh: string; g: string | null; name?: string; side?: string | null; fn?: string | null; train?: string[]; fascia?: boolean; pending?: boolean; rel?: string } | null;
type Explorer = { setView: (v: string) => void; setFocus: (f: string) => void; reset: () => void; selectKey: (k: string | null) => void; destroy: () => void };
const zhOf = (k: string) => (MUS as { k: string; zh: string }[]).find(m => m.k === k)?.zh ?? k;

function Viewer3D({ onPick, apiRef }: { onPick: (p: Pick) => void; apiRef: React.MutableRefObject<Explorer | null> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(""), [ready, setReady] = useState(false), [tries, setTries] = useState(0);
  const [view, setView] = useState("front"), [focus, setFocus] = useState("body");
  useEffect(() => {
    let dead = false, api: Explorer | null = null; setErr(""); setReady(false);
    const url = new URL("/demo3d/anatomy3d.js", location.origin).href;
    const t = setTimeout(() => { if (!api && !dead) setErr("加载超时（网络慢或离线）"); }, 45000);
    import(/* @vite-ignore */ url).then(async M => { if (dead || !cv.current) return; // Selection uses the app's existing accent token (方坤橙), not a separate palette.
      const selectedTint = getComputedStyle(cv.current).getPropertyValue("--color-accent").trim() || "#ee7046";
      api = await M.createMuscleExplorer(cv.current, { onPick, selectedTint }); if (dead) { api?.destroy(); return; } apiRef.current = api; Object.assign(cv.current, { __fk: api }); setReady(true); setErr(""); })
      .catch(() => { if (!dead) setErr("人体模型暂时无法加载"); });
    return () => { dead = true; clearTimeout(t); api?.destroy(); apiRef.current = null; };
  }, [tries]);
  const btn = (on: boolean) => `min-h-11 min-w-11 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent/15 font-bold" : "border-line"}`;
  return <div>
    <div className="relative overflow-hidden rounded-card border border-line bg-[#171a1e]" style={{ height: "min(38dvh, 320px)", minHeight: 240 }}>
      <canvas ref={cv} aria-label="人体肌群3D" className="block h-full w-full" />
      {!ready && !err ? <p className="keep absolute inset-x-0 top-1/2 text-center text-sm text-muted">3D 模型加载中…</p> : null}
      {err ? <div className="absolute inset-0 grid place-items-center bg-[#171a1e] p-3 text-center">
        <div><p className="keep text-sm">{err}</p><button type="button" className={btn(false) + " mt-2"} onClick={() => setTries(x => x + 1)}>重试</button>
          <p className="mt-2 text-sm text-muted">可按名称选择部位。</p></div></div> : null}
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="视角">
      {([["front", "正面"], ["left", "左侧"], ["right", "右侧"], ["back", "背面"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} className={btn(view === v)} onClick={() => { setView(v); apiRef.current?.setView(v); }}>{l}</button>)}
    </div>
    <div className="mt-1.5 flex items-center gap-2">
      <select aria-label="查看范围" className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-sm" value={focus} onChange={event => { setFocus(event.target.value); apiRef.current?.setFocus(event.target.value); }}><option value="body">全身</option><option value="calf">小腿</option><option value="foot">足部</option></select>
      <button type="button" className={btn(false)} onClick={() => { setView("front"); setFocus("body"); apiRef.current?.reset(); }}>重置</button>
    </div>
  </div>;
}

function FootCard({ e, onShow }: { e: FootExercise; onShow: (k: string) => void }) {
  const [open, setOpen] = useState(false), [d, setD] = useState(() => loadDose(e.id)), [saved, setSaved] = useState(false);
  const [gender, setGender] = useState<'male'|'female'>('male');
  const num = (k: "sets" | "amount" | "restSec", v: string) => { const n = Math.max(0, Math.min(k === "restSec" ? 600 : 100, Math.round(+v || 0))); setD({ ...d, [k]: n }); setSaved(false); };
  return <div className="rounded-card border border-line p-3">
    <button type="button" className="flex w-full min-h-11 items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><b>{e.name}</b></span><span className="text-sm text-muted">{d.sets}×{d.amount}{e.dose.unit} · 休息{d.restSec}秒</span></button>
    {open ? <div className="mt-2 space-y-2 text-sm">
      <div><b className="text-xs">演示</b>
        <div className="my-2 flex gap-2" role="group" aria-label="足踝演示角色">{(['male','female'] as const).map(g=><button type="button" className="fk-chip" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div>
        <FangkunExerciseVideo exerciseId={`foot:${e.id}`} title={e.name} gender={gender}/>
        <ol className="ml-4 list-decimal">{e.demo.steps.map(s => <li key={s}>{s}</li>)}</ol>
        <button type="button" className="mt-1 min-h-10 rounded-full border border-line px-3 text-xs" onClick={() => onShow(e.muscles[0])}>在 3D 上显示主要肌群</button></div>
      <p><b>相关部位</b> {[...new Set([...e.muscles, ...e.secondary])].map(zhOf).join("、")}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 font-bold">动作要点</summary><ul className="ml-4 list-disc">{e.tips.map(s => <li key={s}>{s}</li>)}</ul><b className="mt-2 block">常见错误</b><ul className="ml-4 list-disc">{e.mistakes.map(s => <li key={s}>{s}</li>)}</ul></details>
      <div className="flex flex-wrap items-end gap-2" aria-label="剂量">
        <label className="text-xs">组数<input inputMode="numeric" className="ml-1 w-14 rounded border border-line bg-surface px-1 py-1" value={d.sets} onChange={x => num("sets", x.target.value)} /></label>
        <label className="text-xs">{e.dose.unit === "秒" ? "秒数" : "次数"}<input inputMode="numeric" className="ml-1 w-14 rounded border border-line bg-surface px-1 py-1" value={d.amount} onChange={x => num("amount", x.target.value)} /></label>
        <label className="text-xs">组间休息(秒)<input inputMode="numeric" className="ml-1 w-16 rounded border border-line bg-surface px-1 py-1" value={d.restSec} onChange={x => num("restSec", x.target.value)} /></label>
        <button type="button" className="min-h-10 rounded-full border border-line px-3 text-xs" onClick={() => { saveDose(e.id, d); setSaved(true); }}>{saved ? "参考参数已保存" : "保存参考参数"}</button>
      </div>
    </div> : null}
  </div>;
}

export function MuscleExplorerSheet({ onClose, onAdd, onShow, selected = [], selectedCount }: { onClose: () => void; onAdd?: (action: MuscleAction) => void; onShow?: (id: string) => void; selected?: string[]; selectedCount?: number }) {
  const [pick, setPick] = useState<Pick>(null), api = useRef<Explorer | null>(null);
  const [cat, setCat] = useState(FOOT_CATEGORIES[0]);
  const count = selectedCount ?? new Set(selected).size;
  const info = pick ? muscleDisplay(pick) : null;
  return <Sheet full label="人体肌群3D" title="按部位选动作" onClose={onClose} footer={count ? <button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={onClose}>返回训练 · 已选 {count} 个动作</button> : null}>
    <Viewer3D onPick={setPick} apiRef={api} />
    <select aria-label="按名称选择部位" className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={MUS.some(m => m.k === pick?.k) ? pick!.k : ''} onChange={event => { const index = MUS.findIndex(m => m.k === event.target.value), m = MUS[index]; if (m) { setPick({ id: index + 1, k: m.k, zh: m.zh, g: m.g }); api.current?.selectKey(m.k); } else { setPick(null); api.current?.selectKey(null); } }}><option value="">按名称选择部位</option>{MUS.map(m => <option key={m.k} value={m.k}>{m.zh}</option>)}</select>
    {info ? <section aria-label="部位信息" className="mt-3 rounded-card border border-line p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-bold">{info.name}</h3><button type="button" className="min-h-11 shrink-0 px-2 text-sm text-muted" onClick={() => { setPick(null); api.current?.selectKey(null); }}>清除</button></div>{info.effect ? <p className="mt-1 text-sm">作用：{info.effect}</p> : null}{info.related.length ? <p className="mt-1 text-sm text-muted">相关部位：{info.related.join('、')}</p> : null}</section> : null}
    <MuscleActionList pick={pick} onAdd={onAdd} onShow={onShow} selected={selected} />
    <details aria-label="足踝小腿动作" className="mt-4 rounded-card border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-bold">足踝练习参考参数</summary>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="动作分类">{FOOT_CATEGORIES.map(c => <button key={c} type="button" aria-pressed={c === cat} className={`min-h-10 rounded-full border px-3 text-sm ${c === cat ? "border-accent bg-accent/15 font-bold" : "border-line"}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="mt-2 space-y-2">{FOOT_LIBRARY.filter(e => e.cat === cat).map(e => <FootCard key={e.id} e={e} onShow={k => { api.current?.selectKey(k); api.current?.setFocus(k === "foot_intrinsic" ? "foot" : "calf"); }} />)}</div>
    </details>
  </Sheet>;
}
