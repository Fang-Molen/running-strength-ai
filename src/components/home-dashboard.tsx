import { useEffect, useMemo, useRef, useState } from "react";
import { Utensils, UserRound, Activity, Target, ArrowRightLeft, PieChart, TrendingDown, HeartPulse, Lightbulb, Plus, Camera, X, Sun, Moon, Coffee, ChevronUp, ChevronDown, Droplet, Beef, Flame, Leaf } from "lucide-react";
import { loadProfile } from "@/lib/strength/profile";
import { loadEntries, todayEntries, addEntry, MEALS, type Meal } from "@/lib/nutrition/log";
import { savePhoto, shrink } from "@/lib/nutrition/food-photo";
import { loadChecks, removeCheck, upsertCheck, todayDate, type BodyCheck } from "@/lib/nutrition/body";
import { loadVitals } from "@/lib/nutrition/vitals";
import { computePlan } from "@/lib/nutrition/calc";
import { buildAvatarSvg } from "@/components/bodylab/avatar.mjs";
import { Model } from "@/components/bodylab/bodylab-panel";
import { TrendChart, MultiTrend, type Pt } from "@/components/trend-chart";
import { loadCheckins, saveCheckin } from "@/lib/ui/watch-mode";
import { loadExtras } from "@/lib/ui/device-store";

const n = (v: string | number | undefined | null) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const MEAL_ICON = { 早餐: Sun, 午餐: Sun, 晚餐: Moon, 加餐: Coffee } as const;

const TITLE = { macro: "今日营养摄入", trend: "体重变化", SLEEP: "睡眠", RHR: "静息心率", HRV: "HRV", water: "饮水", protein: "蛋白质", carb: "碳水化合物", fat: "脂肪", fiber: "膳食纤维" } as const;
function Empty({ text }: { text: string }) { return <p className="mt-2 text-sm text-muted">{text}</p>; }

