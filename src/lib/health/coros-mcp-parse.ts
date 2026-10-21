/** v89.10：高驰官方 MCP 工具返回的解析（服务端与测试共用，纯函数）。
 * 依据 github.com/coroslab/COROS-MCP docs/en/tools.md：多数工具返回文字（非 JSON），格式未正式约定。
 * 原则：先试 JSON，再按文字逐行宽松匹配；认不出的字段一律 null，不补 0、不猜；整段认不出记入 issues（界面显示“待核”）。 */
export type McpToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }
export type Parsed<T> = { value: T; issues: string[]; raw: string }
const RAW_MAX = 6000
export function toolText(res: McpToolResult | null | undefined): string {
  return (res?.content ?? []).filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n')
}
export function toolJson(res: McpToolResult | null | undefined): unknown {
  if (res?.structuredContent && typeof res.structuredContent === 'object') return res.structuredContent
  const t = toolText(res).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  if (!/^[[{]/.test(t)) return null
  try { return JSON.parse(t) } catch { return null }
}
const lc = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[_\s-]/g, ''), v]))
const pick = (o: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) { const v = o[k]; if (v !== undefined && v !== null && v !== '') return v } return null }
export const num = (v: unknown): number | null => typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null
const inRange = (v: number | null, lo: number, hi: number) => v != null && v >= lo && v <= hi ? v : null
/** “2:12:38” / “52:10” → 秒 */
export function clockSec(s: string | null | undefined): number | null {
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec((s ?? '').trim()); if (!m) return null
  return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]
}
/** “7h 57min” / “7小时57分” / “57 min” → 分钟 */
export function hmMinutes(s: string): number | null {
  const m = /(?:(\d+)\s*(?:h|hr|hours?|小时))?\s*(?:(\d+)\s*(?:m|min|mins|minutes?|分钟|分))?/i.exec(s.trim())
  if (!m || (m[1] == null && m[2] == null)) return null
  return (m[1] ? +m[1] * 60 : 0) + (m[2] ? +m[2] : 0)
}
/** epoch 秒/毫秒 → 带时区 ISO；“yyyy-MM-dd HH:mm(:ss)” → 原样本地时间字符串（时区未知，标 zoned=false）。 */
export function timeOf(v: unknown): { iso: string | null; local: string | null; zoned: boolean } {
  const n = num(v)
  if (n != null) {
    if (n > 1e12 && n < 4e12) return { iso: new Date(n).toISOString(), local: null, zoned: true }
    if (n > 1e9 && n < 4e9) return { iso: new Date(n * 1000).toISOString(), local: null, zoned: true }
    return { iso: null, local: null, zoned: false }
  }
  if (typeof v !== 'string') return { iso: null, local: null, zoned: false }
  const s = v.trim()
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)$/.test(s) && Number.isFinite(Date.parse(s))) return { iso: new Date(s).toISOString(), local: null, zoned: true }
  const m = /^(\d{4})[-/](\d\d)[-/](\d\d)[ T](\d\d):(\d\d)(?::(\d\d))?$/.exec(s)
  if (m) return { iso: null, local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`, zoned: false }
  return { iso: null, local: null, zoned: false }
}
const ymd8 = (s: string) => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
const dateOf = (v: unknown): string | null => { const s = String(v ?? '').trim(); if (/^\d{4}-\d\d-\d\d/.test(s)) return s.slice(0, 10); return ymd8(s) }
/** 在任意嵌套 JSON 里找第一个对象数组（满足 test）。 */
export function findList(x: unknown, test: (o: Record<string, unknown>) => boolean, depth = 0): Record<string, unknown>[] | null {
  if (depth > 5 || x == null) return null
  if (Array.isArray(x)) { if (x.length && x[0] && typeof x[0] === 'object' && !Array.isArray(x[0]) && test(x[0] as Record<string, unknown>)) return x as Record<string, unknown>[]; for (const v of x) { const r = findList(v, test, depth + 1); if (r) return r } return null }
  if (typeof x === 'object') for (const v of Object.values(x as object)) { const r = findList(v, test, depth + 1); if (r && r.length) return r }
  return null
}

// ---------- 活动列表 querySportRecords ----------
export type McpActivity = { labelId: string | null; sportType: number | null; sportName: string | null; date: string | null; startIso: string | null; startLocal: string | null; durationSec: number | null; distanceM: number | null; avgHr: number | null; maxHr: number | null; calories: number | null; issues: string[] }
function activityFromObj(raw: Record<string, unknown>): McpActivity {
  const o = lc(raw), issues: string[] = []
  const id = pick(o, 'labelid', 'activityid', 'recordid', 'id'), st = num(pick(o, 'sporttype', 'sporttypecode', 'sportcode', 'mode'))
  const t = timeOf(pick(o, 'starttime', 'starttimestamp', 'begintime', 'starttimelocal', 'start'))
  const km = num(pick(o, 'distancekm')), dm = num(pick(o, 'distancem', 'distancemeters'))
  const durRaw = pick(o, 'durationsec', 'durationseconds', 'totaltime', 'workouttime', 'duration', 'time')
  const dur = typeof durRaw === 'string' && durRaw.includes(':') ? clockSec(durRaw) : num(durRaw)
  if (km == null && dm == null && pick(o, 'distance') != null) issues.push('距离单位未注明（待核），未使用')
  const a: McpActivity = { labelId: id != null ? String(id) : null, sportType: st, sportName: typeof pick(o, 'sportname', 'sport', 'name') === 'string' ? String(pick(o, 'sportname', 'sport', 'name')).slice(0, 40) : null,
    date: dateOf(pick(o, 'date', 'day', 'happenday')) ?? (t.iso ?? t.local)?.slice(0, 10) ?? null, startIso: t.iso, startLocal: t.local, durationSec: inRange(dur, 1, 172800),
    distanceM: km != null ? inRange(Math.round(km * 1000), 1, 500000) : inRange(dm, 1, 500000), avgHr: inRange(num(pick(o, 'avghr', 'averageheartrate', 'avgheartrate')), 25, 240), maxHr: inRange(num(pick(o, 'maxhr', 'maxheartrate')), 25, 240), calories: null, issues }
  if (!a.labelId) issues.push('缺少活动标识（labelId），不能保存')
  return a
}
function activityFromText(block: string): McpActivity {
  const issues: string[] = [], g = (re: RegExp) => re.exec(block)?.[1]?.trim() ?? null
  const head = /^\s*\d+\.\s*([^\n(]+?)\s*\((\d+)\)\s*[—–-]+\s*(\d{4}-\d\d-\d\d)(?:\s+(\d\d:\d\d(?::\d\d)?))?/m.exec(block)
  const labelId = g(/label\s*id\s*[:：]\s*([0-9A-Za-z_-]{1,40})/i) ?? g(/活动(?:标识|ID)\s*[:：]\s*([0-9A-Za-z_-]{1,40})/i)
  const st = num(g(/sport\s*type(?:\s*code)?\s*[:：]\s*(\d+)/i) ?? g(/运动类型(?:码|代码)?\s*[:：]\s*(\d+)/)) ?? (head ? +head[2] : null)
  const startRaw = g(/start(?:\s*time)?\s*[:：]\s*(\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:?\d\d)?)/i) ?? g(/开始(?:时间)?\s*[:：]\s*(\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?)/) ?? (head?.[4] ? `${head[3]} ${head[4]}` : null)
  const epoch = g(/start\s*timestamp\s*[:：]\s*(\d{10,13})/i), t = timeOf(epoch != null ? +epoch : startRaw)
  const distKm = num(g(/distance\s*[:：]\s*([\d.]+)\s*km/i) ?? g(/距离\s*[:：]\s*([\d.]+)\s*(?:km|公里)/i)), distM = num(g(/distance\s*[:：]\s*([\d.]+)\s*m\b/i))
  const dur = clockSec(g(/(?:duration|workout\s*time|用时|时长)\s*[:：]\s*(\d{1,3}:\d\d(?::\d\d)?)/i))
  const a: McpActivity = { labelId, sportType: st, sportName: head?.[1]?.trim().slice(0, 40) ?? null, date: head?.[3] ?? (t.iso ?? t.local)?.slice(0, 10) ?? null, startIso: t.iso, startLocal: t.local,
    durationSec: inRange(dur, 1, 172800), distanceM: distKm != null ? inRange(Math.round(distKm * 1000), 1, 500000) : inRange(distM, 1, 500000),
    avgHr: inRange(num(g(/(?:average|avg)\s*heart\s*rate\s*[:：]\s*(\d+)/i) ?? g(/平均心率\s*[:：]\s*(\d+)/)), 25, 240), maxHr: inRange(num(g(/max(?:imum)?\s*heart\s*rate\s*[:：]\s*(\d+)/i) ?? g(/最大心率\s*[:：]\s*(\d+)/)), 25, 240), calories: null, issues }
  if (!labelId) issues.push('文字里没有找到活动标识（labelId），不能保存（待核）')
  if (!t.iso && !t.local) issues.push('没有找到开始时刻，只有日期（待核）')
  return a
}
export function parseSportRecords(res: McpToolResult): Parsed<McpActivity[]> {
  const raw = toolText(res).slice(0, RAW_MAX), j = toolJson(res), issues: string[] = []
  if (j) {
    const list = findList(j, o => Object.keys(o).some(k => /label|id|sport/i.test(k)))
    if (list) return { value: list.slice(0, 200).map(activityFromObj), issues, raw }
    if (Array.isArray(j) && !j.length) return { value: [], issues, raw }
  }
  const text = toolText(res)
  if (/\(0 records?\)|no (matching )?(sport )?records|没有.*记录|暂无/i.test(text)) return { value: [], issues, raw }
  const blocks = text.split(/\n(?=\s*\d+\.\s)/).filter(b => /^\s*\d+\.\s/.test(b))
  if (!blocks.length) { if (text.trim()) issues.push('活动列表格式认不出（待核）'); return { value: [], issues, raw } }
  return { value: blocks.slice(0, 200).map(activityFromText), issues, raw }
}

// ---------- 分圈 queryActivityLapData（文档示例为 JSON） ----------
export type McpLap = { index: number | null; timeSec: number | null; distanceRaw: number | null; paceSecPerKm: number | null; avgHr: number | null; maxHr: number | null; avgCadence: number | null }
export function parseLaps(res: McpToolResult): Parsed<McpLap[]> {
  const raw = toolText(res).slice(0, RAW_MAX), j = toolJson(res)
  const list = j ? findList(j, o => Object.keys(o).some(k => /lap|time|distance/i.test(k)) && !Array.isArray((o as Record<string, unknown>).laps)) : null
  if (!list) return { value: [], issues: [raw.trim() ? '分圈格式认不出（待核）' : '没有分圈数据'], raw }
  return { value: list.slice(0, 300).map(r => { const o = lc(r); return { index: num(o.lapindex), timeSec: inRange(num(o.time), 0, 172800), distanceRaw: num(o.distance), paceSecPerKm: inRange(num(o.avgpace), 60, 3600), avgHr: inRange(num(o.avghr), 25, 240), maxHr: inRange(num(o.maxhr), 25, 240), avgCadence: inRange(num(o.avgcadence), 1, 300) } }),
    issues: ['分圈距离单位文档未注明（示例 100000 疑为厘米），只显示原值（待核）'], raw }
}

// ---------- 日级健康 ----------
export type McpDay = { date: string; sleepMinutes?: number | null; sleepScore?: number | null; sleepStart?: string | null; sleepEnd?: string | null; hrvMs?: number | null; restingHr?: number | null; steps?: number | null; activeKcal?: number | null; avgStress?: number | null }
/** 文字按“日期行”分段：遇到以 yyyy-MM-dd 开头（或“日期: yyyy-MM-dd”）的行就开始新的一天。 */
function dateBlocks(text: string): [string, string][] {
  const out: [string, string][] = []; let cur: string | null = null, buf: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?(?:date\s*[:：]\s*|日期\s*[:：]\s*)?(\d{4}-\d\d-\d\d)\b(.*)$/i.exec(line)
    if (m && !/window|窗口/i.test(line)) { if (cur) out.push([cur, buf.join('\n')]); cur = m[1]; buf = [m[2]]; continue }
    if (cur) buf.push(line)
  }
  if (cur) out.push([cur, buf.join('\n')])
  return out
}
const val = (b: string, re: RegExp) => num(re.exec(b)?.[1])
function mergeDays(target: Map<string, McpDay>, date: string, patch: Partial<McpDay>) {
  const d = target.get(date) ?? { date }
  for (const [k, v] of Object.entries(patch)) if (v != null) (d as Record<string, unknown>)[k] = v
  target.set(date, d)
}
function daysFromJson(j: unknown, map: (o: Record<string, unknown>) => Partial<McpDay>): [string, Partial<McpDay>][] | null {
  const list = findList(j, o => Object.keys(o).some(k => /date|day/i.test(k))); if (!list) return null
  return list.flatMap(r => { const o = lc(r), d = dateOf(pick(o, 'date', 'day', 'happenday', 'sleepdate', 'wakeupdate')); return d ? [[d, map(o)] as [string, Partial<McpDay>]] : [] })
}
export type HealthTool = 'querySleepOverview' | 'querySleepHrv' | 'queryRestingHeartRate' | 'queryDailyHealthData'
/** 把一个日级工具的返回并入 days；返回本工具的 issues。 */
export function parseDailyTool(tool: HealthTool, res: McpToolResult, days: Map<string, McpDay>): string[] {
  const issues: string[] = [], j = toolJson(res), text = toolText(res); let hit = 0
  const jsonMap: Record<HealthTool, (o: Record<string, unknown>) => Partial<McpDay>> = {
    querySleepOverview: o => ({ sleepScore: inRange(num(pick(o, 'sleepscore', 'score')), 0, 100), sleepMinutes: inRange(num(pick(o, 'dailysleepminutes', 'sleepminutes', 'totalsleepminutes')), 0, 1440) }),
    querySleepHrv: o => ({ hrvMs: inRange(num(pick(o, 'avghrv', 'averagehrv', 'hrv', 'dailyhrv')), 1, 500) }),
    queryRestingHeartRate: o => ({ restingHr: inRange(num(pick(o, 'restinghr', 'restingheartrate', 'rhr', 'value')), 25, 200) }),
    queryDailyHealthData: o => ({ steps: inRange(num(pick(o, 'steps', 'stepcount')), 0, 250000), activeKcal: inRange(num(pick(o, 'activecalories', 'activekcal', 'activeenergy')), 0, 20000), avgStress: inRange(num(pick(o, 'avgstress', 'averagestress', 'stress')), 0, 100) }),
  }
  const fromJ = j ? daysFromJson(j, jsonMap[tool]) : null
  if (fromJ) { for (const [d, p] of fromJ) { mergeDays(days, d, p); hit++ } }
  else for (const [d, b] of dateBlocks(text)) {
    let p: Partial<McpDay> = {}
    if (tool === 'querySleepOverview') {
      const win = /(?:main\s*sleep\s*window|主睡眠(?:时间|窗口)?)\s*[:：]\s*(\d{4}-\d\d-\d\d \d\d:\d\d)\s*[-–~至]\s*(\d{4}-\d\d-\d\d \d\d:\d\d)/i.exec(b)
      const daily = /(?:daily\s*sleep|当日睡眠|睡眠时长|总睡眠)\s*[:：]\s*([^\n(（]+)/i.exec(b)
      p = { sleepScore: inRange(val(b, /(?:sleep\s*score|睡眠(?:评分|分数))\s*[:：]\s*(\d+)/i), 0, 100), sleepMinutes: daily ? inRange(hmMinutes(daily[1]), 0, 1440) : null, sleepStart: win ? win[1].replace(' ', 'T') : null, sleepEnd: win ? win[2].replace(' ', 'T') : null }
    } else if (tool === 'querySleepHrv') p = { hrvMs: inRange(val(b, /(?:(?:daily\s*)?(?:average|avg)\s*hrv|hrv(?:\s*average)?|平均\s*HRV|HRV\s*均值)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*ms/i) ?? val(b, /^\s*[:：]?\s*(\d+(?:\.\d+)?)\s*ms/), 1, 500) }
    else if (tool === 'queryRestingHeartRate') p = { restingHr: inRange(val(b, /(?:resting\s*heart\s*rate|resting\s*hr|静息心率)?\s*[:：]?\s*(\d+)\s*bpm/i), 25, 200) }
    else p = { steps: inRange(num(/(?:steps|步数)\s*[:：]\s*([\d,]+)/i.exec(b)?.[1]?.replace(/,/g, '')), 0, 250000), activeKcal: inRange(val(b, /(?:active\s*calories|活动(?:热量|卡路里))\s*[:：]\s*(\d+(?:\.\d+)?)/i), 0, 20000), avgStress: inRange(val(b, /(?:(?:average|avg)\s*stress|平均压力)\s*[:：]\s*(\d+)/i), 0, 100) }
    if (Object.values(p).some(v => v != null)) { mergeDays(days, d, p); hit++ }
  }
  if (!hit && text.trim()) issues.push(`${tool}：返回格式认不出（待核）`)
  return issues
}
// ---------- 压力日内序列 queryStressTimeSeries ----------
export type StressPoint = { local: string | null; iso: string | null; value: number }
export function parseStressSeries(res: McpToolResult): Parsed<StressPoint[]> {
  const raw = toolText(res).slice(0, RAW_MAX), j = toolJson(res), out: StressPoint[] = []
  const list = j ? findList(j, o => Object.keys(o).some(k => /stress|value/i.test(k))) : null
  if (list) for (const r of list) { const o = lc(r), t = timeOf(pick(o, 'timestamp', 'time', 'measuretime', 'datetime')), v = inRange(num(pick(o, 'stress', 'value', 'stresslevel')), 0, 100); if (v != null && (t.iso || t.local)) out.push({ iso: t.iso, local: t.local, value: v }) }
  else { let day: string | null = null
    for (const line of toolText(res).split(/\r?\n/)) {
      const d = /^\s*(?:date\s*[:：]\s*)?(\d{4}-\d\d-\d\d)\s*$/i.exec(line); if (d) { day = d[1]; continue }
      const m = /(?:(\d{4}-\d\d-\d\d)[ T])?(\d\d:\d\d)(?::\d\d)?\D{0,12}?(\d{1,3})\b/.exec(line)
      if (m && (m[1] || day)) { const v = inRange(+m[3], 0, 100); if (v != null) out.push({ local: `${m[1] ?? day}T${m[2]}:00`, iso: null, value: v }) }
    } }
  out.sort((a, b) => (a.iso ?? a.local ?? '').localeCompare(b.iso ?? b.local ?? ''))
  return { value: out.slice(0, 3000), issues: !out.length && raw.trim() ? ['压力日内序列格式认不出（待核）'] : [], raw }
}
// ---------- 当前恢复 queryRecoveryStatus ----------
export type Recovery = { percent: number | null; level: string | null; fullRecoveryText: string | null }
export function parseRecovery(res: McpToolResult): Parsed<Recovery> {
  const raw = toolText(res).slice(0, RAW_MAX), j = toolJson(res)
  if (j && typeof j === 'object' && !Array.isArray(j)) { const o = lc(j as Record<string, unknown>); return { value: { percent: inRange(num(pick(o, 'recoverypercent', 'recoverypct', 'recovery', 'percent')), 0, 100), level: typeof pick(o, 'level', 'recoverylevel') === 'string' ? String(pick(o, 'level', 'recoverylevel')).slice(0, 40) : null, fullRecoveryText: null }, issues: [], raw } }
  const t = toolText(res)
  const pct = inRange(num(/(?:recovery|恢复)[^\n%]{0,30}?(\d{1,3}(?:\.\d+)?)\s*%/i.exec(t)?.[1] ?? /(\d{1,3}(?:\.\d+)?)\s*%/.exec(t)?.[1]), 0, 100)
  const level = /(?:level|状态|等级)\s*[:：]\s*([^\n|]{1,40})/i.exec(t)?.[1]?.trim() ?? null
  const full = /(?:full(?:y)?\s*recover\w*|完全恢复)[^\n]{0,60}/i.exec(t)?.[0]?.trim().slice(0, 80) ?? null
  return { value: { percent: pct, level, fullRecoveryText: full }, issues: pct == null && t.trim() ? ['恢复状态格式认不出（待核）'] : [], raw }
}
