/**
 * Local-only device data parsing (FIT / GPX / TCX / CSV / Garmin export ZIP / Apple Health ZIP / OCR text).
 * Nothing here talks to a vendor API. Every parsed row must be confirmed by the user before saving.
 */
export type DeviceActivity = {
  key: string
  source: string
  sport: "RUNNING" | "STRENGTH" | "MIXED" | "UNKNOWN"
  sportLabel: string
  startIso: string | null
  durationSec: number | null
  distanceM: number | null
  avgHr: number | null
  maxHr: number | null
  calories: number | null
  avgCadence: number | null
  avgPower: number | null
  verticalOscMm: number | null
  groundContactMs: number | null
  sets: { name: string; reps: number | null; weightKg: number | null; durationSec: number | null }[]
}
export type HealthMetric = "RHR" | "HRV" | "SLEEP" | "WEIGHT" | "BODY_BATTERY" | "READINESS" | "STRESS"
export type DeviceHealthRow = { key: string; source: string; metric: HealthMetric; day: string; value: number }
export type DeviceParseResult = { kind: string; brand: string; activities: DeviceActivity[]; health: DeviceHealthRow[]; notes: string[] }

export const METRIC_LABELS: Record<HealthMetric, string> = { RHR: "静息心率", HRV: "HRV", SLEEP: "睡眠", WEIGHT: "体重", BODY_BATTERY: "身体电量", READINESS: "训练准备度", STRESS: "压力" }
export const METRIC_UNITS: Record<HealthMetric, string> = { RHR: "次/分", HRV: "ms", SLEEP: "小时", WEIGHT: "kg", BODY_BATTERY: "/100", READINESS: "/100", STRESS: "/100" }
const RANGE: Record<HealthMetric, [number, number]> = { RHR: [30, 120], HRV: [1, 300], SLEEP: [0.5, 16], WEIGHT: [30, 250], BODY_BATTERY: [0, 100], READINESS: [0, 100], STRESS: [0, 100] }

const r1 = (n: number) => Math.round(n * 10) / 10
function okMetric(metric: HealthMetric, value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= RANGE[metric][0] && value <= RANGE[metric][1]
}
function health(source: string, metric: HealthMetric, day: string, value: number): DeviceHealthRow {
  const v = metric === "RHR" || metric === "HRV" || metric === "BODY_BATTERY" || metric === "READINESS" || metric === "STRESS" ? Math.round(value) : r1(value)
  return { key: `${metric}:${day}`, source, metric, day, value: v }
}
export function activityKey(startIso: string | null, distanceM: number | null, durationSec: number | null): string {
  const t = startIso ? new Date(startIso).toISOString().slice(0, 16) : "na"
  return `${t}|${distanceM == null ? "-" : Math.round(distanceM / 50)}|${durationSec == null ? "-" : Math.round(durationSec / 60)}`
}
function emptyActivity(source: string): DeviceActivity {
  return { key: "", source, sport: "UNKNOWN", sportLabel: "未知", startIso: null, durationSec: null, distanceM: null, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }
}
function sportFrom(text: string): [DeviceActivity["sport"], string] {
  const t = text.toLowerCase()
  if (/run|跑|treadmill|track/.test(t)) return ["RUNNING", "跑步"]
  if (/strength|力量|weight|training|fitness_equipment|健身/.test(t)) return ["STRENGTH", "力量"]
  if (/walk|步行|hik|徒步/.test(t)) return ["UNKNOWN", "步行"]
  if (/cycl|bik|骑/.test(t)) return ["UNKNOWN", "骑行"]
  return ["UNKNOWN", text || "未知"]
}
function finish(a: DeviceActivity): DeviceActivity {
  a.key = activityKey(a.startIso, a.distanceM, a.durationSec)
  return a
}

