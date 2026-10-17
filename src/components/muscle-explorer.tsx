import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { demoData } from "@/lib/strength/demo/provider";
import { MUSCLE_FN, MUSCLE_FN_SRC } from "@/lib/body/muscle-info";
import { FOOT_CATEGORIES, FOOT_LIBRARY, loadDose, saveDose, type FootExercise } from "@/lib/body/foot-library";
import { MUS } from "@/lib/body/muscles";
import ExerciseDemo from "@/components/exercise-demo";

type Pick = { id: number; k: string; zh: string; g: string | null } | null;
type Explorer = { setView: (v: string) => void; setFocus: (f: string) => void; reset: () => void; selectKey: (k: string) => void; destroy: () => void };
const zhOf = (k: string) => (MUS as { k: string; zh: string }[]).find(m => m.k === k)?.zh ?? k;

function linked(p: NonNullable<Pick>) {
  const lib = (demoData.exercises as unknown as { id: string; name_zh: string; primary_muscles: string[]; secondary_muscles: string[] }[])
    .filter(e => e.primary_muscles.includes(p.k) || (p.g && e.primary_muscles.includes(p.g)) || e.secondary_muscles.includes(p.k) || (p.g && e.secondary_muscles.includes(p.g)))
    .map(e => ({ name: e.name_zh, main: e.primary_muscles.includes(p.k) || (!!p.g && e.primary_muscles.includes(p.g)) }));
  const foot = FOOT_LIBRARY.filter(e => e.muscles.includes(p.k) || e.secondary.includes(p.k)).map(e => ({ name: e.name, main: e.muscles.includes(p.k) }));
  return [...foot, ...lib].sort((a, b) => Number(b.main) - Number(a.main)).slice(0, 12);
}

