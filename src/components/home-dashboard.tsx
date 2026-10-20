import { recovery10 } from "@/lib/health/legacy-inputs";
import {FoodEntrySheet} from './food-entry-sheet';
import {missingNutrition,NUTRIENT_LABELS,NUTRIENT_KEYS} from '@/lib/nutrition/entry-workflow';
import { HealthModeNote } from "@/components/health-mode-note";
import { PersonalStatsPanel } from "@/components/personal-stats-panel";
import { RestEntry } from "@/components/rest-entry";
import { HealthPageV89 } from "@/components/health-page-v89";
import { HealthSourceDetails } from "./health-source-details";
import { buildHealthSnapshot, loadHealthSources } from "@/lib/health/snapshot";
import { HEALTH_CHANGED, valueText } from "@/lib/health/observation";
import { ScaleScan } from "@/components/scale-scan";
import { RANGES, type ScaleKey } from "@/lib/body/scale-parse";
import { BodyFigureSheet } from "@/components/body-figure-sheet";
import { readGoalBodyFat } from "@/lib/body/goal-editor";
import { Sheet, Toast, useToast } from "@/components/sheet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Utensils, UserRound, Activity, Target, ArrowRightLeft, PieChart, TrendingDown, HeartPulse, Lightbulb, Plus, Camera, X, Sun, Moon, Coffee, ChevronUp, ChevronDown, Droplet, Beef, Flame, Leaf } from "lucide-react";
import { loadProfile } from "@/lib/strength/profile";
import { loadEntries, removeEntry, todayEntries, aggregate, nutrientOf, MEALS, type Meal, type FoodEntry, type NutrientKey } from "@/lib/nutrition/log";
import { loadChecks, removeCheck, upsertCheck, todayDate, type BodyCheck } from "@/lib/nutrition/body";
import { shiftDay } from "@/lib/health/observation";
import { loadVitals } from "@/lib/nutrition/vitals";
import { computePlan } from "@/lib/nutrition/calc";
import { TrendChart, MultiTrend, type Pt } from "@/components/trend-chart";
import { loadCheckins, saveCheckin } from "@/lib/ui/watch-mode";
import { loadExtras } from "@/lib/ui/device-store";

const n = (v: string | number | undefined | null) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const MEAL_ICON = { 早餐: Sun, 午餐: Sun, 晚餐: Moon, 加餐: Coffee } as const;

const TITLE = { macro: "今日营养摄入", trend: "体重变化", SLEEP: "睡眠", RHR: "静息心率", HRV: "HRV", water: "饮水", protein: "蛋白质", carb: "碳水化合物", fat: "脂肪", fiber: "膳食纤维" } as const;
function Empty({ text }: { text: string }) { return <p className="mt-2 text-sm text-muted">{text}</p>; }

