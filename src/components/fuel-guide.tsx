import { Model } from "@/components/bodylab/bodylab-panel"
import { useEffect, useMemo, useState } from "react"
import { Camera, ChevronDown, Droplets, Utensils } from "lucide-react"
import type { Profile } from "@/lib/strength/profile"
import { computePlan } from "@/lib/nutrition/calc"
import { FuelPanel } from "@/components/fuel-panel"
import { addEntry, loadEntries, todayEntries } from "@/lib/nutrition/log"
import { bodyTrend } from "@/lib/nutrition/body"
import { parseFoodLine, type FoodHit } from "@/lib/nutrition/lookup"
import { DAY_LABEL, GOAL_AIM, GOAL_EXAMPLES, GOAL_LABEL, MEAL_EXAMPLES, QUICK_FOODS, fuelFlags, goalTargets, homeTips, mealByHour, weightTrendAdvice, type FuelGoal, sessionTiming, type FuelFlag, type Tip } from "@/lib/nutrition/fuel-guide"
import { confirmedSessionsOn } from "@/lib/ui/day-schedule"
import { SavedBadge } from "@/components/saved-badge"
import { ocr } from "@/components/device-import"

const SIGNS_KEY = "fk-fuel-signs-v1"
type Signs = { frequentIllness?: boolean; boneStress?: boolean; missedPeriods?: boolean; persistentFatigue?: boolean }
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
function loadSigns(): Signs { try { return JSON.parse(localStorage.getItem(SIGNS_KEY) ?? "{}") } catch { return {} } }

function useFuel(profile: Profile, revision = 0, goal: FuelGoal = "keep", servingAdjust = 0) {
  const [state, setState] = useState<{ sessions: ReturnType<typeof confirmedSessionsOn>; signs: Signs; logged: { kcal: number; trainingDay: boolean }[]; week: number | null }>({ sessions: [], signs: {}, logged: [], week: null })
  useEffect(() => {
    const byDay = new Map<string, number>(); for (const e of loadEntries()) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.kcal)
    const days = Array.from({ length: 7 }, (_, i) => localDay(new Date(Date.now() - i * 864e5)))
    setState({ sessions: confirmedSessionsOn(localDay()), signs: loadSigns(), logged: days.filter((d) => byDay.has(d)).map((d) => ({ kcal: byDay.get(d)!, trainingDay: confirmedSessionsOn(d).length > 0 })), week: bodyTrend().weekDelta })
  }, [revision])
  const kg = Number(profile.weightKg)
  const plan = computePlan({ ...profile, aim: GOAL_AIM[goal] })
  const targets = useMemo(() => goalTargets(goal, kg, state.sessions, servingAdjust), [goal, kg, state.sessions, servingAdjust])
  const flags = useMemo(() => fuelFlags({ targetKcal: plan?.kcal ?? null, bmr: plan?.bmr ?? null, aim: plan?.aim ?? null, dayType: targets?.type ?? "rest", loggedDays: state.logged, weekWeightDeltaKg: state.week, signs: state.signs }), [plan?.kcal, plan?.bmr, plan?.aim, targets?.type, state])
  return { ...state, kg: kg >= 30 ? kg : null, plan, targets, flags, setSigns: (s: Signs) => { try { localStorage.setItem(SIGNS_KEY, JSON.stringify(s)) } catch { /* ignore */ } setState({ ...state, signs: s }) } }
}
const TipLine = ({ t }: { t: Tip }) => <li className="leading-snug">{t.text} <span className="whitespace-nowrap text-[10px] text-muted">{t.tag}{t.cite ? ` ${t.cite}` : ""}</span></li>
const FlagBox = ({ f }: { f: FuelFlag }) => <p className={"rounded-lg p-2 text-xs " + (f.level === "refer" ? "border border-[var(--color-risk)] text-[var(--color-risk)]" : f.level === "warn" ? "bg-[#fdf3e8] text-[#8a5a22] dark:bg-transparent" : "bg-surface-2")}>{f.text} <span className="opacity-70">{f.tag}{f.cite ? ` ${f.cite}` : ""}</span></p>