function Viewer3D({ onPick, apiRef }: { onPick: (p: Pick) => void; apiRef: React.MutableRefObject<Explorer | null> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(""), [ready, setReady] = useState(false), [tries, setTries] = useState(0);
  const [view, setView] = useState("front");
  useEffect(() => {
    let dead = false, api: Explorer | null = null; setErr(""); setReady(false);
    const url = new URL("/demo3d/body3d.js", location.origin).href;
    const t = setTimeout(() => { if (!api && !dead) setErr("加载超时（网络慢或离线）"); }, 20000);
    import(/* @vite-ignore */ url).then(async M => { if (dead || !cv.current) return; api = await M.createMuscleExplorer(cv.current, { onPick }); if (dead) { api?.destroy(); return; } apiRef.current = api; Object.assign(cv.current, { __fk: api }); setReady(true); setErr(""); })
      .catch((e: Error) => { if (!dead) setErr(`3D 模型加载失败：${e?.message || "未知错误"}`); });
    return () => { dead = true; clearTimeout(t); api?.destroy(); apiRef.current = null; };
  }, [tries]);
  const btn = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent/15 font-bold" : "border-line"}`;
  return <div>
    <div className="relative overflow-hidden rounded-card border border-line bg-[#171a1e]" style={{ height: 380 }}>
      <canvas ref={cv} aria-label="人体肌群3D" className="block h-full w-full" />
      {!ready && !err ? <p className="keep absolute inset-x-0 top-1/2 text-center text-sm text-muted">3D 模型加载中…</p> : null}
      {err ? <div className="absolute inset-0 grid place-items-center bg-[#171a1e] p-3 text-center">
        <div><p className="keep text-sm">{err}</p><button type="button" className={btn(false) + " mt-2"} onClick={() => setTries(x => x + 1)}>重试</button>
          <p className="keep mt-2 text-xs text-muted">可先从下方选择肌群，查看名称与相关动作。</p></div></div> : null}
    </div>
    {err ? <div className="mt-2 flex max-h-36 flex-wrap gap-1 overflow-y-auto" aria-label="备用肌群列表">{MUS.map((m, index) => <button key={m.k} type="button" className="min-h-9 rounded-full border border-line px-2 text-xs" onClick={() => onPick({ id: index + 1, k: m.k, zh: m.zh, g: m.g })}>{m.zh}</button>)}</div> : null}
    <p className="keep mt-1 text-[11px] text-muted">区域着色模型：肌群颜色画在同一人体网格的贴图上，不是独立肌肉建模。拖动旋转（限 ±30°）· 双指缩放 · 点选肌群。</p>
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
  const num = (k: "sets" | "amount" | "restSec", v: string) => { const n = Math.max(0, Math.min(k === "restSec" ? 600 : 100, Math.round(+v || 0))); setD({ ...d, [k]: n }); setSaved(false); };
  return <div className="rounded-card border border-line p-3">
    <button type="button" className="flex w-full min-h-11 items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span><b>{e.name}</b><span className="ml-2 text-xs text-muted">{e.level}</span></span><span className="text-xs text-muted">{d.sets}×{d.amount}{e.dose.unit} · 休息{d.restSec}秒</span></button>
    {open ? <div className="mt-2 space-y-2 text-sm">
      <div><b className="text-xs">演示</b>
        {e.demo.motion ? <div className="mt-1"><ExerciseDemo catalogId={e.demo.motion} compact /></div> : <p className="keep text-[11px] text-muted">暂无该动作的动画资源；以下为分步说明，可在上方 3D 模型查看相关肌群。</p>}
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
        <button type="button" className="min-h-10 rounded-full border border-line px-3 text-xs" onClick={() => { saveDose(e.id, d); setSaved(true); }}>{saved ? "已保存" : "保存剂量"}</button>
      </div>
      <p className="keep text-[11px] text-muted">剂量为常用起点，可按自身情况修改；不作为医疗处方。</p>
      <div className="text-[11px] text-muted"><b>来源</b>{e.sources.map(s => <p key={s} className="keep text-[11px] text-muted">{s}</p>)}</div>
    </div> : null}
  </div>;
}

export function MuscleExplorerSheet({ onClose }: { onClose: () => void }) {
  const [pick, setPick] = useState<Pick>(null), api = useRef<Explorer | null>(null);
  const [cat, setCat] = useState(FOOT_CATEGORIES[0]);
  return <Sheet label="人体肌群3D" title="人体肌群 3D" sub="点选肌群查看名称、功能和相关动作" onClose={onClose} footer={<button type="button" className="min-h-11 w-full rounded-full border border-line" onClick={onClose}>完成</button>}>
    <Viewer3D onPick={setPick} apiRef={api} />
    <section aria-label="肌群信息" className="mt-3 rounded-card border border-line p-3">
      {pick ? <><h3 className="text-lg font-black">{pick.zh}</h3><p className="mt-1 text-sm">功能：{MUSCLE_FN[pick.k] ?? "待核"}</p>
        <p className="mt-2 text-xs font-bold">相关动作</p><div className="mt-1 flex flex-wrap gap-1">{linked(pick).map(x => <span key={x.name} className={`rounded-full border px-2 py-0.5 text-xs ${x.main ? "border-accent" : "border-line text-muted"}`}>{x.name}{x.main ? "（主要）" : ""}</span>)}{linked(pick).length === 0 ? <span className="text-xs text-muted">暂无关联动作</span> : null}</div></>
        : <p className="keep text-sm text-muted">在模型上点一下某块肌群。</p>}
      <p className="keep mt-2 text-[11px] text-muted">{MUSCLE_FN_SRC}</p>
    </section>
    <section aria-label="足踝小腿动作" className="mt-4">
      <h3 className="font-black">足踝与小腿训练</h3>
      <div className="mt-2 flex gap-1.5" role="group" aria-label="动作分类">{FOOT_CATEGORIES.map(c => <button key={c} type="button" aria-pressed={c === cat} className={`min-h-10 rounded-full border px-3 text-sm ${c === cat ? "border-accent bg-accent/15 font-bold" : "border-line"}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="mt-2 space-y-2">{FOOT_LIBRARY.filter(e => e.cat === cat).map(e => <FootCard key={e.id} e={e} onShow={k => { api.current?.selectKey(k); api.current?.setFocus(k === "foot_intrinsic" ? "foot" : "calf"); }} />)}</div>
    </section>
  </Sheet>;
}
