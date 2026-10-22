import { sleepHoursText } from '../health/observation'
import { currentAthleteId } from "./events.ts"
import type { ImportCompleteness } from "./import-completeness.ts"
import { currentStore, readEnvelope, writeEnvelope } from "./storage.ts"
import { appendRetained, retainNewest, MAX_CONFIRMED_IMPORTS } from "./import-retention.ts"

export type ImportFieldStatus = "RECORDED" | "ABSENT" | "AMBIGUOUS" | "CONFLICTING"
export type ImportSport = "RUNNING" | "STRENGTH" | "MIXED" | "UNKNOWN"
export type ImportInputKind = "TEXT" | "IMAGE" | "MULTI_IMAGE"
export type ImportSourceKind = "text" | `image-${1 | 2 | 3 | 4}` | "user-edited" | "user-confirmed"

export type ImportField<T> = {
  value: T | null
  status: ImportFieldStatus
  sourceIds: string[]
}

export type ImportedRunningSegment = {
  id: string
  kind: "REPETITION" | "CONTINUOUS" | "RECOVERY" | "UNKNOWN"
  round: ImportField<number>
  repeat: ImportField<number>
  distanceMeters: ImportField<number>
  durationSeconds: ImportField<number>
  recoverySeconds: ImportField<number>
  recoveryScope?: "AFTER_REPEAT" | "AFTER_ROUND" | "UNSPECIFIED"
  averageHeartRateBpm?: ImportField<number>
  heartRateMethod?: ImportField<string>
  completion: "COMPLETED" | "SKIPPED" | "NOT_RECORDED"
  sourceIds: string[]
}

export type ImportedStrengthSet = {
  id: string
  exerciseName: ImportField<string>
  setOrdinal: ImportField<number>
  weightKg: ImportField<number>
  repetitions: ImportField<number>
  durationSeconds: ImportField<number>
  recoverySeconds: ImportField<number>
  completion: "COMPLETED" | "SKIPPED" | "NOT_RECORDED"
  sourceIds: string[]
}

export type TrainingImportCandidate = {
  sport: ImportSport
  occurredAt: ImportField<string>
  title: ImportField<string>
  durationSeconds: ImportField<number>
  totalDistanceMeters: ImportField<number>
  runningStructure: "REPEATED" | "CONTINUOUS" | "MIXED" | "UNAVAILABLE"
  runningSegments: ImportedRunningSegment[]
  strengthSets: ImportedStrengthSet[]
  sessionRpe: ImportField<number>
  subjectiveRecovery: ImportField<number>
  sleepHours: ImportField<number>
  pain: ImportField<{ location: string; intensity: number | null }>
  soreness: ImportField<{ location: string; intensity: number | null }>
  uncertainFields: string[]
  conflicts: string[]
  warnings: string[]
}

export type TrainingImportDraft = TrainingImportCandidate & {
  draftId: string
  /** Optional stable device-channel identity; never proof of authorization or training structure. */
  sourceRecordIdentity?: string
  /** v89.9.4：provider/accountRef/recordId/measuredAt/receivedAt（仅高驰账号读取会带；只做来源追溯，不参与判断）。 */
  provenance?: import("@/lib/health/brand-isolation").Provenance
  schemaVersion: 1
  createdAt: string
  inputKind: ImportInputKind
  inputSourceIds: ImportSourceKind[]
  userConfirmed: false
  importCompleteness?: ImportCompleteness
}

export type ConfirmedTrainingImport = Omit<TrainingImportDraft, "userConfirmed"> & {
  athleteId?: string
  confirmedImportId: string
  confirmedAt: string
  userConfirmed: true
  recordMode: "ACTUAL_ONLY"
  canonicalOccurrenceId: null
  sourceIds: string[]
  sources: { id: string; detail: string }[]
}

export type ImportReviewClaim = { text: string; citations: string[] }
export type TrainingImportReview = {
  facts: ImportReviewClaim[]
  observations: ImportReviewClaim[]
  evidenceGaps: ImportReviewClaim[]
  interpretations: ImportReviewClaim[]
  risks: ImportReviewClaim[]
  questions: string[]
  nextSessionBoundary: ImportReviewClaim | null
}