/** 身体 → 饮食：目标、时机、补水、怎么选、温和提示 */
export function FuelGuide({ profile, revision, onEditProfile, goal = "keep", servingAdjust = 0 }: { profile: Profile; revision: number; onEditProfile: () => void; goal?: FuelGoal; servingAdjust?: number }) {
  const f = useFuel(profile, revision, goal, servingAdjust)
  const [open, setOpen] = useState<number | null>(null)
  const [signStamp, setSignStamp] = useState(0)
  const t = f.targets
  return <section className="home-card p-4 text-sm" aria-label="今天怎么吃">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">今天怎么吃</h2><span className="text-xs text-muted">{t ? DAY_LABEL[t.type] : ""}{f.sessions.length ? ` · ${f.sessions.length} 节课` : " · 今天没排课"}</span></div>
    
    {!t ? <p className="mt-2 text-muted">先填体重，方坤才能按 g/kg 算目标。<button type="button" className="fk-link" onClick={onEditProfile}>去填 ›</button></p> : <>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-surface-2 py-2"><p className="text-[11px] text-muted keep">碳水</p><p className="font-bold">{t.carbG[0]}–{t.carbG[1]}<small className="text-muted"> g</small></p></div>
        <div className="rounded-xl bg-surface-2 py-2"><p className="text-[11px] text-muted keep">蛋白</p><p className="font-bold">{t.proteinG}<small className="text-muted"> g</small></p></div>
        <div className="rounded-xl bg-surface-2 py-2"><p className="text-[11px] text-muted keep">热量</p><p className="font-bold">{f.plan ? f.plan.kcal : "—"}<small className="text-muted"> kcal</small></p></div>
      </div>
      <details className="mt-2"><summary className="min-h-10 cursor-pointer font-bold">要点与依据</summary><ul className="list-disc space-y-1 pl-5">{[...homeTips(t, f.sessions, f.flags), ...t.goalTips, t.tips[0]].map((x, i) => <TipLine key={i} t={x} />)}</ul><p className="mt-1 text-xs">碳水 {t.carbPerKg[0]}–{t.carbPerKg[1]} g/kg · 蛋白 {t.proteinPerKg} g/kg，分 {t.meals} 次，每次约 {t.proteinPerMeal} g</p></details>
    </>}
    {f.flags.length ? <div className="mt-3 space-y-1.5">{f.flags.map((x, i) => <FlagBox key={i} f={x} />)}</div> : null}
    {f.sessions.map((s, i) => { const tm = sessionTiming(s, f.kg, null); const isOpen = open === i
      return <div key={i} className="mt-3 rounded-xl border border-line">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)} className="flex w-full items-center justify-between p-2.5 text-left font-bold"><span>「{s.title}」前中后怎么吃</span><ChevronDown className={"size-4 " + (isOpen ? "rotate-180" : "")} /></button>
        {isOpen ? <div className="space-y-2 px-3 pb-3">
          {([["练前", tm.before], ["练中", tm.during], ["练后", tm.after]] as const).map(([k, list]) => <div key={k}><p className="text-xs font-bold text-muted">{k}</p><ul className="list-disc space-y-1 pl-5">{list.map((x, j) => <TipLine key={j} t={x} />)}</ul></div>)}
        </div> : null}
      </div> })}
    <details className="mt-3 rounded-xl border border-line px-3 py-1"><summary className="flex min-h-10 cursor-pointer items-center gap-1.5 font-bold"><Droplets className="size-4 text-[#2182bd]" />补水</summary>
      <ul className="list-disc space-y-1 pb-2 pl-5">
        <TipLine t={{ text: f.kg ? `练前约 4 小时喝 ${Math.round(f.kg * 5)}–${Math.round(f.kg * 7)} ml。` : "练前约 4 小时喝 5–7 ml/kg。", tag: "【共识】", cite: "ACSM 2016" }} />
        <TipLine t={{ text: "练中别让体重掉超过 2%；练后每少 1 kg 补 1.25–1.5 L，可加点盐。", tag: "【共识】", cite: "ACSM 2016" }} />
        <TipLine t={{ text: "平时看尿色：淡黄就够，深黄说明喝少了。", tag: "【经验规则】" }} />
      </ul></details>
    <details className="mt-2 rounded-xl border border-line px-3 py-1"><summary className="min-h-10 cursor-pointer font-bold">食堂 / 外卖怎么选 · {GOAL_LABEL[goal]}</summary>
      <ul className="space-y-1 pb-2">{(GOAL_EXAMPLES[goal] ?? MEAL_EXAMPLES[t?.type ?? "rest"]).map((m) => <li key={m.scene}><b>{m.scene}：</b>{m.pick}</li>)}</ul>
      <p className="pb-2 text-[11px] text-muted">【经验规则】举例，份量按饱腹和训练量调。</p></details>
    <details className="mt-2 rounded-xl border border-line px-3 py-1"><summary className="flex min-h-10 cursor-pointer items-center justify-between font-bold">身体信号自查（可选）<SavedBadge stamp={signStamp} /></summary>
      <div className="space-y-1.5 pb-2">{([["missedPeriods", "月经不规律或连续几个月没来"], ["boneStress", "骨头上某一点按压痛 / 应力性骨折史"], ["frequentIllness", "最近经常感冒生病"], ["persistentFatigue", "持续疲劳、成绩下滑"]] as const).map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.signs[k])} onChange={(e) => { f.setSigns({ ...f.signs, [k]: e.target.checked }); setSignStamp(Date.now()) }} />{label}</label>)}
        <p className="text-[11px] text-muted">只用于提醒就医，不做诊断，只存在本机。依据：IOC 2023 REDs 共识。</p></div></details>
  </section>
}

