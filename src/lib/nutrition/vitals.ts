import { currentStore } from "@/lib/core/storage"

export const VITALS_KEY = "fr255-vitals-v1"

export const VITAL_KINDS = ["HRV", "RHR", "NIGHT_HR", "SLEEP", "RECOVERY"] as const
export type VitalKind = (typeof VITAL_KINDS)[number]
export type VitalSource = "MANUAL" | "IMAGE_CONFIRMED" | "DEVICE_CONFIRMED"
export type HrvMethod = "RMSSD" | "SDNN" | "UNSPECIFIED"

export type VitalRecord = {
  id: string
  kind: VitalKind
  value: number
  unit: "ms" | "bpm" | "hours" | "score"
  observedOn: string
  observedAt: string | null
  source: VitalSource
  note: string
  hrvMethod: HrvMethod | null
  createdAt: string
}

export type VitalDraft = {
  kind: VitalKind
  value: number
  observedOn: string
  observedAt?: string | null
  source: VitalSource
  note?: string
  hrvMethod?: HrvMethod | null
}

const UNITS: Record<VitalKind, VitalRecord["unit"]> = {
  HRV: "ms",
  RHR: "bpm",
  NIGHT_HR: "bpm",
  SLEEP: "hours",
  RECOVERY: "score",
}

const RANGES: Record<VitalKind, { min: number; max: number; integer: boolean }> = {
  HRV: { min: 1, max: 300, integer: true },
  RHR: { min: 30, max: 120, integer: true },
  NIGHT_HR: { min: 30, max: 140, integer: true },
  SLEEP: { min: 0.1, max: 24, integer: false },
  RECOVERY: { min: 1, max: 10, integer: true },
}

export const VITAL_LABELS: Record<VitalKind, string> = {
  HRV: "HRV",
  RHR: "静息心率",
  NIGHT_HR: "夜间平均心率",
  SLEEP: "睡眠时长",
  RECOVERY: "主观恢复",
}

export const HRV_METHOD_LABELS: Record<HrvMethod, string> = {
  RMSSD: "RMSSD",
  SDNN: "SDNN",
  UNSPECIFIED: "未说明口径",
}

function box() {
  return currentStore()
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

export function isVitalRecord(value: unknown): value is VitalRecord {
  if (!value || typeof value !== "object") return false
  const item = value as VitalRecord
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 80
    && (VITAL_KINDS as readonly string[]).includes(item.kind)
    && typeof item.value === "number"
    && item.unit === UNITS[item.kind]
    && isDate(item.observedOn)
    && (item.observedAt === null || /^\d{2}:\d{2}$/.test(item.observedAt))
    && (item.source === "MANUAL" || item.source === "IMAGE_CONFIRMED" || item.source === "DEVICE_CONFIRMED")
    && typeof item.note === "string"
    && item.note.length <= 80
    && (item.kind === "HRV" ? item.hrvMethod === "RMSSD" || item.hrvMethod === "SDNN" || item.hrvMethod === "UNSPECIFIED" : item.hrvMethod === null)
    && typeof item.createdAt === "string"
}

export function loadVitals(): { records: VitalRecord[]; unreadable: boolean } {
  const storage = box()
  if (!storage) return { records: [], unreadable: false }
  const raw = storage.getItem(VITALS_KEY)
  if (!raw) return { records: [], unreadable: false }
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; records?: unknown }
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.records) || parsed.records.some((item) => !isVitalRecord(item))) {
      return { records: [], unreadable: true }
    }
    return { records: parsed.records, unreadable: false }
  } catch {
    return { records: [], unreadable: true }
  }
}

