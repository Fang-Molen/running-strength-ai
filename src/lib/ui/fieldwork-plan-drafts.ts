import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { appendJournal, readJournal, storeKeys } from '../core/storage-journal'
import { fieldworkExercise } from './fieldwork-catalogue'

export const DRAFT_PREFIX = 'fr255-fieldwork-plan-draft-v1:'
export const SECTIONS = ['warmup', 'technique', 'main', 'strength', 'cooldown'] as const
export type Section = typeof SECTIONS[number]
export type PlanDraft = {
  uid: string; revisionId: string; athleteId: string; id: string; kind: 'running' | 'strength'; title: string;
  date: string; slot: Section; sets: number | null; amount: number | null; unit: 'm' | 's' | '次'; restSec: number | null;
  contentVersion: string; reviewStatus: string; plannedOnly: true; createdAt: string; updatedAt: string;
}
type DraftRevision = { schema: 1; athleteId: string; revisionId: string; previousRevision: string | null; action: 'UPSERT' | 'REMOVE'; draft: PlanDraft }
export type DraftInput = { uid?: string; id: string; date: string; slot: string; sets: number | null; amount: number | null; unit: string; restSec: number | null; intent: 'create' | 'update'; plannedOnly: true; expectedRevision?: string | null }
export const validDate = (day: unknown): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day
const scope = () => DRAFT_PREFIX + encodeURIComponent(currentAthleteId()) + ':'
const dose = (v: unknown, integer = false, allowZero = false) => v === null || typeof v === 'number' && Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) && (!integer || Number.isInteger(v))
function validDraft(d: PlanDraft): boolean {
  const source = d && fieldworkExercise(d.id)
  return !!source && d.kind === source.type && typeof d.uid === 'string' && typeof d.revisionId === 'string' && d.athleteId === currentAthleteId() && validDate(d.date) && SECTIONS.includes(d.slot) && d.plannedOnly === true &&
    dose(d.sets, true) && dose(d.amount) && dose(d.restSec, false, true) && ['m','s','次'].includes(d.unit) && typeof d.contentVersion === 'string' && typeof d.reviewStatus === 'string'
}
/** Existing immutable journal, scoped to the current athlete; never a training fact or a formal plan. */
export function loadPlanDrafts(): { ok: true; drafts: PlanDraft[]; revisions: number } | { ok: false; reason: string; drafts: PlanDraft[] } {
  try {
    const box = currentStore(); if (!box) return { ok: false, drafts: [], reason: '本地存储不可用，未读取待练草稿。' }
    const prefix = scope(), rows = readJournal<DraftRevision>(prefix)
    if (storeKeys(box).filter(k=>k.startsWith(prefix)).length !== rows.length) throw Error('invalid envelope')
    const current = new Map<string, DraftRevision>()
    for (const row of rows) {
      const r = row.data
      if (r?.schema !== 1 || r.athleteId !== currentAthleteId() || !['UPSERT','REMOVE'].includes(r.action) || !validDraft(r.draft) || r.revisionId !== r.draft.revisionId || row.id !== r.revisionId) throw Error('invalid revision')
      const previous = current.get(r.draft.uid)
      if ((previous?.revisionId ?? null) !== r.previousRevision || (!previous && r.action === 'REMOVE')) throw Error('conflicting revisions')
      current.set(r.draft.uid, r)
    }
    return { ok: true, drafts: [...current.values()].filter(r=>r.action==='UPSERT').map(r=>r.draft), revisions: rows.length }
  } catch { return { ok: false, drafts: [], reason: '待练草稿存在损坏或冲突，已保留原记录并暂停写入。' } }
}
export function savePlanDraft(input: DraftInput): { ok: true; draft: PlanDraft } | { ok: false; reason: string } {
  const view = loadPlanDrafts(); if (!view.ok) return view
  const source = fieldworkExercise(input.id)
  if (!source || !validDate(input.date) || !SECTIONS.includes(input.slot as Section) || input.plannedOnly !== true || !['create','update'].includes(input.intent) || !dose(input.sets,true) || !dose(input.amount) || !dose(input.restSec,false,true) || !['m','s','次'].includes(input.unit) || (source.type==='strength' && input.unit==='m')) return {ok:false,reason:'请检查动作、日期、环节与待练参数；空值可保留待确认。'}
  const previous = input.intent === 'update' ? view.drafts.find(d=>d.uid===input.uid) : undefined
  if (input.intent === 'update' && (!previous || previous.revisionId !== input.expectedRevision || previous.id !== input.id)) return {ok:false,reason:'此草稿已变化，请重新打开后编辑。'}
  if (view.drafts.some(d=>d.uid!==previous?.uid && d.id===input.id && d.date===input.date && d.slot===input.slot)) return {ok:false,reason:'该日期与环节已包含这个动作，请编辑已有草稿。'}
  const now = new Date().toISOString(), revisionId = `draft-revision-${crypto.randomUUID()}`
  const draft: PlanDraft = { uid: previous?.uid ?? `draft-${crypto.randomUUID()}`, revisionId, athleteId:currentAthleteId(), id:source.id, kind:source.type, title:source.title,
    date:input.date,slot:input.slot as Section,sets:input.sets,amount:input.amount,unit:input.unit as PlanDraft['unit'],restSec:input.restSec,
    contentVersion:source.contentVersion,reviewStatus:source.review,plannedOnly:true,createdAt:previous?.createdAt??now,updatedAt:now }
  if (!appendJournal(scope(),revisionId,{schema:1,athleteId:currentAthleteId(),revisionId,previousRevision:previous?.revisionId??null,action:'UPSERT',draft} satisfies DraftRevision)) return {ok:false,reason:'草稿未保存，请保留输入后重试。'}
  const saved=loadPlanDrafts();if(!saved.ok||!saved.drafts.some(d=>d.revisionId===revisionId))return {ok:false,reason:'草稿未能回读确认，原记录已保留。'}
  return {ok:true,draft}
}
export function removePlanDraft(uid: string, expectedRevision: string): {ok:true}|{ok:false;reason:string} {
  const view=loadPlanDrafts();if(!view.ok)return view
  const previous=view.drafts.find(d=>d.uid===uid)
  if(!previous||previous.revisionId!==expectedRevision)return {ok:false,reason:'草稿已变化，未移除。'}
  const revisionId=`draft-revision-${crypto.randomUUID()}`,draft={...previous,revisionId,updatedAt:new Date().toISOString()}
  if(!appendJournal(scope(),revisionId,{schema:1,athleteId:currentAthleteId(),revisionId,previousRevision:previous.revisionId,action:'REMOVE',draft} satisfies DraftRevision))return {ok:false,reason:'移除未保存，草稿仍保留。'}
  const saved=loadPlanDrafts();return saved.ok&&!saved.drafts.some(d=>d.uid===uid)?{ok:true}:{ok:false,reason:'移除未能回读确认。'}
}
