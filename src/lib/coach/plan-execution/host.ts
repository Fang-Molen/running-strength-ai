import { currentAthleteId, loadCommittedEventRecords, type CommittedEventRecord } from '../../core/events'
import { currentStore } from '../../core/storage'
import { storeKeys } from '../../core/storage-journal'
import { createLocalPlanExecutor, type PlanHostContext, type PlanTarget, type PlanExecutionRepository, type PlanProposal, type PlanExecutionReceipt } from './core'
import { createIndexedDbPlanExecutionRepository } from './store'
import { loadSchedule, readScheduleDocument, SCHEDULE_KEY } from '../../ui/day-schedule'
import { scheduleExecutionId } from '../../ui/scheduled-execution'
import type { ScheduleEntry } from '../../ui/day-schedule-rules'

export type CoachPlanHostChoice = {
  key: string; scheduleId: string; componentId: string | null; title: string; date: string
  state: PlanTarget['state']; identityResolved: boolean; reason: string | null
}
export type CoachPlanHostSnapshot = {
  host: PlanHostContext; asOf: string; signature: string; choices: CoachPlanHostChoice[]
  coverage: { ownedEntries: number; unattributedEntries: number; sourceKeys: string[]; completeCalendar: false; reasons: string[] }
  /** Only used locally to detect source changes; raw records never enter model payloads. */
  sourceFingerprint: string
}
const day = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200
const rawKey = (key: string) => key === SCHEDULE_KEY || key === 'fr255-events-v1' || key === 'fr255-training-occurrence-v1' || key === 'fr255-canonical-training-v1' || key === 'fk-plan400-v4-components-v1' || key.startsWith('fr255-event-journal-v2:') || key.startsWith('fr255-running-tx-r3:')
function readRawSources(): { ok: boolean; records: [string, string | null][]; fingerprint: string } {
  try {
    const store = currentStore(); if (!store) return { ok: false, records: [], fingerprint: 'UNAVAILABLE' }
    const keys = [...new Set([SCHEDULE_KEY, 'fr255-events-v1', 'fr255-training-occurrence-v1', 'fr255-canonical-training-v1', 'fk-plan400-v4-components-v1', ...storeKeys(store).filter(rawKey)])].sort()
    const records: [string, string | null][] = keys.map(key => [key, store.getItem(key)])
    for (const [, value] of records) if (value !== null) JSON.parse(value)
    return { ok: true, records, fingerprint: JSON.stringify(records) }
  } catch { return { ok: false, records: [], fingerprint: 'READ_FAILED' } }
}
async function digest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_UNAVAILABLE')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('')
}
function executionState(entry: ScheduleEntry, component: 'RUNNING' | 'STRENGTH', records: CommittedEventRecord[], asOf: string): PlanTarget['state'] {
  // A whole-course marker does not prove that both modalities were completed.
  const single = entry.runComponents?.length === 1
  if (single && (entry.status === 'done' || entry.actual?.executionState === 'COMPLETED')) return 'COMPLETED'
  const sessionId = scheduleExecutionId(entry.id, component === 'RUNNING' ? 'run' : 'strength')
  const matching = records.filter(x => x.event.payload?.sessionId === sessionId && ['TRAINING_STARTED', 'TRAINING_COMPLETED', 'TRAINING_INTERRUPTED', 'TRAINING_SET_COMPLETED', 'RUN_COMPLETED', 'RUNNING_CONTINUOUS_COMPLETED', 'RUNNING_REPETITION_COMPLETED'].includes(x.event.event_type))
  if (matching.some(x => !Number.isFinite(Date.parse(x.event.timestamp)) || Date.parse(x.event.timestamp) > Date.parse(asOf) || x.recordedAt !== null && (!Number.isFinite(Date.parse(x.recordedAt)) || Date.parse(x.recordedAt) > Date.parse(asOf)))) return 'UNKNOWN'
  if (matching.some(x => x.event.event_type === 'TRAINING_COMPLETED')) return 'COMPLETED'
  if (matching.length) return 'STARTED'
  if (entry.actual || entry.status === 'done') return 'UNKNOWN'
  return entry.status === 'planned' && validDay(entry.date) ? 'NOT_STARTED' : 'UNKNOWN'
}