/** 快速记一笔：常用食物一点即记，文字或截图识别后确认 */
export function QuickFoodLog({ onSaved }: { onSaved: () => void }) {
  const [stamp, setStamp] = useState(0)
  const [text, setText] = useState("")
  const [hits, setHits] = useState<FoodHit[]>([])
  const [status, setStatus] = useState("")
  const [eaten, setEaten] = useState({ kcal: 0, protein: 0 })
  useEffect(() => { const r = todayEntries(); setEaten({ kcal: r.reduce((s, e) => s + e.kcal, 0), protein: Math.round(r.reduce((s, e) => s + (e.protein ?? 0), 0)) }) }, [stamp])
  const save = (list: FoodHit[]) => { const meal = mealByHour(new Date().getHours()); let ok = 0; for (const h of list) if (addEntry({ meal, name: h.name, grams: h.grams, kcal: h.kcal, protein: h.protein, label: h.label })) ok++; if (ok) { setStamp(Date.now()); onSaved(); setStatus(`已记入${meal} ${ok} 项`) } }
  return <section className="home-card mt-3 p-4 text-sm" aria-label="快速记饮食">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">快速记一笔</h2><SavedBadge stamp={stamp} /></div>
    <p className="mt-1 text-xs text-muted">今天已记 {eaten.kcal} kcal · 蛋白 {eaten.protein} g · 按现在时间自动归到{mealByHour(new Date().getHours())}</p>
    <div className="fk-chips mt-2 flex-wrap">{QUICK_FOODS.map((q) => <button key={q} type="button" className="fk-chip" onClick={() => save(parseFoodLine(q))}>+ {q}</button>)}</div>
    <div className="mt-2 flex gap-2">
      <input value={text} onChange={(e) => { setText(e.target.value); setHits(e.target.value.trim() ? parseFoodLine(e.target.value) : []) }} placeholder="如：牛肉面一碗，卤蛋1个" className="fk-cell min-h-11 min-w-0 flex-1" aria-label="输入吃了什么" />
      <label className="fk-chip cursor-pointer" aria-label="截图识别"><Camera className="size-4" /><input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { const raw = await ocr(file, setStatus); const lines = raw.split(/\n/).map((l) => l.replace(/[¥￥]\s*[\d.]+/g, "").trim()).filter((l) => /[\u4e00-\u9fa5]{2,}/.test(l)).join("，"); const found = parseFoodLine(lines); setHits(found); setStatus(found.length ? "识别到以下食物，核对后加入" : "没认出食物名，请手动输入"); } catch (err) { setStatus(err instanceof Error ? err.message : "识别失败") } }} /></label>
    </div>
    {hits.length ? <div className="mt-2 rounded-xl border border-line p-2"><ul className="space-y-0.5 text-xs">{hits.map((h, i) => <li key={i}>{h.name} {h.label} · {h.kcal} kcal · 蛋白 {h.protein} g</li>)}</ul>
      <button type="button" className="fk-primary mt-2 min-h-10 w-full" onClick={() => { save(hits); setHits([]); setText("") }}>加入 {hits.length} 项</button></div> : null}
    {status ? <p className="mt-1 text-xs text-muted" role="status">{status}</p> : null}
    <p className="mt-1 text-[11px] text-muted">热量来自内置食物库估算；外卖截图只识别菜名，份量请自己核对。</p>
  </section>
}

