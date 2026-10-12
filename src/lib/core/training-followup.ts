import { readEnvelope, writeEnvelope } from "./storage.ts"
import { loadConfirmedTrainingImports, normalizeConfirmedTrainingImport, type ConfirmedTrainingImport } from "./training-import.ts"
import type { CoachEvidenceClaim } from "./training-coach.ts"

export const TRAINING_FOLLOWUPS_KEY = "fr255-import-training-followups-v1"
export type FollowupWindow = "EARLY" | "24H" | "48H" | "LATER"
export type BodyReportState = "UNKNOWN" | "PRESENT" | "ABSENT"
export type FollowupInput = {
  requestId: string
  confirmedImportId: string
  observedAt: string
  recoveryScore: number | null
  sleepHours: number | null
  pain: { state: BodyReportState; location: string | null; intensity: number | null }
  soreness: { state: BodyReportState; location: string | null; intensity: number | null }
}
export type ImportedTrainingFollowup = FollowupInput & {
  schemaVersion: 1
  followupId: string
  savedAt: string
  elapsedSeconds: number
  window: FollowupWindow
  canonicalOccurrenceId: null
}
export type FollowupAssessment = {
  status: "NEEDS_INPUT" | "MULTIPLE_RECORDS" | "CAUTION" | "OBSERVATION_ONLY"
  facts: CoachEvidenceClaim[]
  observations: CoachEvidenceClaim[]
  evidenceGaps: CoachEvidenceClaim[]
  sources: { id: string; detail: string }[]
  clearance: "UNKNOWN"
}

const validTimestamp = (value: string) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const score = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
const windowFor = (elapsed: number): FollowupWindow => elapsed < 24 * 3600 ? "EARLY" : elapsed < 48 * 3600 ? "24H" : elapsed < 72 * 3600 ? "48H" : "LATER"
export const FOLLOWUP_WINDOW_LABELS: Record<FollowupWindow, string> = { EARLY: "不足24h", "24H": "24–48h观察", "48H": "48–72h观察", LATER: "72h以后观察" }

function checkedBody(raw: FollowupInput["pain"]): FollowupInput["pain"] | null {
  if (!raw || !["UNKNOWN", "PRESENT", "ABSENT"].includes(raw.state)) return null
  if (raw.state !== "PRESENT") return raw.location == null && raw.intensity == null ? { state: raw.state, location: null, intensity: null } : null
  if (typeof raw.location !== "string" || !raw.location.trim() || raw.location.length > 40 || !score(raw.intensity)) return null
  return { state: "PRESENT", location: raw.location.trim(), intensity: raw.intensity }
}

function checkedInput(raw: FollowupInput, record: ConfirmedTrainingImport, now: string): FollowupInput | null {
  if (!raw || typeof raw.requestId !== "string" || !/^[\w-]{1,55}$/.test(raw.requestId) || raw.confirmedImportId !== record.confirmedImportId || !validTimestamp(raw.observedAt) || !validTimestamp(now)) return null
  if (record.occurredAt.status !== "RECORDED" || !record.occurredAt.value || Date.parse(raw.observedAt) < Date.parse(record.occurredAt.value) || Date.parse(raw.observedAt) > Date.parse(now)) return null
  if (raw.recoveryScore != null && !score(raw.recoveryScore)) return null
  if (raw.sleepHours != null && (typeof raw.sleepHours !== "number" || !Number.isFinite(raw.sleepHours) || raw.sleepHours <= 0 || raw.sleepHours > 24)) return null
  const pain = checkedBody(raw.pain), soreness = checkedBody(raw.soreness)
  if (!pain || !soreness || raw.recoveryScore == null && raw.sleepHours == null && pain.state === "UNKNOWN" && soreness.state === "UNKNOWN") return null
  return { requestId: raw.requestId, confirmedImportId: raw.confirmedImportId, observedAt: raw.observedAt, recoveryScore: raw.recoveryScore ?? null, sleepHours: raw.sleepHours ?? null, pain, soreness }
}

function loadAll(): ImportedTrainingFollowup[] {
  const data = readEnvelope<ImportedTrainingFollowup[]>(TRAINING_FOLLOWUPS_KEY, []).data
  return Array.isArray(data) ? data : []
}

export function readImportedFollowups(record: ConfirmedTrainingImport): ImportedTrainingFollowup[] {
  const normalized = normalizeConfirmedTrainingImport(record)
  if (!normalized) return []
  const valid = loadAll().filter((item) => {
    if (!item || item.schemaVersion !== 1 || item.canonicalOccurrenceId !== null || item.followupId !== `followup:${item.requestId}` || !validTimestamp(item.savedAt)) return false
    const input = checkedInput(item, normalized, item.savedAt)
    if (!input) return false
    const elapsed = (Date.parse(input.observedAt) - Date.parse(normalized.occurredAt.value!)) / 1000
    return elapsed === item.elapsedSeconds && windowFor(elapsed) === item.window
  })
  // Corrupted identities cannot be selected as an authoritative source.
  const groups = new Map<string, ImportedTrainingFollowup[]>()
  for (const item of valid) groups.set(item.followupId, [...(groups.get(item.followupId) ?? []), item])
  return [...groups.values()].filter((group) => group.every((item) => JSON.stringify(item) === JSON.stringify(group[0]))).map((group) => group[0]!)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.followupId.localeCompare(b.followupId))
}

