import { currentAthleteId, loadEvents } from "../core/events.ts"
import { currentStore } from "../core/storage.ts"
import { confirmTrainingImport, createTrainingImportDraft, criticalImportGaps, loadConfirmedTrainingImports, normalizeTrainingImportCandidate, type ImportField, type TrainingImportDraft } from "../core/training-import.ts"
import { BODY_FIELDS, upsertCheck, type BodyCheck } from "../nutrition/body.ts"
import { parseQuickLog, type Parsed } from "./quick-log.ts"

export const QUICK_LOG_DRAFT_KEY = "fk-quicklog-draft-v1"
export const QUICK_LOG_NOTES_KEY = "fk-notes-v1"
export type QuickLogAttachment = { id: string; name: string; url: string }
export type QuickLogDraft = {
  id: string; date: string; at: string; text: string; atts: QuickLogAttachment[]
  rpe: number | null; confirmActual: boolean; athleteId: string
}
/** New fields are additive: old notes remain notes and never generate facts on read. */
export type QuickLogNote = {
  id: string; date: string; at: string; text: string; atts: QuickLogAttachment[]; parsed?: string
  athleteId?: string; generatedRecordIds?: string[]; saveState?: "pending" | "saved"
  submission?: { rpe: number | null; confirmActual: boolean }
}
export type QuickLogSaveResult =
  | { ok: true; note: QuickLogNote; message: string }
  | { ok: false; reason: string; partial: "none" | "note" | "training"; generatedRecordIds: string[] }

const owns = (row: { athleteId?: string }) => (row.athleteId ?? "local") === currentAthleteId()
const store = () => { const value = currentStore(); if (!value) throw new Error("本机存储不可用"); return value }
function allNotes(): QuickLogNote[] {
  const raw = store().getItem(QUICK_LOG_NOTES_KEY)
  if (!raw) return []
  const rows: unknown = JSON.parse(raw)
  if (!Array.isArray(rows)) throw new Error("已有笔记格式无法读取，未覆盖原记录")
  return rows as QuickLogNote[]
}
function writeRaw(key: string, value: unknown) {
  const raw = JSON.stringify(value), box = store()
  box.setItem(key, raw)
  if (box.getItem(key) !== raw) throw new Error("本机存储未确认写入")
}
export function loadQuickLogNotes(): QuickLogNote[] {
  try { return allNotes().filter(row => row && typeof row.id === "string" && owns(row)) } catch { return [] }
}
export function newQuickLogDraft(date = localDay(new Date().toISOString())): QuickLogDraft {
  const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return { id: `n-${token}`, date, at: new Date().toISOString(), text: "", atts: [], rpe: null, confirmActual: false, athleteId: currentAthleteId() }
}
export function quickLogDraftForNote(note: QuickLogNote): QuickLogDraft {
  return { id: note.id, date: note.date, at: note.at, text: note.text, atts: note.atts ?? [], rpe: note.submission?.rpe ?? null, confirmActual: note.submission?.confirmActual ?? false, athleteId: note.athleteId ?? "local" }
}
export function saveQuickLogDraft(draft: QuickLogDraft): boolean {
  try {
    const pending = allNotes().find(note => note.id === draft.id && note.saveState === "pending")
    if (pending && !sameSubmission(pending, draft)) return false
    writeRaw(QUICK_LOG_DRAFT_KEY, draft); return true
  } catch { return false }
}
export function loadQuickLogDraft(date: string): QuickLogDraft | null {
  try {
    const raw = store().getItem(QUICK_LOG_DRAFT_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || typeof saved.text !== "string" || !Array.isArray(saved.atts) || !owns(saved)) return null
    const draft = { ...newQuickLogDraft(date), ...saved } as QuickLogDraft
    const note = loadQuickLogNotes().find(row => row.id === draft.id)
    if (note?.saveState === "pending") return quickLogDraftForNote(note)
    // A failed draft cleanup must not resurrect a successfully committed note.
    if (note?.saveState === "saved" && sameSubmission(note, draft)) return null
    return draft
  } catch { return null }
}
export function clearQuickLogDraft(): void {
  try { (store() as { removeItem?: (key: string) => void }).removeItem?.(QUICK_LOG_DRAFT_KEY) } catch { /* The saved note is the commit marker. */ }
}
export function parsedQuickLog(text: string): Parsed | null {
  const lines = text.split(/\n|；|;/).map(line => parseQuickLog(line.trim())).filter(row => row.kind !== "unknown")
  return lines.length === 1 ? lines[0] : null
}
function sameSubmission(note: QuickLogNote, draft: QuickLogDraft): boolean {
  return note.date === draft.date && note.text === draft.text.trim() && JSON.stringify(note.atts ?? []) === JSON.stringify(draft.atts) && note.submission?.rpe === draft.rpe && note.submission?.confirmActual === draft.confirmActual
}
const field = <T,>(value: T | null): ImportField<T> => value == null ? { value: null, status: "ABSENT", sourceIds: [] } : { value, status: "RECORDED", sourceIds: ["user-confirmed"] }

