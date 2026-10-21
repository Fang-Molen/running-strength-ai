import { recovery10 } from "@/lib/health/legacy-inputs";
import { currentAthleteId } from "@/lib/core/events"
import { loadHealthSnapshot } from "@/lib/health/snapshot"
import { reviewFatigue, dailyCheckin, FATIGUE_REVIEW_RULES } from "@/lib/health/analysis"
import { healthChanged } from '@/lib/health/observation'
import { useEffect, useState } from "react"
import { Plus , Smile } from "lucide-react"
import { loadVitals } from "@/lib/nutrition/vitals"
import { loadExtras } from "@/lib/ui/device-store"
import { type RecoveryInput } from "@/lib/ui/recovery-verdict"
import { SavedBadge } from "@/components/saved-badge"
import { FATIGUE, BRANDS, GROUP_HINT, PAIN, loadBrand, saveWatch, loadTier, gateRecovery, TIERS, TIER_LABEL, SLEEP_CHIPS, WATCHES, fatigueScore, freshness, loadCheckins, saveCheckin, watchLabel, type Checkin, type WatchId } from "@/lib/ui/watch-mode"

const avg = (xs: number[]) => xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
export function readRecoveryInput(today: string): RecoveryInput {
  const snapshot=loadHealthSnapshot(today),ci=loadCheckins().find(c=>c.date===today)
  const view=(k:string)=>snapshot.metrics.find(m=>m.metric===k)
  const val=(k:string)=>view(k)?.state==='AVAILABLE'?view(k)?.current?.value??null:null
  const base=(k:string)=>view(k)?.state==='AVAILABLE'?view(k)?.baseline?.mean??null:null
  return {pain:ci?.pain??null,readiness:val('READINESS'),bodyBattery:null,stress:val('STRESS'),sleepBase:base('SLEEP'),hrv:val('HRV'),hrvBase:base('HRV'),rhr:val('RHR'),rhrBase:base('RHR'),subjective:val('RECOVERY')??recovery10(ci)??fatigueScore(ci?.fatigue),sleepH:val('SLEEP')??(view('SLEEP')?.state==='MISSING'?ci?.sleep??null:null)}

}

export function RecoveryVerdictCard({ today, revision, onImport, watch }: { today: string; revision: number; onImport: () => void; watch?: WatchId | null }) {
  const [input, setInput] = useState<RecoveryInput | null>(null)
  useEffect(() => { if (today) setInput(readRecoveryInput(today)) }, [today, revision])
  if (!input) return null
  const tier = loadTier()
  const review=reviewFatigue(loadHealthSnapshot(today),dailyCheckin(today))
  const v = {level:review.state==='PAIN_REVIEW'||review.state==='MULTI_SIGNAL'?'reduce':review.state==='WATCH'?'watch':'unknown',title:review.title,reasons:review.signals.map(s=>s.detail)}
  const depth = TIERS[tier].depth
  const tone = v.level === "go" ? "border-[#269775] bg-[#269775]/10" : v.level === "reduce" ? "border-[#e0a46b] bg-[#fdf3e8] dark:bg-transparent" : v.level === "watch" ? "border-[#e0c46b] bg-[#fdf9e8] dark:bg-transparent" : "border-line bg-surface-2"
  return <section aria-label="今日恢复" className={"mb-3 rounded-card border-2 p-4 " + tone}>
    <p className="product-eyebrow">今日恢复</p>
    <h2 className="mt-1 text-xl font-bold">{v.title}</h2>
    {depth >= 2 ? <p className="mt-1 text-sm">{v.reasons.join(" · ")}</p> : null}
    <p className="mt-2 text-sm">{review.action}</p><p className="mt-1 text-xs text-muted">{review.followup}</p>
    <p className="keep mt-1 text-xs text-muted">{v.level === "unknown" ? <button type="button" className="fk-link ml-1" onClick={onImport}>导入手表数据 ›</button> : null}</p>
    {watch && watch !== "none" ? <SourceLine watch={watch} revision={revision} onImport={onImport} /> : null}
    {depth >= 3 ? <p className="mt-1 text-[10px] text-muted">本应用复核阈值（非疲劳诊断标准）：HRV 较7天可比记录均值降 ≥{FATIGUE_REVIEW_RULES.hrvDropFraction*100}% 记为复核信号；静息心率高 {FATIGUE_REVIEW_RULES.rhrRiseBpm} 次以上、睡眠少 {FATIGUE_REVIEW_RULES.sleepDeltaHours} 小时以上记为留意。</p> : null}
    <p className="mt-1 text-[10px] text-muted">{TIER_LABEL[tier]}</p>
  </section>
}