export function validateVital(draft: VitalDraft): { ok: true; value: number; unit: VitalRecord["unit"]; hrvMethod: HrvMethod | null; observedAt: string | null; note: string } | { ok: false; reason: string } {
  if (!(VITAL_KINDS as readonly string[]).includes(draft.kind)) return { ok: false, reason: "请选择指标。" }
  if (!isDate(draft.observedOn)) return { ok: false, reason: "日期不正确。" }
  const range = RANGES[draft.kind]
  if (typeof draft.value !== "number" || !Number.isFinite(draft.value) || draft.value < range.min || draft.value > range.max || (range.integer && !Number.isInteger(draft.value))) {
    return { ok: false, reason: `${VITAL_LABELS[draft.kind]}需在 ${range.min}–${range.max}${range.integer ? " 的整数" : ""}。` }
  }
  const clock = draft.observedAt == null || draft.observedAt === "" ? null : draft.observedAt
  if (clock != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return { ok: false, reason: "测量时间需为 24 小时制，或留空。" }
  if (draft.source !== "MANUAL" && draft.source !== "IMAGE_CONFIRMED" && draft.source !== "DEVICE_CONFIRMED") return { ok: false, reason: "来源不正确。" }
  const note = (draft.note ?? "").trim()
  if (note.length > 80) return { ok: false, reason: "备注最多 80 字。" }
  if (draft.kind === "HRV") {
    if (draft.hrvMethod !== "RMSSD" && draft.hrvMethod !== "SDNN" && draft.hrvMethod !== "UNSPECIFIED") return { ok: false, reason: "请选择 HRV 口径。未说明也可以。" }
    return { ok: true, value: draft.value, unit: "ms", hrvMethod: draft.hrvMethod, observedAt: clock, note }
  }
  const value = draft.kind === "SLEEP" ? Math.round(draft.value * 10) / 10 : draft.value
  return { ok: true, value, unit: UNITS[draft.kind], hrvMethod: null, observedAt: clock, note }
}

export function saveVital(draft: VitalDraft, id: string = crypto.randomUUID(), createdAt = new Date().toISOString()): { ok: true; records: VitalRecord[] } | { ok: false; reason: string } {
  const current = loadVitals()
  if (current.unreadable) return { ok: false, reason: "已有监测记录无法读取，没有覆盖。" }
  const checked = validateVital(draft)
  if (!checked.ok) return checked
  const storage = box()
  if (!storage) return { ok: false, reason: "没有写入本机。请重试。" }
  const record: VitalRecord = {
    id,
    kind: draft.kind,
    value: checked.value,
    unit: checked.unit,
    observedOn: draft.observedOn,
    observedAt: checked.observedAt,
    source: draft.source,
    note: checked.note,
    hrvMethod: checked.hrvMethod,
    createdAt,
  }
  const records = [...current.records, record]
  try {
    storage.setItem(VITALS_KEY, JSON.stringify({ schemaVersion: 1, records }))
  } catch {
    return { ok: false, reason: "没有写入本机。请重试。" }
  }
  return { ok: true, records }
}

export function removeVital(id: string): { ok: true; records: VitalRecord[] } | { ok: false; reason: string } {
  const current = loadVitals()
  if (current.unreadable) return { ok: false, reason: "已有监测记录无法读取，没有删除。" }
  const records = current.records.filter((item) => item.id !== id)
  if (records.length === current.records.length) return { ok: false, reason: "没有找到这条记录。" }
  const storage = box()
  if (!storage) return { ok: false, reason: "没有删除。请重试。" }
  try {
    storage.setItem(VITALS_KEY, JSON.stringify({ schemaVersion: 1, records }))
  } catch {
    return { ok: false, reason: "没有删除。请重试。" }
  }
  return { ok: true, records }
}

export function latestOnDay(records: VitalRecord[], kind: VitalKind, day: string): VitalRecord | null {
  return records.filter((item) => item.kind === kind && item.observedOn === day).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
}

export function historyOf(records: VitalRecord[], kind: VitalKind | "ALL"): VitalRecord[] {
  return records.filter((item) => kind === "ALL" || item.kind === kind).sort((a, b) => {
    if (a.observedOn !== b.observedOn) return a.observedOn < b.observedOn ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

export function trendPoints(records: VitalRecord[], kind: VitalKind, today: string, days: 7 | 30, method?: HrvMethod): VitalRecord[] | null {
  if (!isDate(today)) return null
  if (kind === "HRV" && !method) return null
  const start = dayNumber(today) - (days - 1)
  const points = records.filter((item) => {
    if (item.kind !== kind || !isDate(item.observedOn)) return false
    const day = dayNumber(item.observedOn)
    if (day < start || day > dayNumber(today)) return false
    return kind !== "HRV" || item.hrvMethod === method
  }).sort((a, b) => (a.observedOn === b.observedOn ? (a.createdAt < b.createdAt ? -1 : 1) : a.observedOn < b.observedOn ? -1 : 1))
  return points.length >= 2 ? points : null
}