const GOAL_KEY = "fk-diet-goal-v1"
type GoalPref = { goal: FuelGoal; servingAdjust: number }
function loadGoal(profile: Profile): GoalPref { try { const v = JSON.parse(localStorage.getItem(GOAL_KEY) ?? "null"); if (v?.goal) return v } catch { /* default */ } return { goal: profile.aim === "lose" ? "cut" : profile.aim === "gain" ? "gain" : "run", servingAdjust: 0 } }

/** 饮食页：目标 → 今日目标与要点 → 体重趋势 → 快速记录 → 详细记录 */
function DietFigure({ profile }: { profile: Profile }) {
  const h = Number(profile.heightCm), w = Number(profile.weightKg)
  if (!(h >= 140 && w >= 35)) return null
  return <div className="h-56 w-full"><Model profile={{ heightCm: h, massKg: w, bodyFatPct: Number(profile.bodyFat) || (profile.sex === "female" ? 27 : 18), frame: 0, sex: profile.sex === "female" ? "female" : "male" }} yaw={0} frameHeight={h / 100} onYaw={() => {}} /></div>
}
export function DietPage({ profile, onEditProfile, active }: { profile: Profile; onEditProfile: () => void; active: boolean }) {
  const [mounted, setMounted] = useState(false)
  const [pref, setPref] = useState<GoalPref>({ goal: "run", servingAdjust: 0 })
  const [revision, setRevision] = useState(0)
  const [stamp, setStamp] = useState(0)
  const [week, setWeek] = useState<number | null>(null)
  useEffect(() => { setMounted(true); setPref(loadGoal(profile)) }, [profile])
  useEffect(() => { if (active) { setRevision((v) => v + 1); setWeek(bodyTrend().weekDelta) } }, [active])
  const save = (p: GoalPref) => { setPref(p); try { localStorage.setItem(GOAL_KEY, JSON.stringify(p)); setStamp(Date.now()) } catch { /* ignore */ } }
  const kg = Number(profile.weightKg) >= 30 ? Number(profile.weightKg) : null
  const advice = weightTrendAdvice(pref.goal, kg, week)
  return <div className="mx-auto max-w-3xl space-y-3 px-3 pt-2 pb-nav">
    <section className="home-card p-3" aria-label="饮食目标"><div>
      <div className="flex items-center justify-between"><h2 className="text-base font-bold">我的目标</h2><SavedBadge stamp={stamp} /></div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">{(Object.keys(GOAL_LABEL) as FuelGoal[]).map((g) => <button key={g} type="button" className="fk-chip justify-center" aria-pressed={pref.goal === g} onClick={() => save({ goal: g, servingAdjust: 0 })}>{GOAL_LABEL[g]}</button>)}</div>
    </div></section>
    {mounted ? <>
      <FuelGuide profile={profile} revision={revision} onEditProfile={onEditProfile} goal={pref.goal} servingAdjust={pref.servingAdjust} />
      <section className="home-card p-4 text-sm" aria-label="体重趋势">
        <h2 className="text-base font-bold">体重趋势 vs 目标</h2>
        <p className="mt-1">{advice.text} <span className="text-[10px] text-muted">{advice.tag}{advice.cite ? ` ${advice.cite}` : ""}</span></p>
        {advice.adjust ? <div className="mt-2 flex gap-2"><button type="button" className="fk-chip" onClick={() => save({ ...pref, servingAdjust: Math.max(-3, Math.min(3, pref.servingAdjust + advice.adjust)) })}>接受调整</button><button type="button" className="fk-chip" onClick={() => setWeek(null)}>先不用</button></div> : null}
        {pref.servingAdjust ? <p className="mt-1 text-xs text-muted">当前：每天{pref.servingAdjust > 0 ? "多" : "少"} {Math.abs(pref.servingAdjust)} 份主食。<button type="button" className="fk-link" onClick={() => save({ ...pref, servingAdjust: 0 })}>撤销</button></p> : null}
      </section>
      <div id="quick-food"><QuickFoodLog onSaved={() => setRevision((v) => v + 1)} /></div>
    </> : null}
    <details className="home-card p-3"><summary className="min-h-10 cursor-pointer text-sm font-bold">详细记录 · 食物库 · 热量设置</summary><FuelPanel profile={profile} onEdit={onEditProfile} revision={revision} onSaved={() => setRevision((v) => v + 1)} /></details>
  </div>
}
