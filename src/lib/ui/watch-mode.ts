import { healthChanged } from "@/lib/health/observation"
/** 健康页两种模式：戴手表（只问手表测不到的）/ 不戴手表（极简手动打卡）。 */
export const WATCH_KEY = "fk-watch-v1"
export const WATCHES = [["none", "无手表"], ["pro", "专业运动手表"], ["basic", "普通健康手表"]] as const
export const GROUP_HINT: Record<string, string> = { none: "每天 30 秒手动打卡", pro: "佳明 / 高驰 COROS / 颂拓 Suunto / Polar：可导入健康与训练明细，完整度以实际数据为准", basic: "Apple Watch / 华为 / 小米：健康指标 + 基础训练数据" }
export const BRANDS: Record<string, readonly (readonly [string, string])[]> = { pro: [["garmin", "佳明"], ["coros", "高驰 COROS"], ["suunto", "颂拓 Suunto"], ["polar", "Polar"]], basic: [["apple", "Apple Watch"], ["huawei", "华为"], ["xiaomi", "小米"]], none: [] }
export type WatchId = (typeof WATCHES)[number][0]
const brandLabel = (b?: string | null) => Object.values(BRANDS).flat().find((x) => x[0] === b)?.[1]
export const watchLabel = (w: WatchId, brand?: string | null) => brandLabel(brand) ?? (w === "pro" ? "运动手表" : w === "basic" ? "健康手表" : "手动")
export const STALE_HOURS = 24
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const store = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage)
export function loadWatch(s: KV | null = store()): WatchId | null {
  try { const v = JSON.parse(s?.getItem(WATCH_KEY) ?? "null"); return WATCHES.some((x) => x[0] === v?.watch) ? v.watch : null } catch { return null }
}
export function loadBrand(s: KV | null = store()): string | null { try { return JSON.parse(s?.getItem(WATCH_KEY) ?? "null")?.brand ?? null } catch { return null } }
export function saveWatch(w: WatchId, s: KV | null = store(), brand: string | null = null) { s?.setItem(WATCH_KEY, JSON.stringify({ watch: w, tier: TIER_OF_GROUP[w], brand: BRANDS[w].some((x) => x[0] === brand) ? brand : null, at: new Date().toISOString() })); healthChanged() }
/** 专业表：训练完整明细；普通健康表：训练只取距离/时长/心率。 */
export const trainingDetail = (w: WatchId | null) => (w === "pro" ? "full" : w === "basic" ? "basic" : "manual")

/** 手表模式下这些指标由手表测，不允许手动输入。 */
export const WATCH_MEASURED = ["HRV", "RHR", "NIGHT_HR", "SLEEP"] as const
export function manualKinds(w: WatchId | null): string[] { return w && w !== "none" ? ["RECOVERY"] : ["SLEEP", "RECOVERY"] }