/* ---------------- FIT ---------------- */
const FIT_EPOCH = Date.UTC(1989, 11, 31) / 1000
const FIT_SPORTS: Record<number, string> = { 0: "通用", 1: "running", 2: "cycling", 4: "fitness_equipment", 5: "swimming", 10: "training", 11: "walking", 17: "hiking" }
type FitMsg = { num: number; f: Record<number, number | string | null> }
type FitDef = { num: number; le: boolean; fields: { n: number; size: number; t: number }[]; devSize: number }
const BASE: Record<number, [number, number | null]> = { 0: [1, 0xff], 1: [1, 0x7f], 2: [1, 0xff], 3: [2, 0x7fff], 4: [2, 0xffff], 5: [4, 0x7fffffff], 6: [4, 0xffffffff], 7: [1, null], 8: [4, null], 9: [8, null], 10: [1, 0], 11: [2, 0], 12: [4, 0], 13: [1, 0xff], 14: [8, null], 15: [8, null], 16: [8, null] }
function readVal(dv: DataView, off: number, size: number, t: number, le: boolean): number | string | null {
  const bt = t & 0x1f
  const [bsize, invalid] = BASE[bt] ?? [1, null]
  if (bt === 7) {
    let s = ""; for (let i = 0; i < size; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c) }
    try { return decodeURIComponent(escape(s)) } catch { return s }
  }
  if (size < bsize) return null
  let v: number
  switch (bt) {
    case 1: v = dv.getInt8(off); break
    case 3: v = dv.getInt16(off, le); break
    case 4: case 11: v = dv.getUint16(off, le); break
    case 5: v = dv.getInt32(off, le); break
    case 6: case 12: v = dv.getUint32(off, le); break
    case 8: v = dv.getFloat32(off, le); break
    case 9: v = dv.getFloat64(off, le); break
    case 14: case 15: case 16: v = Number(dv.getBigUint64(off, le)); break
    default: v = dv.getUint8(off)
  }
  if (invalid != null && v === invalid) return null
  return v
}
export function isFit(bytes: Uint8Array): boolean {
  return bytes.length > 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54
}
export function decodeFit(bytes: Uint8Array): FitMsg[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const hsize = bytes[0]
  const dataSize = dv.getUint32(4, true)
  const end = Math.min(bytes.length, hsize + dataSize)
  const defs: Record<number, FitDef> = {}
  const out: FitMsg[] = []
  let p = hsize
  let lastTs = 0
  while (p < end) {
    const h = bytes[p++]
    if (h & 0x80) {
      const def = defs[(h >> 5) & 3]; if (!def) break
      const msg = readData(def)
      const off = h & 0x1f
      lastTs = (lastTs & ~0x1f) + off + (off < (lastTs & 0x1f) ? 0x20 : 0)
      if (msg.f[253] == null) msg.f[253] = lastTs
      out.push(msg); continue
    }
    const local = h & 0x0f
    if (h & 0x40) {
      const le = bytes[p + 1] === 0
      const num = le ? dv.getUint16(p + 2, true) : dv.getUint16(p + 2, false)
      const n = bytes[p + 4]; p += 5
      const fields = []
      for (let i = 0; i < n; i++) { fields.push({ n: bytes[p], size: bytes[p + 1], t: bytes[p + 2] }); p += 3 }
      let devSize = 0
      if (h & 0x20) { const dn = bytes[p++]; for (let i = 0; i < dn; i++) { devSize += bytes[p + 1]; p += 3 } }
      defs[local] = { num, le, fields, devSize }
    } else {
      const def = defs[local]; if (!def) break
      const msg = readData(def)
      if (typeof msg.f[253] === "number") lastTs = msg.f[253] as number
      out.push(msg)
    }
  }
  return out
  function readData(def: FitDef): FitMsg {
    const f: FitMsg["f"] = {}
    for (const fd of def.fields) { f[fd.n] = p + fd.size <= bytes.length ? readVal(dv, p, fd.size, fd.t, def.le) : null; p += fd.size }
    p += def.devSize
    return { num: def.num, f }
  }
}
const fitTime = (v: unknown) => typeof v === "number" ? new Date((v + FIT_EPOCH) * 1000).toISOString() : null
const num = (v: unknown, scale = 1) => typeof v === "number" ? v / scale : null
// A few common Garmin exercise categories (FIT profile exercise_category). Unknown ids are shown as 动作#id.
const EX_CAT: Record<number, string> = { 0: "卧推", 1: "提踵", 2: "卡迪奥", 3: "划船/拉", 4: "卷腹", 5: "弯举", 7: "核心", 8: "硬拉", 10: "飞鸟", 11: "髋部", 12: "髋稳定", 13: "臀桥/髋伸", 15: "跳跃", 17: "弓步", 18: "平板", 21: "引体", 22: "俯卧撑", 23: "划船", 24: "推举", 25: "肩稳定", 26: "耸肩", 27: "仰卧起坐", 28: "深蹲", 30: "臂屈伸" }
export function parseFit(bytes: Uint8Array, source = "FIT"): DeviceParseResult {
  const msgs = decodeFit(bytes)
  const fileId = msgs.find((m) => m.num === 0)
  const brand = fileId?.f[1] === 1 ? "Garmin" : fileId?.f[1] === 294 ? "COROS" : fileId?.f[1] === 255 ? "开发者" : fileId?.f[1] != null ? `厂商#${fileId.f[1]}` : "未知"
  const notes: string[] = []
  const healthRows: DeviceHealthRow[] = []
  const activities: DeviceActivity[] = []
  const sets = msgs.filter((m) => m.num === 225 && m.f[5] === 1).map((m) => {
    const cat = m.f[7]
    return { name: typeof cat === "number" ? EX_CAT[cat] ?? `动作#${cat}` : "未命名动作", reps: num(m.f[3]), weightKg: m.f[4] == null ? null : r1((m.f[4] as number) / 16), durationSec: m.f[0] == null ? null : Math.round((m.f[0] as number) / 1000) }
  })
  const sessions = msgs.filter((m) => m.num === 18)
  for (const s of sessions) {
    const a = emptyActivity(source)
    const [sp, label] = sportFrom(FIT_SPORTS[s.f[5] as number] ?? String(s.f[5] ?? ""))
    a.sport = sp; a.sportLabel = label
    a.startIso = fitTime(s.f[2]) ?? fitTime(s.f[253])
    a.durationSec = s.f[8] != null ? Math.round((s.f[8] as number) / 1000) : s.f[7] != null ? Math.round((s.f[7] as number) / 1000) : null
    a.distanceM = s.f[9] != null ? r1((s.f[9] as number) / 100) : null
    a.calories = num(s.f[11]); a.avgHr = num(s.f[16]); a.maxHr = num(s.f[17])
    a.avgCadence = s.f[18] != null ? (sp === "RUNNING" ? (s.f[18] as number) * 2 : (s.f[18] as number)) : null
    a.avgPower = num(s.f[20])
    a.verticalOscMm = s.f[89] != null ? r1((s.f[89] as number) / 10) : null
    a.groundContactMs = s.f[91] != null ? Math.round((s.f[91] as number) / 10) : null
    if (sets.length && sessions.length === 1) { a.sets = sets; if (a.sport === "UNKNOWN") { a.sport = "STRENGTH"; a.sportLabel = "力量" } }
    if (a.distanceM === 0 && a.sport === "STRENGTH") a.distanceM = null
    activities.push(finish(a))
  }
  if (!sessions.length) {
    const recs = msgs.filter((m) => m.num === 20 && typeof m.f[253] === "number")
    if (recs.length > 1) {
      const a = emptyActivity(source)
      a.startIso = fitTime(recs[0].f[253]); a.durationSec = (recs.at(-1)!.f[253] as number) - (recs[0].f[253] as number)
      const d = recs.map((m) => m.f[5]).filter((v): v is number => typeof v === "number")
      a.distanceM = d.length ? r1(d.at(-1)! / 100) : null
      const hr = recs.map((m) => m.f[3]).filter((v): v is number => typeof v === "number")
      a.avgHr = hr.length ? Math.round(hr.reduce((x, y) => x + y, 0) / hr.length) : null
      a.maxHr = hr.length ? Math.max(...hr) : null
      notes.push("文件没有汇总段，按逐点记录推算。")
      activities.push(finish(a))
    }
  }
  // Garmin HRV status summary (msg 370): last night average, scaled by 128.
  for (const m of msgs.filter((x) => x.num === 370)) {
    const t = fitTime(m.f[253]); const v = num(m.f[1], 128)
    if (t && okMetric("HRV", v)) healthRows.push(health(source, "HRV", t.slice(0, 10), v))
  }
  // Monitoring resting HR (monitoring_hr_data msg 211, field 0 resting_heart_rate)
  for (const m of msgs.filter((x) => x.num === 211)) {
    const t = fitTime(m.f[253]); const v = num(m.f[0])
    if (t && okMetric("RHR", v)) healthRows.push(health(source, "RHR", t.slice(0, 10), v))
  }
  // Weight scale (msg 30): weight in 0.01 kg
  for (const m of msgs.filter((x) => x.num === 30)) {
    const t = fitTime(m.f[253]); const v = num(m.f[0], 100)
    if (t && okMetric("WEIGHT", v)) healthRows.push(health(source, "WEIGHT", t.slice(0, 10), v))
  }
  if (!activities.length && !healthRows.length) notes.push("FIT 文件里没有可识别的训练汇总或健康指标（睡眠等监测文件格式私有，暂不解析）。")
  return { kind: "FIT", brand, activities, health: dedupeHealth(healthRows), notes }
}