export function HomeDashboard(props: { onFood: () => void; onBody: () => void; onAdvice?: () => void; only?: "diet" | "body"; slot?: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <HomeDashboardInner {...props} /> : null;
}
function HomeDashboardInner({ onFood, onBody, onAdvice, only, slot }: { onFood: () => void; onBody: () => void; onAdvice?: () => void; only?: "diet" | "body"; slot?: React.ReactNode }) {
  const profile = useMemo(() => loadProfile(), []);
  const [entries, setEntries] = useState(() => todayEntries(loadEntries()));
  const [logMeal, setLogMeal] = useState<Meal | null>(null);
  const [checks, setChecks] = useState(() => [...loadChecks()].sort((a, b) => a.date.localeCompare(b.date)));
  const [bodyOpen, setBodyOpen] = useState(false);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [range, setRange] = useState<number>(30);
  const vitals = useMemo(() => loadVitals().records, []);
  const plan = useMemo(() => computePlan(profile), [profile]);
  const [view, setView] = useState<"front" | "side" | "back">("front");
  const last = checks[checks.length - 1];
  const weight = n(last?.weight) ?? n(profile.weightKg);
  const height = n(profile.heightCm);
  const fat = n(last?.fat) ?? n(profile.bodyFat);
  const target = n(profile.targetKg);
  const sex = profile.sex === "female" ? "female" : "male";
  const kcal = entries.reduce((s, e) => s + (e.kcal || 0), 0);
  const protein = entries.reduce((s, e) => s + (e.protein || 0), 0);
  const meals = MEALS.map((m) => ({ m, done: entries.some((e) => e.meal === m) }));
  const month = checks.filter((c) => c.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const delta = month.length >= 2 ? month[month.length - 1].weight - month[0].weight : null;
  const latest = (k: string) => [...vitals].filter((v) => v.kind === k).sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0];
  const sleep = latest("SLEEP"), rhr = latest("RHR"), rec = latest("RECOVERY");
  const start = checks[0]?.weight ?? weight;
  const progress = weight && target && start && start !== target ? Math.max(0, Math.min(1, (start - weight) / (start - target))) : null;
  const yaw = view === "side" ? Math.PI / 2 : view === "back" ? Math.PI : 0;
  const me = weight && height ? { heightCm: height, massKg: weight, bodyFatPct: fat ?? (sex === "male" ? 18 : 27), frame: 0, sex } : null;
  const goalShape = me && target ? { ...me, massKg: target } : null;
  const pct = plan && kcal ? Math.min(1, kcal / plan.kcal) : 0;

  void onBody; const D = only !== "body", B = only !== "diet";
  const [mealsOpen, setMealsOpen] = useState(true);
  const [sheet, setSheet] = useState<null | "macro" | "trend" | "SLEEP" | "RHR" | "HRV" | "water" | "protein" | "carb" | "fat" | "fiber">(null);
  const [shape, setShape] = useState<"now" | "goal" | "cmp">("now");
  const [trend, setTrend] = useState<"weight" | "fat" | "muscle">("weight");
  const hrv = latest("HRV");
  const series = checks.filter((c) => c.date >= new Date(Date.now() - range * 864e5).toISOString().slice(0, 10)).map((c) => ({ d: c.date, v: trend === "weight" ? c.weight : trend === "fat" ? c.fat : c.muscle })).filter((x): x is { d: string; v: number } => typeof x.v === "number" && x.v > 0);
  const shown = shape === "goal" && goalShape ? goalShape : me;
  const R = 2 * Math.PI * 42;
  const bar = (label: string, got: number | null, goal: number | undefined, color: string) => <div key={label} className="text-xs"><div className="flex justify-between"><span>{label}</span><span className="text-muted">{got != null ? `${Math.round(got)}` : "未记录"}{goal ? ` / ${goal} g` : ""}{got != null && goal ? `  ${Math.round(got / goal * 100)}%` : ""}</span></div><div className="fk-bar mt-0.5"><i style={{ width: `${got != null && goal ? Math.min(100, got / goal * 100) : 0}%`, background: color }} /></div></div>;
  const tile = (Icon: typeof Sun, label: string, value: string | null, sub: string | undefined, k: "SLEEP" | "RHR" | "HRV" | "water") => <button type="button" onClick={() => setSheet(k)} className="rounded-xl border border-line bg-surface-2 p-2 text-left"><p className="flex items-center gap-1 whitespace-nowrap text-xs"><Icon className="size-3.5 shrink-0 text-accent" />{label}</p><p className="mt-1 text-base font-bold">{value ?? "—"}</p><p className="keep text-[11px] text-muted">{value ? sub ?? "" : "暂无数据"}</p></button>;
  const tip = (Icon: typeof Sun, k: string, t: string, id: "protein" | "carb" | "fat" | "fiber") => <button key={k} type="button" onClick={() => setSheet(id)} className="flex w-full items-start gap-2 py-1 text-left text-xs"><Icon className="mt-0.5 size-4 shrink-0 text-accent" /><span className="w-16 shrink-0 whitespace-nowrap font-bold">{k}</span><span className="text-muted">{t}</span></button>;
  return <div className="space-y-3">
    {D ? <>
    <section className="fk-dash-card">
      <div className="flex items-center gap-2"><Utensils className="size-6 text-accent" /><div className="min-w-0 flex-1"><b>今日饮食记录</b><p className="keep text-xs text-muted">已记录 {meals.filter((x) => x.done).length}/4 餐 · {Math.round(kcal)}{plan ? ` / ${plan.kcal} kcal (${Math.round(pct * 100)}%)` : " kcal"}</p></div>
        <button type="button" className="fk-orange-btn flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-bold" onClick={() => { const h = new Date().getHours(); setLogMeal(h < 10 ? "早餐" : h < 15 ? "午餐" : h < 21 ? "晚餐" : "加餐"); }}><Plus className="size-4" />记录饮食</button>
        <button type="button" aria-expanded={mealsOpen} aria-label="展开收起" className="min-h-10 px-1" onClick={() => setMealsOpen(!mealsOpen)}>{mealsOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}</button></div>
      {mealsOpen ? <div className="mt-2 grid grid-cols-4 gap-1.5">{meals.map(({ m, done }) => { const I = MEAL_ICON[m]; return <button key={m} type="button" onClick={() => setLogMeal(m)} className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1.5 text-left"><I className="size-4 shrink-0 text-accent" /><span className="text-xs leading-tight">{m}<br /><span className={done ? "text-emerald-400" : "text-muted"}>{done ? "已记录" : "未记录"}</span></span></button>; })}</div> : null}
    </section>
    <div className="grid grid-cols-1 gap-3">
      <section className="fk-dash-card p-2">
        <button type="button" onClick={() => setSheet("macro")} className="fk-dash-title text-sm"><PieChart className="size-4" />今日营养摄入 ›</button>
        <svg viewBox="0 0 100 100" className="mx-auto mt-1 size-28"><circle cx="50" cy="50" r="42" fill="none" stroke="#2a2b30" strokeWidth="9" /><circle cx="50" cy="50" r="42" fill="none" stroke="#ff6a1a" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${R * pct} ${R}`} transform="rotate(-90 50 50)" /><text x="50" y="47" textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="700">{Math.round(kcal)}</text><text x="50" y="60" textAnchor="middle" fill="#9a9ca3" fontSize="7">{plan ? `/ ${plan.kcal} kcal` : "kcal"}</text><text x="50" y="71" textAnchor="middle" fill="#ffb84a" fontSize="8">{plan ? `${Math.round(pct * 100)}%` : ""}</text></svg>
        <div className="space-y-1">{bar("蛋白质", entries.length ? protein : null, plan?.protein, "#ff6a1a")}{bar("碳水", null, plan?.carb, "#4aa8ff")}{bar("脂肪", null, plan?.fat, "#ffb020")}{bar("膳食纤维", null, 25, "#3ccf6a")}</div>
      </section>
      <section className="fk-dash-card p-2">
        <button type="button" onClick={onAdvice ?? onFood} className="fk-dash-title text-sm"><Lightbulb className="size-4" />营养建议 ›</button>
        <div className="mt-1 divide-y divide-line">{tip(Beef, "蛋白质", plan ? `建议 ${plan.protein} g/天${weight ? `（${f1(plan.protein / weight)} g/kg）` : ""}` : "填资料后计算", "protein")}{tip(Droplet, "碳水", plan ? `建议 ${plan.carb} g；练前 1–3 小时为主` : "填资料后计算", "carb")}{tip(Flame, "脂肪", plan ? `约 ${plan.fat} g/天` : "填资料后计算", "fat")}{tip(Leaf, "膳食纤维", "建议每日 25 g 以上", "fiber")}</div>
      </section>
    </div>
      <div className="grid grid-cols-1 gap-3">
        <button type="button" onClick={onAdvice ?? onFood} className="fk-dash-card p-3 text-left"><p className="fk-dash-title text-sm"><Utensils className="size-4" />练前练后怎么吃 ›</p><p className="keep mt-1 text-xs text-muted">练前 1–4 h 碳水为主；练后 2 h 内蛋白+主食</p></button>
      </div>
    </> : null}
    {B ? <>
      <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => setBodyOpen(true)} className="fk-dash-card row-span-3 flex flex-col p-2 text-left">
        <span className="fk-dash-title text-sm"><UserRound className="size-4" />我的形象 ›</span>
        <span className="mt-1 block h-[260px] w-full">{me ? <span className="pointer-events-none block h-full"><Model profile={me} yaw={0} frameHeight={height! / 100} onYaw={() => {}} /></span> : <Empty text="填身高和体重后显示" />}</span>
        <span className="keep mt-1 text-center text-xs text-muted">正面 · 点开看侧面/背面/体成分</span>
      </button>
      <section className="fk-dash-card cursor-pointer p-2" onClick={() => setBodyOpen(true)}>
        <div className="fk-dash-title text-sm"><Activity className="size-4" />身体数据 ›</div>
        {weight ? <div className="mt-1 grid grid-cols-2 gap-1 text-xs"><div><span className="text-muted">体重</span><br /><b>{f1(weight)} kg</b></div><div><span className="text-muted">体脂率</span><br /><b>{fat ? `${f1(fat)}%` : "—"}</b></div><div><span className="text-muted">BMI</span><br /><b>{height ? f1(weight / (height / 100) ** 2) : "—"}</b></div><div><span className="text-muted">肌肉量</span><br /><b>{last?.muscle ? `${f1(last.muscle)}` : "—"}</b></div></div> : <Empty text="还没有体重记录" />}
      </section>
      <section className="fk-dash-card p-2">
        <div className="fk-dash-title text-sm"><Target className="size-4" />目标进度</div>
        {weight && target ? <><p className="keep text-xs text-muted">目标 {f1(target)} kg</p>{progress != null ? <><p className="text-sm">已完成 <b>{Math.round(progress * 100)}%</b></p><div className="fk-bar mt-1"><i style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg,#ff5a0a,#ff9a4a)" }} /></div></> : null}<p className="mt-1 text-xs">还差 <b className="text-emerald-400">{f1(Math.abs(target - weight))} kg</b></p></> : <Empty text="在个人资料里设目标体重" />}
      </section>
      <button type="button" onClick={() => { setShape("cmp"); setBodyOpen(true); }} className="fk-dash-card p-2 text-left">
        <span className="fk-dash-title text-sm"><ArrowRightLeft className="size-4" />体型对比 ›</span>
        {me && goalShape ? <span className="mt-1 grid grid-cols-2 gap-1 text-center text-[10px]">{([[me, "当前"], [goalShape, "目标"]] as const).map(([p, l]) => <span key={l}><span className="block h-20 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildAvatarSvg(p, { view: "front", frameHeight: height! / 100, label: l }) }} />{l} {f1(p.massKg)}</span>)}</span> : <Empty text="需要身高、体重、目标体重" />}
      </button>
      </div>
    <div className="grid grid-cols-1 gap-3">
      <HealthGrid vitals={vitals} />
      {slot}
      <RecoveryTrend vitals={vitals} />
      <section className="fk-dash-card p-2">
        <button type="button" onClick={() => setSheet("trend")} className="fk-dash-title text-sm"><TrendingDown className="size-4" />体重变化趋势 ›</button>
        <div className="mt-1 flex items-center gap-1 text-[11px]"><span className="flex rounded border border-line">{([[7, "周"], [30, "月"], [182, "半年"], [365, "年"]] as const).map(([d, l]) => <button key={l} type="button" aria-pressed={range === d} onClick={() => setRange(d)} className={"min-h-7 px-1.5 " + (range === d ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</span><span className="ml-auto flex rounded border border-line">{([["weight", "体重"], ["fat", "体脂率"], ["muscle", "肌肉量"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={trend === k} onClick={() => setTrend(k)} className={"min-h-7 px-1.5 " + (trend === k ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</span></div>
        {series.length >= 2 ? <TrendChart key={`${trend}-${range}`} points={series} /> : <Empty text="记录 2 次以上后显示" />}
        <div className="flex justify-between text-xs"><span><b>{weight ? `${f1(weight)} kg` : "—"}</b></span><span className={delta != null && delta < 0 ? "text-emerald-400" : "text-muted"}>{delta != null ? `${delta > 0 ? "+" : ""}${f1(delta)} kg/30天` : ""}</span><span className="text-muted">{target ? `目标 ${f1(target)}` : ""}</span></div>
      </section>
    </div>
    {bodyOpen ? <BodyDetail editDate={editDate} onClose={() => { setBodyOpen(false); setEditDate(null); }} onSaved={() => setChecks([...loadChecks()].sort((a, b) => a.date.localeCompare(b.date)))} checks={checks}>      <section className="fk-dash-card flex flex-col p-2">
        <div className="fk-dash-title text-sm"><UserRound className="size-4" />我的身体形象</div>
        <div className="relative mt-1 min-h-[420px] flex-1" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; if (goalShape) setShape(shape === "cmp" ? "now" : "cmp"); }}>
          <div className="absolute left-0 top-0 z-10 flex flex-col gap-1">{(["front", "side", "back"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={"flex size-11 flex-col items-center justify-center rounded-lg border text-[10px] " + (view === v ? "border-accent text-accent" : "border-line text-muted")}><UserRound className="size-4" />{v === "front" ? "正面" : v === "side" ? "侧面" : "背面"}</button>)}</div>
          {shown ? (shape === "cmp" && goalShape ? <div className="grid h-full grid-cols-2 pl-12">{([[me!, "当前"], [goalShape, "目标"]] as const).map(([p, l]) => <div key={l} className="h-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: buildAvatarSvg(p, { view, frameHeight: height! / 100, label: l }) }} />)}</div> : <div className="h-[420px] pl-10"><Model profile={shown} yaw={yaw} frameHeight={height! / 100} onYaw={() => {}} /></div>) : <div className="pl-12"><Empty text="填身高和体重后显示" /></div>}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">{([["now", "当前"], ["goal", "目标"], ["cmp", "对比"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={shape === k} disabled={k !== "now" && !goalShape} onClick={() => setShape(k)} className={"min-h-8 rounded-lg border text-xs disabled:opacity-40 " + (shape === k ? "border-accent text-accent" : "border-line")}>{l}</button>)}</div>
        
      </section></BodyDetail> : null}
    </> : null}
    {sheet ? <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="详情"><div className="sticky top-0 flex items-center justify-between border-b border-line bg-bg px-4 pb-2" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}><b>{TITLE[sheet]}</b><button type="button" className="min-h-11 px-3" onClick={() => setSheet(null)}>关闭</button></div><div className="space-y-2 p-4 text-sm">
      {sheet === "macro" ? <><table className="w-full text-left"><thead className="text-xs text-muted"><tr><th>营养素</th><th>已吃</th><th>目标</th></tr></thead><tbody>
        <tr><td>热量</td><td>{Math.round(kcal)} kcal</td><td>{plan ? `${plan.kcal} kcal` : "—"}</td></tr><tr><td>蛋白质</td><td>{entries.length ? `${Math.round(protein)} g` : "未记录"}</td><td>{plan ? `${plan.protein} g` : "—"}</td></tr><tr><td>碳水</td><td>未记录</td><td>{plan ? `${plan.carb} g` : "—"}</td></tr><tr><td>脂肪</td><td>未记录</td><td>{plan ? `${plan.fat} g` : "—"}</td></tr><tr><td>膳食纤维</td><td>未记录</td><td>25 g</td></tr></tbody></table>
        <b className="block pt-2">今天吃了</b>{entries.length ? entries.map((e) => <p key={e.id}>{e.meal} · {e.name} {e.grams} g · {Math.round(e.kcal)} kcal{e.protein ? ` · 蛋白 ${Math.round(e.protein)} g` : ""}</p>) : <Empty text="今天还没有记录" />}
        <button type="button" className="fk-orange-btn mt-2 min-h-11 w-full rounded-xl font-bold" onClick={() => { setSheet(null); setLogMeal("加餐"); }}>记录饮食</button></> : null}
      {sheet === "trend" ? <WeightSheet checks={checks} onAdd={() => { setSheet(null); setEditDate(null); setBodyOpen(true); }} onEdit={(d) => { setSheet(null); setEditDate(d); setBodyOpen(true); }} onChanged={() => setChecks([...loadChecks()].sort((a, b) => a.date.localeCompare(b.date)))} /> : null}
      {sheet === "SLEEP" || sheet === "RHR" || sheet === "HRV" ? (() => { const rs = vitals.filter((v) => v.kind === sheet).sort((a, b) => b.observedOn.localeCompare(a.observedOn)).slice(0, 30); return rs.length ? rs.map((r) => <p key={r.id} className="flex justify-between border-b border-line py-1"><span>{r.observedOn}</span><span>{sheet === "SLEEP" ? `${f1(r.value)} h` : `${Math.round(r.value)} ${r.unit}`}</span></p>) : <Empty text="暂无数据，佳明同步或手动记录后显示" />; })() : null}
      {sheet === "water" ? <Empty text="饮水还没有记录入口（待接入）" /> : null}
      {sheet === "protein" ? <><p>{plan ? `每天约 ${plan.protein} g` : "填资料后计算每日目标"}；运动人群 1.4–2.0 g/kg/天，分 3–5 次吃，每次约 0.3 g/kg，练后 2 小时内吃一次。</p><p className="keep text-xs text-muted">依据：Jäger R, et al. ISSN Position Stand: protein and exercise. JISSN 2017;14:20；Thomas DT, et al. Nutrition and Athletic Performance (ACSM). MSSE 2016;48(3):543–568</p></> : null}
      {sheet === "carb" ? <><p>{plan ? `今天约 ${plan.carb} g` : "填资料后计算"}；轻训练 3–5 g/kg、约 1 小时中等训练 5–7 g/kg、高训练量 6–10 g/kg。练前 1–4 小时吃以碳水为主的一餐；超过 1 小时的训练每小时补 30–60 g。</p><p className="keep text-xs text-muted">依据：Thomas DT, et al. ACSM 2016, MSSE 48(3):543–568；Kerksick CM, et al. ISSN Position Stand: nutrient timing. JISSN 2017;14:33</p></> : null}
      {sheet === "fat" ? <><p>{plan ? `约 ${plan.fat} g/天` : "填资料后计算"}；脂肪约占总热量 20–35%，长期低于 20% 不建议。</p><p className="keep text-xs text-muted">依据：Thomas DT, et al. ACSM 2016, MSSE 48(3):543–568</p></> : null}
      {sheet === "fiber" ? <><p>成人每天 25 g 以上；练前 1–2 小时那餐少吃高纤维，避免胃肠不适。</p><p className="keep text-xs text-muted">依据：EFSA NDA Panel. Dietary Reference Values for carbohydrates and dietary fibre. EFSA Journal 2010;8(3):1462；ACSM 2016</p></> : null}
    </div></div> : null}
    {logMeal ? <FoodSheet meal={logMeal} onMeal={setLogMeal} onClose={() => setLogMeal(null)} onSaved={() => { setEntries(todayEntries(loadEntries())); setLogMeal(null); }} /> : null}
  </div>;

}

function FoodSheet({ meal, onMeal, onClose, onSaved }: { meal: Meal; onMeal: (m: Meal) => void; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(""), [photo, setPhoto] = useState<File | null>(null), [err, setErr] = useState("");
  const save = async () => {
    if (!name.trim() && !photo) { setErr("写个名字或拍张照"); return; }
    let photoId: string | undefined;
    try { if (photo) { photoId = `ph-${Date.now()}`; await savePhoto(photoId, await shrink(photo)); } } catch { setErr("照片没存上，文字照常保存"); photoId = undefined; }
    const r = addEntry({ meal, name: name.trim() || "照片记录", grams: 0, kcal: 0, photo: photoId });
    if (!r) { setErr("保存失败，存储可能已满"); return; }
    onSaved();
  };
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport; const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const on = () => { if (vv) setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop)); };
    vv?.addEventListener("resize", on); vv?.addEventListener("scroll", on); on();
    return () => { document.body.style.overflow = prev; vv?.removeEventListener("resize", on); vv?.removeEventListener("scroll", on); };
  }, []);
  return <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]" style={{ touchAction: "none" }} onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="记录饮食" className="absolute inset-x-0 rounded-t-3xl border-t border-line bg-[#141518] px-4 pt-2 shadow-2xl" style={{ bottom: kb, paddingBottom: kb ? 12 : "max(16px, env(safe-area-inset-bottom))", touchAction: "auto" }} onClick={(e) => e.stopPropagation()}>
      <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line" />
      <div className="flex items-center justify-between"><b className="text-base">记录饮食</b><button type="button" aria-label="关闭" className="grid size-10 place-items-center" onClick={onClose}><X className="size-5" /></button></div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">{MEALS.map((m) => <button key={m} type="button" aria-pressed={meal === m} onClick={() => onMeal(m)} className={"min-h-10 rounded-xl border text-sm " + (meal === m ? "border-accent bg-accent/15 font-bold text-accent" : "border-line")}>{m}</button>)}</div>
      <input aria-label="吃了什么" placeholder="吃了什么，如：米饭一碗、鸡胸 150g" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} className="fk-cell mt-3 min-h-12 w-full text-base" />
      {err ? <p className="keep mt-1 text-xs text-[var(--color-risk)]">{err}</p> : null}
      <div className="mt-3 flex gap-2">
        <label className="flex min-h-12 w-28 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-xl border border-line text-sm"><Camera className="size-4" />{photo ? "已拍 ✓" : "拍照"}<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
        <button type="button" className="fk-orange-btn min-h-12 flex-1 rounded-xl font-bold" onClick={() => void save()}>记录</button>
      </div>
    </div>
  </div>;
}

const COMP: { key: keyof BodyCheck; label: string; unit: string }[] = [
  { key: "weight", label: "体重", unit: "kg" }, { key: "fat", label: "体脂率", unit: "%" }, { key: "muscle", label: "肌肉量", unit: "kg" },
  { key: "armMuscle", label: "双臂肌肉", unit: "kg" }, { key: "trunkMuscle", label: "躯干肌肉", unit: "kg" }, { key: "legMuscle", label: "双腿肌肉", unit: "kg" },
  { key: "visceral", label: "内脏脂肪", unit: "级" }, { key: "waterRate", label: "水分", unit: "%" }, { key: "boneMass", label: "骨量", unit: "kg" }, { key: "bmr", label: "基础代谢", unit: "kcal" },
];
function BodyDetail({ children, checks, onClose, onSaved, editDate }: { children: React.ReactNode; checks: BodyCheck[]; onClose: () => void; onSaved: () => void; editDate?: string | null }) {
  const last = checks[checks.length - 1];
  const [form, setForm] = useState<Record<string, string>>(() => { const c = editDate ? checks.find((x) => x.date === editDate) : null; const f: Record<string, string> = { date: editDate ?? todayDate() }; if (c) for (const k of COMP) { const v = c[k.key]; if (v != null) f[k.key as string] = String(v); } return f; });
  const formRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (editDate && formRef.current) { formRef.current.open = true; formRef.current.scrollIntoView({ block: "start" }); } }, [editDate]);
  const [msg, setMsg] = useState("");
  const save = () => {
    const w = Number(form.weight);
    if (!(w >= 30 && w <= 200)) { setMsg("请填体重"); return; }
    const rec: Omit<BodyCheck, "id"> = { date: form.date || todayDate(), weight: w };
    for (const c of COMP) { const v = Number(form[c.key as string]); if (c.key !== "weight" && v > 0) (rec as Record<string, number | string>)[c.key as string] = v; }
    const old = checks.find((c) => c.date === rec.date);
    if (!upsertCheck({ ...(old ?? {}), ...rec })) { setMsg("保存失败"); return; }
    setMsg("已保存"); setForm({ date: todayDate() }); onSaved();
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="身体详情">
    <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-line bg-bg px-4 pb-1" style={{ paddingTop: "max(4px, env(safe-area-inset-top))" }}><b>我的身体</b><button type="button" className="min-h-11 px-3" onClick={onClose}>关闭</button></div>
    <div className="space-y-3 p-3">
      {children}
      <section className="fk-dash-card p-3">
        <div className="fk-dash-title text-sm"><Activity className="size-4" />体成分{last ? <span className="keep ml-auto text-xs font-normal text-muted">{last.date}</span> : null}</div>
        {last ? <div className="mt-2 grid grid-cols-3 gap-2 text-center">{COMP.map((c) => { const v = last[c.key] as number | undefined; return <div key={c.key as string} className="rounded-lg bg-surface-2 p-1.5"><b className="text-sm">{v ? f1(v) : "—"}</b><p className="keep text-[10px] text-muted">{c.label}{v ? ` ${c.unit}` : ""}</p></div>; })}</div> : <Empty text="还没有体脂秤记录" />}
      </section>
      <details ref={formRef} className="fk-dash-card px-3"><summary className="min-h-11 cursor-pointer font-bold">手动记录体脂秤数据</summary>
        <div className="grid grid-cols-2 gap-2 pb-3">
          <label className="col-span-2 text-xs">日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="fk-cell mt-0.5 w-full" /></label>
          {COMP.map((c) => <label key={c.key as string} className="text-xs">{c.label}（{c.unit}）<input inputMode="decimal" value={form[c.key as string] ?? ""} onChange={(e) => setForm({ ...form, [c.key as string]: e.target.value.replace(/[^\d.]/g, "") })} className="fk-cell mt-0.5 w-full" /></label>)}
          <button type="button" className="fk-orange-btn col-span-2 min-h-11 rounded-xl font-bold" onClick={save}>保存</button>
          {msg ? <p className="keep col-span-2 text-xs" aria-live="polite">{msg}</p> : null}
        </div>
      </details>
      <section className="fk-dash-card p-3"><div className="fk-dash-title text-sm"><TrendingDown className="size-4" />历史</div>
        {checks.length ? <div className="mt-1 text-xs">{[...checks].reverse().slice(0, 60).map((c) => <p key={c.id} className="flex justify-between border-b border-line py-1"><span>{c.date}</span><span>{f1(c.weight)} kg{c.fat ? ` · ${f1(c.fat)}%` : ""}{c.muscle ? ` · 肌 ${f1(c.muscle)}` : ""}{c.visceral ? ` · 内脏 ${c.visceral}` : ""}</span></p>)}</div> : <Empty text="暂无历史" />}
      </section>
    </div>
  </div>;
}

const REC = [["SLEEP", "睡眠", "h"], ["RHR", "静息心率", "bpm"], ["HRV", "HRV", "ms"], ["fatigue", "疲劳", "1轻松-3很累"], ["pain", "酸痛", "0不疼-2明显"]] as const;
function RecoveryTrend({ vitals }: { vitals: ReturnType<typeof loadVitals>["records"] }) {
  const [k, setK] = useState<(typeof REC)[number][0]>("SLEEP");
  const [days, setDays] = useState(30);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const pts: Pt[] = useMemo(() => {
    if (k === "fatigue" || k === "pain") { const F: Record<string, number> = { fresh: 1, ok: 2, tired: 3 }, P: Record<string, number> = { none: 0, mild: 1, sharp: 2 }; return loadCheckins().filter((c) => c.date >= since).map((c) => ({ d: c.date, v: k === "fatigue" ? F[c.fatigue ?? ""] : P[c.pain ?? ""] })).filter((p): p is Pt => typeof p.v === "number").sort((a, b) => a.d.localeCompare(b.d)); }
    const byDay = new Map<string, number>(); for (const r of vitals) if (r.kind === k && r.observedOn >= since) byDay.set(r.observedOn, r.value);
    return [...byDay].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d));
  }, [k, since, vitals]);
  const meta = REC.find((r) => r[0] === k)!;
  return <section className="fk-dash-card p-2">
    <div className="fk-dash-title text-sm"><Activity className="size-4" />恢复趋势<span className="keep ml-auto text-[10px] font-normal text-muted">{meta[2]}</span></div>
    <div className="mt-1 flex items-center gap-1 text-[11px]"><span className="flex flex-wrap rounded border border-line">{REC.map(([id, l]) => <button key={id} type="button" aria-pressed={k === id} onClick={() => setK(id)} className={"min-h-7 px-1.5 " + (k === id ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</span><span className="ml-auto flex rounded border border-line">{[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={"min-h-7 px-1.5 " + (days === d ? "bg-accent text-accent-fg" : "")}>{d}天</button>)}</span></div>
    {pts.length >= 2 ? <TrendChart key={`${k}-${days}`} points={pts} fmt={(v) => (k === "SLEEP" ? (Math.round(v * 10) / 10).toString() : String(Math.round(v)))} /> : <Empty text={k === "fatigue" || k === "pain" ? "在主观感受里点 2 天以上后显示" : "同步佳明 2 天以上后显示"} />}
  </section>;
}

type MDef = { id: string; label: string; unit: string; icon: typeof Sun; subj?: boolean; fmt?: (v: number) => string };
const METRICS: MDef[] = [
  { id: "SLEEP", label: "睡眠", unit: "h", icon: Moon, fmt: (v) => f1(v) }, { id: "RHR", label: "静息心率", unit: "bpm", icon: HeartPulse }, { id: "HRV", label: "HRV", unit: "ms", icon: Activity },
  { id: "STRESS", label: "压力", unit: "", icon: Flame }, { id: "BODY_BATTERY", label: "身体电量", unit: "", icon: Sun }, { id: "RESP", label: "呼吸", unit: "次/分", icon: Leaf, fmt: (v) => f1(v) },
  { id: "SPO2", label: "血氧", unit: "%", icon: Droplet }, { id: "STEPS", label: "步数", unit: "步", icon: Activity },
  { id: "fatigue", label: "疲劳", unit: "", icon: Moon, subj: true }, { id: "pain", label: "酸痛", unit: "", icon: HeartPulse, subj: true }, { id: "recovery", label: "恢复状态", unit: "/5", icon: Lightbulb, subj: true },
];
const SUBJ: Record<string, [string, number][]> = { fatigue: [["轻松", 1], ["一般", 2], ["很累", 3]], pain: [["不疼", 0], ["有点疼", 1], ["明显疼", 2]], recovery: [["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5]] };
const TILE_KEY = "fk-health-tiles-v1";
const DEFAULT_TILES = ["SLEEP", "RHR", "HRV", "BODY_BATTERY", "fatigue", "pain"];
function HealthGrid({ vitals }: { vitals: ReturnType<typeof loadVitals>["records"] }) {
  const [rev, setRev] = useState(0);
  const [chosen, setChosen] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(TILE_KEY) || "null"); return Array.isArray(v) ? v : DEFAULT_TILES; } catch { return DEFAULT_TILES; } });
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [hd, setHd] = useState(30);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const series = useMemo(() => {
    void rev; const out: Record<string, Pt[]> = {};
    const put = (id: string, d: string, v: number) => { (out[id] ??= []).push({ d, v }); };
    for (const r of vitals) put(r.kind, r.observedOn, r.value);
    for (const x of loadExtras()) put(x.metric, x.day, x.value);
    const F: Record<string, number> = { fresh: 1, ok: 2, tired: 3 }, P: Record<string, number> = { none: 0, mild: 1, sharp: 2 };
    for (const c of loadCheckins()) { if (c.fatigue) put("fatigue", c.date, F[c.fatigue]); if (c.pain) put("pain", c.date, P[c.pain]); if (c.recovery) put("recovery", c.date, c.recovery); }
    for (const k in out) { const m = new Map(out[k].map((p) => [p.d, p.v])); out[k] = [...m].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d)); }
    return out;
  }, [vitals, rev]);
  const avail = METRICS.filter((m) => m.subj || series[m.id]?.length);
  const shown = avail.filter((m) => chosen.includes(m.id));
  const val = (m: MDef) => { const s = series[m.id]; const l = s?.[s.length - 1]; if (!l) return null; if (m.subj) return { t: SUBJ[m.id].find(([, v]) => v === l.v)?.[0] ?? String(l.v), d: l.d }; return { t: `${(m.fmt ?? ((v: number) => String(Math.round(v))))(l.v)}${m.unit && m.unit !== "步" ? " " + m.unit : ""}`, d: l.d }; };
  const rate = (id: string, v: number) => {
    const patch = id === "fatigue" ? { fatigue: (["fresh", "ok", "tired"] as const)[v - 1] } : id === "pain" ? { pain: (["none", "mild", "sharp"] as const)[v] } : { recovery: v };
    saveCheckin(today, patch); setRev((x) => x + 1);
  };
  const om = open ? METRICS.find((m) => m.id === open)! : null;
  return <section className="fk-dash-card p-2">
    <div className="flex items-center"><div className="fk-dash-title text-sm"><HeartPulse className="size-4" />健康记录</div><button type="button" className="ml-auto min-h-8 px-2 text-xs text-accent" onClick={() => setEdit(!edit)}>{edit ? "完成" : "编辑"}</button></div>
    {edit ? <div className="mt-1 grid grid-cols-2 gap-1 text-sm">{avail.map((m) => <label key={m.id} className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-2"><input type="checkbox" checked={chosen.includes(m.id)} onChange={(e) => { const n = e.target.checked ? [...chosen, m.id] : chosen.filter((x) => x !== m.id); setChosen(n); localStorage.setItem(TILE_KEY, JSON.stringify(n)); }} />{m.label}</label>)}</div>
    : shown.length ? <div className="mt-1 grid grid-cols-3 gap-1.5">{shown.map((m) => { const v = val(m); const I = m.icon; return <button key={m.id} type="button" onClick={() => setOpen(m.id)} className="rounded-xl border border-line bg-surface-2 p-2 text-left"><p className="flex items-center gap-1 whitespace-nowrap text-xs"><I className="size-3.5 shrink-0 text-accent" />{m.label}</p><p className="mt-1 text-base font-bold">{v?.t ?? (m.subj ? "点一下" : "—")}</p><p className="keep text-[10px] text-muted">{v ? v.d.slice(5) : ""}</p></button>; })}</div> : <Empty text="点编辑选要显示的指标" />}
    {om ? <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setOpen(null)}><div role="dialog" aria-label={om.label} className="w-full rounded-t-2xl border-t border-line bg-bg p-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between"><b>{om.label}</b><button type="button" className="min-h-10 px-2" onClick={() => setOpen(null)}>关闭</button></div>
      {om.subj ? <div className="mt-1 flex flex-wrap gap-1.5"><span className="keep self-center text-xs text-muted">今天</span>{SUBJ[om.id].map(([l, v]) => { const last = series[om.id]?.find((p) => p.d === today)?.v; return <button key={l} type="button" className="fk-chip" aria-pressed={last === v} onClick={() => rate(om.id, v)}>{l}</button>; })}</div> : null}
      <div className="mt-2 flex rounded border border-line text-xs">{[7, 30, 90, 365].map((d) => <button key={d} type="button" aria-pressed={hd === d} onClick={() => setHd(d)} className={"min-h-8 flex-1 " + (hd === d ? "bg-accent text-accent-fg" : "")}>{d === 365 ? "年" : `${d}天`}</button>)}</div>
      {(() => { const since = new Date(Date.now() - hd * 864e5).toISOString().slice(0, 10); const ps = (series[om.id] ?? []).filter((p) => p.d >= since); return <>{ps.length >= 2 ? <TrendChart key={`${om.id}-${hd}`} points={ps} height={180} fmt={om.fmt} /> : <Empty text="这个时间段少于 2 天数据" />}<div className="mt-2 max-h-48 overflow-y-auto text-xs">{[...ps].reverse().map((p) => <p key={p.d} className="flex justify-between border-b border-line py-1"><span>{p.d}</span><b>{om.subj ? SUBJ[om.id].find(([, v]) => v === p.v)?.[0] ?? p.v : (om.fmt ?? ((v: number) => String(Math.round(v))))(p.v)}</b></p>)}</div></>; })()}
    </div></div> : null}
  </section>;
}

const WM: { key: keyof BodyCheck; label: string; color: string }[] = [
  { key: "weight", label: "体重", color: "#ff6a1a" }, { key: "fat", label: "体脂率", color: "#4aa8ff" }, { key: "muscle", label: "肌肉量", color: "#3ccf6a" },
  { key: "visceral", label: "内脏脂肪", color: "#ffb020" }, { key: "waterRate", label: "水分", color: "#7ad7f0" }, { key: "bmr", label: "基础代谢", color: "#c08bff" },
];
function WeightSheet({ checks, onAdd, onEdit, onChanged }: { checks: BodyCheck[]; onAdd: () => void; onEdit: (d: string) => void; onChanged: () => void }) {
  const [sel, setSel] = useState<string[]>(["weight"]);
  const [days, setDays] = useState(30);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const inRange = checks.filter((c) => c.date >= since);
  const avail = WM.filter((m) => checks.some((c) => typeof c[m.key] === "number"));
  const series = WM.filter((m) => sel.includes(m.key as string)).map((m) => ({ label: m.label, color: m.color, points: inRange.filter((c) => typeof c[m.key] === "number" && (c[m.key] as number) > 0).map((c) => ({ d: c.date, v: c[m.key] as number })) }));
  return <>
    <div className="flex flex-wrap gap-1">{avail.map((m) => <label key={m.key as string} className="flex min-h-8 items-center gap-1 rounded-full border border-line px-2 text-xs"><input type="checkbox" checked={sel.includes(m.key as string)} onChange={(e) => setSel(e.target.checked ? [...sel, m.key as string] : sel.filter((x) => x !== m.key))} /><span style={{ color: m.color }}>●</span>{m.label}</label>)}</div>
    <div className="flex rounded border border-line text-xs">{([[7, "周"], [30, "月"], [182, "半年"], [365, "年"]] as const).map(([d, l]) => <button key={l} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={"min-h-8 flex-1 " + (days === d ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</div>
    {series.some((s) => s.points.length >= 2) ? <MultiTrend key={`${days}-${sel.join()}`} series={series} height={200} /> : <Empty text="这个时间段记录少于 2 次" />}
    <button type="button" className="fk-orange-btn min-h-11 w-full rounded-xl font-bold" onClick={onAdd}>+ 记录</button>
    {checks.length ? <div className="text-xs">{[...checks].reverse().slice(0, 100).map((c) => <div key={c.id} className="flex items-center gap-2 border-b border-line py-1.5"><span className="w-20 shrink-0">{c.date}</span><span className="flex-1">{f1(c.weight)} kg{c.fat ? ` · ${f1(c.fat)}%` : ""}{c.muscle ? ` · 肌 ${f1(c.muscle)}` : ""}</span><button type="button" className="min-h-8 px-2 text-accent" onClick={() => onEdit(c.date)}>编辑</button><button type="button" className="min-h-8 px-2 text-muted" onClick={() => { if (confirm(`删除 ${c.date} 的记录？`)) { removeCheck(c.id); onChanged(); } }}>删除</button></div>)}</div> : <Empty text="还没有体重记录" />}
  </>;
}
