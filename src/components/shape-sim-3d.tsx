import { useEffect, useRef, useState } from "react";
import { girthFor, loadSim, saveSim, splitOf, type SimParams } from "@/lib/body/shape-sim";

type Fig = { setPose: (k: string) => void; setView: (v: string) => void; reset: () => void; setShape: (i: number, g: object) => void; destroy: () => void };
const POSES: [string, string][] = [["stand", "标准站姿"], ["relax", "自然休闲"], ["hips", "叉腰"], ["arms", "轻抱臂"], ["flex", "屈肘展示"], ["run", "跑步定格"]];
const VIEWS: [string, string][] = [["front", "正面"], ["side", "侧面"], ["back", "背面"], ["three", "45°"]];
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** t428 C + t432: real three.js viewer on human.glb; current vs target share model, pose and camera (rotation synced). */
export function ShapeSim3D({ cur, tgt, sex }: { cur: { kg: number; bf: number | null }; tgt: { kg: number; bf: number | null } | null; sex: "male" | "female" }) {
  const cv = useRef<HTMLCanvasElement>(null), api = useRef<Fig | null>(null);
  const [err, setErr] = useState(""), [ready, setReady] = useState(false), [tries, setTries] = useState(0);
  const [p, setP] = useState<SimParams>(() => { const s = loadSim(); return tgt?.bf != null && !localStorage.getItem("fk-shape-sim-v1") ? { ...s, mode: "bf" } : s; });
  const [view, setView] = useState("front");
  const sp = tgt ? splitOf(cur, tgt, p) : null;
  useEffect(() => {
    if (sex !== "male") return; let dead = false, a: Fig | null = null; setErr(""); setReady(false);
    const t = setTimeout(() => { if (!a && !dead) setErr("加载超时（网络慢或离线）"); }, 20000);
    import(/* @vite-ignore */ new URL("/demo3d/body3d.js", location.origin).href).then(async M => {
      if (dead || !cv.current) return; a = await M.createFigureViewer(cv.current, { count: tgt ? 2 : 1 }); if (dead) { a?.destroy(); return; }
      api.current = a; Object.assign(cv.current, { __fk: a }); a!.setPose(p.pose); setReady(true); setErr("");
    }).catch((e: Error) => { if (!dead) setErr(`3D 模型加载失败：${e?.message || "未知错误"}`); });
    return () => { dead = true; clearTimeout(t); a?.destroy(); api.current = null; };
  }, [tries, !!tgt, sex]);
  useEffect(() => { if (ready && sp) api.current?.setShape(1, girthFor(sp.dFat, sp.dLean)); }, [ready, sp?.dFat, sp?.dLean]);
  const upd = (q: Partial<SimParams>) => { const n = { ...p, ...q }; setP(n); saveSim(n); };
  const chip = (on: boolean) => `min-h-9 rounded-full border px-2.5 text-xs ${on ? "border-accent bg-accent/15 font-bold text-accent" : "border-line"}`;
  if (sex !== "male") return <div className="rounded-xl border border-line p-3 text-center"><img src="/fangkun-atlas/figure-female.webp" alt="标准形象插画" className="mx-auto h-[300px] object-contain" /><p className="keep text-[11px] text-amber-400">静态插画，非体型模拟。女性 3D 人体模型尚未提供（缺失资源）。</p></div>;
  return <div aria-label="体型模拟3D">
    <p className="keep text-center text-[11px] font-bold text-amber-400">模拟外观，非准确预测</p>
    <div className="relative mt-1 overflow-hidden rounded-xl border border-line bg-[#171a1e]" style={{ height: 360 }}>
      <canvas ref={cv} aria-label="体型3D" className="block h-full w-full" />
      {tgt ? <><span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 text-xs">当前 {f1(cur.kg)} kg</span><span className="absolute right-2 top-2 rounded bg-black/50 px-1.5 text-xs text-accent">目标 {f1(tgt.kg)} kg</span></> : null}
      {!ready && !err ? <p className="keep absolute inset-x-0 top-1/2 text-center text-sm text-muted">3D 模型加载中…</p> : null}
      {err ? <div className="absolute inset-0 grid place-items-center bg-[#171a1e] p-3 text-center"><div><p className="keep text-sm">{err}</p>
        <button type="button" className={chip(false) + " mt-2"} onClick={() => setTries(x => x + 1)}>重试</button>
        <img src="/fangkun-atlas/figure-male.webp" alt="标准形象插画" className="mx-auto mt-2 h-44 object-contain" /><p className="keep text-[11px] text-muted">静态插画（非 3D，非体型模拟）</p></div></div> : null}
    </div>
    <p className="keep mt-1 text-[11px] text-muted">同一模型、同一姿势、同一镜头，左右同步旋转。左侧为标准模型作为当前基准，右侧按体重、体脂与肌肉/脂肪比例调整腰、胸、上臂、大腿、小腿、肩部围度。拖动旋转 · 双指缩放。</p>
    <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="视角">{VIEWS.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} className={chip(view === k)} onClick={() => { setView(k); api.current?.setView(k); }}>{l}</button>)}
      <button type="button" className={chip(false)} onClick={() => { setView("front"); upd({ pose: "stand" }); api.current?.reset(); }}>恢复默认</button></div>
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="姿势">{POSES.map(([k, l]) => <button key={k} type="button" aria-pressed={p.pose === k} className={chip(p.pose === k)} onClick={() => { upd({ pose: k }); api.current?.setPose(k); }}>{l}</button>)}</div>
    {tgt && sp ? <div className="mt-2 rounded-xl border border-line p-2 text-xs">
      <div className="flex gap-1" role="group" aria-label="模拟方式">
        <button type="button" aria-pressed={p.mode === "bf"} disabled={tgt.bf == null || cur.bf == null} className={chip(p.mode === "bf") + " disabled:opacity-40"} onClick={() => upd({ mode: "bf" })}>按目标体脂换算</button>
        <button type="button" aria-pressed={p.mode === "split"} className={chip(p.mode === "split")} onClick={() => upd({ mode: "split" })}>自定肌肉/脂肪比例</button></div>
      {p.mode === "split" ? <><div className="mt-2 flex justify-between"><span>体重变化中肌肉占比</span><b className="text-accent">{Math.round(p.leanShare * 100)}%</b></div>
        <input aria-label="肌肉占比" type="range" min={0} max={100} step={5} value={Math.round(p.leanShare * 100)} onChange={e => upd({ leanShare: Number(e.target.value) / 100 })} className="w-full accent-[#ff6a1a]" /></> : null}
      <p className="keep mt-1 text-muted">脂肪 {sp.dFat >= 0 ? "+" : ""}{f1(sp.dFat)} kg · 去脂体重 {sp.dLean >= 0 ? "+" : ""}{f1(sp.dLean)} kg{sp.share != null && p.mode === "bf" ? ` · 相当于肌肉占比 ${Math.round(sp.share * 100)}%` : ""}{sp.derivedBf != null ? ` · 目标体脂约 ${f1(sp.derivedBf)}%` : ""}</p>
      <p className="keep mt-1 text-[11px] text-muted">模拟参数单独保存，不会改动体重、体脂等实测记录。</p>
    </div> : <p className="keep mt-2 text-xs text-muted">在下方选择目标体重后显示目标对比。</p>}
  </div>;
}