export const TRAINING_IMPORT_DRAFTS_KEY = "fr255-training-import-drafts-v1"
export const CONFIRMED_TRAINING_IMPORTS_KEY = "fr255-confirmed-training-imports-v1"

const MAX_DRAFTS = 20

function id(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function cleanIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80))].slice(0, 8) : []
}

function status(value: unknown): ImportFieldStatus {
  return value === "RECORDED" || value === "AMBIGUOUS" || value === "CONFLICTING" ? value : "ABSENT"
}

const SHORT_STATUS = { R: "RECORDED", A: "ABSENT", M: "AMBIGUOUS", C: "CONFLICTING" } as const

function field<T>(raw: unknown, parse: (value: unknown) => T | null): ImportField<T> {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const shortCode = item.s === "R" || item.s === "A" || item.s === "M" || item.s === "C" ? item.s : null
  const nextStatus = shortCode ? SHORT_STATUS[shortCode] : status(item.status)
  const value = parse(shortCode && !("value" in item) ? item.v : item.value)
  const sourceIds = cleanIds(shortCode && !("sourceIds" in item) ? item.i : item.sourceIds)
  return { value: nextStatus === "ABSENT" ? null : value, status: nextStatus === "RECORDED" && (value == null || sourceIds.length === 0) ? "AMBIGUOUS" : nextStatus, sourceIds }
}

function numberValue(value: unknown, min = 0, max = 1_000_000): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function integerValue(value: unknown, min = 0, max = 10_000): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null
}