/** A quick log is actual-only. It never creates a synthetic scheduled session. */
export function quickLogTrainingDraft(draft: QuickLogDraft, parsed: Parsed): TrainingImportDraft | null {
  if (!draft.confirmActual || (parsed.kind !== "run" && parsed.kind !== "strength")) return null
  const run = parsed.kind === "run" ? parsed : null, strength = parsed.kind === "strength" ? parsed : null
  const candidate = {
    sport: run ? "RUNNING" : "STRENGTH",
    occurredAt: field(draft.at),
    title: field(run ? `${run.title}${run.km != null ? ` ${run.km} 公里` : ""} · 计划外实际` : `${strength!.name} ${strength!.sets}×${strength!.reps} · 计划外实际`),
    durationSeconds: field(run?.minutes != null ? run.minutes * 60 : null),
    totalDistanceMeters: field(run?.km != null ? run.km * 1000 : null),
    // The user confirmed the total, not a particular continuous/interval protocol.
    runningStructure: "UNAVAILABLE",
    runningSegments: run ? [{ id: "reported-total", kind: "UNKNOWN", round: field(null), repeat: field(null), distanceMeters: field(run.km != null ? run.km * 1000 : null), durationSeconds: field(run.minutes != null ? run.minutes * 60 : null), recoverySeconds: field(null), completion: "COMPLETED", sourceIds: ["user-confirmed"] }] : [],
    strengthSets: strength ? Array.from({ length: strength.sets }, (_, index) => ({ id: `reported-set-${index + 1}`, exerciseName: field(strength.name), setOrdinal: field(index + 1), weightKg: field(strength.kg), repetitions: field(strength.reps), durationSeconds: field(null), recoverySeconds: field(null), completion: "COMPLETED", sourceIds: ["user-confirmed"] })) : [],
    sessionRpe: field(draft.rpe != null && Number.isInteger(draft.rpe) && draft.rpe >= 1 && draft.rpe <= 10 ? draft.rpe : null),
    subjectiveRecovery: field(null), sleepHours: field(null), pain: field(null), soreness: field(null),
    uncertainFields: ["训练开始时刻未记录；时间戳是笔记记录时刻，仅用于日期归档"], conflicts: [],
    warnings: [`记一笔来源：${draft.id}；计划外实际（用户自报）`, "未关联或对照原计划；未填数据不补全", ...(run?.pace ? [`自报/按明确总距与时长计算的配速：${run.pace}；不据此补算时长`] : [])],
  }
  return { ...createTrainingImportDraft(candidate, "TEXT", ["user-confirmed"]), draftId: `qlog-${draft.id}` }
}
function notifyActivities() {
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event("fk-training-activities-changed")) } catch { /* Node / listener isolation. */ }
}

