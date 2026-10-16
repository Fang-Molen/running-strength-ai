import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { loadVitals } from "@/lib/nutrition/vitals"
import { loadExtras } from "@/lib/ui/device-store"
import { VERDICT_RULES, recoveryVerdict, type RecoveryInput } from "@/lib/ui/recovery-verdict"
import { RULES } from "@/lib/ui/day-schedule-rules"
import { SavedBadge } from "@/components/saved-badge"
import { FATIGUE, BRANDS, GROUP_HINT, PAIN, loadBrand, saveWatch, loadTier, gateRecovery, TIERS, TIER_LABEL, SLEEP_CHIPS, WATCHES, fatigueScore, freshness, loadCheckins, saveCheckin, watchLabel, type Checkin, type WatchId } from "@/lib/ui/watch-mode"

const avg = (xs: number[]) => xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
export function readRecoveryInput(today: string): RecoveryInput {
  const v = loadVitals().records, ex = loadExtras()
  const of = (k: string) => v.filter((r) => r.kind === k).sort((a, b) => a.observedOn.localeCompare(b.observedOn))
  const todayVal = (k: string) => of(k).filter((r) => r.observedOn === today).at(-1)?.value ?? null
  const base = (k: string) => avg(of(k).filter((r) => r.observedOn < today).slice(-7).map((r) => r.value))
  const ext = (m: string) => ex.filter((e) => e.metric === m && e.day === today).at(-1)?.value ?? null
  const ci = loadCheckins().find((c) => c.date === today)
  return { pain: ci?.pain ?? null, readiness: ext("READINESS"), bodyBattery: ext("BODY_BATTERY"), stress: ext("STRESS"), sleepBase: base("SLEEP"), hrv: todayVal("HRV"), hrvBase: base("HRV"), rhr: todayVal("RHR"), rhrBase: base("RHR"), subjective: todayVal("RECOVERY") ?? fatigueScore(ci?.fatigue), sleepH: todayVal("SLEEP") ?? ci?.sleep ?? null }
}

export function RecoveryVerdictCard({ today, revision, onImport, watch }: { today: string; revision: number; onImport: () => void; watch?: WatchId | null }) {
  const [input, setInput] = useState<RecoveryInput | null>(null)
  useEffect(() => { if (today) setInput(readRecoveryInput(today)) }, [today, revision])
  if (!input) return null
  const tier = loadTier()
  const v = recoveryVerdict(gateRecovery(tier, input))
  const depth = TIERS[tier].depth
  const tone = v.level === "go" ? "border-[#269775] bg-[#269775]/10" : v.level === "reduce" ? "border-[#e0a46b] bg-[#fdf3e8] dark:bg-transparent" : v.level === "watch" ? "border-[#e0c46b] bg-[#fdf9e8] dark:bg-transparent" : "border-line bg-surface-2"
  return <section aria-label="今日恢复" className={"mb-3 rounded-card border-2 p-4 " + tone}>
    <p className="product-eyebrow">今日恢复</p>
    <h2 className="mt-1 text-xl font-bold">{v.title}</h2>
    {depth >= 2 ? <p className="mt-1 text-sm">{v.reasons.join(" · ")}</p> : null}
    <p className="keep mt-1 text-xs text-muted">{v.level === "unknown" ? <button type="button" className="fk-link ml-1" onClick={onImport}>导入手表数据 ›</button> : null}</p>
    {watch && watch !== "none" ? <SourceLine watch={watch} revision={revision} onImport={onImport} /> : null}
    {depth >= 3 ? <p className="mt-1 text-[10px] text-muted">依据：HRV 较 7 天均值降 ≥{RULES.hrvDropPct}% 或准备度 &lt;{RULES.lowReadiness} 记为偏低；静息心率高 {VERDICT_RULES.rhrRise} 次以上、睡眠少 {RULES.sleepWorseHours} 小时以上记为留意。</p> : null}
    <p className="mt-1 text-[10px] text-muted">{TIER_LABEL[tier]}</p>
  </section>
}