function stringValue(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

function evidenceValue(value: unknown): { location: string; intensity: number | null } | null {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const location = stringValue(input.location, 40)
  const intensity = integerValue(input.intensity, 1, 10)
  return location ? { location, intensity } : null
}

function runningSegment(raw: unknown, index: number): ImportedRunningSegment {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const kind = item.kind === "REPETITION" || item.kind === "CONTINUOUS" || item.kind === "RECOVERY" ? item.kind : "UNKNOWN"
  const completion = item.completion === "COMPLETED" || item.completion === "SKIPPED" ? item.completion : "NOT_RECORDED"
  return {
    id: stringValue(item.id, 80) ?? `run-${index + 1}`,
    kind,
    round: field(item.round, (value) => integerValue(value, 1, 100)),
    repeat: field(item.repeat, (value) => integerValue(value, 1, 100)),
    distanceMeters: field(item.distanceMeters, (value) => numberValue(value, 0.1, 1_000_000)),
    durationSeconds: field(item.durationSeconds, (value) => numberValue(value, 0.1, 1_000_000)),
    recoveryScope: item.recoveryScope === "AFTER_REPEAT" || item.recoveryScope === "AFTER_ROUND" ? item.recoveryScope : "UNSPECIFIED",
    averageHeartRateBpm: field(item.averageHeartRateBpm, (value) => integerValue(value, 20, 240)),
    heartRateMethod: field(item.heartRateMethod, (value) => stringValue(value, 60)),
    recoverySeconds: field(item.recoverySeconds, (value) => numberValue(value, 0, 100_000)),
    completion,
    sourceIds: cleanIds(item.sourceIds),
  }
}

function strengthSet(raw: unknown, index: number): ImportedStrengthSet {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const completion = item.completion === "COMPLETED" || item.completion === "SKIPPED" ? item.completion : "NOT_RECORDED"
  return {
    id: stringValue(item.id, 80) ?? `set-${index + 1}`,
    exerciseName: field(item.exerciseName, (value) => stringValue(value, 80)),
    setOrdinal: field(item.setOrdinal, (value) => integerValue(value, 1, 100)),
    weightKg: field(item.weightKg, (value) => numberValue(value, 0, 1_000)),
    repetitions: field(item.repetitions, (value) => integerValue(value, 0, 1_000)),
    durationSeconds: field(item.durationSeconds, (value) => numberValue(value, 0.1, 100_000)),
    recoverySeconds: field(item.recoverySeconds, (value) => numberValue(value, 0, 100_000)),
    completion,
    sourceIds: cleanIds(item.sourceIds),
  }
}

export function normalizeTrainingImportCandidate(raw: unknown): TrainingImportCandidate {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const sport: ImportSport = item.sport === "RUNNING" || item.sport === "STRENGTH" || item.sport === "MIXED" ? item.sport : "UNKNOWN"
  const runningStructure = item.runningStructure === "REPEATED" || item.runningStructure === "CONTINUOUS" || item.runningStructure === "MIXED" ? item.runningStructure : "UNAVAILABLE"
  const runningSegments = Array.isArray(item.runningSegments) ? item.runningSegments.slice(0, 48).map(runningSegment) : []
  const strengthSets = Array.isArray(item.strengthSets) ? item.strengthSets.slice(0, 80).map(strengthSet) : []
  return {
    sport,
    occurredAt: field(item.occurredAt, (value) => stringValue(value, 40)),
    title: field(item.title, (value) => stringValue(value, 120)),
    durationSeconds: field(item.durationSeconds, (value) => numberValue(value, 0.1, 1_000_000)),
    totalDistanceMeters: field(item.totalDistanceMeters, (value) => numberValue(value, 0.1, 1_000_000)),
    runningStructure,
    runningSegments,
    strengthSets,
    sessionRpe: field(item.sessionRpe, (value) => integerValue(value, 0, 10)),
    subjectiveRecovery: field(item.subjectiveRecovery, (value) => integerValue(value, 1, 10)),
    sleepHours: field(item.sleepHours, (value) => numberValue(value, 0.1, 24)),
    pain: field(item.pain, evidenceValue),
    soreness: field(item.soreness, evidenceValue),
    uncertainFields: Array.isArray(item.uncertainFields) ? item.uncertainFields.filter((entry): entry is string => typeof entry === "string").slice(0, 40) : [],
    conflicts: Array.isArray(item.conflicts) ? item.conflicts.filter((entry): entry is string => typeof entry === "string").slice(0, 40) : [],
    warnings: Array.isArray(item.warnings) ? item.warnings.filter((entry): entry is string => typeof entry === "string").slice(0, 40) : [],
  }
}

export function createTrainingImportDraft(candidate: unknown, inputKind: ImportInputKind, inputSourceIds: ImportSourceKind[]): TrainingImportDraft {
  return {
    ...normalizeTrainingImportCandidate(candidate),
    draftId: id("draft"),
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    inputKind,
    inputSourceIds: [...new Set(inputSourceIds)].slice(0, 5),
    userConfirmed: false,
  }
}

export function loadTrainingImportDrafts(): TrainingImportDraft[] {
  const data = readEnvelope<TrainingImportDraft[]>(TRAINING_IMPORT_DRAFTS_KEY, []).data
  return Array.isArray(data) ? data.filter((item) => item?.schemaVersion === 1 && item.userConfirmed === false).slice(-MAX_DRAFTS) : []
}

export function saveTrainingImportDraft(draft: TrainingImportDraft): boolean {
  const current = loadTrainingImportDrafts().filter((item) => item.draftId !== draft.draftId)
  return Boolean(writeEnvelope(TRAINING_IMPORT_DRAFTS_KEY, [...current, draft].slice(-MAX_DRAFTS)))
}

export function discardTrainingImportDraft(draftId: string): boolean {
  return Boolean(writeEnvelope(TRAINING_IMPORT_DRAFTS_KEY, loadTrainingImportDrafts().filter((item) => item.draftId !== draftId)))
}

export function loadConfirmedTrainingImports(): ConfirmedTrainingImport[] {
  const data = readEnvelope<ConfirmedTrainingImport[]>(CONFIRMED_TRAINING_IMPORTS_KEY, []).data
  return Array.isArray(data) ? data.filter((item) => item?.schemaVersion === 1 && item.userConfirmed === true) : []
}

/** Permanently remove one confirmed, standalone import. Never touches canonical sessions or other imports. */
export function permanentlyDeleteConfirmedTrainingImport(confirmedImportId: string): boolean {
  if (!confirmedImportId.trim()) return false
  const before = loadConfirmedTrainingImports()
  if (!before.some((item) => item.confirmedImportId === confirmedImportId)) return false
  const after = before.filter((item) => item.confirmedImportId !== confirmedImportId)
  const written = writeEnvelope(CONFIRMED_TRAINING_IMPORTS_KEY, after)
  if (!written) return false
  return !loadConfirmedTrainingImports().some((item) => item.confirmedImportId === confirmedImportId)
}

export function trainingImportSources(record: TrainingImportDraft | ConfirmedTrainingImport): { id: string; detail: string }[] {
  const result: { id: string; detail: string }[] = []
  const push = (suffix: string, detail: string, fieldValue: ImportField<unknown>) => {
    if (fieldValue.status !== "RECORDED" || fieldValue.value == null) return
    result.push({ id: `import:${record.draftId}:${suffix}`, detail })
  }
  push("occurred-at", `训练时间 ${record.occurredAt.value}`, record.occurredAt)
  push("duration", `已确认总时长 ${record.durationSeconds.value} 秒`, record.durationSeconds)
  push("distance", `已确认总距离 ${record.totalDistanceMeters.value} 米`, record.totalDistanceMeters)
  push("rpe", `已确认 RPE ${record.sessionRpe.value}/10`, record.sessionRpe)
  push("recovery", `已确认主观恢复 ${record.subjectiveRecovery.value}/10`, record.subjectiveRecovery)
  push("sleep", `已确认睡眠 ${record.sleepHours.value == null ? "未知" : sleepHoursText(record.sleepHours.value)}`, record.sleepHours)
  push("pain", `已确认疼痛 ${record.pain.value?.location ?? ""} ${record.pain.value?.intensity ?? "程度未记录"}`, record.pain)
  push("soreness", `已确认酸痛 ${record.soreness.value?.location ?? ""} ${record.soreness.value?.intensity ?? "程度未记录"}`, record.soreness)
  for (const [index, segment] of record.runningSegments.entries()) {
    const value = (field: ImportField<number>) => field.status === "RECORDED" ? field.value : `未确认（${field.status}）`
    const values = [`距离 ${value(segment.distanceMeters)} 米`, `用时 ${value(segment.durationSeconds)} 秒`, `恢复 ${value(segment.recoverySeconds)} 秒`]
    result.push({ id: `import:${record.draftId}:run-${index + 1}`, detail: `跑步分段 ${index + 1}；状态 ${segment.completion}：${values.join("；")}；未记录不等于没做` })
  }
  for (const [index, set] of record.strengthSets.entries()) {
    const value = (field: ImportField<unknown>) => field.status === "RECORDED" ? field.value : `未确认（${field.status}）`
    result.push({ id: `import:${record.draftId}:set-${index + 1}`, detail: `力量组 ${index + 1}；状态 ${set.completion}：${value(set.exerciseName)}；${value(set.weightKg)} kg；${value(set.repetitions)} 次；${value(set.durationSeconds)} 秒；未记录不等于没做` })
  }
  return result.slice(0, 140)
}

export function criticalImportGaps(input: TrainingImportDraft): string[] {
  const draft = { ...input, ...normalizeTrainingImportCandidate(input) }
  const gaps: string[] = []
  if (draft.sport === "UNKNOWN") gaps.push("请选择跑步、力量或混合训练")
  if (draft.occurredAt.status !== "RECORDED" || !draft.occurredAt.value) gaps.push("请确认训练时间")
  else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(draft.occurredAt.value) || !Number.isFinite(Date.parse(draft.occurredAt.value))) gaps.push("训练时间需要有效日期、时刻和时区")
  if (draft.conflicts.length > 0) gaps.push("请先处理冲突字段")
  if ([draft.durationSeconds, draft.totalDistanceMeters, draft.sessionRpe, draft.subjectiveRecovery, draft.sleepHours, draft.pain, draft.soreness].some((item) => item.status === "CONFLICTING")) gaps.push("训练反馈仍有冲突")
  if (draft.runningSegments.some((segment) => [segment.round, segment.repeat, segment.distanceMeters, segment.durationSeconds, segment.recoverySeconds, segment.averageHeartRateBpm ?? {status:"ABSENT"}, segment.heartRateMethod ?? {status:"ABSENT"}].some((item) => item.status === "CONFLICTING"))) gaps.push("跑步分段仍有冲突")
  if (draft.strengthSets.some((set) => [set.exerciseName, set.setOrdinal, set.weightKg, set.repetitions, set.durationSeconds].some((item) => item.status === "CONFLICTING"))) gaps.push("力量组仍有冲突")
  const hasRunningActual = [draft.totalDistanceMeters, draft.durationSeconds].some((item) => item.status === "RECORDED" && item.value != null) || draft.runningSegments.some((segment) => segment.completion === "COMPLETED" && [segment.distanceMeters, segment.durationSeconds].some((item) => item.status === "RECORDED" && item.value != null))
  const durationOnlyStrength = draft.sport === "STRENGTH" && draft.durationSeconds.status === "RECORDED" && draft.durationSeconds.value != null
  const hasStrengthActual = durationOnlyStrength || draft.strengthSets.some((set) => set.completion === "COMPLETED" && set.exerciseName.status === "RECORDED" && [set.repetitions, set.durationSeconds].some((item) => item.status === "RECORDED" && item.value != null))
  if ((draft.sport === "RUNNING" || draft.sport === "MIXED") && !hasRunningActual) gaps.push("没有可确认的跑步实际记录；计划或未记录槽位不能当作实际完成")
  if ((draft.sport === "STRENGTH" || draft.sport === "MIXED") && !hasStrengthActual) gaps.push("没有可确认的力量实际记录")
  if (new Set(draft.runningSegments.map((item) => item.id)).size !== draft.runningSegments.length || new Set(draft.strengthSets.map((item) => item.id)).size !== draft.strengthSets.length) gaps.push("分段或力量组标识重复，请核对")
  if (input.runningSegments.length > 48 || input.strengthSets.length > 80) gaps.push("训练记录超过可处理上限，请分开导入")
  if (input.importCompleteness && input.importCompleteness.status !== "COMPLETE" && !input.importCompleteness.acknowledged) gaps.push(input.importCompleteness.note)
  return [...new Set(gaps)]
}

