import { currentAthleteId } from './events.ts'
import { importedFormalRows } from './coach-import-evidence.ts'
import { loadConfirmedTrainingImports, type ConfirmedTrainingImport } from './training-import.ts'
import { appendCorrection, listCorrections, type CorrectionField } from './training-correction.ts'
import { parseDecimalDraft } from '../ui/decimal-draft.ts'

export type ImportCorrectionTarget = {
  id: string; field: CorrectionField; setKey: string; sourceId: string
  label: string; value: number; originalValue: number; unit: string
}

/** Read the same effective rows used by the coach; never rewrite the import. */
export function importCorrectionTargets(record: ConfirmedTrainingImport, asOf = new Date().toISOString()): ImportCorrectionTarget[] {
  const rows = importedFormalRows([record], currentAthleteId(), asOf, listCorrections(record.confirmedImportId))
  const replaced = new Set(rows.map(row => row.supersedesRecordId).filter(Boolean))
  const byId = new Map(rows.map(row => [row.recordId, row]))
  const rootId = (id: string): string => {
    const seen = new Set<string>()
    let row = byId.get(id)
    while (row?.supersedesRecordId && !seen.has(row.recordId)) {
      seen.add(row.recordId); row = byId.get(row.supersedesRecordId)
    }
    return row?.recordId ?? id
  }
  const definitions: Array<{root: string; aliases: string[]; field: CorrectionField; label: string; unit: string; original: number | null}> = []
  record.runningSegments.forEach((segment, i) => {
    if (segment.kind === 'RECOVERY') return
    const base = {root: `import:${record.draftId}:run-${i + 1}`, aliases: [segment.id, `run-${i + 1}`]}
    definitions.push({...base, field: 'duration', label: `第${i + 1}段用时`, unit: '秒', original: segment.durationSeconds.value})
    definitions.push({...base, field: 'distance', label: `第${i + 1}段距离`, unit: '米', original: segment.distanceMeters.value})
  })
  record.strengthSets.forEach((set, i) => {
    const aliases = [set.id, `set-${i + 1}`, `${set.exerciseName.value ?? 'unknown'}:${set.setOrdinal.value ?? i + 1}`]
    const label = `${set.exerciseName.value || '力量'}第${i + 1}组`
    for (const [field, metric, original, unit, name] of [
      ['weight', 'STRENGTH_KG', set.weightKg.value, 'kg', '重量'],
      ['reps', 'STRENGTH_REPS', set.repetitions.value, '次', '次数'],
      ['duration', 'STRENGTH_SECONDS', set.durationSeconds.value, '秒', '时长'],
    ] as const) definitions.push({root: `import:${record.draftId}:set-${i + 1}:${metric}`, aliases, field, label: label + name, unit, original})
  })
  const active = rows.filter(row => !replaced.has(row.recordId))
  return definitions.flatMap(def => {
    const found = active.filter(row => rootId(row.recordId) === def.root)
    if (found.length !== 1 || found[0].status !== 'OBSERVED' || found[0].value === null || def.original === null) return []
    // Match the formal projection's aliases. Ambiguous imported IDs cannot guess a target.
    const setKey = def.aliases.find(key => definitions.filter(other => other.field === def.field && other.aliases.includes(key) && active.some(row => rootId(row.recordId) === other.root)).length === 1)
    if (!setKey) return []
    const row = found[0]
    const value = def.field === 'distance' ? Number(row.protocol.match(/:(\d+(?:\.\d+)?)m$/)?.[1]) : row.value
    if (value === null || !Number.isFinite(value)) return []
    return [{id: `${def.root}:${def.field}`, field: def.field, setKey, sourceId: row.recordId, label: def.label, value, originalValue: def.original, unit: def.unit}]
  })
}

/** Re-read before committing: a stale screen must not overwrite a later correction. */
export function confirmImportLogCorrection(input: {occurrenceId: string; targetId: string; expectedSourceId: string; value: string; reason: string; confirmed: boolean}) {
  if (!input.confirmed || !input.reason.trim() || input.reason.trim().length > 300) return {ok: false as const, reason: '请核对修改并填写原因（最多300字）。'}
  const record = loadConfirmedTrainingImports().find(row => row.confirmedImportId === input.occurrenceId && (row.athleteId ?? 'local') === currentAthleteId())
  const target = record && importCorrectionTargets(record).find(row => row.id === input.targetId)
  if (!target || target.sourceId !== input.expectedSourceId) return {ok: false as const, reason: '原记录已变化或无法唯一关联，请重新打开核对；没有覆盖已有更正。'}
  const parsed = parseDecimalDraft(input.value, {min: target.field === 'weight' ? 0 : target.field === 'reps' ? 1 : 0.001, max: target.field === 'weight' || target.field === 'reps' ? 1000 : 1000000, integer: target.field === 'reps'})
  if (!parsed.ok || parsed.value === null) return {ok: false as const, reason: parsed.ok ? '请填写正确数值。' : parsed.reason}
  if (parsed.value === target.value) return {ok: false as const, reason: '数值没有变化，无需重复保存。'}
  const saved = appendCorrection({trainingOccurrenceId: input.occurrenceId, kind: 'FIELD', field: target.field, setKey: target.setKey, originalValue: String(target.value), newValue: String(parsed.value), reason: input.reason.trim()})
  return saved ? {ok: true as const, correctionId: saved.correctionId} : {ok: false as const, reason: '更正未写入，原记录仍保留，请重试。'}
}