export function HomeDashboard(props: { onFood: () => void; onBody: () => void; onAdvice?: () => void; onCoach?: () => void; only?: "diet" | "body"; slot?: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? <HomeDashboardInner {...props} /> : null;
}
function HomeDashboardInner({ onFood, onBody, onAdvice, onCoach, only, slot }: { onFood: () => void; onBody: () => void; onAdvice?: () => void; onCoach?: () => void; only?: "diet" | "body"; slot?: React.ReactNode }) {
  const [profile, setProfile] = useState(() => loadProfile());
  const [goalBf, setGoalBf] = useState<number | null>(readGoalBodyFat);
  const [foodDate,setFoodDate]=useState(todayDate());
  const [entries, setEntries] = useState(() => todayEntries(loadEntries()));
  useEffect(() => { const refresh = () => setEntries(loadEntries().filter(e=>e.date===foodDate)); window.addEventListener('fk-food-changed', refresh); window.addEventListener('storage', refresh); return () => { window.removeEventListener('fk-food-changed', refresh); window.removeEventListener('storage', refresh); }; }, [foodDate]);
  useEffect(()=>setEntries(loadEntries().filter(e=>e.date===foodDate)),[foodDate]);
  const [logMeal, setLogMeal] = useState<Meal | null>(null);
  const [mealList, setMealList] = useState<Meal | null>(null);
  const [pendingKey,setPendingKey]=useState<NutrientKey|null>(null),[editingFood,setEditingFood]=useState<FoodEntry|null>(null);
  const [checks, setChecks] = useState(() => [...loadChecks()].sort((a, b) => a.date.localeCompare(b.date)));
  const [bodyOpen, setBodyOpenRaw] = useState<false | "figure" | "data">(false);
  const setBodyOpen = (v: boolean | "figure" | "data") => setBodyOpenRaw(v === true ? "figure" : v);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [range, setRange] = useState<number>(30);
  const [healthRev,setHealthRev]=useState(0);
  useEffect(()=>{const f=()=>{setHealthRev(x=>x+1);setChecks([...loadChecks()].sort((a,b)=>a.date.localeCompare(b.date)));};window.addEventListener(HEALTH_CHANGED,f);window.addEventListener('storage',f);window.addEventListener('focus',f);const t=window.setInterval(f,60000);return()=>{window.removeEventListener(HEALTH_CHANGED,f);window.removeEventListener('storage',f);window.removeEventListener('focus',f);window.clearInterval(t)}},[]);
  const vitals = useMemo(() => loadVitals().records, [healthRev]);
  const plan = useMemo(() => computePlan(profile), [profile]);
  const last = checks[checks.length - 1];
  const weight = n(last?.weight) ?? n(profile.weightKg);
  const height = n(profile.heightCm);
  const fat = n(last?.fat) ?? n(profile.bodyFat);
  const target = n(profile.targetKg);
  const sex = profile.sex === "female" ? "female" : "male";
  const agg = aggregate(entries);
  const kcal = agg.kcal.sum;
  const protein = agg.protein.sum;
  const sumK = (k: "carb" | "fat" | "fiber") => { const xs = entries.map((e) => nutrientOf(e, k)).filter((v): v is number => typeof v === "number"); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
  const carbSum = sumK("carb"), fatSum = sumK("fat"), fiberSum = sumK("fiber");
  const meals = MEALS.map((m) => ({ m, done: entries.some((e) => e.meal === m) }));
  const month = checks.filter((c) => c.date >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const delta = month.length >= 2 ? month[month.length - 1].weight - month[0].weight : null;
  const latest = (k: string) => [...vitals].filter((v) => v.kind === k).sort((a, b) => b.observedOn.localeCompare(a.observedOn))[0];
  const sleep = latest("SLEEP"), rhr = latest("RHR"), rec = latest("RECOVERY");
  const start = checks[0]?.weight ?? weight;
  const progress = weight && target && start && start !== target ? Math.max(0, Math.min(1, (start - weight) / (start - target))) : null;
  const me = weight && height ? { heightCm: height, massKg: weight, bodyFatPct: fat ?? (sex === "male" ? 18 : 27), frame: 0, sex } : null;
  const pct = plan && kcal ? Math.min(1, kcal / plan.kcal) : 0;

  void onBody; const D = only !== "body", B = only !== "diet";
  const [mealsOpen, setMealsOpen] = useState(true);
  const [sheet, setSheet] = useState<null | "macro" | "trend" | "SLEEP" | "RHR" | "HRV" | "water" | "protein" | "carb" | "fat" | "fiber">(null);
  const [trend, setTrend] = useState<"weight" | "fat" | "muscle">("weight");
  const hrv = latest("HRV");
  const series = checks.filter((c) => c.date >= new Date(Date.now() - range * 864e5).toISOString().slice(0, 10)).map((c) => ({ d: c.date, v: trend === "weight" ? c.weight : trend === "fat" ? c.fat : c.muscle })).filter((x): x is { d: string; v: number } => typeof x.v === "number" && x.v > 0);
  const R = 2 * Math.PI * 42;
  const pend = (k: NutrientKey) => (agg[k].pending ? ` +${agg[k].pending}项待补充` : "");
  const bar = (label: string, k: NutrientKey, goal: number | undefined, color: string) => { const a = agg[k]; const got = a.known ? a.sum : null; return <div key={label} className="text-xs"><div className="flex justify-between"><span>{label}</span><span className="text-muted">{got != null ? `${Math.round(got)}` : entries.length ? "待补充" : "未记录"}{goal ? ` / ${goal} g` : ""}{got != null && goal && !a.pending ? `  ${Math.round(got / goal * 100)}%` : ""}<button type="button" aria-label={"补充"+NUTRIENT_LABELS[k]} onClick={()=>setPendingKey(k)} className="ml-1 min-h-9 text-amber-400" disabled={!a.pending}>{a.pending?"另有"+a.pending+"项待补充":""}</button></span></div><div className="fk-bar mt-0.5"><i style={{ width: `${got != null && goal ? Math.min(100, got / goal * 100) : 0}%`, background: color }} /></div></div>; };
  const tile = (Icon: typeof Sun, label: string, value: string | null, sub: string | undefined, k: "SLEEP" | "RHR" | "HRV" | "water") => <button type="button" onClick={() => setSheet(k)} className="rounded-xl border border-line bg-surface-2 p-2 text-left"><p className="flex items-center gap-1 whitespace-nowrap text-xs"><Icon className="size-3.5 shrink-0 text-accent" />{label}</p><p className="mt-1 text-base font-bold">{value ?? "—"}</p><p className="keep text-[11px] text-muted">{value ? sub ?? "" : "暂无数据"}</p></button>;
  const tip = (Icon: typeof Sun, k: string, t: string, id: "protein" | "carb" | "fat" | "fiber") => <button key={k} type="button" onClick={() => setSheet(id)} className="flex w-full items-start gap-2 py-1 text-left text-xs"><Icon className="mt-0.5 size-4 shrink-0 text-accent" /><span className="w-16 shrink-0 whitespace-nowrap font-bold">{k}</span><span className="text-muted">{t}</span></button>;
  return <div className="space-y-3">
    {D ? <>
    <section className="fk-dash-card">
      <label className="mb-2 flex items-center justify-between text-xs text-muted">查看日期<input aria-label="查看饮食日期" type="date" max={todayDate()} value={foodDate} onChange={e=>setFoodDate(e.target.value)} className="fk-cell min-h-10"/></label>
      <div className="flex items-center gap-2"><Utensils className="size-6 text-accent" /><div className="min-w-0 flex-1"><b>{foodDate===todayDate()?"今日饮食记录":"饮食记录"}</b><p className="keep text-xs text-muted">已记录 {meals.filter((x) => x.done).length}/4 餐 · {agg.kcal.known ? Math.round(kcal) : entries.length ? "待补充" : "未记录"}{plan ? ` / ${plan.kcal} kcal${agg.kcal.pending?"（已知小计）":` (${Math.round(pct * 100)}%)`}` : " kcal"}</p></div>
        <button type="button" className="fk-orange-btn flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-bold" onClick={() => { const h = new Date().getHours(); setLogMeal(h < 10 ? "早餐" : h < 15 ? "午餐" : h < 21 ? "晚餐" : "加餐"); }}><Plus className="size-4" />记录饮食</button>
        <button type="button" aria-expanded={mealsOpen} aria-label="展开收起" className="min-h-10 px-1" onClick={() => setMealsOpen(!mealsOpen)}>{mealsOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}</button></div>
      {mealsOpen ? <div className="mt-2 grid grid-cols-4 gap-1.5">{meals.map(({ m, done }) => { const I = MEAL_ICON[m]; return <button key={m} type="button" onClick={() => (done ? setMealList(m) : setLogMeal(m))} className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1.5 text-left"><I className="size-4 shrink-0 text-accent" /><span className="text-xs leading-tight">{m}<br /><span className={done ? "text-emerald-400" : "text-muted"}>{done ? "已记录" : "未记录"}</span></span></button>; })}</div> : null}
    </section>
    <div className="grid grid-cols-1 gap-3">
      <section className="fk-dash-card p-2">
        <button type="button" onClick={() => setSheet("macro")} className="fk-dash-title text-sm"><PieChart className="size-4" />{foodDate===todayDate()?"今日营养摄入":foodDate+" 营养摄入"} ›</button>
        <svg viewBox="0 0 100 100" className="mx-auto mt-1 size-28"><circle cx="50" cy="50" r="42" fill="none" stroke="#2a2b30" strokeWidth="9" /><circle cx="50" cy="50" r="42" fill="none" stroke="#ff6a1a" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${R * pct} ${R}`} transform="rotate(-90 50 50)" /><text x="50" y="47" textAnchor="middle" fill="currentColor" fontSize="15" fontWeight="700">{agg.kcal.known ? Math.round(kcal) : entries.length ? "待补充" : "未记录"}</text><text x="50" y="60" textAnchor="middle" fill="#9a9ca3" fontSize="7">{plan ? `/ ${plan.kcal} kcal` : "kcal"}</text><text x="50" y="71" textAnchor="middle" fill="#ffb84a" fontSize="8">{plan && !agg.kcal.pending ? `${Math.round(pct * 100)}%` : "已知小计"}</text></svg>
        {agg.kcal.pending ? <button type="button" aria-label="补充热量" onClick={()=>setPendingKey("kcal")} className="keep block min-h-11 w-full text-center text-xs text-amber-400">已记录热量 {agg.kcal.sum} kcal · 另有 {agg.kcal.pending} 项待补充</button> : null}
        <div className="space-y-1">{bar("蛋白质", "protein", plan?.protein, "#ff6a1a")}{bar("碳水", "carb", plan?.carb, "#4aa8ff")}{bar("脂肪", "fat", plan?.fat, "#ffb020")}{bar("膳食纤维", "fiber", 25, "#3ccf6a")}</div>
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
    {/* v89：健康页改为顶部分区（恢复/身体指标/睡眠/HRV/压力）；每样只出现一次。“形象与目标”与“我的形象/目标进度”重复，已合并。 */}
    <HealthPageV89 onCoach={onCoach}
      body={<>
      <div className="fk-health-figure-grid grid grid-cols-2 gap-3">
      <button type="button" onClick={() => setBodyOpen("figure")} className="fk-dash-card fk-health-portrait flex flex-col p-2 text-left">
        <span className="fk-dash-title text-sm"><UserRound className="size-4" />我的形象 ›</span>
        <span className="fk-character-image mt-1 block w-full"><span className="pointer-events-none block h-full"><Figure sex={sex} /></span></span>
        <span className="keep mt-auto pt-1 text-center text-[10px] text-muted">查看可调3D与目标</span>
      </button>
      <section className="fk-dash-card cursor-pointer p-2" onClick={() => setBodyOpen("data")}>
        <div className="fk-dash-title text-sm"><Activity className="size-4" />身体数据 ›</div>
        {weight ? <div className="mt-1 grid grid-cols-2 gap-1 text-xs"><div><span className="text-muted">体重</span><br /><b>{f1(weight)} kg</b></div><div><span className="text-muted">体脂率</span><br /><b>{fat ? `${f1(fat)}%` : "—"}</b></div><div><span className="text-muted">BMI</span><br /><b>{height ? f1(weight / (height / 100) ** 2) : "—"}</b></div><div><span className="text-muted">肌肉量</span><br /><b>{last?.muscle ? `${f1(last.muscle)}` : "—"}</b></div></div> : <Empty text="还没有体重记录" />}
      </section>
      <section className="fk-dash-card p-2">
        <div className="fk-dash-title text-sm"><Target className="size-4" />目标进度</div>
        {weight && target ? <><p className="keep text-xs text-muted">目标 {f1(target)} kg</p>{progress != null ? <><p className="text-sm">已完成 <b>{Math.round(progress * 100)}%</b></p><div className="fk-bar mt-1"><i style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg,#ff5a0a,#ff9a4a)" }} /></div></> : null}<p className="mt-1 text-xs">还差 <b className="text-emerald-400">{f1(Math.abs(target - weight))} kg</b></p></> : <Empty text="在个人资料里设目标体重" />}
      </section>
      </div>
      </>}
      slot={slot}
      grid={<HealthGrid vitals={vitals} />}
      stats={<PersonalStatsPanel day={todayDate()} className="fk-dash-card p-3" />}
      rest={(day) => <RestEntry day={day} onSaved={() => setHealthRev(x => x + 1)} />}
      trend={(only) => <RecoveryTrend vitals={vitals} only={only} />}
    />
    {bodyOpen === "figure" ? <BodyFigureSheet sex={sex} kg={weight} bf={fat} targetKg={target} targetBf={goalBf}
      onClose={() => setBodyOpen(false)} onData={() => setBodyOpen("data")}
      onSaved={(next, bf) => { setProfile(next); setGoalBf(bf); }} /> : bodyOpen === "data" ? <BodyDetail mode="data" editDate={editDate}
        onClose={() => { setBodyOpen(false); setEditDate(null); }} onSaved={() => setChecks([...loadChecks()].sort((a, b) => a.date.localeCompare(b.date)))}
        checks={checks} onTrend={() => setBodyOpen("data")} /> : null}
    </> : null}
    {sheet ? <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="详情"><div className="sticky top-0 flex items-center justify-between border-b border-line bg-bg px-4 pb-2" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}><b>{TITLE[sheet]}</b><button type="button" className="min-h-11 px-3" onClick={() => setSheet(null)}>关闭</button></div><div className="space-y-2 p-4 text-sm">
      {sheet === "macro" ? <><table className="w-full text-left"><thead className="text-xs text-muted"><tr><th>营养素</th><th>已吃</th><th>目标</th></tr></thead><tbody>
        <tr><td>热量</td><td>{agg.kcal.known ? `${Math.round(agg.kcal.sum)} kcal` : "待补充"}{agg.kcal.pending ? ` +${agg.kcal.pending}项待补充` : ""}</td><td>{plan ? `${plan.kcal} kcal` : "—"}</td></tr><tr><td>蛋白质</td><td>{agg.protein.known ? `${Math.round(agg.protein.sum)} g` : "待补充"}{agg.protein.pending ? ` +${agg.protein.pending}项待补充` : ""}</td><td>{plan ? `${plan.protein} g` : "—"}</td></tr><tr><td>碳水</td><td>{agg.carb.known ? `${Math.round(agg.carb.sum)} g` : "待补充"}{agg.carb.pending ? ` +${agg.carb.pending}项待补充` : ""}</td><td>{plan ? `${plan.carb} g` : "—"}</td></tr><tr><td>脂肪</td><td>{agg.fat.known ? `${Math.round(agg.fat.sum)} g` : "待补充"}{agg.fat.pending ? ` +${agg.fat.pending}项待补充` : ""}</td><td>{plan ? `${plan.fat} g` : "—"}</td></tr><tr><td>膳食纤维</td><td>{agg.fiber.known ? `${Math.round(agg.fiber.sum)} g` : "待补充"}{agg.fiber.pending ? ` +${agg.fiber.pending}项待补充` : ""}</td><td>25 g</td></tr></tbody></table>
        <b className="block pt-2">今天吃了</b>{entries.length ? entries.map((e) => <p key={e.id}>{e.meal} · {e.name} {entryLine(e)}</p>) : <Empty text="今天还没有记录" />}
        <button type="button" className="fk-orange-btn mt-2 min-h-11 w-full rounded-xl font-bold" onClick={() => { setSheet(null); setLogMeal("加餐"); }}>记录饮食</button></> : null}
      
      {sheet === "SLEEP" || sheet === "RHR" || sheet === "HRV" ? (() => { const rs = vitals.filter((v) => v.kind === sheet).sort((a, b) => b.observedOn.localeCompare(a.observedOn)).slice(0, 30); return rs.length ? rs.map((r) => <p key={r.id} className="flex justify-between border-b border-line py-1"><span>{r.observedOn}</span><span>{sheet === "SLEEP" ? `${f1(r.value)} h` : `${Math.round(r.value)} ${r.unit}`}</span></p>) : <Empty text="暂无数据，佳明同步或手动记录后显示" />; })() : null}
      {sheet === "water" ? <Empty text="饮水还没有记录入口（待接入）" /> : null}
      {sheet === "protein" ? <><p>{plan ? `每天约 ${plan.protein} g` : "填资料后计算每日目标"}；运动人群 1.4–2.0 g/kg/天，分 3–5 次吃，每次约 0.3 g/kg，练后 2 小时内吃一次。</p><p className="keep text-xs text-muted">依据：Jäger R, et al. ISSN Position Stand: protein and exercise. JISSN 2017;14:20；Thomas DT, et al. Nutrition and Athletic Performance (ACSM). MSSE 2016;48(3):543–568</p></> : null}
      {sheet === "carb" ? <><p>{plan ? `今天约 ${plan.carb} g` : "填资料后计算"}；轻训练 3–5 g/kg、约 1 小时中等训练 5–7 g/kg、高训练量 6–10 g/kg。练前 1–4 小时吃以碳水为主的一餐；超过 1 小时的训练每小时补 30–60 g。</p><p className="keep text-xs text-muted">依据：Thomas DT, et al. ACSM 2016, MSSE 48(3):543–568；Kerksick CM, et al. ISSN Position Stand: nutrient timing. JISSN 2017;14:33</p></> : null}
      {sheet === "fat" ? <><p>{plan ? `约 ${plan.fat} g/天` : "填资料后计算"}；脂肪约占总热量 20–35%，长期低于 20% 不建议。</p><p className="keep text-xs text-muted">依据：Thomas DT, et al. ACSM 2016, MSSE 48(3):543–568</p></> : null}
      {sheet === "fiber" ? <><p>成人每天 25 g 以上；练前 1–2 小时那餐少吃高纤维，避免胃肠不适。</p><p className="keep text-xs text-muted">依据：EFSA NDA Panel. Dietary Reference Values for carbohydrates and dietary fibre. EFSA Journal 2010;8(3):1462；ACSM 2016</p></> : null}
    </div></div> : null}
    {mealList ? <MealList meal={mealList} entries={entries.filter((e) => e.meal === mealList)} onClose={() => setMealList(null)} onAdd={() => { setLogMeal(mealList); setMealList(null); }} onChanged={() => setEntries(loadEntries().filter(e=>e.date===foodDate))} /> : null}
    {logMeal ? <FoodEntrySheet initialDate={foodDate} meal={logMeal} onClose={() => setLogMeal(null)} onSaved={() => setEntries(loadEntries().filter(e=>e.date===foodDate))} /> : null}
    {pendingKey ? <Sheet label="营养待补充列表" footer={null} title={NUTRIENT_LABELS[pendingKey]+"待补充"} onClose={()=>setPendingKey(null)}>{missingNutrition(entries,pendingKey).map(({row,fields})=><article key={row.id} className="border-b border-line py-3"><b>{row.name}</b><p className="keep text-xs text-muted">{row.meal} · {row.date} · 缺少{fields.map(k=>NUTRIENT_LABELS[k]).join("、")}</p><button type="button" className="fk-chip mt-2" onClick={()=>{setEditingFood(row);setPendingKey(null)}}>选择产品或补充营养</button></article>)}</Sheet>:null}
    {editingFood?<FoodEntrySheet meal={editingFood.meal} entry={editingFood} onClose={()=>setEditingFood(null)} onSaved={()=>setEntries(loadEntries().filter(e=>e.date===foodDate))}/>:null}
  </div>;

}

const COMP: { key: keyof BodyCheck; label: string; unit: string }[] = [
  { key: "weight", label: "体重", unit: "kg" }, { key: "fat", label: "体脂率", unit: "%" }, { key: "muscle", label: "肌肉量", unit: "kg" },
  { key: "armMuscle", label: "双臂肌肉", unit: "kg" }, { key: "trunkMuscle", label: "躯干肌肉", unit: "kg" }, { key: "legMuscle", label: "双腿肌肉", unit: "kg" },
  { key: "visceral", label: "内脏脂肪", unit: "级" }, { key: "waterRate", label: "水分", unit: "%" }, { key: "boneMass", label: "骨量", unit: "kg" }, { key: "bmr", label: "基础代谢", unit: "kcal" },
];
function BodyDetail({ children, checks, onClose, onSaved, editDate, onTrend, mode }: { children?: React.ReactNode; checks: BodyCheck[]; onClose: () => void; onSaved: () => void; editDate?: string | null; onTrend: () => void; mode: "figure" | "data" }) {
  const last = checks[checks.length - 1];
  const [form, setForm] = useState<Record<string, string>>(() => { const c = editDate ? checks.find((x) => x.date === editDate) : null; const f: Record<string, string> = { date: editDate ?? todayDate() }; if (c) for (const k of COMP) { const v = c[k.key]; if (v != null) f[k.key as string] = String(v); } return f; });
  const formRef = useRef<HTMLDetailsElement>(null);
  const editAt = (d: string | null) => { const c = d ? checks.find((x) => x.date === d) : null; const f: Record<string, string> = { date: d ?? todayDate() }; if (c) for (const k of COMP) { const v = c[k.key]; if (v != null) f[k.key as string] = String(v); } setForm(f); if (formRef.current) { formRef.current.open = true; formRef.current.scrollIntoView({ block: "start", behavior: "smooth" }); } };
  useEffect(() => { if (editDate && formRef.current) { formRef.current.open = true; formRef.current.scrollIntoView({ block: "start" }); } }, [editDate]);
  const h = Number(loadProfile().heightCm) || 0;
  const [msg, setMsg] = useState("");
  const [hit, setHit] = useState<Record<string, "ok" | "warn">>({});
  const save = () => {
    const w = Number(form.weight);
    if (!(w >= 30 && w <= 200)) { setMsg("请填体重"); return; }
    const rec: Omit<BodyCheck, "id"> = { date: form.date || todayDate(), weight: w };
    for (const c of COMP) { const v = Number(form[c.key as string]); if (c.key !== "weight" && v > 0) (rec as Record<string, number | string>)[c.key as string] = v; }
    const old = checks.find((c) => c.date === rec.date);
    if (!upsertCheck({ ...(old ?? {}), ...rec })) { setMsg("保存失败"); return; }
    setMsg("已保存"); setHit({}); setForm({ date: todayDate() }); onSaved();
  };
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg" role="dialog" aria-label="身体详情">
    <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-line bg-bg px-4 pb-1" style={{ paddingTop: "max(4px, env(safe-area-inset-top))" }}><b>{mode === "figure" ? "我的形象" : "身体数据"}</b><button type="button" className="min-h-11 px-3" onClick={onClose}>关闭</button></div>
    <div className="space-y-3 px-3 pt-2" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>
      {mode === "figure" ? <>{children}<button type="button" className="min-h-11 w-full rounded-xl border border-line text-sm" onClick={onTrend}>身体数据与趋势 ›</button></> : <>
      <section className="fk-dash-card p-3"><div className="fk-dash-title text-sm"><Activity className="size-4" />体成分{last ? <span className="keep ml-auto text-xs font-normal text-muted">{last.date}</span> : null}</div>
        {last ? <div className="mt-2 grid grid-cols-3 gap-2 text-center">{COMP.map((c) => { const v = last[c.key] as number | undefined; return <div key={c.key as string} className="rounded-lg bg-surface-2 p-1.5"><b className="text-sm">{v ? f1(v) : "—"}</b><p className="keep text-[10px] text-muted">{c.label}{v ? ` ${c.unit}` : ""}</p></div>; })}<div className="rounded-lg bg-surface-2 p-1.5"><b className="text-sm">{h ? f1(last.weight / (h / 100) ** 2) : "—"}</b><p className="keep text-[10px] text-muted">BMI</p></div></div> : <Empty text="还没有身体数据" />}
      </section>
      <section className="fk-dash-card space-y-2 p-3"><div className="fk-dash-title text-sm"><TrendingDown className="size-4" />趋势与历史</div><WeightSheet checks={checks} onAdd={() => editAt(null)} onEdit={(d) => editAt(d)} onChanged={onSaved} /></section>
      <details ref={formRef} className="fk-dash-card px-3"><summary className="min-h-11 cursor-pointer font-bold">手动记录体脂秤数据</summary>
        <div className="grid grid-cols-2 gap-2 pb-3">
          <ScaleScan onResult={(r) => { const f: Record<string, string> = { ...form }; const h: Record<string, "ok" | "warn"> = {}; for (const [k, v] of Object.entries(r.values)) { f[k] = String(v); h[k] = r.suspicious.includes(k as ScaleKey) ? "warn" : "ok"; } if (r.date) { f.date = r.date; h.date = "ok"; } setForm(f); setHit(h); setMsg(""); }} />
          <label className="col-span-2 text-xs">日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="fk-cell mt-0.5 w-full" /></label>
          {COMP.map((c) => { const k = c.key as string, st = hit[k], r = RANGES[k as ScaleKey]; const v = Number(form[k]); const bad = form[k] && r && !(v >= r[0] && v <= r[1]); return <label key={k} className={"text-xs " + (bad ? "text-red-400" : st ? "text-accent" : "")}>{c.label}（{c.unit}）{st && !bad ? " · 已识别" : ""}{bad ? " · 请检查" : ""}<input inputMode="decimal" aria-label={c.label} value={form[k] ?? ""} onChange={(e) => { setForm({ ...form, [k]: e.target.value.replace(/[^\d.]/g, "") }); setHit(({ [k]: _x, ...o }) => o); }} className={"fk-cell mt-0.5 w-full " + (bad ? "ring-2 ring-red-500" : st ? "ring-2 ring-[#ff6a1a]" : "")} /></label>; })}
          <button type="button" className="fk-orange-btn col-span-2 min-h-11 rounded-xl font-bold" onClick={save}>保存</button>
          {msg ? <p className="keep col-span-2 text-xs" aria-live="polite">{msg}</p> : null}
        </div>
      </details></>}
    </div>
  </div>;
}

const REC = [["SLEEP", "睡眠", "h"], ["RHR", "静息心率", "bpm"], ["HRV", "HRV", "ms"], ["STRESS", "压力", "/100"], ["fatigue", "疲劳", "1轻松-3很累"], ["pain", "酸痛", "0不疼-2明显"]] as const;
const t2 = (d: string) => Date.parse(d + "T12:00:00Z");
function RecoveryTrend({ vitals, only }: { vitals: ReturnType<typeof loadVitals>["records"]; only?: string }) {
  const [k0, setK] = useState<(typeof REC)[number][0]>("SLEEP");
  const k = (REC.find(r => r[0] === only)?.[0] ?? k0) as (typeof REC)[number][0];
  const [days, setDays] = useState(30);
  // 上海本地日：今天往前 days-1 天（含今天共 days 天）。旧写法用 UTC 日期，早上 8 点前会差一天。
  const today = todayDate(), since = shiftDay(today, -(days - 1));
  const pts: Pt[] = useMemo(() => {
    if (k === "fatigue" || k === "pain") { const F: Record<string, number> = { fresh: 1, ok: 2, tired: 3 }, P: Record<string, number> = { none: 0, mild: 1, sharp: 2 }; return loadCheckins().filter((c) => c.date >= since).map((c) => ({ d: c.date, v: k === "fatigue" ? F[c.fatigue ?? ""] : P[c.pain ?? ""] })).filter((p): p is Pt => typeof p.v === "number").sort((a, b) => a.d.localeCompare(b.d)); }
    const view=buildHealthSnapshot(vitals,loadExtras(),todayDate(),loadHealthSources(),loadCheckins()).metrics.find(m=>m.metric===k);
    return (view?.series??[]).filter(p=>p.day>=since).map(p=>({d:p.day,v:p.value}));
  }, [k, since, vitals]);
  const meta = REC.find((r) => r[0] === k)!;
  return <section className="fk-dash-card p-2">
    <div className="fk-dash-title text-sm"><Activity className="size-4" />{only ? `${meta[1]}趋势` : "恢复趋势"}<span className="keep ml-auto text-[10px] font-normal text-muted">{meta[2]}</span></div>
    <div className="mt-1 flex items-center gap-1 text-[11px]">{only ? null : <span className="flex flex-wrap rounded border border-line">{REC.map(([id, l]) => <button key={id} type="button" aria-pressed={k === id} onClick={() => setK(id)} className={"min-h-7 px-1.5 " + (k === id ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</span>}<span className="ml-auto flex rounded border border-line">{[7, 30, 90].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={"min-h-7 px-1.5 " + (days === d ? "bg-accent text-accent-fg" : "")}>{d}天</button>)}</span></div>
    {pts.length >= 2 ? <><TrendChart key={`${k}-${days}`} domain={[since, today]} unit={meta[2].length < 5 ? meta[2] : "分"} points={pts} fmt={(v) => (k === "SLEEP" ? (Math.round(v * 10) / 10).toString() : String(Math.round(v)))} />
      <p className="keep text-[10px] text-muted" data-testid="trend-coverage">{since.slice(5)}–{today.slice(5)} · {pts.length} 天有数据{pts[0].d > since ? `；最早 ${pts[0].d.slice(5)}，不足 ${days} 天${k === "fatigue" || k === "pain" ? "" : "（佳明每次同步会往前补 14 天，直到 90 天）"}` : ""}{pts.length < Math.round((t2(today) - t2(pts[0].d)) / 864e5) + 1 ? "；缺的天不连线" : ""}</p></> : <Empty text={k === "fatigue" || k === "pain" ? "在主观感受里点 2 天以上后显示" : "选择同一来源且有2天以上数据后显示"} />}
  </section>;
}

type MDef = { id: string; label: string; unit: string; icon: typeof Sun; subj?: boolean; fmt?: (v: number) => string };
const METRICS: MDef[] = [
  { id: "SLEEP", label: "睡眠", unit: "h", icon: Moon, fmt: (v) => f1(v) }, { id: "RHR", label: "静息心率", unit: "bpm", icon: HeartPulse }, { id: "HRV", label: "HRV", unit: "ms", icon: Activity },
  { id: "STRESS", label: "压力", unit: "", icon: Flame }, { id: "BODY_BATTERY", label: "身体电量", unit: "", icon: Sun }, { id: "RESP", label: "呼吸", unit: "次/分", icon: Leaf, fmt: (v) => f1(v) },
  { id: "SPO2", label: "血氧", unit: "%", icon: Droplet }, { id: "STEPS", label: "步数", unit: "步", icon: Activity },
  { id: "fatigue", label: "疲劳", unit: "", icon: Moon, subj: true }, { id: "pain", label: "酸痛", unit: "", icon: HeartPulse, subj: true }, { id: "recovery", label: "恢复状态", unit: "/10", icon: Lightbulb, subj: true },
];
const SUBJ: Record<string, [string, number][]> = { fatigue: [["轻松", 1], ["一般", 2], ["很累", 3]], pain: [["不疼", 0], ["有点疼", 1], ["明显疼", 2]], recovery: [["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8], ["9", 9], ["10", 10]] };
const TILE_KEY = "fk-health-tiles-v1";
const IN_RECOVERY = new Set(["SLEEP", "RHR", "HRV", "BODY_BATTERY"]);
const DEFAULT_TILES = ["SLEEP", "RHR", "HRV", "BODY_BATTERY", "fatigue", "pain"];
function HealthGrid({ vitals }: { vitals: ReturnType<typeof loadVitals>["records"] }) {
  const [rev, setRev] = useState(0);
  const [chosen, setChosen] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(TILE_KEY) || "null"); return Array.isArray(v) ? v : DEFAULT_TILES; } catch { return DEFAULT_TILES; } });
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [hd, setHd] = useState(30);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const snapshot=useMemo(()=>buildHealthSnapshot(vitals,loadExtras(),today,loadHealthSources(),loadCheckins()),[vitals,rev,today]);
  const series = useMemo(() => {
    void rev; const out: Record<string, Pt[]> = {};
    const put = (id: string, d: string, v: number) => { (out[id] ??= []).push({ d, v }); };
    for (const view of snapshot.metrics) for (const p of view.series) put(view.metric,p.day,p.value);
    const F: Record<string, number> = { fresh: 1, ok: 2, tired: 3 }, P: Record<string, number> = { none: 0, mild: 1, sharp: 2 };
    for (const c of loadCheckins()) { if (c.fatigue) put("fatigue", c.date, F[c.fatigue]); if (c.pain) put("pain", c.date, P[c.pain]); { const r = recovery10(c); if (r != null) put("recovery", c.date, r); } }
    for (const k in out) { const m = new Map(out[k].map((p) => [p.d, p.v])); out[k] = [...m].map(([d, v]) => ({ d, v })).sort((a, b) => a.d.localeCompare(b.d)); }
    return out;
  }, [vitals, rev, snapshot]);
  // v89：睡眠/静息心率/HRV/身体电量已在「恢复」四宫格和各自分区，这里不再重复。
  const avail = METRICS.filter((m) => !IN_RECOVERY.has(m.id) && (m.subj || snapshot.metrics.find(x=>x.metric===m.id)?.candidates.length));
  const shown = avail.filter((m) => chosen.includes(m.id));
  const val = (m: MDef) => { const view=snapshot.metrics.find(x=>x.metric===m.id); if(view?.state==='CONFLICT')return {t:"来源待核对",d:view.candidates[0]?.day??""}; if(!m.subj&&view?.current)return {t:valueText(m.id,view.current.value),d:view.current.day}; const s = series[m.id]; const l = s?.[s.length - 1]; if (!l) return null; if (m.subj) return { t: SUBJ[m.id].find(([, v]) => v === l.v)?.[0] ?? String(l.v), d: l.d }; return { t: `${(m.fmt ?? ((v: number) => String(Math.round(v))))(l.v)}${m.unit && m.unit !== "步" ? " " + m.unit : ""}`, d: l.d }; };
  const rate = (id: string, v: number) => {
    const patch = id === "fatigue" ? { fatigue: (["fresh", "ok", "tired"] as const)[v - 1] } : id === "pain" ? { pain: (["none", "mild", "sharp"] as const)[v] } : { recovery: v, recoveryScale: 10 as const };
    saveCheckin(today, patch); setRev((x) => x + 1);
  };
  const om = open ? METRICS.find((m) => m.id === open)! : null;
  return <section className="fk-dash-card p-2">
    <div className="flex items-center"><div className="fk-dash-title text-sm"><HeartPulse className="size-4" />更多指标与历史</div><button type="button" className="ml-auto min-h-8 px-2 text-xs text-accent" onClick={() => setEdit(!edit)}>{edit ? "完成" : "编辑"}</button></div>
    <HealthModeNote day={today}/>
    {edit ? <div className="mt-1 grid grid-cols-2 gap-1 text-sm">{avail.map((m) => <label key={m.id} className="flex min-h-9 items-center gap-2 rounded-lg border border-line px-2"><input type="checkbox" checked={chosen.includes(m.id)} onChange={(e) => { const n = e.target.checked ? [...chosen, m.id] : chosen.filter((x) => x !== m.id); setChosen(n); localStorage.setItem(TILE_KEY, JSON.stringify(n)); }} />{m.label}</label>)}</div>
    : shown.length ? <div className="mt-1 grid grid-cols-3 gap-1.5">{shown.map((m) => { const v = val(m); const I = m.icon; return <button key={m.id} type="button" onClick={() => setOpen(m.id)} className="rounded-xl border border-line bg-surface-2 p-2 text-left"><p className="flex items-center gap-1 whitespace-nowrap text-xs"><I className="size-3.5 shrink-0 text-accent" />{m.label}</p><p className="mt-1 text-base font-bold">{m.subj && v && v.d !== today ? "今天未评" : v?.t ?? (m.subj ? "点一下" : "—")}</p><p className="keep text-xs text-muted">{v ? (m.subj && v.d !== today ? `上次 ${v.t} · ${v.d.slice(5)}` : v.d.slice(5)) : ""}</p>{!m.subj?<p className="mt-0.5 text-xs text-muted">{snapshot.metrics.find(x=>x.metric===m.id)?.current?.statistic}</p>:null}</button>; })}</div> : <Empty text="点编辑选要显示的指标" />}
    {om ? <Sheet title={om.label} label="健康指标详情" footer={null} onClose={()=>setOpen(null)}>
      {!om.subj && snapshot.metrics.find(x=>x.metric===om.id) ? <HealthSourceDetails view={snapshot.metrics.find(x=>x.metric===om.id)!}/> : null}
      {om.subj ? <div className="mt-1 flex flex-wrap gap-1.5"><span className="keep self-center text-xs text-muted">今天</span>{SUBJ[om.id].map(([l, v]) => { const last = series[om.id]?.find((p) => p.d === today)?.v; return <button key={l} type="button" className="fk-chip" aria-pressed={last === v} onClick={() => rate(om.id, v)}>{l}</button>; })}</div> : null}
      <div className="mt-2 flex rounded border border-line text-xs">{[7, 30, 90, 365].map((d) => <button key={d} type="button" aria-pressed={hd === d} onClick={() => setHd(d)} className={"min-h-8 flex-1 " + (hd === d ? "bg-accent text-accent-fg" : "")}>{d === 365 ? "年" : `${d}天`}</button>)}</div>
      {(() => { const since = shiftDay(today, -(hd - 1)); const ps = (series[om.id] ?? []).filter((p) => p.d >= since); return <>{ps.length >= 2 ? <TrendChart key={`${om.id}-${hd}`} domain={[since, today]} points={ps} height={180} fmt={om.fmt} unit={om.subj ? "分" : om.unit} /> : <Empty text="这个时间段少于 2 天数据" />}<div className="mt-2 max-h-48 overflow-y-auto text-xs">{[...ps].reverse().map((p) => <p key={p.d} className="flex justify-between border-b border-line py-1"><span>{p.d}</span><b>{om.subj ? SUBJ[om.id].find(([, v]) => v === p.v)?.[0] ?? p.v : (om.fmt ?? ((v: number) => String(Math.round(v))))(p.v)}</b></p>)}</div></>; })()}
    </Sheet> : null}
  </section>;
}

const WM: { key: keyof BodyCheck; label: string; color: string; unit: string }[] = [
  { key: "weight", label: "体重", color: "#ff6a1a", unit: "kg" }, { key: "fat", label: "体脂率", color: "#4aa8ff", unit: "%" }, { key: "muscle", label: "肌肉量", color: "#3ccf6a", unit: "kg" },
  { key: "visceral", label: "内脏脂肪", color: "#ffb020", unit: "级" }, { key: "waterRate", label: "水分", color: "#7ad7f0", unit: "%" }, { key: "bmr", label: "基础代谢", color: "#c08bff", unit: "kcal" },
];
function WeightSheet({ checks, onAdd, onEdit, onChanged }: { checks: BodyCheck[]; onAdd: () => void; onEdit: (d: string) => void; onChanged: () => void }) {
  const [sel, setSel] = useState<string[]>(["weight"]);
  const [days, setDays] = useState(30);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const inRange = checks.filter((c) => c.date >= since);
  const avail = WM.filter((m) => checks.some((c) => typeof c[m.key] === "number"));
  const series = WM.filter((m) => sel.includes(m.key as string)).map((m) => ({ label: m.label, color: m.color, unit: m.unit, points: inRange.filter((c) => typeof c[m.key] === "number" && (c[m.key] as number) > 0).map((c) => ({ d: c.date, v: c[m.key] as number })) }));
  return <>
    <div className="flex flex-wrap gap-1">{avail.map((m) => <label key={m.key as string} className="flex min-h-8 items-center gap-1 rounded-full border border-line px-2 text-xs"><input type="checkbox" checked={sel.includes(m.key as string)} onChange={(e) => setSel(e.target.checked ? [...sel, m.key as string] : sel.filter((x) => x !== m.key))} /><span style={{ color: m.color }}>●</span>{m.label}</label>)}</div>
    <div className="flex rounded border border-line text-xs">{([[7, "周"], [30, "月"], [182, "半年"], [365, "年"]] as const).map(([d, l]) => <button key={l} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={"min-h-8 flex-1 " + (days === d ? "bg-accent text-accent-fg" : "")}>{l}</button>)}</div>
    {series.some((s) => s.points.length >= 1) ? <MultiTrend key={`${days}-${sel.join()}`} series={series} height={200} /> : <Empty text="这个时间段还没有记录" />}
    {series.length && series.every((s) => s.points.length < 2) && series.some((s) => s.points.length === 1) ? <p className="keep text-xs text-muted">再记录 1 次即可显示曲线</p> : null}
    <button type="button" className="fk-orange-btn min-h-11 w-full rounded-xl font-bold" onClick={onAdd}>+ 记录</button>
    {checks.length ? <div className="text-xs">{[...checks].reverse().slice(0, 100).map((c) => <div key={c.id} className="flex items-center gap-2 border-b border-line py-1.5"><span className="w-20 shrink-0">{c.date}</span><span className="flex-1">{f1(c.weight)} kg{c.fat ? ` · ${f1(c.fat)}%` : ""}{c.muscle ? ` · 肌 ${f1(c.muscle)}` : ""}</span><button type="button" className="min-h-8 px-2 text-accent" onClick={() => onEdit(c.date)}>编辑</button><button type="button" className="min-h-8 px-2 text-muted" onClick={() => { if (confirm(`删除 ${c.date} 的记录？`)) { removeCheck(c.id); onChanged(); } }}>删除</button></div>)}</div> : <Empty text="还没有体重记录" />}
  </>;
}

function entryLine(e:FoodEntry):string {
 const amount=e.amount??e.grams;return (amount!=null?amount+" "+(e.unit||"g")+" · ":"")+NUTRIENT_KEYS.map(k=>{const v=nutrientOf(e,k);return NUTRIENT_LABELS[k]+" "+(v==null?"待补充":v+(k==='kcal'?" kcal":" g"))}).join(" · ");
}
function MealList({ meal, entries, onClose, onAdd, onChanged }: { meal: Meal; entries: FoodEntry[]; onClose: () => void; onAdd: () => void; onChanged: () => void }) {
  const [edit, setEdit] = useState<string | null>(null), [error, setError] = useState("");
  const del = (id: string) => { if (removeEntry(id)) { setError(""); onChanged(); } else setError("删除未保存，原记录仍在。请重试。"); };
  return <Sheet title={meal} label={`${meal}明细`} onClose={onClose} footer={<><p role="status" className="mb-2 text-sm text-risk">{error}</p><button type="button" className="fk-orange-btn min-h-12 w-full rounded-xl font-bold" onClick={onAdd}>+ 添加食物</button></>}>
    {!entries.length ? <p className="py-4 text-sm text-muted">这餐还没有记录。</p> : null}
    {entries.map(e => <div key={e.id} className="border-b border-line py-3 text-sm"><p className="break-words font-bold">{e.name}</p><p className="keep mt-1 text-xs text-muted">{entryLine(e)}</p>{e.nutritionSource ? <details className="mt-1 text-xs"><summary className="min-h-9 cursor-pointer">识别依据 / 估算说明</summary><p>{e.nutritionSource.evidence}</p><p>{e.nutritionSource.uncertainty}</p></details> : null}<div className="flex gap-3"><button type="button" className="min-h-11 text-accent" onClick={() => setEdit(edit === e.id ? null : e.id)}>{nutrientOf(e,'kcal') == null ? "补录营养" : "编辑"}</button><button type="button" className="min-h-11 text-muted" onClick={() => del(e.id)}>删除</button></div>{edit === e.id ? <FoodEntrySheet entry={e} meal={e.meal} onClose={()=>setEdit(null)} onSaved={onChanged} /> : null}</div>)}
  </Sheet>;
}

type FigP = { heightCm: number; massKg: number; bodyFatPct: number };
// Static character illustration (04 pack hero art). No body-shape model is wired,
// so current and target show the same standard figure; numbers carry the difference.
function Figure({ sex }: { sex: "male" | "female"; base?: FigP; p?: FigP; ghost?: boolean }) {
  return <span className="relative flex h-full w-full items-end justify-center">
    <img src={`/fangkun-atlas/figure-${sex}.webp`} alt="标准形象插画" draggable={false} className="h-full w-full max-w-full object-contain" style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,.5))" }} />
  </span>;
}