export function confirmTrainingImport(input: TrainingImportDraft): { ok: true; record: ConfirmedTrainingImport; duplicate: boolean } | { ok: false; reason: string; code?: 'PERSISTENCE_FAILED' | 'PERSISTENCE_UNCONFIRMED' } {
  const draft = { ...input, ...normalizeTrainingImportCandidate(input) }
  if (!draft.draftId || draft.draftId.length > 55) return { ok: false, reason: "草稿标识无效" }
  const existing = loadConfirmedTrainingImports().find((item) => item.draftId === draft.draftId)
  if (existing) return { ok: true, record: existing, duplicate: true }
  const gaps = criticalImportGaps(input)
  if (gaps.length) return { ok: false, reason: gaps.join("；") }
  const confirmed: ConfirmedTrainingImport = {
    ...draft,
    athleteId: currentAthleteId(),
    confirmedImportId: `confirmed:${draft.draftId}`,
    confirmedAt: new Date().toISOString(),
    userConfirmed: true,
    recordMode: "ACTUAL_ONLY",
    canonicalOccurrenceId: null,
    sourceIds: [],
    sources: [],
  }
  confirmed.sources = trainingImportSources(draft)
  confirmed.sourceIds = confirmed.sources.map((item) => item.id)
  // v86.2：按训练发生时间保留最新的（旧版按写入顺序截取，佳明“新的在前”导致最新活动被挤掉）
  const next = appendRetained(retainNewest(loadConfirmedTrainingImports()), confirmed)
  if (!next) return { ok: false, reason: `早于保留范围（只保留最近 ${MAX_CONFIRMED_IMPORTS} 条导入），未保存` }
  const written = writeEnvelope(CONFIRMED_TRAINING_IMPORTS_KEY, next)
  try {
    const raw = currentStore()?.getItem(CONFIRMED_TRAINING_IMPORTS_KEY)
    if (!written || raw !== JSON.stringify(written)) {
      const stored = raw == null ? null : JSON.parse(raw)
      // An automatic retry is allowed only when the readback proves absence.
      // A throw or an ambiguous write may already have saved this record.
      const absent = raw == null || Array.isArray(stored?.data) && !stored.data.some((item: { confirmedImportId?: string; draftId?: string }) => item?.confirmedImportId === confirmed.confirmedImportId || item?.draftId === confirmed.draftId)
      return absent ? { ok: false, reason: "确认记录保存失败，请重试", code: 'PERSISTENCE_FAILED' }
        : { ok: false, reason: "确认记录保存结果无法核对，请刷新后复核", code: 'PERSISTENCE_UNCONFIRMED' }
    }
  } catch { return { ok: false, reason: "确认记录保存结果无法核对，请刷新后复核", code: 'PERSISTENCE_UNCONFIRMED' } }
  discardTrainingImportDraft(draft.draftId)
  return { ok: true, record: confirmed, duplicate: false }
}