export function freshness(lastIso: string | null, now = new Date()): { stale: boolean; text: string } {
  if (!lastIso) return { stale: true, text: "还没有导入过手表数据" }
  const t = new Date(lastIso); const h = (now.getTime() - t.getTime()) / 3_600_000
  const p = (n: number) => String(n).padStart(2, "0")
  const when = `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
  return { stale: h > STALE_HOURS, text: h > STALE_HOURS ? `数据停在 ${when}，已超过 ${STALE_HOURS} 小时` : when }
}

/** 一键打卡：疲劳 / 疼痛（手表测不到）；不戴表再加睡眠。 */
export const CHECKIN_KEY = "fk-checkin-v1"
export const FATIGUE = [["fresh", "轻松", 8], ["ok", "一般", 6], ["tired", "很累", 3]] as const
export const PAIN = [["none", "不疼"], ["mild", "有点疼"], ["sharp", "明显疼"]] as const
export const SLEEP_CHIPS = [["<6", 5.5], ["6–7", 6.5], ["7–8", 7.5], [">8", 8.5]] as const
export type Checkin = { date: string; fatigue?: (typeof FATIGUE)[number][0]; pain?: (typeof PAIN)[number][0]; sleep?: number; recovery?: number; at: string }
export function loadCheckins(s: KV | null = store()): Checkin[] { try { const v = JSON.parse(s?.getItem(CHECKIN_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
export function saveCheckin(date: string, patch: Partial<Checkin>, s: KV | null = store()): Checkin {
  const all = loadCheckins(s).filter((c) => c.date !== date)
  const prev = loadCheckins(s).find((c) => c.date === date)
  const next = { ...prev, ...patch, date, at: new Date().toISOString() } as Checkin
  s?.setItem(CHECKIN_KEY, JSON.stringify([...all, next].slice(-120))); healthChanged(); return next
}
export const fatigueScore = (f?: Checkin["fatigue"]) => FATIGUE.find((x) => x[0] === f)?.[2] ?? null

/* ---------- 版本（需求深度）：基础 / 进阶 / 专业 ---------- */
export type Tier = "basic" | "plus" | "pro"
export const TIER_LABEL: Record<Tier, string> = { basic: "基础版", plus: "进阶版", pro: "专业版" }
export const TIER_OF_GROUP: Record<WatchId, Tier> = { none: "basic", basic: "plus", pro: "pro" }
export const TIERS: Record<Tier, { fields: string[]; tiles: string[]; analyses: string[]; depth: 1 | 2 | 3; desc: string }> = {
  basic: { fields: ["RECOVERY", "PAIN", "SLEEP_SELF", "WEIGHT"], tiles: ["RECOVERY", "WEIGHT"], analyses: ["checkin", "simpleAdvice"], depth: 1, desc: "打卡 + 主观状态 + 简单建议" },
  plus: { fields: ["RECOVERY", "PAIN", "WEIGHT", "SLEEP", "RHR"], tiles: ["SLEEP", "RHR", "RECOVERY", "WEIGHT"], analyses: ["checkin", "simpleAdvice", "recoveryVerdict", "trainingTrend"], depth: 2, desc: "+ 睡眠/静息心率恢复判断、基础训练趋势" },
  pro: { fields: ["RECOVERY", "PAIN", "WEIGHT", "SLEEP", "RHR", "HRV", "READINESS", "BODY_BATTERY", "STRESS"], tiles: ["READINESS", "SLEEP", "HRV", "RHR", "BODY_BATTERY", "STRESS", "RECOVERY", "WEIGHT"], analyses: ["checkin", "simpleAdvice", "recoveryVerdict", "trainingTrend", "trainingLoad", "runDynamics", "zones"], depth: 3, desc: "+ HRV、训练负荷、跑步动态、配速/心率区间、更细建议" },
}
export function loadTier(s: KV | null = store()): Tier {
  try { const v = JSON.parse(s?.getItem(WATCH_KEY) ?? "null"); if (v?.tier && v.tier in TIERS) return v.tier; if (v?.watch in TIER_OF_GROUP) return TIER_OF_GROUP[v.watch as WatchId] } catch { /* default */ }
  return "basic"
}
/** 手动升/降级；只改版本，不动数据来源。 */
export function saveTier(t: Tier, s: KV | null = store()) { let v: Record<string, unknown> = {}; try { v = JSON.parse(s?.getItem(WATCH_KEY) ?? "{}") ?? {} } catch { /* reset */ } s?.setItem(WATCH_KEY, JSON.stringify({ ...v, tier: t })) }
export const canShow = (t: Tier, analysis: string) => TIERS[t].analyses.includes(analysis)
/** 按版本过滤恢复判断的输入：未开放的字段不参与，也不会显示。 */
export function gateRecovery<T extends Record<string, unknown>>(t: Tier, i: T): T {
  const f = TIERS[t].fields, o: Record<string, unknown> = { ...i }
  const map: Record<string, string[]> = { HRV: ["hrv", "hrvBase"], RHR: ["rhr", "rhrBase"], SLEEP: ["sleepBase"], READINESS: ["readiness"], BODY_BATTERY: ["bodyBattery"], STRESS: ["stress"] }
  for (const [field, keys] of Object.entries(map)) if (!f.includes(field)) for (const k of keys) o[k] = null
  return o as T
}