/** 疼痛/伤病记录：部位、0–10、日期；P-03/P-07 提示。 */
const PAIN_KEY = "fk-pain-log-v1"
type Pain = { id: string; date: string; part: string; score: number; note: string; athleteId?: string; occurredAt?: string; recordedAt?: string }
export function PainLog({ today }: { today: string }) {
  const [list, setList] = useState<Pain[]>([])
  const [part, setPart] = useState(""), [score, setScore] = useState(3), [stamp, setStamp] = useState(0), [saveError, setSaveError] = useState("")
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(PAIN_KEY) ?? "[]").filter((p:Pain)=>(p.athleteId??'local')===currentAthleteId())) } catch { setList([]) } }, [])
  const save = (next: Pain[]) => { try { const all=JSON.parse(localStorage.getItem(PAIN_KEY)??'[]') as Pain[]; if(!Array.isArray(all))throw Error('INVALID')
    const raw=JSON.stringify([...all.filter(p=>(p.athleteId??'local')!==currentAthleteId()),...next]);localStorage.setItem(PAIN_KEY,raw)
    if(localStorage.getItem(PAIN_KEY)!==raw)throw Error('VERIFY_FAILED')
    setList(next);setStamp(Date.now());setSaveError("");healthChanged() } catch { setSaveError("没保存成功：原有记录未改动，请稍后重试。") /* Preserve old data on failed persistence. */ } }
  const byPart = new Map<string, Pain[]>(); for (const p of list) byPart.set(p.part, [...(byPart.get(p.part) ?? []), p])
  const long = [...byPart.entries()].filter(([, ps]) => { const ds = ps.map((p) => p.date).sort(); return (Date.parse(ds.at(-1)!) - Date.parse(ds[0])) / 864e5 >= 14 && ds.at(-1)! >= today.slice(0, 8) })
  return <section className="home-card mt-3 p-4 text-sm" aria-label="疼痛与伤病">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">疼痛 / 伤病</h2><SavedBadge stamp={stamp} /></div>{saveError ? <p role="status" className="keep mt-1 text-sm text-risk">{saveError}</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={part} onChange={(e) => setPart(e.target.value.slice(0, 12))} placeholder="部位，如 左膝外侧" className="fk-cell min-h-10 min-w-0 flex-1" aria-label="疼痛部位" />
      <label className="flex items-center gap-1 text-xs">程度<input type="range" min={0} max={10} value={score} onChange={(e) => setScore(+e.target.value)} aria-label="疼痛程度" /><b className="w-5">{score}</b></label>
      <button type="button" disabled={!part.trim()} className="fk-chip" onClick={() => { const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;save([...list, { id: Math.random().toString(36).slice(2), date: today, part: part.trim(), score, note: "",athleteId:currentAthleteId(),recordedAt:now.toISOString(),...(day===today?{occurredAt:now.toISOString()}: {}) }]); setPart("") }}><Plus className="size-3.5" />记下</button>
    </div>
    {score > 3 && part ? <p className="mt-1 text-xs text-[var(--color-risk)]">疼痛 &gt;3/10 或改变跑姿：停止引起疼痛的训练，48 小时内不做引起疼痛的动作；不缓解请就医。（手册 P-03【经验规则】）</p> : null}
    {long.map(([p]) => <p key={p} className="mt-1 rounded-lg border border-[var(--color-risk)] p-2 text-xs text-[var(--color-risk)]">「{p}」记录跨度已超过 14 天，建议找运动医学/康复专业人员检查。（手册 P-07）</p>)}
    {list.length ? <ul className="mt-2 divide-y divide-line">{[...list].reverse().slice(0, 6).map((p) => <li key={p.id} className="flex items-center justify-between py-1.5"><span>{p.date.slice(5)} · {p.part} · <b>{p.score}/10</b></span><button type="button" className="text-xs text-muted" onClick={() => save(list.filter((x) => x.id !== p.id))}>删除</button></li>)}</ul> : <p className="mt-2 text-xs text-muted">没有记录。</p>}
  </section>
}