// This checks a client packet's internal consistency, not its authenticity in localStorage.
export function normalizeConfirmedTrainingImport(raw: unknown): ConfirmedTrainingImport | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as ConfirmedTrainingImport
  if (item.schemaVersion !== 1 || item.userConfirmed !== true || item.recordMode !== "ACTUAL_ONLY" || item.canonicalOccurrenceId !== null) return null
  if (typeof item.draftId !== "string" || !/^[\w-]{1,55}$/.test(item.draftId) || item.confirmedImportId !== `confirmed:${item.draftId}`) return null
  if (!Array.isArray(item.runningSegments) || !Array.isArray(item.strengthSets) || item.runningSegments.length > 48 || item.strengthSets.length > 80) return null
  if (!["TEXT", "IMAGE", "MULTI_IMAGE"].includes(item.inputKind) || !Array.isArray(item.inputSourceIds) || item.inputSourceIds.some((id) => !["text", "image-1", "image-2", "image-3", "image-4", "user-edited", "user-confirmed"].includes(id))) return null
  if (typeof item.createdAt !== "string" || typeof item.confirmedAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.confirmedAt))) return null
  const record = { ...item, ...normalizeTrainingImportCandidate(item) }
  if (criticalImportGaps({ ...record, userConfirmed: false }).length) return null
  record.sources = trainingImportSources(record)
  record.sourceIds = record.sources.map((source) => source.id)
  return record
}

