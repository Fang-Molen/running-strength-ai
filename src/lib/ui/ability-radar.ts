/**
 * 六方图（用户本人能力画像，不是方坤）。纯函数，只读已有数据：
 * - 日程 fk-schedule-v1 的 entries（status=done 且 actual.outcome≠missed 才算“练了”；actual.km/minutes/rpe 为实际值）
 * - 体征 fr255-vitals-v1（HRV / RHR / SLEEP）、设备补充 fk-device-extra-v1（BODY_BATTERY）
 * - 打卡 fk-checkin-v1（疲劳/疼痛/睡眠，基础版的恢复只能靠它）
 * 规则：窗口 = asOf 往前 28 天；任何维度都不从单次训练下结论（各有最少样本门槛），
 * 不够门槛 → status "pending"（待评估），score 为 null，绝不补数。
 * 置信度：样本数 + 数据来源（手动打卡上限为“低”）。
 */
import type { ScheduleEntry } from "./day-schedule-rules.ts"
import type { VitalRecord } from "../nutrition/vitals.ts"
import type { ExtraRow } from "./device-store.ts"
import type { Checkin, Tier } from "./watch-mode.ts"

export type AbilityKey = "strength" | "endurance" | "speed" | "recovery" | "stability" | "adherence"
export const ABILITY_ORDER: AbilityKey[] = ["strength", "endurance", "speed", "recovery", "stability", "adherence"]
export const ABILITY_LABEL: Record<AbilityKey, string> = { strength: "力量", endurance: "耐力", speed: "速度", recovery: "恢复", stability: "稳定性", adherence: "坚持度" }
export type Confidence = "高" | "中" | "低"
export type AbilityScore = {
  key: AbilityKey; label: string; status: "scored" | "pending"; score: number | null
  confidence: Confidence | null; samples: number; need: string; drivers: string[]; tip: string
}
export type AbilityInput = { entries: ScheduleEntry[]; vitals: VitalRecord[]; extras: ExtraRow[]; checkins: Checkin[]; tier: Tier; asOf: string }

export const WINDOW_DAYS = 28
const DAY = 864e5
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))
const r = (v: number) => Math.round(clamp(v))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
export const shiftDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10)
const inWindow = (d: string, asOf: string) => d <= asOf && d > shiftDay(asOf, -WINDOW_DAYS)
const conf = (n: number, mid: number, high: number): Confidence => (n >= high ? "高" : n >= mid ? "中" : "低")
const pending = (key: AbilityKey, samples: number, need: string, tip: string): AbilityScore => ({ key, label: ABILITY_LABEL[key], status: "pending", score: null, confidence: null, samples, need, drivers: [`近 ${WINDOW_DAYS} 天有效样本 ${samples}，${need}`], tip })
const scored = (key: AbilityKey, score: number, confidence: Confidence, samples: number, drivers: string[], tip: string): AbilityScore => ({ key, label: ABILITY_LABEL[key], status: "scored", score: r(score), confidence, samples, need: "", drivers, tip })