export function lastDeviceSync(): string | null {
  return [...loadVitals().records.filter((r) => r.source === "DEVICE_CONFIRMED").map((r) => r.observation?.syncedAt ?? r.createdAt), ...loadExtras().map(r=>r.observation?.syncedAt??'')].filter(Boolean).sort().at(-1) ?? null
}
function SourceLine({ watch, revision, onImport }: { watch: WatchId; revision: number; onImport: () => void }) {
  const [f, setF] = useState<ReturnType<typeof freshness> | null>(null)
  useEffect(() => { setF(freshness(lastDeviceSync())) }, [revision])
  if (!f) return null
  return <p className={"mt-2 text-xs " + (f.stale ? "rounded-lg bg-[#fdf3e8] p-2 text-[#9a5b1e] dark:bg-transparent" : "text-muted")}>
    所选手表 {watchLabel(watch, loadBrand())} · 最近接收 {f.text}（测量日期见各指标）{f.stale ? <button type="button" className="fk-link ml-1 font-bold" onClick={onImport}>一键导入 ›</button> : null}
  </p>
}

export function WatchQuestion({ onPick, current }: { onPick: (w: WatchId) => void; current?: WatchId | null }) {
  return <section className="home-card p-4" aria-label="你的数据从哪来">
    <h2 className="text-lg font-bold">你的数据从哪来？</h2>
    <p className="mt-1 text-sm text-muted">选一个最像你的，之后可在“个人与数据”里改。</p>
    <div className="mt-3 grid gap-2">{WATCHES.map(([id, label]) => <button key={id} type="button" className="fk-chip min-h-14 flex-col items-start" aria-pressed={current === id} onClick={() => onPick(id)}><b>{label}</b><span className="text-xs text-muted">{GROUP_HINT[id]}</span></button>)}</div>
  </section>
}

/** 一键打卡：手表模式只问疲劳 + 疼痛；不戴表加睡眠（共 3 项）。 */
export function CheckinCard({ today, watch, onSaved, onPain }: { today: string; watch: WatchId; onSaved: () => void; onPain: () => void }) {
  const [c, setC] = useState<Checkin | null>(null)
  const [stamp, setStamp] = useState(0)
  useEffect(() => { if (today) setC(loadCheckins().find((x) => x.date === today) ?? null) }, [today])
  const set = (patch: Partial<Checkin>) => { setC(saveCheckin(today, patch)); setStamp(Date.now()); onSaved() }
  const noWatch = watch === "none"
  const sleepMissing=loadHealthSnapshot(today).metrics.find(m=>m.metric==='SLEEP')?.state!=='AVAILABLE'
  return <section className="fk-dash-card fk-subjective w-full p-2" aria-label="主观感受">
    <div className="flex items-center justify-between"><h2 className="fk-dash-title text-sm"><Smile className="size-4" />主观感受</h2><SavedBadge stamp={stamp} /></div>
    {noWatch || sleepMissing ? <Row label="自报睡眠"><>{SLEEP_CHIPS.map(([l, v]) => <button key={l} type="button" className="fk-chip" aria-pressed={c?.sleep === v} onClick={() => set({ sleep: v })}>{l} 小时</button>)}</></Row> : null}
    {!noWatch&&sleepMissing?<p className="mt-1 text-xs text-muted">当天睡眠未导入或待核对，可先自报；来源独立保存。</p>:null}
    <Row label="疲劳"><>{FATIGUE.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={c?.fatigue === id} onClick={() => set({ fatigue: id })}>{l}</button>)}</></Row>
    <Row label="疼痛"><>{PAIN.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={c?.pain === id} onClick={() => set({ pain: id })}>{l}</button>)}</></Row>
    {c?.pain && c.pain !== "none" ? <button type="button" className="fk-link mt-2 text-sm" onClick={onPain}>记下部位和程度 ›</button> : null}
  </section>
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-1.5 flex items-start gap-2"><p className="keep w-8 shrink-0 pt-1 text-xs text-muted">{label}</p><div className="flex flex-1 flex-wrap gap-1">{children}</div></div>
}

