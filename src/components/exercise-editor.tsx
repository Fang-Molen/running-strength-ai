import { MUSCLES, muscleMapSVG } from "@/lib/strength/demo/musclemap.js";
import atlasIndex from "../lib/strength/atlas-index.json" with { type: "json" };
import { isChunkError, recoverFromChunkError } from "@/lib/chunk-recover";
import { REST_SUGGEST, fmtRest, splitSec, toSec } from "@/lib/strength/rest";
import { lazy, Suspense, useMemo, useState, useEffect } from "react";
import { demoData } from "@/lib/strength/demo/provider";
const ExerciseDemo = lazy(() => import("@/components/exercise-demo").catch((e) => { if (isChunkError(e)) void recoverFromChunkError(); throw e; }));
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { CATALOG } from "@/lib/strength/catalog";

export type Unit = "reps" | "sec" | "m";
export type Ex = { name: string; sets: string; reps: string; weight: string; rpe: string; unit?: Unit; perSide?: boolean; restSec?: number | null; sideRestSec?: number | null };
export type Dose = { unit: Unit; perSide: boolean; bodyweight: boolean; sets: string; amount: string };
export const UNIT_LABEL: Record<Unit, string> = { reps: "次", sec: "秒", m: "米" };
export function doseOf(name: string): Dose {
  const loaded = /杠铃|哑铃|壶铃|绳索|龙门|器械|腿举|坐姿|负重|药球/.test(name);
  const unit: Unit = /农夫行走|冲刺|雪橇|行走(?!弓步)|搬运/.test(name) ? "m" : /平板|侧桥|支撑|悬挂|静态|靠墙|保持|等长/.test(name) ? "sec" : "reps";
  const perSide = /单腿|单臂|分腿|弓步|Pallof|抗旋|侧桥|侧平板|侧卧|鸟狗|登阶|台阶|单侧/.test(name);
  const bodyweight = !loaded && /俯卧撑|引体|平板|侧桥|死虫|卷腹|起坐|两头起|悬垂|波比|登山者|臀桥|鸟狗|侧卧抬腿|臂屈伸|反向划船|弹跳|蹲跳|跳箱|抗旋|Pallof|行走弓步|北欧/.test(name);
  const amount = unit === "sec" ? "30" : unit === "m" ? "20" : bodyweight ? "10" : "8";
  return { unit, perSide, bodyweight, sets: "3", amount };
}
const ALIAS: Record<string, string> = { "分腿蹲": "保加利亚分腿蹲", "罗马尼亚硬拉 RDL": "罗马尼亚硬拉", "RDL": "罗马尼亚硬拉", "提踵": "站姿提踵", "抗旋": "Pallof 抗旋转" };
export function demoIdFor(name: string): string | null {
  const n = ALIAS[name] ?? name;
  const c = CATALOG.find((x) => x.name === n) ?? CATALOG.find((x) => x.name.includes(n) || n.includes(x.name));
  return c && demoData.exercises.some((e) => e.id === c.id) ? c.id : null;
}
type AtlasRow = { muscles: string[]; aux: string[]; training?: { sets: number; amount: number; unit: string; restSec: number }; img: { male?: string; female?: string }; seq_male?: string[]; seq_female?: string[] };
const ATLAS = atlasIndex as Record<string, AtlasRow>;
type Cue = { setup: string[]; execution: string[]; breathing: string[]; mistakes: string[]; safety: string[]; regression: string[]; progression: string[] };
type DemoEx = { id: string; name_zh: string; name_en: string; category: string; equipment: string[]; default_sets: number; default_reps_or_time: { mode: string; amount: number }; default_rest_sec: number; review?: string; primary_muscles: string[]; secondary_muscles: string[]; cues?: Cue };
const EN_ZH: Record<string, string> = { "delt front": "三角肌前束", "delt side": "三角肌中束", "delt rear": "三角肌后束", "glute med": "臀中肌", feet: "足底内在肌" };
const zh = (m: string) => (MUSCLES as Record<string, string>)[m] ?? EN_ZH[m] ?? m;
function MuscleCard({ e, sex }: { e: DemoEx | undefined; sex: "male" | "female" }) {
  const [view, setView] = useState<"front" | "back">("front");
  const [pick, setPick] = useState<string | null>(null);
  if (!e) return null;
  const prim = e.primary_muscles, sec = e.secondary_muscles;
  const backHeavy = prim.length > 0 && prim.every((m) => ["lats", "rhomboids", "erectors", "glutes", "hamstrings", "calves", "traps", "delt_rear", "triceps", "glute_med"].includes(m));
  return <div className="fk-dash-card mt-3 text-sm" aria-label="目标肌群">
    <div className="flex items-center"><div className="fk-dash-title">目标肌群</div>
      <span className="ml-auto flex rounded border border-line text-xs">{(["front", "back"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={"min-h-9 px-3 " + (view === v ? "bg-accent text-accent-fg" : "")}>{v === "front" ? "正面" : "背面"}</button>)}</span></div>
    {backHeavy && view === "front" ? <p className="keep mt-1 text-xs text-amber-400">主要肌群多在背面，可切换到背面查看</p> : null}
    <div className="mx-auto mt-2 w-full max-w-[220px] [&>svg]:h-auto [&>svg]:w-full" onClick={(ev) => { const m = (ev.target as Element).getAttribute?.("data-m"); setPick(m); }}
      dangerouslySetInnerHTML={{ __html: muscleMapSVG(view, prim as never, sec as never, { selected: (pick ? [pick] : []) as never }) }} />
    <div className="mt-2 flex flex-wrap gap-3 text-xs"><span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm bg-[#ff5a3c]" />主要</span><span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm bg-[#ffb199]" />辅助</span><span className="flex items-center gap-1"><i className="inline-block size-3 rounded-sm bg-[#4da3ff]" />你点选的</span></div>
    {pick ? <p className="keep mt-1">{zh(pick)}：{prim.includes(pick) ? "本动作主要参与" : sec.includes(pick) ? "本动作辅助参与" : "本动作不是重点"}</p> : null}
    <p className="mt-2">主要：{prim.map(zh).join("、") || "待补"}</p>{sec.length ? <p className="text-muted">辅助：{sec.map(zh).join("、")}</p> : null}
    <p className="keep mt-1 text-[11px] text-muted">高亮表示动作涉及的肌群，不是实测的发力程度、疲劳或恢复。2D 示意图（{sex === "male" ? "男" : "女"}性动作图对应同一肌群图）。</p>
  </div>;
}
function DemoBlock({ id }: { id: string }) {
  const a = ATLAS[id];
  const [sex, setSex] = useState<"male" | "female">("male");
  const [show3d, setShow3d] = useState(false);
  const img = a ? (a.img[sex] ?? a.img.male ?? a.img.female) : undefined;
  const seq = a ? (a[`seq_${sex}`] ?? a.seq_male ?? a.seq_female) : undefined;
  const src = (x: string) => `/fangkun-atlas/${x}`;
  const demo = <Suspense fallback={<p>正在打开演示…</p>}><ExerciseDemo catalogId={id} compact /></Suspense>;
  return <div className="fk-dash-card mt-3">
    <div className="flex items-center gap-2"><div className="fk-dash-title">动作图</div>
      {a && a.img.male && a.img.female ? <span className="ml-auto flex rounded border border-line text-xs">{(["male", "female"] as const).map((x) => <button key={x} type="button" aria-pressed={sex === x} onClick={() => setSex(x)} className={"min-h-9 px-3 " + (sex === x ? "bg-accent text-accent-fg" : "")}>{x === "male" ? "男" : "女"}</button>)}</span> : null}</div>
    {img ? <><img src={src(img)} alt="动作示意" className="mt-2 max-h-[60dvh] w-full rounded-xl object-contain" loading="lazy" />
      {seq ? <div className="mt-2 grid grid-cols-5 gap-1">{seq.map((f, i) => <figure key={f}><img src={src(f)} alt={`第${i + 1}步`} className="w-full rounded-md object-contain" loading="lazy" /><figcaption className="text-center text-[10px] text-muted">0{i + 1}</figcaption></figure>)}</div> : null}
      <button type="button" aria-expanded={show3d} className="mt-2 min-h-10 w-full rounded-xl border border-line text-sm" onClick={() => setShow3d(!show3d)}>{show3d ? "收起动画演示" : "播放动画演示（可慢放）"}</button>
      {show3d ? <div className="mt-2">{demo}</div> : null}</> : <div className="mt-2">{demo}</div>}
    <p className="keep mt-2 text-[11px] text-muted">动作图为生成的示意插画；动画为示意模型。待专业校核</p>
  </div>;
}
export function DemoSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const e = demoData.exercises.find((x) => x.id === id) as unknown as DemoEx | undefined;
  const cue = e?.cues;
  return <div className="product-ui app-wallpaper fixed inset-0 z-50 overflow-y-auto px-4 pt-[max(16px,env(safe-area-inset-top))]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)" }} data-theme="dark" role="dialog" aria-label="动作详情">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h1 className="text-3xl font-black">{e?.name_zh}</h1><p className="text-sm uppercase tracking-[.2em] text-muted">{e?.name_en}</p></div><button type="button" className="min-h-11 shrink-0 rounded-full border border-line px-4 font-bold" onClick={onClose}>关闭</button></div>
    {e ? <div className="mt-2 flex flex-wrap gap-2 text-xs">{[e.category, ...e.equipment].map((t) => <span key={t} className="rounded-md border border-line px-2 py-1">{t}</span>)}</div> : null}
    <DemoBlock id={id} />
    <MuscleCard e={e} sex="male" />
    {e ? <div className="fk-dash-card mt-3 text-sm"><div className="fk-dash-title">推荐参数</div><p className="mt-1">默认 {e.default_sets} 组 × {e.default_reps_or_time.amount}{e.default_reps_or_time.mode === "seconds" ? " 秒" : " 次"} · 组间休息 {e.default_rest_sec} 秒</p></div> : null}
    {cue ? <div className="fk-dash-card mt-3 text-sm"><div className="fk-dash-title">怎么做</div>{([["准备", cue.setup], ["动作", cue.execution], ["呼吸", cue.breathing], ["常见错误", cue.mistakes], ["安全", cue.safety], ["变简单 / 变难", [...cue.regression.map((x) => "简单：" + x), ...cue.progression.map((x) => "进阶：" + x)]]] as [string, string[]][]).map(([t, lines], i) => <details key={t} open={i < 2} className="mt-2"><summary className="min-h-9 font-bold">{t}</summary><ul className="list-disc pl-5">{lines.map((l, n) => <li key={n}>{l}</li>)}</ul></details>)}</div> : null}
    <p className="keep mt-3 text-xs text-muted">动作要领为方坤自写内容，尚未经专业审校{e?.review ? `（${e.review}）` : ""}</p>
  </div>;
}
export const PARTS = ["下肢", "上肢", "核心", "后链", "小腿", "全身", "快速力量"] as const;
const EXTRA: [string, string[]][] = [
  ["分腿蹲", ["下肢"]], ["保加利亚分腿蹲", ["下肢"]], ["台阶上步", ["下肢"]], ["深蹲", ["下肢", "全身"]], ["陷阱杠硬拉", ["后链", "全身"]],
  ["罗马尼亚硬拉 RDL", ["后链"]], ["臀推", ["后链", "下肢"]], ["臀桥", ["后链"]], ["北欧腿弯举", ["后链"]], ["提踵", ["小腿"]], ["膝屈提踵", ["小腿"]],
  ["Pallof 抗旋转", ["核心"]], ["死虫", ["核心"]], ["鸟狗", ["核心"]], ["侧桥", ["核心"]], ["低量弹跳", ["快速力量"]], ["蹲跳", ["快速力量"]], ["跳箱", ["快速力量"]], ["药球抛", ["快速力量", "上肢"]],
];
const GROUP_PART: Record<string, string[]> = { 腿: ["下肢"], 臀: ["下肢", "后链"], 胸: ["上肢"], 背: ["上肢"], 肩: ["上肢"], 手臂: ["上肢"], 核心: ["核心"], 全身: ["全身"] };
function partsOf(name: string, group?: string): string[] {
  const p = new Set(group ? GROUP_PART[group] ?? [] : []);
  if (/硬拉|RDL|腿弯|背伸|桥|臀/.test(name)) p.add("后链"); if (/提踵|小腿/.test(name)) p.add("小腿"); if (/跳|弹|抛|高翻|爆发/.test(name)) p.add("快速力量");
  return [...p];
}
export const LIBRARY: { name: string; parts: string[] }[] = (() => {
  const m = new Map<string, string[]>();
  for (const [n, ps] of EXTRA) m.set(n, ps);
  for (const c of CATALOG) if (!m.has(c.name)) m.set(c.name, partsOf(c.name, c.group));
  return [...m].map(([name, parts]) => ({ name, parts }));
})();