/* ---------------- XML (GPX / TCX) ---------------- */
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
const tag = (s: string, t: string) => { const m = new RegExp(`<(?:\\w+:)?${t}[^>]*>([^<]*)<`, "i").exec(s); return m ? m[1].trim() : null }
export function parseGpx(text: string, source = "GPX"): DeviceParseResult {
  const pts = [...text.matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g)]
  const a = emptyActivity(source)
  const [sp, label] = sportFrom(tag(text, "type") ?? tag(text, "name") ?? "running")
  a.sport = sp; a.sportLabel = label
  let dist = 0; const hrs: number[] = []; let first: string | null = null, last: string | null = null
  pts.forEach((m, i) => {
    if (i) dist += haversine([+pts[i - 1][1], +pts[i - 1][2]], [+m[1], +m[2]])
    const t = tag(m[3], "time"); if (t) { first ??= t; last = t }
    const hr = tag(m[3], "hr"); if (hr) hrs.push(+hr)
  })
  a.startIso = first ? new Date(first).toISOString() : null
  a.durationSec = first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 1000) : null
  a.distanceM = pts.length > 1 ? r1(dist) : null
  a.avgHr = hrs.length ? Math.round(hrs.reduce((x, y) => x + y, 0) / hrs.length) : null
  a.maxHr = hrs.length ? Math.max(...hrs) : null
  const brand = /garmin/i.test(text) ? "Garmin" : /coros/i.test(text) ? "COROS" : /strava/i.test(text) ? "Strava" : "未知"
  return { kind: "GPX", brand, activities: pts.length > 1 ? [finish(a)] : [], health: [], notes: pts.length > 1 ? ["距离按轨迹点直线累加，可能比手表略短。"] : ["GPX 里没有轨迹点。"] }
}
export function parseTcx(text: string, source = "TCX"): DeviceParseResult {
  const activities: DeviceActivity[] = []
  for (const m of text.matchAll(/<Activity\s+Sport="([^"]*)"[^>]*>([\s\S]*?)<\/Activity>/g)) {
    const a = emptyActivity(source)
    const [sp, label] = sportFrom(m[1]); a.sport = sp; a.sportLabel = label
    const id = tag(m[2], "Id"); a.startIso = id ? new Date(id).toISOString() : null
    let dur = 0, dist = 0, cal = 0, hrSum = 0, hrW = 0, maxHr = 0
    for (const lap of m[2].matchAll(/<Lap[\s\S]*?<\/Lap>/g)) {
      const s = lap[0]
      const d = +(tag(s, "TotalTimeSeconds") ?? 0); dur += d
      dist += +(tag(s, "DistanceMeters") ?? 0); cal += +(tag(s, "Calories") ?? 0)
      const avg = /<AverageHeartRateBpm>\s*<Value>(\d+)/.exec(s); if (avg) { hrSum += +avg[1] * d; hrW += d }
      const mx = /<MaximumHeartRateBpm>\s*<Value>(\d+)/.exec(s); if (mx) maxHr = Math.max(maxHr, +mx[1])
    }
    a.durationSec = dur ? Math.round(dur) : null; a.distanceM = dist ? r1(dist) : null; a.calories = cal || null
    a.avgHr = hrW ? Math.round(hrSum / hrW) : null; a.maxHr = maxHr || null
    activities.push(finish(a))
  }
  return { kind: "TCX", brand: /Garmin/i.test(text) ? "Garmin" : "未知", activities, health: [], notes: activities.length ? [] : ["TCX 里没有 Activity。"] }
}

