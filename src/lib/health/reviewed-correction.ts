import { healthPreviewKey, type DeviceHealthRow } from '../ui/device-parse'
import { currentAthleteId } from '../core/events'
import { shortHash } from './observation'
import { readUnifiedFacts } from './unified-fact-store'
import { exactInstant, factDay, factId, normalizeFact, projectFacts, type UnifiedFact } from './unified-facts'

export type ReviewedHealthEdit = { ok: true; row: DeviceHealthRow } | { ok: false; reason: string }

/** Preview-only edit. The existing explicit save action commits the retained originals and revision together. */
export function editReviewedHealthRow(row: DeviceHealthRow, patch: Partial<Pick<DeviceHealthRow, 'day' | 'value'>>, receivedAt = new Date().toISOString()): ReviewedHealthEdit {
  const day = patch.day ?? row.day, value = patch.value ?? row.value
  if (!factDay(day) || !Number.isFinite(value) || value < 0 || !exactInstant(receivedAt)) return { ok: false, reason: '请填写有效日期和读数；缺失值不会填为0。' }
  const originals = row.observation?.facts ?? []
  const preview: UnifiedFact[] = []
  for (const raw of originals) {
    const f = normalizeFact(raw)
    if (!f || f.athleteId !== currentAthleteId()) return { ok: false, reason: '原始证据无效或不属于当前运动员，请重新读取后核对。' }
    preview.push(f)
  }
  if (day === row.day && value === row.value) return { ok: true, row }
  const updated: DeviceHealthRow = {
    ...row, day, value, source: row.source.includes('人工更正') ? row.source : row.source + ' · 人工更正',
    observation: row.observation ? { ...row.observation, previous: [...(row.observation.previous ?? []), { value: row.value, syncedAt: row.observation.syncedAt }] } : undefined,
  }
  if (!preview.length) {
    if (day !== row.day && updated.observation) updated.observation = { ...updated.observation, key: `${updated.observation.key}:date:${day}`.slice(0, 160), measuredAt: null }
    updated.key = healthPreviewKey(updated)
    return { ok: true, row: updated }
  }

  // Apple aggregates carry their original stages too. Only the row's own fact identity is revised.
  const matching = preview.filter(f => f.metric === row.metric && (row.observation!.key === `fact:${shortHash(factId(f))}` || row.observation!.key.startsWith(`fact:${shortHash(factId(f))}:date:`)))
  if (!matching.length || new Set(matching.map(factId)).size !== 1) return { ok: false, reason: '无法确认待更正的原始记录，请重新读取后核对。' }
  const target = [...matching].sort((a, b) => a.revision - b.revision || a.receivedAt.localeCompare(b.receivedAt)).at(-1)!
  const id = factId(target), stored = readUnifiedFacts()
  if (stored.rejected.length) return { ok: false, reason: '已有原始证据无法读取，未创建可能冲突的更正。' }
  const known = [...stored.evidence.filter(f => factId(f) === id), ...matching]
  const previousRevision = Math.max(...known.map(f => f.revision))
  if (!Number.isSafeInteger(previousRevision + 1)) return { ok: false, reason: '记录修订号已达上限，未覆盖原始证据。' }
  const latest = projectFacts(known, currentAthleteId(), receivedAt).facts.find(f => factId(f) === id)
  const correction = latest?.manualCorrection && latest.day === day && latest.value === value ? latest : normalizeFact({
    ...target, day, value, quality: 'VALID', revision: previousRevision + 1, receivedAt,
    // The user changed the day, not the source's timestamp. Keeping it would reassign sleep to the old wake date.
    start: day === target.day ? target.start : null, end: day === target.day ? target.end : null,
    manualCorrection: { previousRevision },
  })
  if (!correction) return { ok: false, reason: '更正的日期、读数或单位无效，原始证据未改变。' }
  const first = [...known].sort((a, b) => a.revision - b.revision).at(0)!
  const baseKey = `fact:${shortHash(id)}`
  updated.observation = {
    ...updated.observation!, key: day === first.day ? baseKey : `${baseKey}:date:${day}`,
    syncedAt: correction.receivedAt, measuredAt: correction.end ?? correction.start,
    facts: [...new Map([...preview, correction].map(f => [JSON.stringify(f), f])).values()],
  }
  updated.key = healthPreviewKey(updated)
  return { ok: true, row: updated }
}