function numericClaims(text: string): number[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0])).filter(Number.isFinite)
}

export function assessTrainingImportReview(record: ConfirmedTrainingImport, raw: unknown): { review: TrainingImportReview | null; code: string } {
  const fail = (code: string) => ({ review: null, code })
  if (!raw || typeof raw !== "object") return fail("BAD_SHAPE")
  const input = raw as Record<string, unknown>
  const allowed = new Map(trainingImportSources(record).map((source) => [source.id, source.detail]))
  const incompleteSources = new Set([
    ...record.runningSegments.flatMap((segment, index) => segment.completion !== "COMPLETED" ? [`import:${record.draftId}:run-${index + 1}`] : []),
    ...record.strengthSets.flatMap((set, index) => set.completion !== "COMPLETED" ? [`import:${record.draftId}:set-${index + 1}`] : []),
  ])
  const claims = (value: unknown): ImportReviewClaim[] | null => {
    if (!Array.isArray(value) || value.length > 16) return null
    const result: ImportReviewClaim[] = []
    for (const item of value) {
      if (!item || typeof item !== "object") return null
      const claim = item as Record<string, unknown>
      if (typeof claim.text !== "string" || claim.text.trim().length === 0 || claim.text.length > 300) return null
      if (!Array.isArray(claim.citations) || claim.citations.length > 8 || claim.citations.some((id) => typeof id !== "string" || !allowed.has(id))) return null
      const citations = cleanIds(claim.citations)
      const numbers = numericClaims(claim.text)
      if (numbers.length && citations.some((id) => incompleteSources.has(id))) return null
      if (numbers.length && !numbers.every((number) => citations.some((citation) => numericClaims(allowed.get(citation) ?? "").includes(number)))) return null
      if (citations.length === 0 && numbers.length > 0) return null
      if (/(?:已记录|已确认).{0,15}疼痛/.test(claim.text) && !citations.includes(`import:${record.draftId}:pain`)) return null
      if (/(?:已记录|已确认).{0,15}酸痛/.test(claim.text) && !citations.includes(`import:${record.draftId}:soreness`)) return null
      result.push({ text: claim.text.trim(), citations })
    }
    return result
  }
  const facts = claims(input.facts)
  const observations = claims(input.observations)
  const evidenceGaps = claims(input.evidenceGaps)
  const interpretations = claims(input.interpretations)
  const risks = claims(input.risks)
  const next = input.nextSessionBoundary == null ? null : claims([input.nextSessionBoundary])?.[0] ?? null
  if (!facts || !observations || !evidenceGaps || !interpretations || !risks) return fail("BAD_SHAPE")
  if (input.nextSessionBoundary != null && !next) return fail("NEXT_BOUNDARY")
  if (facts.some((claim) => claim.citations.length === 0)) return fail("FACT_SOURCE")
  const questions = Array.isArray(input.questions) ? input.questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.slice(0, 200)).slice(0, 6) : []
  const allClaims = [...facts, ...observations, ...evidenceGaps, ...interpretations, ...risks, ...(next ? [next] : [])]
  const allText = allClaims.map((item) => item.text).concat(questions).join(" ")
  if (/(?:长期|整体)?能力(?:提高|下降|变强|变差)|已经安全回归|已经恢复正常|没有受伤风险/.test(allText)) return fail("ABILITY_OR_CLEARANCE")
  if (record.recordMode === "ACTUAL_ONLY" && /(?:完成|达到|偏离|超过|低于).{0,6}(?:计划|目标)/.test(allText)) return fail("PLAN_COMPARE")
  const positiveText = allText.replace(/(?:不能|不可|不|不得|禁止|无法)[^。；，？！]{0,8}(?:加量|加组|加重|提速|提高强度|没有疼痛|已恢复|恢复正常)/g, "")
  if (/(?:加量|加组|加重|提速|提高强度|没有疼痛|已恢复|恢复正常)/.test(positiveText)) return fail("PRESCRIPTION")
  const highRpeMissingRecovery = record.sessionRpe.status === "RECORDED" && (record.sessionRpe.value ?? 0) >= 8 && record.subjectiveRecovery.status !== "RECORDED"
  if (highRpeMissingRecovery && next && /保持|减量|恢复训练|下一课.{0,8}(?:跑|练)/.test(next.text)) return fail("HIGH_RPE_HIDDEN_PRESCRIPTION")
  if (highRpeMissingRecovery && !questions.some((item) => /恢复/.test(item))) return fail("MISSING_RECOVERY_QUESTION")
  const cited = new Set(allClaims.flatMap((item) => item.citations))
  if (record.pain.status === "RECORDED" && record.soreness.status === "RECORDED" && (!cited.has(`import:${record.draftId}:pain`) || !cited.has(`import:${record.draftId}:soreness`))) return fail("PAIN_SORENESS_SPLIT")
  return { review: { facts, observations, evidenceGaps, interpretations, risks, questions, nextSessionBoundary: next }, code: "OK" }
}

export function guardTrainingImportReview(record: ConfirmedTrainingImport, raw: unknown): TrainingImportReview | null {
  return assessTrainingImportReview(record, raw).review
}