/* ---------------- CSV ---------------- */
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = "", q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ",") { out.push(cur); cur = "" }
    else cur += c
  }
  out.push(cur); return out.map((s) => s.trim())
}
function parseClock(s: string): number | null {
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?$/.exec(s.trim())
  if (!m) return null
  return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]
}
function parseSleepText(s: string): number | null {
  const hm = /(\d+)\s*(?:h|小时|时)\s*(?:(\d+)\s*(?:m|min|分钟|分))?/i.exec(s)
  if (hm) return +hm[1] + (hm[2] ? +hm[2] / 60 : 0)
  const c = parseClock(s); if (c != null) return s.split(":").length === 2 ? c / 60 : c / 3600
  const n = parseFloat(s); return Number.isFinite(n) ? n : null
}
const numIn = (s: string | undefined) => { if (s == null) return null; const n = parseFloat(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null }
function findCol(headers: string[], re: RegExp) { return headers.findIndex((h) => re.test(h)) }
function toDay(s: string): string | null {
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s)
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null
}
function toIso(s: string): string | null {
  const d = toDay(s); if (!d) return null
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.slice(s.indexOf(d.slice(5, 7)) + 2))
  const local = `${d}T${t ? `${t[1].padStart(2, "0")}:${t[2]}:${t[3] ?? "00"}` : "12:00:00"}+08:00`
  return Number.isFinite(Date.parse(local)) ? new Date(local).toISOString() : null
}
export function parseCsv(text: string, source = "CSV"): DeviceParseResult {
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim())
  const notes: string[] = []
  if (lines.length < 2) return { kind: "CSV", brand: "未知", activities: [], health: [], notes: ["CSV 没有数据行。"] }
  const headers = splitCsv(lines[0])
  const rows = lines.slice(1).map(splitCsv)
  const c = {
    type: findCol(headers, /活动类型|activity type|^type$|运动类型/i), date: findCol(headers, /^日期$|^date$|开始时间|start time|^时间戳|calendar/i),
    dist: findCol(headers, /^距离|distance/i), time: findCol(headers, /^时间$|^time$|duration|用时|运动时间|总时间/i), cal: findCol(headers, /卡路里|calories/i),
    avgHr: findCol(headers, /平均心率|avg hr|average heart/i), maxHr: findCol(headers, /最大心率|max hr/i), cad: findCol(headers, /平均步频|avg.*cadence/i),
    rhr: findCol(headers, /静息心率|resting heart/i), hrv: findCol(headers, /hrv|心率变异/i), sleep: findCol(headers, /睡眠时[长间]|^睡眠$|sleep (time|duration)|total sleep|^sleep$/i),
    weight: findCol(headers, /体重|weight/i), bb: findCol(headers, /身体电量|body battery/i), ready: findCol(headers, /训练准备|readiness/i), stress: findCol(headers, /压力|stress/i),
  }
  const brand = /活动类型|Activity Type/i.test(lines[0]) && c.avgHr >= 0 ? "Garmin" : "未知"
  const activities: DeviceActivity[] = []; const hr: DeviceHealthRow[] = []
  const isActivity = c.type >= 0 || (c.dist >= 0 && c.time >= 0)
  for (const row of rows) {
    const dateCell = c.date >= 0 ? row[c.date] : row[0]
    if (isActivity) {
      const a = emptyActivity(source)
      const [sp, label] = sportFrom(c.type >= 0 ? row[c.type] : "running"); a.sport = sp; a.sportLabel = label
      a.startIso = toIso(dateCell ?? "")
      const d = numIn(row[c.dist]); a.distanceM = d == null ? null : d > 300 ? d : r1(d * 1000)
      a.durationSec = c.time >= 0 ? parseClock(row[c.time] ?? "") : null
      a.calories = numIn(row[c.cal]); a.avgHr = numIn(row[c.avgHr]); a.maxHr = numIn(row[c.maxHr]); a.avgCadence = numIn(row[c.cad])
      if (a.startIso) activities.push(finish(a))
    }
    const day = toDay(dateCell ?? "")
    if (!day) continue
    const push = (m: HealthMetric, v: number | null) => { if (okMetric(m, v)) hr.push(health(source, m, day, v)) }
    if (c.rhr >= 0) push("RHR", numIn(row[c.rhr]))
    if (c.hrv >= 0) push("HRV", numIn(row[c.hrv]))
    if (c.sleep >= 0) push("SLEEP", parseSleepText(row[c.sleep] ?? ""))
    if (c.weight >= 0 && !isActivity) push("WEIGHT", numIn(row[c.weight]))
    if (c.bb >= 0) push("BODY_BATTERY", numIn(row[c.bb]))
    if (c.ready >= 0) push("READINESS", numIn(row[c.ready]))
    if (c.stress >= 0 && !isActivity) push("STRESS", numIn(row[c.stress]))
  }
  if (!activities.length && !hr.length) notes.push(`没认出列名（${headers.slice(0, 6).join("、")}…）。支持佳明/华为/小米等导出的活动或健康 CSV。`)
  return { kind: "CSV", brand, activities, health: dedupeHealth(hr), notes }
}