/** Local read adapter only. Current athlete is a device scope, not server authentication.
 * Unknown ownership, missing component identities and incomplete calendars are not upgraded.
 */
export async function readCoachPlanHostSnapshot(asOf = new Date().toISOString()): Promise<CoachPlanHostSnapshot> {
  const athleteId = currentAthleteId(), raw = readRawSources(), read = readScheduleDocument()
  const assertOwner = () => { if (currentAthleteId() !== athleteId) throw new Error('SUBJECT_CHANGED') }
  const version = async (value: unknown) => { const hash = await digest(value); assertOwner(); return hash }
  const date = new Date(asOf), clockKnown = Number.isFinite(date.getTime()) && date.getTime() <= Date.now()
  const all = read.ok ? read.value.entries : [], owned = loadSchedule().entries.filter(entry => entry.athleteId === athleteId)
  const records = loadCommittedEventRecords().filter(record => record.event.athlete_id === athleteId)
  const reasons = ['当前完整执行日历尚未合并核定（周期计划、自建、导入及已确认修订）。', '现有日程和训练写入尚未统一并发协调；尚未修改。', '日期移动的适用安全限制尚未完成受信复核，确认不能解除医疗限制。']
  const unattributed = all.filter(entry => entry.athleteId == null).length
  if (unattributed) reasons.push(`${unattributed} 条旧日程没有明确归属，仅保留历史，未认领为当前运动员。`)
  const choices: CoachPlanHostChoice[] = [], targets: PlanTarget[] = []
  for (const entry of owned) {
    const duplicateEntry = owned.filter(x => x.id === entry.id).length !== 1
    const components = Array.isArray(entry.runComponents) ? entry.runComponents : []
    if (!components.length || components.some(c => !c || typeof c !== 'object' || !id(c.componentId) || !['RUNNING', 'STRENGTH'].includes(c.modality))) {
      choices.push({ key: JSON.stringify([entry.id, null]), scheduleId: entry.id, componentId: null, title: entry.title, date: entry.date, state: entry.status === 'done' ? 'COMPLETED' : 'UNKNOWN', identityResolved: false, reason: '此日程未保存稳定组成 ID，不能按名称或课程类型推造改课目标。' })
      continue
    }
    for (const component of components) {
      const resolved = !duplicateEntry && id(entry.id) && id(component.componentId) && components.filter(c => c.componentId === component.componentId).length === 1 && validDay(entry.date) && ['RUNNING', 'STRENGTH'].includes(component.modality)
      const state = resolved && clockKnown ? executionState(entry, component.modality, records, asOf) : 'UNKNOWN'
      const sourceVersion = await version(entry) // Full source entry, never a clipped title/summary.
      const row: PlanTarget = { scheduleId: entry.id, componentId: component.componentId, athleteId, originalDate: entry.date, sourceVersion, state, identityResolved: resolved }
      targets.push(row)
      choices.push({ key: JSON.stringify([row.scheduleId, row.componentId]), scheduleId: row.scheduleId, componentId: row.componentId, title: `${entry.title} · ${component.modality === 'RUNNING' ? '跑步' : '力量'}`, date: entry.date, state, identityResolved: resolved, reason: !resolved ? '日程或组成身份冲突，待核对。' : state === 'NOT_STARTED' ? null : '已有开始、完成或不明执行状态，不能按未开始分项移动。' })
    }
  }
  // Wall-clock reads are audit metadata, not content revisions. A refresh with the
  // same sources must not invalidate a pending proposal solely because time passed.
  const hash = await version({ athleteId, records: raw.records, coverage: 'UNKNOWN' })
  const safetyRecords = records.filter(x => ['PAIN_RECORDED', 'INJURY_REPORTED', 'SYMPTOM_CHANGED'].includes(x.event.event_type))
  const available = raw.ok && read.ok && clockKnown && id(athleteId)
  const host: PlanHostContext = {
    actor: available ? { subjectId: athleteId, athleteId, deviceId: 'LOCAL_BROWSER_SCOPE', profileVersion: await version({ athleteId, scope: 'LOCAL_DEVICE_ONLY' }), scope: 'LOCAL_DEVICE_ONLY' } : null,
    authorization: available ? 'LOCAL_DEVICE_OWNER' : 'UNVERIFIED', persistenceBoundary: 'UNCOORDINATED',
    calendarVersion: await version({ schedule: raw.records.find(([key]) => key === SCHEDULE_KEY)?.[1] ?? null, coverage: 'UNKNOWN' }),
    factsVersion: hash, safetyVersion: await version({ safetyRecords, coverage: 'UNKNOWN' }), calendarCoverage: 'UNKNOWN',
    readState: available ? 'AVAILABLE' : 'FAILED', safety: safetyRecords.length ? 'REVIEW_REQUIRED' : 'UNKNOWN', today: clockKnown ? day(date) : '', targets,
  }
  if (!available) reasons.unshift('本机身份、日期或原始数据读取失败，未当作空数据或正常状态。')
  assertOwner()
  return { host, asOf, signature: hash, choices, coverage: { ownedEntries: owned.length, unattributedEntries: unattributed, sourceKeys: raw.records.map(([key]) => key), completeCalendar: false, reasons }, sourceFingerprint: raw.fingerprint }
}

