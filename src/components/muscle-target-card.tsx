import { useEffect, useRef, useState } from "react";
import { MUSCLES } from "@/lib/strength/demo/musclemap.js";
import { muscleDisplay } from "@/lib/body/muscle-display";
import "./muscle-target-card.css";

type Pick = { k: string; zh: string; g: string | null; side?: string; layer?: string; name?: string } | null;
type API = { setView: (v: string) => void; setFocus: (v: string) => void; setDeep: (value: boolean) => void; selectKey: (key: string | null) => void; destroy: () => void };
type Exercise = { id: string; primary_muscles: string[]; secondary_muscles: string[]; muscle_source?: string };
const zh = (key: string) => (MUSCLES as Record<string, string>)[key] ?? key;
const BACK = new Set(["glutes", "glute_med", "hamstrings", "calves", "soleus", "lats", "traps", "rhomboids", "erectors", "triceps", "delt_rear"]);

/** Independent anatomical muscle meshes. The animation has its own rig. */
export function MuscleTargetCard({ exercise }: { exercise: Exercise }) {
  const canvas = useRef<HTMLCanvasElement>(null), api = useRef<API | null>(null);
  const [pick, setPick] = useState<Pick>(null), [ready, setReady] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const initialView = exercise.primary_muscles.length && exercise.primary_muscles.every(x => BACK.has(x)) ? "back" : "front";
  const [view, setView] = useState(initialView);
  const [focus, setFocus] = useState("body"), [deep, setDeep] = useState(false);
  useEffect(() => {
    let dead = false, instance: API | null = null;
    setReady(false); setError(""); setPick(null); setView(initialView); setFocus("body"); setDeep(false);
    const timeout = setTimeout(() => { if (!dead && !instance) setError("肌肉模型加载较慢，肌群列表仍可查看。"); }, 45000);
    import(/* @vite-ignore */ new URL("/demo3d/anatomy3d.js", window.location.origin).href).then(async module => {
      if (dead || !canvas.current) return;
      instance = await module.createMuscleExplorer(canvas.current, {
        primary: exercise.primary_muscles, secondary: exercise.secondary_muscles,
        onPick: (value: Pick) => { if (!dead) setPick(value); },
      }) as API;
      if (dead) { instance.destroy(); return; }
      instance.setView(initialView); api.current = instance;
      clearTimeout(timeout); setReady(true); setError("");
    }).catch(() => { if (!dead) setError("3D暂不可用，肌群列表仍可查看。"); });
    return () => { dead = true; clearTimeout(timeout); instance?.destroy(); api.current = null; };
  }, [exercise.id, initialView, retry]);
  const info = pick ? muscleDisplay(pick) : null;
  return <section className="fk-dash-card fk-target-card mt-3" aria-label="目标肌群">
    <header><h2 className="fk-dash-title">相关部位</h2></header>
    <div className="fk-target-stage"><canvas ref={canvas} aria-label="可点选的独立肌肉3D模型" />
      {!ready ? <div className="fk-target-status" role="status"><p className="keep">{error || "正在打开肌群模型…"}</p>{error ? <button type="button" onClick={() => setRetry(x => x + 1)}>重新加载</button> : null}</div> : null}
    </div>
    <div className="fk-target-controls" role="group" aria-label="肌群视角">{[["front", "正面"], ["left", "左侧"], ["right", "右侧"], ["back", "背面"]].map(([key, label]) => <button key={key} type="button" disabled={!ready} aria-pressed={view === key} onClick={() => { setView(key); api.current?.setView(key); }}>{label}</button>)}</div>
    <div className="fk-target-controls" role="group" aria-label="肌群范围">{[["body", "全身"], ["calf", "小腿"], ["foot", "足部"]].map(([key, label]) => <button key={key} type="button" disabled={!ready} aria-pressed={focus === key} onClick={() => { setFocus(key); api.current?.setFocus(key); }}>{label}</button>)}<button type="button" disabled={!ready} onClick={() => { setView(initialView); setFocus("body"); setDeep(false); api.current?.setDeep(false); api.current?.selectKey(null); api.current?.setFocus("body"); api.current?.setView(initialView); }}>复原</button></div>
    <div className="fk-target-layer" role="group" aria-label="肌肉层次">{([[false, "表层肌"], [true, "深层肌"]] as const).map(([value, label]) => <button key={String(value)} type="button" disabled={!ready} aria-pressed={deep === value} onClick={() => { setDeep(value); api.current?.setDeep(value); }}>{label}</button>)}</div>
    <div className="fk-target-legend"><span><i className="main" />主要参与</span><span><i className="aux" />辅助参与</span><span><i className="selected" />已选中</span></div>
    {info ? <div className="mt-3 space-y-1 text-sm" role="status"><h3 className="font-bold">{info.name}</h3>{info.effect ? <p>作用：{info.effect}</p> : null}{info.related.length ? <p className="text-muted">相关部位：{info.related.join('、')}</p> : null}</div> : null}
    <div className="fk-target-muscles" aria-label="主要肌群"><b>主要</b>{exercise.primary_muscles.map(m => <button type="button" key={m} className="main" onClick={() => api.current?.selectKey(m)}>{zh(m)}</button>)}</div>
    {!!exercise.secondary_muscles.length && <div className="fk-target-muscles" aria-label="辅助肌群"><b>辅助</b>{exercise.secondary_muscles.map(m => <button type="button" key={m} className="aux" onClick={() => api.current?.selectKey(m)}>{zh(m)}</button>)}</div>}
  </section>;
}