const did = (e: ScheduleEntry) => e.status === "done" && e.actual?.outcome !== "missed"
const minutesOf = (e: ScheduleEntry) => e.actual?.minutes ?? e.minutes
const kmOf = (e: ScheduleEntry) => (e.actual && e.actual.outcome !== "as_planned" ? e.actual.km ?? null : e.actual?.km ?? e.km ?? null)
const rpeOf = (e: ScheduleEntry) => (typeof e.actual?.rpe === "number" ? e.actual.rpe : null)
const hard = (e: ScheduleEntry) => { const p = rpeOf(e); return p != null ? p >= 7 : (e.actual?.intensity ?? e.intensity) !== "EASY" }
const fmtPace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`

/** 力量：S = 60·min(1, 每周力量次数/2.5) + 40·(中高强度占比，RPE≥7 或强度≠EASY)。门槛：≥3 次力量课。 */
function strength(done: ScheduleEntry[]): AbilityScore {
  const s = done.filter((e) => e.modality === "strength"); const n = s.length
  if (n < 3) return pending("strength", n, "至少 3 次力量课才评估", "这周先完成 2 次力量课，记得拖一下气力槽。")
  const perWeek = n / (WINDOW_DAYS / 7); const share = s.filter(hard).length / n
  return scored("strength", 60 * Math.min(1, perWeek / 2.5) + 40 * share, conf(n, 5, 8), n,
    [`力量课 ${n} 次，约 ${perWeek.toFixed(1)} 次/周（满分线 2.5）`, `中高强度占 ${Math.round(share * 100)}%`],
    perWeek < 2 ? "每周固定 2 次下肢+核心，比偶尔一次大练更涨力量。" : share < 0.5 ? "频率够了，每次挑 1 个主项做到 RPE 7–8。" : "保持频率，每 2 周给主项加一点重量。")
}

/** 耐力：E = 60·min(1, 周跑量/30km) + 40·min(1, 最长单次/15km)；无距离时用分钟（周 180 分、单次 90 分为满分线）。门槛：≥3 次跑步。 */
function endurance(runs: ScheduleEntry[]): AbilityScore {
  const n = runs.length
  if (n < 3) return pending("endurance", n, "至少 3 次跑步才评估", "先稳定每周 3 次轻松跑，距离不用长。")
  const kms = runs.map(kmOf).filter((x): x is number => typeof x === "number" && x > 0)
  const weeks = WINDOW_DAYS / 7
  if (kms.length >= 3) {
    const weekly = kms.reduce((a, b) => a + b, 0) / weeks; const longest = Math.max(...kms)
    return scored("endurance", 60 * Math.min(1, weekly / 30) + 40 * Math.min(1, longest / 15), conf(n, 6, 10), n,
      [`周均跑量 ${weekly.toFixed(1)} km（满分线 30）`, `最长一次 ${longest.toFixed(1)} km（满分线 15）`],
      longest < 10 ? "每周留 1 次长距离，每周最多加 1–2 km。" : "长距离已稳，周跑量每周增幅别超过 10%。")
  }
  const mins = runs.map(minutesOf); const weekly = mins.reduce((a, b) => a + b, 0) / weeks; const longest = Math.max(...mins)
  return scored("endurance", 60 * Math.min(1, weekly / 180) + 40 * Math.min(1, longest / 90), conf(n, 6, 10) === "高" ? "中" : "低", n,
    [`周均跑步 ${Math.round(weekly)} 分钟（无距离，按时间估）`, `最长一次 ${longest} 分钟`], "记录时顺手填公里数，耐力评估会更准。")
}

/** 速度：取有距离+时间(≥3km)的跑步，算配速；用最快 3 次的均值，7:30/km→0 分，4:00/km→100 分线性。门槛：≥3 次带配速的跑步。 */
function speed(runs: ScheduleEntry[]): AbilityScore {
  const paces = runs.map((e) => { const km = kmOf(e); const m = minutesOf(e); return km && km >= 3 && m > 0 ? (m * 60) / km : null }).filter((x): x is number => x != null).sort((a, b) => a - b)
  const n = paces.length
  if (n < 3) return pending("speed", n, "至少 3 次带距离和时间（≥3 km）的跑步", "跑完填上距离和用时，方坤才能算配速。")
  const best = mean(paces.slice(0, 3))
  return scored("speed", ((450 - best) / (450 - 240)) * 100, conf(n, 5, 8), n,
    [`最快 3 次平均配速 ${fmtPace(best)}`, `换算：7:30/km=0 分，4:00/km=100 分`],
    "每周 1 次节奏跑或间歇就够，其余跑轻松。")
}

/** 恢复（有表）：取 7 天以上数据，子项平均——睡眠 (h-5)/3·100；HRV 50+(近7天/28天均值-1)·250；静息心率 50-(近7天-28天均值)·10；Body Battery 近7天均值。
 *  恢复（基础版/无表）：打卡疲劳 轻松8/一般6/很累3 ×10 与手动睡眠均值；置信度最高“低”。门槛：≥7 天。 */
function recovery(inp: AbilityInput): AbilityScore {
  const { asOf, tier } = inp
  const last7 = (d: string) => d <= asOf && d > shiftDay(asOf, -7)
  const vit = inp.vitals.filter((v) => inWindow(v.observedOn, asOf))
  const of = (k: string) => vit.filter((v) => v.kind === k)
  const bb = inp.extras.filter((x) => x.metric === "BODY_BATTERY" && inWindow(x.day, asOf))
  const days = new Set([...vit.map((v) => v.observedOn), ...bb.map((x) => x.day)]).size
  const parts: { s: number; d: string }[] = []
  if (tier !== "basic" && days >= 7) {
    const sl = of("SLEEP"); if (sl.length >= 7) { const s7 = sl.filter((v) => last7(v.observedOn)).map((v) => v.value); const h = s7.length ? mean(s7) : mean(sl.map((v) => v.value)); parts.push({ s: clamp(((h - 5) / 3) * 100), d: `近 7 天睡眠 ${h.toFixed(1)} 小时` }) }
    const hv = of("HRV"); if (hv.length >= 7) { const a7 = mean(hv.filter((v) => last7(v.observedOn)).map((v) => v.value)); const a28 = mean(hv.map((v) => v.value)); if (a7) parts.push({ s: clamp(50 + (a7 / a28 - 1) * 250), d: `HRV 近 7 天 ${a7.toFixed(0)} ms，对比 28 天基线 ${a28.toFixed(0)} ms` }) }
    const rh = of("RHR"); if (rh.length >= 7) { const a7 = mean(rh.filter((v) => last7(v.observedOn)).map((v) => v.value)); const a28 = mean(rh.map((v) => v.value)); if (a7) parts.push({ s: clamp(50 - (a7 - a28) * 10), d: `静息心率近 7 天 ${a7.toFixed(0)}，基线 ${a28.toFixed(0)}` }) }
    if (tier === "pro" && bb.length >= 7) { const b7 = bb.filter((x) => last7(x.day)).map((x) => x.value); if (b7.length) parts.push({ s: clamp(mean(b7)), d: `Body Battery 近 7 天均值 ${mean(b7).toFixed(0)}` }) }
    if (parts.length) return scored("recovery", mean(parts.map((p) => p.s)), parts.length >= 3 && days >= 21 ? "高" : days >= 14 ? "中" : "低", days, parts.map((p) => p.d), parts[0].s < 50 ? "这周先把睡眠拉到 7 小时以上，再谈加量。" : "恢复跟得上，强度课前一晚别熬夜。")
  }
  const ck = inp.checkins.filter((c) => inWindow(c.date, asOf))
  const fat = ck.map((c): number | null => (c.fatigue === "fresh" ? 8 : c.fatigue === "ok" ? 6 : c.fatigue === "tired" ? 3 : null)).filter((x): x is number => x != null)
  const sl = ck.map((c) => c.sleep).filter((x): x is number => typeof x === "number")
  if (fat.length < 7) return pending("recovery", Math.max(days, fat.length), tier === "basic" ? "基础版靠每日打卡，至少 7 天" : "至少 7 天的睡眠/HRV/静息心率", tier === "basic" ? "每天花 30 秒打卡疲劳和睡眠，7 天后点亮恢复。" : "连续戴表睡 7 晚，恢复就能评估。")
  const p = [mean(fat) * 10]; const d = [`打卡 ${fat.length} 天，主观疲劳均值 ${mean(fat).toFixed(1)}/10`]
  if (sl.length >= 7) { p.push(clamp(((mean(sl) - 5) / 3) * 100)); d.push(`手动睡眠均值 ${mean(sl).toFixed(1)} 小时`) }
  d.push("来自手动打卡，置信度最高为低")
  return scored("recovery", mean(p), "低", fat.length, d, "感觉很累的日子主动换成轻松课，不算偷懒。")
}

/** 稳定性：已过日期、已有结果的计划课（done/skipped）中——F = 80·(按计划 + 0.5·有改动)/总数 + 20·(1 - 因疼痛偏离占比)。门槛：≥6 节。 */
function stability(resolved: ScheduleEntry[]): AbilityScore {
  const n = resolved.length
  if (n < 6) return pending("stability", n, "至少 6 节已结束的计划课", "接受方坤的课后照常记录，按计划或不同都要点一下。")
  const asPlan = resolved.filter((e) => e.status === "done" && e.actual?.outcome === "as_planned").length
  const diff = resolved.filter((e) => e.status === "done" && e.actual?.outcome === "different").length
  const pain = resolved.filter((e) => e.actual?.reasons.includes("pain")).length
  return scored("stability", 80 * ((asPlan + 0.5 * diff) / n) + 20 * (1 - pain / n), conf(n, 10, 16), n,
    [`${n} 节里按计划 ${asPlan}、有改动 ${diff}、未完成 ${n - asPlan - diff}`, pain ? `因疼痛偏离 ${pain} 次` : "无因疼痛偏离"],
    pain ? "疼痛偏离先处理，告诉方坤哪里疼再调课。" : diff > asPlan ? "计划常被改，可以让方坤把课排短一点。" : "执行很稳，可以小幅加难度。")
}

/** 坚持度：A = 60·(4 周中 ≥2 次训练的周数/4) + 40·min(1, 总次数/12)。门槛：≥4 次训练且最早记录距今 ≥14 天。 */
function adherence(done: ScheduleEntry[], asOf: string): AbilityScore {
  const n = done.length; const first = done.map((e) => e.date).sort()[0]
  if (n < 4 || !first || first > shiftDay(asOf, -14)) return pending("adherence", n, "至少 4 次训练且跨度满 2 周", "先连续练满 2 周，坚持度就会出现。")
  let weeks = 0
  for (let w = 0; w < 4; w++) { const hi = shiftDay(asOf, -7 * w), lo = shiftDay(asOf, -7 * (w + 1)); if (done.filter((e) => e.date <= hi && e.date > lo).length >= 2) weeks++ }
  return scored("adherence", 60 * (weeks / 4) + 40 * Math.min(1, n / 12), conf(n, 8, 12), n,
    [`近 4 周有 ${weeks} 周练了 2 次以上`, `共训练 ${n} 次（满分线 12）`], weeks < 4 ? "每周最少 2 次，哪怕只有 20 分钟。" : "节奏很好，保持就是进步。")
}

export function computeAbilities(inp: AbilityInput): AbilityScore[] {
  const win = inp.entries.filter((e) => inWindow(e.date, inp.asOf) && e.modality !== "rest")
  const done = win.filter(did)
  const runs = done.filter((e) => e.modality === "run")
  const resolved = win.filter((e) => !e.unplanned && (e.status === "done" || e.status === "skipped"))
  const map: Record<AbilityKey, AbilityScore> = { strength: strength(done), endurance: endurance(runs), speed: speed(runs), recovery: recovery(inp), stability: stability(resolved), adherence: adherence(done, inp.asOf) }
  return ABILITY_ORDER.map((k) => map[k])
}

/** 当前 vs 30 天前（同一套公式，asOf 往前推 30 天）。 */
export function abilityComparison(inp: AbilityInput) {
  return { now: computeAbilities(inp), before: computeAbilities({ ...inp, asOf: shiftDay(inp.asOf, -30) }) }
}
