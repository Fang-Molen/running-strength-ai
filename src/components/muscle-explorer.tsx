import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { MUSCLE_FN, MUSCLE_FN_SRC } from "@/lib/body/muscle-info";
import { FOOT_CATEGORIES, FOOT_LIBRARY, loadDose, saveDose, type FootExercise } from "@/lib/body/foot-library";
import { MUS } from "@/lib/body/muscles";
import { FangkunExerciseVideo } from './fangkun-unified-video';
import { MuscleActionList } from "@/components/muscle-action-list";
import type { MuscleAction } from "@/lib/body/muscle-actions";

type Pick = { id: number | string; k: string; zh: string; g: string | null } | null;
type Explorer = { setView: (v: string) => void; setFocus: (f: string) => void; reset: () => void; selectKey: (k: string) => void; destroy: () => void };
const zhOf = (k: string) => (MUS as { k: string; zh: string }[]).find(m => m.k === k)?.zh ?? k;

function Viewer3D({ onPick, apiRef }: { onPick: (p: Pick) => void; apiRef: React.MutableRefObject<Explorer | null> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(""), [ready, setReady] = useState(false), [tries, setTries] = useState(0);
  const [view, setView] = useState("front");
  useEffect(() => {
    let dead = false, api: Explorer | null = null; setErr(""); setReady(false);
    const url = new URL("/demo3d/anatomy3d.js", location.origin).href;
    const t = setTimeout(() => { if (!api && !dead) setErr("加载超时（网络慢或离线）"); }, 45000);
    import(/* @vite-ignore */ url).then(async M => { if (dead || !cv.current) return; // Selection uses the app's existing accent token (方坤橙), not a separate palette.
      const selectedTint = getComputedStyle(cv.current).getPropertyValue("--color-accent").trim() || "#ee7046";
      api = await M.createMuscleExplorer(cv.current, { onPick, selectedTint }); if (dead) { api?.destroy(); return; } apiRef.current = api; Object.assign(cv.current, { __fk: api }); setReady(true); setErr(""); })
      .catch((e: Error) => { if (!dead) setErr(`3D 模型加载失败：${e?.message || "未知错误"}`); });
    return () => { dead = true; clearTimeout(t); api?.destroy(); apiRef.current = null; };
  }, [tries]);
  const btn = (on: boolean) => `min-h-11 min-w-11 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent/15 font-bold" : "border-line"}`;
  return <div>
    <div className="relative overflow-hidden rounded-card border border-line bg-[#171a1e]" style={{ height: 380 }}>
      <canvas ref={cv} aria-label="人体肌群3D" className="block h-full w-full" />
      {!ready && !err ? <p className="keep absolute inset-x-0 top-1/2 text-center text-sm text-muted">3D 模型加载中…</p> : null}
      {err ? <div className="absolute inset-0 grid place-items-center bg-[#171a1e] p-3 text-center">
        <div><p className="keep text-sm">{err}</p><button type="button" className={btn(false) + " mt-2"} onClick={() => setTries(x => x + 1)}>重试</button>
          <p className="keep mt-2 text-xs text-muted">可先从下方选择肌群，查看名称与相关动作。</p></div></div> : null}
    </div>
    {err ? <div className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-y-auto" aria-label="备用肌群列表">{MUS.map((m, index) => <button key={m.k} type="button" className="min-h-9 rounded-full border border-line px-2 text-xs" onClick={() => onPick({ id: index + 1, k: m.k, zh: m.zh, g: m.g })}>{m.zh}</button>)}</div> : null}
    <p className="keep mt-1 text-[11px] text-muted">拖动查看不同角度（左右限 ±30°），点选肌群</p>
    <p className="keep text-[11px] text-muted">橙色表示所选肌群，不代表实际肌电活动</p>
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="视角">
      {([["front", "正面"], ["left", "左侧"], ["right", "右侧"], ["back", "背面"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} className={btn(view === v)} onClick={() => { setView(v); apiRef.current?.setView(v); }}>{l}</button>)}
    </div>
    <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="聚焦">
      <button type="button" className={btn(false)} onClick={() => apiRef.current?.setFocus("foot")}>足部</button>
      <button type="button" className={btn(false)} onClick={() => apiRef.current?.setFocus("calf")}>小腿</button>
      <button type="button" className={btn(false)} onClick={() => apiRef.current?.setFocus("body")}>全身</button>
      <button type="button" className={btn(false)} onClick={() => { setView("front"); apiRef.current?.reset(); }}>重置</button>
    </div>
  </div>;
}

function FootCard({ e, onShow }: { e: FootExercise; onShow: (k: string) => void }) {
  const [open, setOpen] = useState(false), [d, setD] = useState(() => loadDose(e.id)), [saved, setSaved] = useState(false);
  const [gender, setGender] = useState<'male'|'female'>('male');
  const num = (k: "sets" | "amount" | "restSec", v: string) => { const n = Math.max(0, Math.min(k === "restSec" ? 600 : 100, Math.round(+v || 0))); setD({ ...d, [k]: n }); setSaved(false); };
  return <div className="rounded-card border border-line p-3">
    <button type="button" className="flex w-full min-h-11 items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><b>{e.name}</b><span className="ml-2 text-xs text-muted">{e.level}</span></span><span className="text-xs text-muted">{d.sets}×{d.amount}{e.dose.unit} · 休息{d.restSec}秒</span></button>
    {open ? <div className="mt-2 space-y-2 text-sm">
      <div><b className="text-xs">演示</b>
        <div className="my-2 flex gap-2" role="group" aria-label="足踝演示角色">{(['male','female'] as const).map(g=><button type="button" className="fk-chip" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div>
        <FangkunExerciseVideo exerciseId={`foot:${e.id}`} title={e.name} gender={gender}/>
        <ol className="ml-4 list-decimal">{e.demo.steps.map(s => <li key={s}>{s}</li>)}</ol>
        <button type="button" className="mt-1 min-h-10 rounded-full border border-line px-3 text-xs" onClick={() => onShow(e.muscles[0])}>在 3D 上显示主要肌群</button></div>
      <p><b className="text-xs">肌群</b> 主要：{e.muscles.map(zhOf).join("、")}{e.secondary.length ? `；辅助：${e.secondary.map(zhOf).join("、")}` : ""}</p>
      <div><b className="text-xs">技术要点</b><ul className="ml-4 list-disc">{e.tips.map(s => <li key={s}>{s}</li>)}</ul></div>
      <div><b className="text-xs">常见错误</b><ul className="ml-4 list-disc">{e.mistakes.map(s => <li key={s}>{s}</li>)}</ul></div>
      <p><b className="text-xs">难度与进阶</b> {e.level}；{e.progress}</p>
      <div className="flex flex-wrap items-end gap-2" aria-label="剂量">
        <label className="text-xs">组数<input inputMode="numeric" className="ml-1 w-14 rounded border border-line bg-surface px-1 py-1" value={d.sets} onChange={x => num("sets", x.target.value)} /></label>
        <label className="text-xs">{e.dose.unit === "秒" ? "秒数" : "次数"}<input inputMode="numeric" className="ml-1 w-14 rounded border border-line bg-surface px-1 py-1" value={d.amount} onChange={x => num("amount", x.target.value)} /></label>
        <label className="text-xs">组间休息(秒)<input inputMode="numeric" className="ml-1 w-16 rounded border border-line bg-surface px-1 py-1" value={d.restSec} onChange={x => num("restSec", x.target.value)} /></label>
        <button type="button" className="min-h-10 rounded-full border border-line px-3 text-xs" onClick={() => { saveDose(e.id, d); setSaved(true); }}>{saved ? "参考参数已保存" : "保存参考参数"}</button>
      </div>
      <p className="keep text-[11px] text-muted">剂量为常用起点，可按自身情况修改；不作为医疗处方。</p>
      <div className="text-[11px] text-muted"><b>来源</b>{e.sources.map(s => <p key={s} className="keep text-[11px] text-muted">{s}</p>)}</div>
    </div> : null}
  </div>;
}

export function MuscleExplorerSheet({ onClose, onAdd, onShow, selected = [] }: { onClose: () => void; onAdd?: (action: MuscleAction) => void; onShow?: (id: string) => void; selected?: string[] }) {
  const [pick, setPick] = useState<Pick>(null), api = useRef<Explorer | null>(null);
  const actionAnchor = useRef<HTMLDivElement>(null);
  const [cat, setCat] = useState(FOOT_CATEGORIES[0]);
  return <Sheet full label="人体肌群3D" title="人体肌肉 3D" sub="点击身体上的肌群，查看对应训练动作" onClose={onClose} footer={<button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={onClose}>{selected.length ? `返回训练 · 已选${selected.length}个动作` : '完成查看'}</button>}>
    <Viewer3D onPick={setPick} apiRef={api} />
    {pick ? <div className="sticky top-0 z-10 mt-2 flex items-center justify-between gap-2 rounded-xl border border-accent bg-[#171a1e] p-3"><b className="text-sm text-accent">已选：{pick.zh}</b><button type="button" className="min-h-11 shrink-0 rounded-full bg-accent px-3 text-sm font-bold text-accent-fg" onClick={() => actionAnchor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>查看相关动作 ↓</button></div> : null}
    <details className="mt-2 rounded-xl border border-line p-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">按名称选择肌群</summary><div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{MUS.map((m, index) => <button type="button" key={m.k} className="fk-chip" aria-pressed={pick?.k === m.k} onClick={() => { setPick({ id: index + 1, k: m.k, zh: m.zh, g: m.g }); api.current?.selectKey(m.k); }}>{m.zh}</button>)}</div></details>
    <section aria-label="肌群信息" className="mt-3 rounded-card border border-line p-3">
      {pick ? <><h3 className="text-lg font-black">{pick.zh}</h3><p className="mt-1 text-sm">功能：{MUSCLE_FN[pick.k] ?? "待核"}</p>
        </>
        : <p className="keep text-sm text-muted">在模型上点一下某块肌群。</p>}
      <p className="keep mt-2 text-[11px] text-muted">{MUSCLE_FN_SRC}</p>
    </section>
    <div ref={actionAnchor} className="scroll-mt-20"><MuscleActionList pick={pick} onAdd={onAdd} onShow={onShow} selected={selected} /></div>
    <section aria-label="足踝小腿动作" className="mt-4">
      <h3 className="font-black">足踝与小腿训练</h3>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="动作分类">{FOOT_CATEGORIES.map(c => <button key={c} type="button" aria-pressed={c === cat} className={`min-h-10 rounded-full border px-3 text-sm ${c === cat ? "border-accent bg-accent/15 font-bold" : "border-line"}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="mt-2 space-y-2">{FOOT_LIBRARY.filter(e => e.cat === cat).map(e => <FootCard key={e.id} e={e} onShow={k => { api.current?.selectKey(k); api.current?.setFocus(k === "foot_intrinsic" ? "foot" : "calf"); }} />)}</div>
    </section>
  </Sheet>;
}
