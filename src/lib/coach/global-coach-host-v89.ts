/** Read-only host bridge. Evidence remains in the existing stores; this projection
 * never grants plan authority and never sends data to a model. */
import { ATHLETE_SCOPE_CHANGED, currentAthleteId, onAppEvent } from '../core/events'
import { currentStore } from '../core/storage'
import { storeKeys } from '../core/storage-journal'
import { readCoachData, type CoachDataContext } from '../health/coach-data'
import { loadHealthSnapshot, healthSummaryLine } from '../health/snapshot'
import { HEALTH_CHANGED, localDay, shortHash, validDay } from '../health/observation'
import { loadEntries, nutrientOf } from '../nutrition/log'
import { readPendingFeedback } from '../ui/pending-feedback-host'
import { pendingTaskId, type PendingItem } from '../ui/pending-feedback'
import { readC03FollowupView, C03_FOLLOWUP_CHANGED_EVENT } from './c03/runtime'
import { PLAN_EXECUTION_EVENT, type PlanExecutionRepository } from './plan-execution/core'
import { createIndexedDbPlanExecutionRepository } from './plan-execution/store'
import { coordinateGlobal, type Evidence, type GlobalResult, type Task } from './global-coach-v89'

export const GLOBAL_COACH_EVENTS = [
  HEALTH_CHANGED, ATHLETE_SCOPE_CHANGED, C03_FOLLOWUP_CHANGED_EVENT, PLAN_EXECUTION_EVENT,
  'fk-food-changed', 'fk-garmin-synced', 'fk-schedule-changed', 'fk-training-activities-changed',
  'fk-training-corrected', 'fk-plan400-changed', 'fk-plan400-components', 'fk-run-links',
  'storage', 'pageshow', 'focus',
] as const
export type HostEvidence = Evidence & {
  sourceId: string; metric: string; unit: string | null; value: number | null
  quality: 'RECORDED' | 'LEGACY' | 'UNKNOWN'; coverage: 'RECORDED_ONLY' | 'UNKNOWN'
}
export type GlobalCoachSnapshot = {
  athleteId: string; day: string; revision: string; result: GlobalResult
  data: CoachDataContext | null; evidence: HostEvidence[]; pending: PendingItem[]
  limitations: string[]; planWriteEnabled: false
}
// This short content digest is only a UI refresh token, NEVER a CAS/write token.
const revision = (value: unknown) => shortHash(JSON.stringify(value))
const units: Record<string,string> = {SLEEP:'h',RHR:'bpm',HRV:'ms',NIGHT_HR:'bpm',
  BODY_BATTERY:'/100',READINESS:'/100',STRESS:'/100',STEPS:'steps',SPO2:'%',RESP:'/min',RECOVERY:'/10'}