/* ---------------- Garmin Connect JSON (from the account data export) ---------------- */
export function parseGarminJson(name: string, text: string): DeviceParseResult {
  const res: DeviceParseResult = { kind: "Garmin JSON", brand: "Garmin", activities: [], health: [], notes: [] }
  let data: unknown
  try { data = JSON.parse(text) } catch { return res }
  const list: Record<string, unknown>[] = []
  const walk = (v: unknown, depth = 0) => {
    if (depth > 3 || !v) return
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1))
    else if (typeof v === "object") { list.push(v as Record<string, unknown>); for (const x of Object.values(v)) if (Array.isArray(x)) walk(x, depth + 1) }
  }
  walk(data)
  const src = `Garmin 导出 · ${name.split("/").pop()}`
  for (const o of list) {
    const day = typeof o.calendarDate === "string" ? o.calendarDate.slice(0, 10) : null
    if (/sleep/i.test(name) && day) {
      const secs = ["deepSleepSeconds", "lightSleepSeconds", "remSleepSeconds"].reduce((s, k) => s + (typeof o[k] === "number" ? (o[k] as number) : 0), 0)
      if (okMetric("SLEEP", secs / 3600)) res.health.push(health(src, "SLEEP", day, secs / 3600))
    }
    if (day && typeof o.restingHeartRate === "number" && okMetric("RHR", o.restingHeartRate)) res.health.push(health(src, "RHR", day, o.restingHeartRate))
    if (day && typeof o.lastNightAvg === "number" && okMetric("HRV", o.lastNightAvg)) res.health.push(health(src, "HRV", day, o.lastNightAvg))
    const bb = o.bodyBattery as { bodyBatteryStatList?: { bodyBatteryStatType?: string; statsValue?: number }[] } | undefined
    const high = bb?.bodyBatteryStatList?.find((x) => x.bodyBatteryStatType === "HIGHEST")?.statsValue
    if (day && okMetric("BODY_BATTERY", high)) res.health.push(health(src, "BODY_BATTERY", day, high))
    if (day && typeof o.score === "number" && /readiness/i.test(name) && okMetric("READINESS", o.score)) res.health.push(health(src, "READINESS", day, o.score))
    if (typeof o.activityType === "string" && typeof o.beginTimestamp === "number") {
      const a = emptyActivity(src)
      const [sp, label] = sportFrom(o.activityType); a.sport = sp; a.sportLabel = label
      a.startIso = new Date(o.beginTimestamp).toISOString()
      a.durationSec = typeof o.duration === "number" ? Math.round(o.duration / 1000) : null
      a.distanceM = typeof o.distance === "number" && o.distance > 0 ? r1(o.distance / 100) : null
      a.avgHr = typeof o.avgHr === "number" ? Math.round(o.avgHr) : null
      a.maxHr = typeof o.maxHr === "number" ? Math.round(o.maxHr) : null
      a.calories = typeof o.calories === "number" ? Math.round(o.calories) : null
      res.activities.push(finish(a))
    }
  }
  return res
}