export function createCoachPlanChangeController(options: { repository?: PlanExecutionRepository; now?: () => Date; lock?: <T>(work: () => T | Promise<T>) => Promise<T> } = {}) {
  const repository = options.repository ?? createIndexedDbPlanExecutionRepository(), now = options.now ?? (() => new Date())
  let snapshot: CoachPlanHostSnapshot | null = null
  let refreshSequence = 0
  const unavailable = (): PlanHostContext => ({ actor: null, authorization: 'UNVERIFIED', persistenceBoundary: 'UNCOORDINATED', calendarVersion: '', factsVersion: '', safetyVersion: '', calendarCoverage: 'UNKNOWN', readState: 'FAILED', safety: 'UNKNOWN', today: '', targets: [] })
  const executor = createLocalPlanExecutor({ repository, now, lock: options.lock, readHostContext: () => {
    if (!snapshot || currentAthleteId() !== snapshot.host.actor?.athleteId || readRawSources().fingerprint !== snapshot.sourceFingerprint) return unavailable()
    return { ...snapshot.host, persistenceBoundary: 'UNCOORDINATED' }
  } })
  async function refresh() {
    const token = ++refreshSequence, owner = currentAthleteId()
    const fresh = await readCoachPlanHostSnapshot(now().toISOString())
    if (token !== refreshSequence || owner !== currentAthleteId()) throw new Error('SUBJECT_CHANGED')
    snapshot = fresh
    const document = await executor.read()
    if (token !== refreshSequence || owner !== currentAthleteId()) throw new Error('SUBJECT_CHANGED')
    return { snapshot: fresh, document }
  }
  return {
    refresh,
    async previewMove(input: { scheduleId: string; componentId: string; toDate: string }) { await refresh(); return executor.previewMove(input) },
    async confirm(proposal: Pick<PlanProposal, 'id' | 'diffHash'>) { await refresh(); return executor.confirm({ proposalId: proposal.id, diffHash: proposal.diffHash, confirmation: 'CONFIRM_THIS_CHANGE' }) },
    async undo(receipt: Pick<PlanExecutionReceipt, 'id'>) { await refresh(); return executor.undo({ receiptId: receipt.id, confirmation: 'UNDO_THIS_CHANGE' }) },
    close() { refreshSequence += 1; snapshot = null; if ('close' in repository && typeof repository.close === 'function') repository.close() },
  }
}