/** 疼痛/伤病记录：部位、0–10、日期；P-03/P-07 提示。 */
const PAIN_KEY = "fk-pain-log-v1"
type Pain = { id: string; date: string; part: string; score: number; note: string }
export function PainLog({ today }: { today: string }) {
  const [list, setList] = useState<Pain[]>([])
  const [part, setPart] = useState(""), [score, setScore] = useState(3), [stamp, setStamp] = useState(0)
  useEffect(() => { try { setList(JSON.parse(localStorage.getItem(PAIN_KEY) ?? "[]")) } catch { setList([]) } }, [])
  const save = (next: Pain[]) => { setList(next); try { localStorage.setItem(PAIN_KEY, JSON.stringify(next.slice(-200))); setStamp(Date.now()) } catch { /* ignore */ } }
  const byPart = new Map<string, Pain[]>(); for (const p of list) byPart.set(p.part, [...(byPart.get(p.part) ?? []), p])
  const long = [...byPart.entries()].filter(([, ps]) => { const ds = ps.map((p) => p.date).sort(); return (Date.parse(ds.at(-1)!) - Date.parse(ds[0])) / 864e5 >= 14 && ds.at(-1)! >= today.slice(0, 8) })
  return <section className="home-card mt-3 p-4 text-sm" aria-label="疼痛与伤病">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">疼痛 / 伤病</h2><SavedBadge stamp={stamp} /></div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={part} onChange={(e) => setPart(e.target.value.slice(0, 12))} placeholder="部位，如 左膝外侧" className="fk-cell min-h-10 min-w-0 flex-1" aria-label="疼痛部位" />
      <label className="flex items-center gap-1 text-xs">程度<input type="range" min={0} max={10} value={score} onChange={(e) => setScore(+e.target.value)} aria-label="疼痛程度" /><b className="w-5">{score}</b></label>
      <button type="button" disabled={!part.trim()} className="fk-chip" onClick={() => { save([...list, { id: Math.random().toString(36).slice(2), date: today, part: part.trim(), score, note: "" }]); setPart("") }}><Plus className="size-3.5" />记下</button>
    </div>
    {score > 3 && part ? <p className="mt-1 text-xs text-[var(--color-risk)]">疼痛 &gt;3/10 或改变跑姿：停止引起疼痛的训练，48 小时内不做引起疼痛的动作；不缓解请就医。（手册 P-03【经验规则】）</p> : null}
    {long.map(([p]) => <p key={p} className="mt-1 rounded-lg border border-[var(--color-risk)] p-2 text-xs text-[var(--color-risk)]">「{p}」记录跨度已超过 14 天，建议找运动医学/康复专业人员检查。（手册 P-07）</p>)}
    {list.length ? <ul className="mt-2 divide-y divide-line">{[...list].reverse().slice(0, 6).map((p) => <li key={p.id} className="flex items-center justify-between py-1.5"><span>{p.date.slice(5)} · {p.part} · <b>{p.score}/10</b></span><button type="button" className="text-xs text-muted" onClick={() => save(list.filter((x) => x.id !== p.id))}>删除</button></li>)}</ul> : <p className="mt-2 text-xs text-muted">没有记录。</p>}
  </section>
}

export function lastDeviceSync(): string | null {
  return loadVitals().records.filter((r) => r.source === "DEVICE_CONFIRMED").map((r) => r.createdAt).sort().at(-1) ?? null
}
function SourceLine({ watch, revision, onImport }: { watch: WatchId; revision: number; onImport: () => void }) {
  const [f, setF] = useState<ReturnType<typeof freshness> | null>(null)
  useEffect(() => { setF(freshness(lastDeviceSync())) }, [revision])
  if (!f) return null
  return <p className={"mt-2 text-xs " + (f.stale ? "rounded-lg bg-[#fdf3e8] p-2 text-[#9a5b1e] dark:bg-transparent" : "text-muted")}>
    数据来自 {watchLabel(watch, loadBrand())} · {f.text}{f.stale ? <button type="button" className="fk-link ml-1 font-bold" onClick={onImport}>一键导入 ›</button> : null}
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
  return <section className="home-card mb-3 p-4" aria-label="今日打卡">
    <div className="flex items-center justify-between"><h2 className="text-base font-bold">{noWatch ? "今日打卡（30 秒）" : "手表测不到的，点一下"}</h2><SavedBadge stamp={stamp} /></div>
    {noWatch ? <Row label="昨晚睡了"><>{SLEEP_CHIPS.map(([l, v]) => <button key={l} type="button" className="fk-chip" aria-pressed={c?.sleep === v} onClick={() => set({ sleep: v })}>{l} 小时</button>)}</></Row> : null}
    <Row label="主观疲劳"><>{FATIGUE.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={c?.fatigue === id} onClick={() => set({ fatigue: id })}>{l}</button>)}</></Row>
    <Row label="疼痛"><>{PAIN.map(([id, l]) => <button key={id} type="button" className="fk-chip" aria-pressed={c?.pain === id} onClick={() => set({ pain: id })}>{l}</button>)}</></Row>
    {c?.pain && c.pain !== "none" ? <button type="button" className="fk-link mt-2 text-sm" onClick={onPain}>记下部位和程度 ›</button> : null}
  </section>
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-2"><p className="text-xs text-muted">{label}</p><div className="mt-1 flex flex-wrap gap-1.5">{children}</div></div>
}

/** 每组一张简单的上传说明卡；组内选品牌只用于显示对应步骤。 */
const GROUP_STEPS: Record<WatchId, { title: string; steps: string[]; note: string }> = {
  none: { title: "无手表：每天 30 秒", steps: ["在“今日恢复”点 3 下：睡眠、疲劳、疼痛", "体重在“身体指标”里记，每周 2–3 次", "跑步和力量在训练页记录"], note: "没有数据时，方坤不会假设你恢复得很好。" },
  pro: { title: "专业运动手表：健康 + 训练完整数据", steps: [], note: "同一次活动多处导入时，按开始时间（±2 分钟）和距离（±3%）自动去重。" },
  basic: { title: "普通健康手表：健康指标 + 基础训练", steps: ["训练只取距离、时长、心率（可导入文件或截图识别），不做配速/跑姿等细分析", "力量训练在本应用里记"], note: "同一次活动多处导入时，按开始时间（±2 分钟）和距离（±3%）自动去重。" },
}
const BRAND_STEPS: Record<string, string[]> = {
  garmin: ["Garmin Connect 网页 → 活动 → 导出原始文件（FIT），拖到下方", "账户 → 数据管理 → 导出数据（ZIP）整包导入，含睡眠/HRV/静息心率", "账号直连需佳明合作方审批，尚未开通；garmin.cn 与国际区账号不互通"],
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