export function PartChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return <div className="flex flex-wrap gap-2">{PARTS.map((t) => <button key={t} type="button" className="fk-chip" aria-pressed={value.includes(t)} onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}>{t}</button>)}</div>;
}

export function ExerciseEditor({ value, onChange, parts, betweenRest, onBetweenRest }: { value: Ex[]; onChange: (v: Ex[]) => void; parts: string[]; betweenRest?: number | null; onBetweenRest?: (v: number | null) => void }) {
  const [bulk, setBulk] = useState<[string, string]>(["", ""]);
  const [q, setQ] = useState("");
  const [demo, setDemo] = useState<string | null>(null);
  const lib = useMemo(() => LIBRARY.filter((x) => (!parts.length || x.parts.some((p) => parts.includes(p))) && (!q || x.name.includes(q))), [parts, q]);
  const set = (i: number, k: keyof Ex, v: string) => onChange(value.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const move = (i: number, d: number) => { const n = [...value]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const add = (name: string) => { const d = doseOf(name); onChange([...value, { name, sets: d.sets, reps: d.amount, weight: "", rpe: "", unit: d.unit, perSide: d.perSide }]); };
  const inp = "min-h-9 w-full rounded border border-line bg-surface px-1 text-center";
  const setRest = (i: number, k: "restSec" | "sideRestSec", v: number | null) => onChange(value.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return <div className="space-y-2">
    {value.length ? <div className="rounded-card border border-line p-2 text-xs" aria-label="批量设置组间休息">
      <p className="font-bold">批量设置组间休息 <span className="font-normal text-muted">（之后可逐个修改）</span></p>
      <div className="mt-1 flex items-center gap-1"><RestInput v={bulk} onV={setBulk} label="批量" />
        <button type="button" className="fk-chip" onClick={() => setBulk(splitSec(REST_SUGGEST))}>建议 {REST_SUGGEST} 秒</button>
        <button type="button" disabled={toSec(...bulk) == null} className="min-h-9 rounded-lg bg-accent px-3 font-bold text-accent-fg disabled:opacity-40" onClick={() => { const v = toSec(...bulk); onChange(value.map((e) => ({ ...e, restSec: v }))); }}>应用到全部</button></div>
      {onBetweenRest ? <div className="mt-2 flex items-center gap-1"><span className="shrink-0">动作之间休息</span><RestInput v={splitSec(betweenRest)} onV={(v) => onBetweenRest(toSec(...v))} label="动作之间休息" /><span className="text-muted">{fmtRest(betweenRest)}</span></div> : null}
    </div> : null}
    {demo ? <DemoSheet id={demo} onClose={() => setDemo(null)} /> : null}
    {value.map((e, i) => <div key={i} className="rounded-card border border-line p-2" data-ex-row>
      <div className="flex items-center gap-1"><input className="min-h-9 min-w-0 flex-1 rounded border border-line bg-surface px-2 font-bold" value={e.name} onChange={(x) => set(i, "name", x.target.value)} />
        {demoIdFor(e.name) ? <button type="button" aria-label="看演示" className="min-h-9 rounded border border-line px-2 text-xs" onClick={() => setDemo(demoIdFor(e.name))}>演示</button> : null}
        <button type="button" aria-label="上移" className="size-9" onClick={() => move(i, -1)}><ChevronUp className="mx-auto size-4" /></button>
        <button type="button" aria-label="下移" className="size-9" onClick={() => move(i, 1)}><ChevronDown className="mx-auto size-4" /></button>
        <button type="button" aria-label="删除动作" className="size-9 text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="mx-auto size-4" /></button></div>
      {(() => { const d = doseOf(e.name); const unit = e.unit ?? d.unit; const side = e.perSide ?? d.perSide; return <div className="mt-1 grid grid-cols-4 gap-1 text-xs">
        <label>组<input className={inp} inputMode="numeric" value={e.sets} onChange={(x) => set(i, "sets", x.target.value)} /></label>
        <label><select aria-label="单位" className="bg-transparent" value={unit} onChange={(x) => onChange(value.map((y, j) => (j === i ? { ...y, unit: x.target.value as Unit } : y)))}>{(["reps", "sec", "m"] as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select>{side ? "/每侧" : ""}<input className={inp} inputMode="numeric" value={e.reps} onChange={(x) => set(i, "reps", x.target.value)} /></label>
        <label>重量kg<input className={inp} inputMode="decimal" placeholder={d.bodyweight ? "自重" : ""} value={e.weight} onChange={(x) => set(i, "weight", x.target.value)} /></label>
        <label>RPE<input className={inp} inputMode="decimal" value={e.rpe} onChange={(x) => set(i, "rpe", x.target.value)} /></label>
        <div className="col-span-4 mt-1 flex flex-wrap items-center gap-1"><span className="shrink-0">{side ? "两侧做完后组间休息" : "组间休息"}</span><RestInput v={splitSec(e.restSec)} onV={(v) => setRest(i, "restSec", toSec(...v))} label={`${e.name}组间休息`} /><span className={e.restSec == null ? "text-amber-400" : "text-muted"}>{fmtRest(e.restSec)}</span></div>
        {side ? <div className="col-span-4 flex flex-wrap items-center gap-1"><span className="shrink-0">换侧间隔</span><RestInput v={splitSec(e.sideRestSec)} onV={(v) => setRest(i, "sideRestSec", toSec(...v))} label={`${e.name}换侧间隔`} /><span className={e.sideRestSec == null ? "text-amber-400" : "text-muted"}>{fmtRest(e.sideRestSec)}</span></div> : null}
      </div>; })()}
    </div>)}
    <input className="min-h-10 w-full rounded-card border border-line bg-surface px-2" placeholder="搜索动作" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{lib.map((x) => <button key={x.name} type="button" className="fk-chip" onClick={() => add(x.name)}>＋{x.name}</button>)}
      {q && !lib.some((x) => x.name === q) ? <button type="button" className="fk-chip" onClick={() => { add(q); setQ(""); }}>＋自定义「{q}」</button> : null}</div>
  </div>;
}

function RestInput({ v, onV, label }: { v: [string, string]; onV: (v: [string, string]) => void; label: string }) {
  const [m, setM] = useState(v[0]); const [sec, setSec] = useState(v[1]);
  useEffect(() => { setM(v[0]); setSec(v[1]); }, [v[0], v[1]]);
  const c = "min-h-9 w-11 rounded border border-line bg-surface px-1 text-center";
  const clean = (x: string) => x.replace(/\D/g, "").slice(0, 3);
  return <span className="inline-flex items-center gap-0.5"><input aria-label={`${label}分`} className={c} inputMode="numeric" value={m} onChange={(x) => { const n = clean(x.target.value); setM(n); onV([n, sec]); }} />分<input aria-label={`${label}秒`} className={c} inputMode="numeric" value={sec} onChange={(x) => { const n = clean(x.target.value); setSec(n); onV([m, n]); }} />秒</span>;
}