export function saveQuickLog(input: QuickLogDraft): QuickLogSaveResult {
  let partial: "none" | "note" | "training" = "none", generatedRecordIds: string[] = []
  try {
    if (!owns(input) || !/^n-[\w-]{1,47}$/.test(input.id)) throw new Error("草稿归属或标识已变化，请重新打开原草稿")
    if (!input.text.trim() && !input.atts.length) throw new Error("先写点什么或加一张截图")
    if (!Number.isFinite(Date.parse(input.at)) || input.date !== localDay(input.at)) throw new Error("草稿日期与记录日期不一致，请恢复原草稿后保存")
    const draft = { ...input, text: input.text.trim() }, rows = allNotes()
    const prior = rows.find(note => note.id === draft.id)
    if (prior) {
      generatedRecordIds = [
        ...(prior.generatedRecordIds ?? []).filter(id => loadConfirmedTrainingImports().some(row => row.confirmedImportId === id && (row.athleteId ?? "local") === currentAthleteId())),
        ...loadEvents().filter(event => event.athlete_id === currentAthleteId() && (event.payload.bodyCheck as { sourceNoteId?: string } | undefined)?.sourceNoteId === draft.id).map(event => event.event_id),
      ]
      partial = generatedRecordIds.length ? "training" : "note"
    }
    if (prior && (!owns(prior) || !sameSubmission(prior, draft))) throw new Error("该草稿已有保存内容，未覆盖或重复生成训练；请从下方待完成笔记恢复原草稿，再重试。已存训练可到日志核对，本入口不覆盖关联训练")
    if (prior?.saveState === "saved") return { ok: true, note: prior, message: prior.parsed ?? "已保存为笔记" }
    const parsed = parsedQuickLog(draft.text), training = parsed ? quickLogTrainingDraft(draft, parsed) : null
    // Reject correctable input before creating a pending note: it must remain editable.
    const gaps = training ? criticalImportGaps(training) : []
    if (gaps.length) throw new Error(`${gaps.join("；")}。可补充数据，或取消实际确认后只存笔记`)
    const weightRange = BODY_FIELDS.find(item => item.key === "weight")!
    if (parsed?.kind === "weight" && (parsed.kg < weightRange.min || parsed.kg > weightRange.max)) throw new Error(`体重应为 ${weightRange.min}–${weightRange.max} 公斤，请核对输入`)
    const existingTraining = training && loadConfirmedTrainingImports().find(row => row.draftId === training.draftId)
    if (existingTraining && ((existingTraining.athleteId ?? "local") !== currentAthleteId() || JSON.stringify(normalizeTrainingImportCandidate(existingTraining)) !== JSON.stringify(normalizeTrainingImportCandidate(training)))) throw new Error("关联训练标识冲突，未覆盖已有训练；请在训练日志核对")
    // Persist identity and original payload before either side effect, so refresh/retry is idempotent.
    writeRaw(QUICK_LOG_DRAFT_KEY, draft)
    generatedRecordIds = training ? [`confirmed:${training.draftId}`] : []
    let note: QuickLogNote = { id: draft.id, date: draft.date, at: draft.at, text: draft.text, atts: draft.atts, athleteId: draft.athleteId, generatedRecordIds, saveState: "pending", submission: { rpe: draft.rpe, confirmActual: draft.confirmActual } }
    const putNote = () => writeRaw(QUICK_LOG_NOTES_KEY, [note, ...allNotes().filter(row => row.id !== note.id)])
    putNote(); partial = "note"
    let message = "已保存为笔记"
    if (training) {
      const saved = confirmTrainingImport(training)
      if (!saved.ok) throw new Error(`训练记录未保存：${saved.reason}`)
      partial = "training"; notifyActivities(); message = "已保存笔记，并记入计划外实际训练"
    } else if (parsed?.kind === "weight") {
      // Body events retain sourceNoteId as well, so a retry cannot append another measurement event.
      const existing = loadEvents().find(event => event.athlete_id === currentAthleteId() && event.event_type === "BODY_MEASUREMENT_RECORDED" && (event.payload.bodyCheck as (BodyCheck & { sourceNoteId?: string }) | undefined)?.sourceNoteId === draft.id)
      if (existing) generatedRecordIds = [existing.event_id]
      else {
        const check: Omit<BodyCheck, "id"> & { sourceNoteId: string } = { date: draft.date, weight: parsed.kg, sourceNoteId: draft.id }
        if (!upsertCheck(check)) throw new Error("身体数据未保存，请重试")
        const event = loadEvents().find(row => row.athlete_id === currentAthleteId() && (row.payload.bodyCheck as { sourceNoteId?: string } | undefined)?.sourceNoteId === draft.id)
        if (!event) throw new Error("身体数据写入状态无法确认，请重试原草稿")
        generatedRecordIds = [event.event_id]
      }
      partial = "training"; message = `已保存笔记，并记体重 ${parsed.kg} kg`
    }
    note = { ...note, generatedRecordIds, saveState: "saved", parsed: message }
    putNote()
    clearQuickLogDraft()
    return { ok: true, note, message }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "本机存储已满或被禁用"
    const prefix = partial === "training" ? "关联数据已保存；本次保存未完成，请核对后重试原草稿（不会重复入库）" : partial === "note" ? "笔记已保存，关联数据尚未保存；请重试原草稿" : "保存未完成，尚未生成训练记录"
    return { ok: false, reason: `${prefix}。${detail}。输入仍保留在当前页面；已写入的原草稿可恢复。`, partial, generatedRecordIds: partial === "training" ? generatedRecordIds : [] }
  }
}
function localDay(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
/** This action only removes the note. Training facts and corrections are untouched. */
export function deleteQuickLogNote(id: string): { ok: true } | { ok: false; reason: string } {
  try {
    const rows = allNotes(), note = rows.find(row => row.id === id)
    if (!note || !owns(note)) return { ok: false, reason: "笔记不存在或不属于当前用户" }
    if (note.saveState === "pending") return { ok: false, reason: "请先恢复原草稿并重试保存，确认关联数据状态后再仅删除笔记" }
    writeRaw(QUICK_LOG_NOTES_KEY, rows.filter(row => row !== note))
    return { ok: true }
  } catch { return { ok: false, reason: "笔记删除失败；原笔记与训练记录仍保留，请重试" } }
}