export function saveImportedFollowup(raw: FollowupInput, now = new Date().toISOString()):
  { ok: true; followup: ImportedTrainingFollowup; duplicate: boolean } | { ok: false; reason: string } {
  const original = loadConfirmedTrainingImports().find((record) => record.confirmedImportId === raw?.confirmedImportId)
  const record = normalizeConfirmedTrainingImport(original)
  if (!record) return { ok: false, reason: "请先明确选择一份有效的已确认训练。" }
  const input = checkedInput(raw, record, now)
  if (!input) return { ok: false, reason: "反馈无效：核对时间、1–10评分、身体部位和程度；空白不能当成0。" }
  const existing = loadAll().find((item) => item.requestId === input.requestId)
  if (existing) {
    const comparable = checkedInput(existing, record, existing.savedAt)
    if (!comparable || JSON.stringify(comparable) !== JSON.stringify(input) || !readImportedFollowups(record).some((item) => item.followupId === existing.followupId)) return { ok: false, reason: "这次提交标识已用于另一份反馈，不能覆盖原记录。" }
    return { ok: true, followup: existing, duplicate: true }
  }
  const all = loadAll()
  if (all.length >= 1000) return { ok: false, reason: "恢复反馈存储已达到上限；原记录仍保留。" }
  const elapsedSeconds = (Date.parse(input.observedAt) - Date.parse(record.occurredAt.value!)) / 1000
  const followup: ImportedTrainingFollowup = { ...input, schemaVersion: 1, followupId: `followup:${input.requestId}`, savedAt: now, elapsedSeconds, window: windowFor(elapsedSeconds), canonicalOccurrenceId: null }
  if (!writeEnvelope(TRAINING_FOLLOWUPS_KEY, [...all, followup])) return { ok: false, reason: "反馈保存失败，请重试；没有改动训练记录。" }
  return { ok: true, followup, duplicate: false }
}

function claim(text: string, citations: string[], kind: CoachEvidenceClaim["kind"]): CoachEvidenceClaim { return { text, citations, kind } }

export function assessImportedFollowups(record: ConfirmedTrainingImport, now = new Date().toISOString()): FollowupAssessment {
  const rows = readImportedFollowups(record)
  const facts: CoachEvidenceClaim[] = [], observations: CoachEvidenceClaim[] = [], evidenceGaps: CoachEvidenceClaim[] = []
  const sources: FollowupAssessment["sources"] = []
  for (const row of rows) {
    const source = row.followupId
    const elapsed = `${Math.floor(row.elapsedSeconds / 3600)}小时${Math.floor(row.elapsedSeconds % 3600 / 60)}分钟`
    const parts = [`${FOLLOWUP_WINDOW_LABELS[row.window]}：观察时间 ${row.observedAt}，距已确认训练时间 ${elapsed}`]
    if (row.recoveryScore != null) parts.push(`主观恢复 ${row.recoveryScore}/10`)
    if (row.sleepHours != null) parts.push(`本次反馈睡眠 ${row.sleepHours} 小时`)
    for (const [name, body] of [["疼痛", row.pain], ["酸痛", row.soreness]] as const) {
      if (body.state === "PRESENT") parts.push(`报告${body.location}${name} ${body.intensity}/10`)
      else if (body.state === "ABSENT") parts.push(`本次明确表示当前没有${name}`)
      else parts.push(`${name}未记录`)
    }
    const detail = parts.join("；")
    sources.push({ id: source, detail })
    facts.push(claim(detail, [source], "FACT"))
  }
  const a = rows.filter((row) => row.window === "24H"), b = rows.filter((row) => row.window === "48H")
  const multiple = [a, b].some((group) => group.length > 1)
  if (multiple) evidenceGaps.push(claim("同一观察窗口有多条反馈，请结合各自时间人工核对；不平均，也不挑一条作为代表。", [...a, ...b].map((row) => row.followupId), "QUESTION"))
  if (a.length === 1 && b.length === 1 && a[0]!.recoveryScore != null && b[0]!.recoveryScore != null) observations.push(claim(`24–48h窗口自报恢复 ${a[0]!.recoveryScore}/10，48–72h窗口为 ${b[0]!.recoveryScore}/10。这只描述两次自报变化，不能证明身体已经恢复或可以加量。`, [a[0]!.followupId, b[0]!.followupId], "OBSERVATION"))
  const elapsedNow = record.occurredAt.value && validTimestamp(now) ? (Date.parse(now) - Date.parse(record.occurredAt.value)) / 3600000 : null
  if (elapsedNow != null && elapsedNow >= 24 && a.length === 0) evidenceGaps.push(claim("24–48h窗口尚无反馈；更早或更晚的反馈不能补成该窗口的记录。", [], "QUESTION"))
  if (elapsedNow != null && elapsedNow >= 48 && b.length === 0) evidenceGaps.push(claim("48–72h窗口尚无反馈；不能把缺失当成恢复正常。", [], "QUESTION"))
  const cautionRows = rows.filter((row) => row.pain.state === "PRESENT" || row.recoveryScore != null && row.recoveryScore <= 3 || row.sleepHours != null && row.sleepHours < 6)
  if (rows.some((row) => row.soreness.state === "PRESENT")) observations.push(claim("反馈中有酸痛；酸痛不等于疼痛或伤病，这里不作诊断。", rows.filter((row) => row.soreness.state === "PRESENT").map((row) => row.followupId), "BOUNDARY"))
  if (cautionRows.length) observations.push(claim("有报告疼痛、较低主观恢复或短睡眠的记录，先核对当前情况；这条观察不生成下一课处方、不确认安全回归。", cautionRows.map((row) => row.followupId), "BOUNDARY"))
  return { status: multiple ? "MULTIPLE_RECORDS" : cautionRows.length ? "CAUTION" : evidenceGaps.length || rows.length === 0 ? "NEEDS_INPUT" : "OBSERVATION_ONLY", facts, observations, evidenceGaps, sources, clearance: "UNKNOWN" }
}