/** 每组一张简单的上传说明卡；组内选品牌只用于显示对应步骤。 */
const GROUP_STEPS: Record<WatchId, { title: string; steps: string[]; note: string }> = {
  none: { title: "无手表：每天 30 秒", steps: ["在“今日恢复”点 3 下：睡眠、疲劳、疼痛", "体重在“身体指标”里记，每周 2–3 次", "跑步和力量在训练页记录"], note: "没有数据时，方坤不会假设你恢复得很好。" },
  pro: { title: "专业运动手表：健康 + 训练明细", steps: [], note: "设备导入会检查相似活动；与日程尚未关联的记录分开分析，核对后再处理。" },
  basic: { title: "普通健康手表：健康指标 + 基础训练", steps: ["先导入已有健康和活动记录；详细分析以实际字段和质量为准，没有HRV也能使用", "力量训练在本应用里记"], note: "设备导入会检查相似活动；与日程尚未关联的记录分开分析，核对后再处理。" },
}
const BRAND_STEPS: Record<string, string[]> = {
  garmin: ["Garmin Connect 网页 → 活动 → 导出原始文件（FIT），拖到下方", "账户 → 数据管理 → 导出数据（ZIP）整包导入，含睡眠/HRV/静息心率", "如使用本应用的佳明账号同步，请核对登录地区、同步状态及每项数据日期；选择品牌不会自动登录"],
  coros: ["高驰 App → 运动记录 → 分享/导出 .fit，拖到下方", "健康数据可用 App 截图识别"],
  suunto: ["Suunto App → 运动 → 导出 FIT（或通过 Strava 下载原始文件）", "睡眠/HRV 可用 App 截图识别"],
  polar: ["Polar Flow 网页 → 训练 → 导出 FIT/TCX", "账户可导出全部数据（ZIP）"],
  apple: ["健康指标：iPhone“快捷指令”导出睡眠、静息心率、HRV、体重后上传；或 健康 App → 头像 → 导出所有健康数据（ZIP）", "训练：Apple Health 里的训练口径杂，建议用 GPX 或截图只取基础数据"],
  huawei: ["华为运动健康 App 截图（睡眠、心率、运动记录），在下方用截图识别", "iPhone 用户可经苹果健康 + 快捷指令导出"],
  xiaomi: ["小米运动健康 App 截图，在下方用截图识别", "iPhone 用户可经苹果健康 + 快捷指令导出"],
}
export function SourceGuide({ watch, onChange }: { watch: WatchId; onChange?: () => void }) {
  const [brand, setBrand] = useState<string | null>(null)
  useEffect(() => { setBrand(loadBrand()) }, [watch])
  const g = GROUP_STEPS[watch], brands = BRANDS[watch]
  const steps = [...(brand ? BRAND_STEPS[brand] ?? [] : []), ...g.steps]
  return <section className="home-card mb-3 p-4 text-sm" aria-label="上传说明">
    <h2 className="text-base font-bold">{g.title}</h2>
    {brands.length ? <div className="mt-2 flex flex-wrap gap-1.5">{brands.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={brand === id} onClick={() => { saveWatch(watch, undefined, id); setBrand(id); onChange?.() }}>{l}</button>)}</div> : null}
    {brands.length && !brand ? <p className="mt-2 text-xs text-muted">选一下品牌，显示对应步骤。</p> : null}
    <ol className="mt-2 list-decimal space-y-1 pl-5">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
    <p className="mt-2 text-xs text-muted">{g.note}</p>
  </section>
}