/* ---------------- ZIP (Garmin export, Apple Health, Huawei/Xiaomi bundles) ---------------- */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw")
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer()
  return new Uint8Array(buf)
}
export async function unzip(bytes: Uint8Array, want: (name: string) => boolean): Promise<{ name: string; data: Uint8Array }[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件")
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: { name: string; data: Uint8Array }[] = []
  for (let i = 0; i < count && p < bytes.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true)
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (name.endsWith("/") || !want(name)) continue
    const lstart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    const raw = bytes.subarray(lstart, lstart + csize)
    try { out.push({ name, data: method === 0 ? raw : method === 8 ? await inflateRaw(raw) : new Uint8Array() }) } catch { /* skip broken entry */ }
  }
  return out
}
export function parseAppleHealthXml(xml: string, sinceDay: string): DeviceParseResult {
  const res: DeviceParseResult = { kind: "Apple 健康", brand: "Apple", activities: [], health: [], notes: [] }
  const map: Record<string, HealthMetric> = { HKQuantityTypeIdentifierRestingHeartRate: "RHR", HKQuantityTypeIdentifierHeartRateVariabilitySDNN: "HRV", HKQuantityTypeIdentifierBodyMass: "WEIGHT" }
  const sleep: Record<string, number> = {}
  for (const m of xml.matchAll(/<Record\s([^>]*?)\/?>/g)) {
    const attrs = m[1]
    const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? ""
    const start = /startDate="([^"]+)"/.exec(attrs)?.[1] ?? ""
    const day = start.slice(0, 10)
    if (!day || day < sinceDay) continue
    if (map[type]) {
      let v = parseFloat(/value="([^"]+)"/.exec(attrs)?.[1] ?? "")
      if (map[type] === "WEIGHT" && /unit="lb"/.test(attrs)) v *= 0.4536
      if (okMetric(map[type], v)) res.health.push(health("Apple 健康导出", map[type], day, v))
    } else if (type === "HKCategoryTypeIdentifierSleepAnalysis" && /Asleep/.test(attrs)) {
      const end = /endDate="([^"]+)"/.exec(attrs)?.[1] ?? ""
      const h = (Date.parse(end.replace(" ", "T").replace(" ", "")) - Date.parse(start.replace(" ", "T").replace(" ", ""))) / 3.6e6
      const endDay = end.slice(0, 10)
      if (h > 0 && endDay) sleep[endDay] = (sleep[endDay] ?? 0) + h
    }
  }
  for (const [day, h] of Object.entries(sleep)) if (okMetric("SLEEP", h)) res.health.push(health("Apple 健康导出", "SLEEP", day, h))
  for (const m of xml.matchAll(/<Workout\s([^>]*?)>/g)) {
    const attrs = m[1]; const start = /startDate="([^"]+)"/.exec(attrs)?.[1] ?? ""
    if (start.slice(0, 10) < sinceDay) continue
    const a = emptyActivity("Apple 健康导出")
    const [sp, label] = sportFrom(/workoutActivityType="HKWorkoutActivityType(\w+)"/.exec(attrs)?.[1] ?? ""); a.sport = sp; a.sportLabel = label
    a.startIso = Number.isFinite(Date.parse(start.replace(" ", "T").replace(" ", ""))) ? new Date(start.replace(" ", "T").replace(" ", "")).toISOString() : null
    const dur = parseFloat(/duration="([^"]+)"/.exec(attrs)?.[1] ?? ""); a.durationSec = Number.isFinite(dur) ? Math.round(dur * 60) : null
    const dist = parseFloat(/totalDistance="([^"]+)"/.exec(attrs)?.[1] ?? ""); a.distanceM = Number.isFinite(dist) ? r1(dist * 1000) : null
    res.activities.push(finish(a))
  }
  res.health = dedupeHealth(res.health)
  res.notes.push(`只读取 ${sinceDay} 之后的静息心率、HRV(SDNN)、体重、睡眠和体能训练。`)
  return res
}