const at = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null
function sourceFingerprint() {
  const store = currentStore()
  if (!store) throw Error('STORAGE_UNAVAILABLE')
  const keys = storeKeys(store).filter(key =>
    /^(fr255-(events|event-journal|running-tx|training-|confirmed-training|vitals|food-log)|fk-(health-|pain-log|checkin|device-|watch-|plan400|schedule|run-links|today-checklist)|fangkun-import-session-ratings)/.test(key)).sort()
  return JSON.stringify(keys.map(key=>[key,store.getItem(key)]))
}
export function feedbackTasks(items: readonly PendingItem[], athleteId: string): Task[] {
  return items.map(item => ({
    id: pendingTaskId(item, athleteId), kind: item.kind === 'confirm_run' ? 'VERIFY_SOURCE' : 'FILL_FEEDBACK',
    priority: item.kind === 'confirm_run' ? 1 : 2, target: 'log', title: `${item.date} · ${item.text}`,
    detail: item.kind === 'confirm_run' ? '先核对这条手表记录属于哪节课；未确认前不算完成。' : '沿用已保存的实际训练，只补主观反馈，不再创建一节训练。',
    evidenceIds: [`v4:${item.date}:${item.part}`], changesRecords: false,
  }))
}
export function subscribeGlobalCoach(refresh: () => void): () => void {
  // Some legacy writers publish an event before closing the occurrence in the
  // same call stack. Read after that commit completes, coalescing duplicate signals.
  let active=true,queued=false
  const request=()=>{if(queued||!active)return;queued=true;queueMicrotask(()=>{queued=false;if(active)refresh()})}
  const off = onAppEvent(event => { if (event.athlete_id === currentAthleteId()) request() })
  if (typeof window !== 'undefined') GLOBAL_COACH_EVENTS.forEach(name => window.addEventListener(name, request))
  return () => { active=false;off(); if (typeof window !== 'undefined') GLOBAL_COACH_EVENTS.forEach(name => window.removeEventListener(name, request)) }
}
/** Atomic identity/read revision is checked again after the IndexedDB await. */
export async function readGlobalCoachSnapshot(
  day = localDay(), repository?: Pick<PlanExecutionRepository,'read'>,
): Promise<GlobalCoachSnapshot> {
  const athleteId = currentAthleteId(), limitations: string[] = []
  const failed = (reason: string): GlobalCoachSnapshot => ({ athleteId, day, revision: 'UNAVAILABLE',
    result: coordinateGlobal({ athleteId, today: day, readState: 'FAILED', facts: [], parts: [] }),
    data: null, evidence: [], pending: [], limitations: [reason], planWriteEnabled: false })
  if (!validDay(day) || !currentStore()) return failed('当前本机档案或存储不可用。')
  let data: CoachDataContext, evidence: HostEvidence[], pending: PendingItem[], fingerprint: string
  try {
    fingerprint = sourceFingerprint()
    // Legacy readers deliberately degrade; report corrupt source containers here.
    for (const key of ['fk-schedule-v1','fk-plan400-v4-components-v1','fk-plan400-v4-log','fr255-food-log-v1']) {
      const raw = currentStore()!.getItem(key)
      if (raw !== null) JSON.parse(raw)
    }
    data = readCoachData(day)
    const health = loadHealthSnapshot(day)
    if (health.unreadable) limitations.push('部分健康来源无法读取，未视为正常。')
    evidence = health.metrics.map(metric => {
      const p = metric.current
      return { id: `health:${athleteId}:${metric.metric}`, athleteId, domain: 'HEALTH', availability: health.unreadable ? 'ERROR' : metric.state,
        revision: revision([metric.state, metric.current, metric.candidates, metric.selectedSource]),
        observedAt: at(p?.measuredAt), knownAt: at(p?.updatedAt), summary: healthSummaryLine(metric),
        sourceId: p?.id ?? `health:${metric.metric}:unresolved`, metric: metric.metric, unit: units[metric.metric] ?? null,
        value: p?.value ?? null, quality: p ? p.legacy ? 'LEGACY' : 'RECORDED' : 'UNKNOWN', coverage: 'RECORDED_ONLY' }
    })
    for (const food of loadEntries().filter(row => row.date === day && (row.athleteId ?? 'local') === athleteId)) {
      const kcal=nutrientOf(food,'kcal')
      evidence.push({ id:`nutrition:${athleteId}:${food.id}`,athleteId,domain:'NUTRITION',
        availability:kcal===null?'MISSING':'AVAILABLE',revision:revision(food),observedAt:at(food.eatenAt),knownAt:at(food.recordedAt),
        summary:`${food.meal} · ${food.name}：${kcal===null?'热量未记录':`${kcal} kcal`}（仅此条记录）`,
        sourceId:food.id,metric:'ENERGY_INTAKE',unit:'kcal',value:kcal,quality:food.recordedAt?'RECORDED':'LEGACY',coverage:'RECORDED_ONLY'})
    }
    pending = readPendingFeedback(day)
    if(data.muscleRecovery) evidence.push({id:`muscle:${athleteId}:${day}`,athleteId,domain:'TRAINING',
      availability:data.muscleRecovery.unreadable?'ERROR':data.muscleRecovery.hasObservedRegions?'AVAILABLE':'MISSING',
      revision:data.muscleRecovery.revision,observedAt:null,knownAt:null,summary:data.muscleRecovery.summary,
      sourceId:`muscle:${data.muscleRecovery.revision}`,metric:'MUSCLE_EXPOSURE',unit:null,value:null,
      quality:data.muscleRecovery.hasObservedRegions?'RECORDED':'UNKNOWN',coverage:'RECORDED_ONLY'})
  } catch { return failed('来源读取失败，保留原记录；请到对应页面核对。') }
  const factsRevision = revision([data,evidence,pending])
  const history = readC03FollowupView()
  if (history.status !== 'AVAILABLE') limitations.push('长期判断历史暂不可读取，未当作没有历史。')
  const staleClaimIds = history.hypotheses.filter(row => row.status === 'STALE_NEEDS_REVIEW').map(row => row.id)
  const repo = repository ?? createIndexedDbPlanExecutionRepository()
  let pendingProposalIds: string[] = []
  try {
    const document = await repo.read(athleteId)
    if (document.athleteId !== athleteId) throw Error('SUBJECT_MISMATCH')
    pendingProposalIds = Object.values(document.proposals).filter(row => row.state === 'PENDING' &&
      row.actor.athleteId === athleteId && Date.parse(row.expiresAt) > Date.now()).map(row => row.id)
  } catch { limitations.push('本机提案回执暂不可读取；正式改课仍关闭。') }
  finally { if (!repository && 'close' in repo) (repo as ReturnType<typeof createIndexedDbPlanExecutionRepository>).close() }
  if (currentAthleteId() !== athleteId) return failed('运动员档案已切换，旧摘要已丢弃。')
  // If a save happened during the asynchronous receipt read, return unavailable;
  // the subscribed event starts a fresh projection rather than mixing versions.
  try {
    if (sourceFingerprint() !== fingerprint || revision(readCoachData(day)) !== revision(data)) return failed('读取期间资料已更新，正在重新核对。')
  } catch { return failed('回读来源失败，未继续使用旧摘要。') }
  const result = coordinateGlobal({ athleteId, today: day,
    readState: limitations.length || data.warnings.length ? 'PARTIAL' : 'READY',
    facts: evidence, parts: [], staleClaimIds, pendingProposalIds })
  result.tasks = [...new Map([...result.tasks, ...feedbackTasks(pending, athleteId)].map(task=>[task.id,task])).values()]
    .sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))
  result.warnings = [...new Set([...result.warnings, ...data.warnings])]
  return { athleteId, day, revision: factsRevision, result, data, evidence, pending, limitations, planWriteEnabled: false }
}