export function dedupeHealth(rows: DeviceHealthRow[]): DeviceHealthRow[] {
  const m = new Map<string, DeviceHealthRow>(); for (const r of rows) m.set(r.key, r); return [...m.values()].sort((a, b) => b.day.localeCompare(a.day))
}
export function mergeResults(parts: DeviceParseResult[]): DeviceParseResult {
  const acts = new Map<string, DeviceActivity>()
  for (const p of parts) for (const a of p.activities) { const prev = acts.get(a.key); if (!prev || (a.source.includes("FIT") && !prev.source.includes("FIT"))) acts.set(a.key, a) }
  return { kind: [...new Set(parts.map((p) => p.kind))].join(" + ") || "—", brand: [...new Set(parts.map((p) => p.brand).filter((b) => b !== "未知"))].join("/") || "未知", activities: [...acts.values()].sort((a, b) => (b.startIso ?? "").localeCompare(a.startIso ?? "")), health: dedupeHealth(parts.flatMap((p) => p.health)), notes: [...new Set(parts.flatMap((p) => p.notes))] }
}

export function detectKind(name: string, head: Uint8Array): "fit" | "gpx" | "tcx" | "csv" | "zip" | "json" | "image" | "unknown" {
  if (isFit(head)) return "fit"
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip"
  if ((head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50)) return "image"
  const t = new TextDecoder().decode(head.subarray(0, 600))
  if (/<gpx/i.test(t)) return "gpx"
  if (/<TrainingCenterDatabase/i.test(t)) return "tcx"
  if (/^\s*[[{]/.test(t)) return "json"
  if (/\.csv$/i.test(name) || /,/.test(t.split("\n")[0] ?? "")) return "csv"
  return "unknown"
}

const SINCE_DAYS = 120
export async function parseDeviceFile(name: string, bytes: Uint8Array, today = new Date().toISOString().slice(0, 10), depth = 0): Promise<DeviceParseResult> {
  const kind = detectKind(name, bytes.subarray(0, 600))
  const text = () => new TextDecoder().decode(bytes)
  if (kind === "fit") return parseFit(bytes, `FIT · ${name.split("/").pop()}`)
  if (kind === "gpx") return parseGpx(text(), `GPX · ${name.split("/").pop()}`)
  if (kind === "tcx") return parseTcx(text(), `TCX · ${name.split("/").pop()}`)
  if (kind === "csv") return parseCsv(text(), `CSV · ${name.split("/").pop()}`)
  if (kind === "json") return parseGarminJson(name, text())
  if (kind === "zip" && depth < 2) {
    const since = new Date(Date.parse(today) - SINCE_DAYS * 864e5).toISOString().slice(0, 10)
    const entries = await unzip(bytes, (n) => /\.(fit|gpx|tcx|csv|zip)$/i.test(n) || /export\.xml$/.test(n) || /(sleep|UDSFile|summarizedActivities|hrv|readiness).*\.json$/i.test(n))
    const parts: DeviceParseResult[] = []
    let fitCount = 0
    for (const e of entries) {
      if (/export\.xml$/.test(e.name) && !/cda/i.test(e.name)) { parts.push(parseAppleHealthXml(new TextDecoder().decode(e.data), since)); continue }
      if (/\.fit$/i.test(e.name) && ++fitCount > 400) continue
      try { parts.push(await parseDeviceFile(e.name, e.data, today, depth + 1)) } catch { /* skip */ }
    }
    const merged = mergeResults(parts)
    merged.activities = merged.activities.filter((a) => !a.startIso || a.startIso.slice(0, 10) >= since)
    merged.health = merged.health.filter((h) => h.day >= since)
    merged.kind = `ZIP（${entries.length} 个文件）`
    if (fitCount > 400) merged.notes.push("FIT 文件超过 400 个，只读了前 400 个。")
    merged.notes.push(`只保留最近 ${SINCE_DAYS} 天的数据。`)
    return merged
  }
  return { kind: "未知", brand: "未知", activities: [], health: [], notes: ["无法识别的文件。支持 FIT / GPX / TCX / CSV / 佳明数据导出 ZIP / Apple 健康导出 ZIP / 截图。"] }
}

/* ---------------- OCR text (Garmin Connect / 华为 / 小米 summary screenshots) ---------------- */
export function parseSummaryText(raw: string, day: string): { health: DeviceHealthRow[]; activity: DeviceActivity | null } {
  const text = raw.replace(/[ \t]+/g, " ").replace(/[：]/g, ":")
  const flat = text.replace(/\n/g, " ")
  const after = (re: RegExp, span = 28) => { const m = re.exec(flat); if (!m) return null; const rest = flat.slice(m.index + m[0].length, m.index + m[0].length + span); return rest }
  const firstNum = (s: string | null) => { if (!s) return null; const m = /(\d+(?:\.\d+)?)/.exec(s); return m ? +m[1] : null }
  const src = "截图识别"
  const out: DeviceHealthRow[] = []
  const push = (m: HealthMetric, v: number | null) => { if (okMetric(m, v)) out.push(health(src, m, day, v)) }
  push("RHR", firstNum(after(/静息心率|Resting\s*HR|Resting Heart Rate/i)))
  push("HRV", firstNum(after(/(?:HRV|心率变异性)(?:\s*状态)?(?:[^0-9]{0,12}(?:夜间平均|昨晚平均|Last Night Avg))?/i)))
  const sl = after(/睡眠(?:时长|时间)?|Sleep(?:\s*Duration)?/i, 20)
  if (sl) { const v = parseSleepText(sl.replace(/^[^0-9]*/, "")); if (v != null && /h|小时|时|:/i.test(sl)) push("SLEEP", v) }
  push("BODY_BATTERY", firstNum(after(/身体电量|Body Battery/i)))
  push("READINESS", firstNum(after(/训练准备度|Training Readiness/i)))
  push("STRESS", firstNum(after(/(?:平均)?压力(?:水平)?|Stress/i)))
  push("WEIGHT", firstNum(after(/体重|Weight/i)))
  const dist = /(\d+(?:\.\d+)?)\s*(?:公里|km)/i.exec(flat)
  const time = after(/(?:运动)?时间|用时|Time|时长/i, 16)
  const tsec = time ? (() => { const m = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(time); return m ? parseClock(m[1]) : null })() : null
  const hr = firstNum(after(/平均心率|Avg\s*HR/i))
  let activity: DeviceActivity | null = null
  if (dist && (tsec || hr)) {
    activity = emptyActivity(src); activity.sport = "RUNNING"; activity.sportLabel = "跑步"
    activity.distanceM = r1(+dist[1] * 1000); activity.durationSec = tsec; activity.avgHr = hr
    activity.startIso = new Date(`${day}T12:00:00+08:00`).toISOString()
    finish(activity)
  }
  return { health: dedupeHealth(out), activity }
}

export function paceText(a: Pick<DeviceActivity, "distanceM" | "durationSec">): string | null {
  if (!a.distanceM || !a.durationSec || a.distanceM < 200) return null
  const s = a.durationSec / (a.distanceM / 1000)
  return `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, "0")}"/km`
}
