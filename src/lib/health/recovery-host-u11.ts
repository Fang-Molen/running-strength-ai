/** Read-only projection of the existing event journal, V4 feedback and imports.
 * No training store, physiology score or plan writer is introduced here. */
import { currentAthleteId, loadCommittedEventRecords } from '../core/events'
import { currentStore } from '../core/storage'
import { getTrainingPlanSnapshot, listTrainingOccurrences } from '../core/occurrence'
import { occurrenceAttempts, projectTrainingFact } from '../core/training-fact'
import { projectActualSets } from '../core/canonical'
import { listCorrections, occurrenceVoided } from '../core/training-correction'
import { coachImports } from '../core/coach-import-evidence'
import { loadOwnedComponents } from '../ui/plan400-components-store'
import { garminRows } from '../ui/training-read-model'
import { garminViewKey } from './garmin-view-scope'
import { CATALOG } from '../strength/catalog'
import { localDay, shortHash, validDay } from './observation'
import { buildMuscleReview, REGION_LABEL, type Region, type Symptom, type TrainingPart } from './muscle-recovery-u11'
import { buildIntradayRecovery } from './intraday-recovery-u10'

export type RecoverySource = {
  id: string; label: string; occurredAt: string | null; knownAt: string | null
  actualSets: number | null; detail: string
}
export const regionFromExplicitLabel = (label: string): Region | null => {
  const exact = Object.entries(REGION_LABEL).find(([,name]) => name === label.trim().replace(/^(左|右)(侧)?[ ·]?/, ''))
  return exact ? exact[0] as Region : null
}
const iso = (v: unknown): v is string => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
export const partEvidenceKey = (p: TrainingPart) => p.occurrenceId && p.componentId
  ? `${p.athleteId}|${p.occurrenceId}|${p.componentId}|${p.modality}` : `${p.athleteId}|${p.sourceId}|${p.eventId}|${p.modality}`
export function readRecoveryProjection(day = localDay(), asOf = new Date().toISOString()) {
  if (!validDay(day) || !iso(asOf)) throw Error('INVALID_RECOVERY_TIME')
  const athleteId = currentAthleteId(), parts: TrainingPart[] = [], symptoms: Symptom[] = []
  const sources: RecoverySource[] = [], gaps: string[] = []
  const endOfDay = new Date(`${day}T23:59:59.999`).getTime()
  const cutoff = Math.min(Date.parse(asOf), endOfDay), effectiveAsOf = new Date(cutoff).toISOString()
  const recent = (time: string) => iso(time) && Date.parse(time) <= cutoff && Date.parse(time) >= cutoff - 72 * 3600000
  let unreadable = !currentStore()
  const add = (p: TrainingPart, label: string, detail: string, actualSets: number | null = null) => {
    parts.push(p); sources.push({id:partEvidenceKey(p),label,occurredAt:p.occurredAt,knownAt:p.knownAt,actualSets,detail})
  }
  try {
    // Legacy readers degrade to empty. Expose corrupt containers before using them.
    for (const key of ['fr255-events-v1','fr255-training-occurrence-v1','fr255-training-correction-v1','fk-plan400-v4-components-v1','fk-pain-log-v1']) {
      const raw = currentStore()?.getItem(key); if (raw) JSON.parse(raw)
    }
    const records = loadCommittedEventRecords()
    const events = records.filter(r => r.event.athlete_id === athleteId && iso(r.event.timestamp) &&
      Date.parse(r.event.timestamp) <= cutoff && (!r.recordedAt || iso(r.recordedAt) && Date.parse(r.recordedAt) <= cutoff)).map(r => r.event)
    const occurrences = listTrainingOccurrences()
    for (const occurrence of occurrences) {
      if (!occurrence.startedAt || !recent(occurrence.startedAt) || occurrenceVoided(occurrence.trainingOccurrenceId)) continue
      const start = events.findIndex(e => e.event_id === occurrence.startEventId)
      if (start < 0) continue
      const snapshot = occurrence.trainingPlanSnapshotId ? getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId) : null
      const siblings = occurrences.filter(o => o.sessionId === occurrence.sessionId && o.trainingOccurrenceId !== occurrence.trainingOccurrenceId)
      const input = {occurrence,snapshot,events,siblingOccurrences:siblings,siblingStartEventIds:siblings.map(o=>o.startEventId)}
      const fact = projectTrainingFact(input)
      if (!['COMPLETED','INTERRUPTED'].includes(fact.lifecycle)) continue
      if (listCorrections(occurrence.trainingOccurrenceId).some(c=>c.kind==='FIELD')) {
        gaps.push('有更正的逐组记录暂不参与肌群推断，请核对更正后的动作明细'); continue
      }
      const end = events.findIndex(e=>e.event_id===occurrence.closeEventId)
      const selected = occurrenceAttempts(input,start,end,athleteId)
      if (selected.ambiguous) { gaps.push('存在跨课或归属不清的组记录，未参与肌群分析'); continue }
      const projection = projectActualSets(snapshot,selected.attempts)
      const exercises: NonNullable<TrainingPart['exercises']> = []
      for (const set of projection.plannedSets.filter(s=>s.status==='COMPLETED')) {
        const attempt = projection.attempts.find(a=>a.actualSetId===set.attemptIds[0])
        const event = selected.attempts.find(e=>e.event_id===attempt?.eventId)
        const planned = snapshot?.exercises.find(e=>e.moveId===set.moveId)
        if (!event || !attempt || !planned || attempt.movementChanged || attempt.actualAmount === null || attempt.actualAmount <= 0) {
          gaps.push('部分组的实际动作或完成量不足，未按计划补齐'); continue
        }
        // A performed set is required; the frozen catalog ID only identifies its movement.
        const catalogId = typeof event.payload?.catalogId === 'string' ? event.payload.catalogId : planned.catalogId ?? undefined
        const same = exercises.find(e=>e.catalogId===catalogId && e.name===planned.name)
        if (same) same.actualSets!++
        else exercises.push({catalogId,name:planned.name,actualSets:1,verified:true})
      }
      if (!exercises.length && !selected.attempts.length) continue // A running occurrence is not a strength session.
      const known = records.find(r=>r.event.event_id===occurrence.closeEventId)?.recordedAt
      if (!iso(known)) { gaps.push('旧训练缺少保存时间，无法用于按时间追踪的肌群判断'); continue }
      const p: TrainingPart = {athleteId,eventId:occurrence.closeEventId!,occurrenceId:occurrence.trainingOccurrenceId,
        componentId:'strength',modality:'STRENGTH',occurredAt:occurrence.startedAt,knownAt:known,
        sourceId:occurrence.trainingOccurrenceId,actual:'CONFIRMED',exercises}
      add(p,'力量逐组记录',exercises.map(e=>`${e.name} ${e.actualSets}组`).join('；') || '无法判断具体肌群：缺少可信实际动作',exercises.length ? exercises.reduce((n,e)=>n+(e.actualSets??0),0) : null)
    }
    for (const record of coachImports(athleteId,effectiveAsOf)) {
      if (!record.occurredAt.value || !recent(record.occurredAt.value) || occurrenceVoided(record.confirmedImportId)) continue
      if (listCorrections(record.confirmedImportId).some(c=>c.kind==='FIELD')) {
        gaps.push('导入训练已有更正，肌群分析不再引用更正前明细'); continue
      }
      const base = {athleteId,eventId:record.confirmedImportId,occurrenceId:record.confirmedImportId,
        occurredAt:record.occurredAt.value,knownAt:record.confirmedAt,sourceId:record.confirmedImportId,actual:'CONFIRMED' as const}
      if (record.sport === 'STRENGTH' || record.sport === 'MIXED') {
        const exercises: NonNullable<TrainingPart['exercises']> = []
        for (const s of record.strengthSets) {
          if (s.completion!=='COMPLETED' || s.exerciseName.status!=='RECORDED' ||
            ![s.repetitions,s.durationSeconds].some(f=>f.status==='RECORDED' && f.value!=null && f.value>0)) continue
          // Exact unique catalogue name only; no free-text/AI fuzzy matching.
          const matches = CATALOG.filter(e=>e.name===s.exerciseName.value)
          const catalogId = matches.length===1 ? matches[0].id : undefined
          const old = exercises.find(e=>e.catalogId===catalogId && e.name===s.exerciseName.value)
          if(old) old.actualSets!++
          else exercises.push({catalogId,name:s.exerciseName.value??undefined,actualSets:1,verified:true})
        }
        add({...base,componentId:'strength',modality:'STRENGTH',exercises},'已确认导入力量',
          exercises.map(e=>`${e.name} ${e.actualSets}组`).join('；')||'无法判断具体肌群：只有摘要，没有动作明细',
          exercises.length ? exercises.reduce((n,e)=>n+(e.actualSets??0),0) : null)
      }
      if (record.sport==='RUNNING'||record.sport==='MIXED')
        add({...base,componentId:'running',modality:'RUN',runType:'UNKNOWN'},'已确认导入跑步','跑步类型未独立确认，未由标题、距离或平均心率推断肌群')
      for (const [kind,field] of [['PAIN',record.pain],['SORENESS',record.soreness]] as const) {
        if (field.status!=='RECORDED'||!field.value) continue
        const region=regionFromExplicitLabel(field.value.location)
        if(!region) { gaps.push(`${kind==='PAIN'?'疼痛':'酸痛'}位置未精确到肌群，保留原反馈，请核对具体部位`); continue }
        const s: Symptom={...base,eventId:`${base.eventId}:${kind}`,region,kind,severity:field.value.intensity??undefined}
        symptoms.push(s);sources.push({id:s.eventId,label:'导入的局部反馈',occurredAt:s.occurredAt,knownAt:s.knownAt,actualSets:null,detail:`${field.value.location} · ${kind==='PAIN'?'疼痛':'酸痛'} ${s.severity??'程度未知'}`})
      }
    }
    const watchRaw=currentStore()?.getItem(garminViewKey('fk-garmin-acts-v1'))
    for(const row of garminRows(watchRaw?JSON.parse(watchRaw):{})) if(recent(row.startedAt)) {
      // Device activity summaries are evidence of an activity, not proof of a
      // reconstructed session, performed exercise, or a specific running protocol.
      gaps.push(`${row.date} 佳明${row.sport==='STRENGTH'?'力量':'跑步'}活动只有摘要，无法判断具体肌群；活动条数未当成训练课次数`)
    }
    for (const [date,row] of Object.entries(loadOwnedComponents(currentStore()).days)) {
      for (const name of ['running','strength'] as const) {
        const p=row[name], doneOn=p?.doneOn||date
        if(!p || !validDay(doneOn) || doneOn>day || doneOn<localDay(new Date(cutoff-72*3600000))) continue
        if(p.status==='done'||p.status==='reduced')
          gaps.push(`${doneOn} ${name==='running'?'跑步':'力量'}只有分项评价，无法判断具体肌群；未把原课表动作当实际完成`)
        if(p.pain && (p.pain.score===null || p.pain.score>0)) {
          const region=regionFromExplicitLabel(p.pain.area)
          // Date-only actual time stays unknown: report the symptom without fabricating a timestamp.
          gaps.push(`${doneOn} 自报${p.pain.area||'部位未明确'}疼痛${p.pain.score==null?'':` ${p.pain.score}/10`}；${region?'缺少发生时刻，保留反馈但未自动映射':'不能由部位猜测具体肌肉'}，设备分数不能解除限制`)
        }
      }
    }
    const rawPain=JSON.parse(currentStore()?.getItem('fk-pain-log-v1')??'[]')
    if(!Array.isArray(rawPain)) throw Error('INVALID_PAIN_SOURCE')
    for(const p of rawPain) if((p?.athleteId??'local')===athleteId && validDay(p?.date) && p.date<=day &&
      p.date>=localDay(new Date(cutoff-72*3600000)) && typeof p.score==='number' && p.score>0 && p.score<=10) {
      const region=regionFromExplicitLabel(String(p.part??''))
      if(region && iso(p.occurredAt) && iso(p.recordedAt) && recent(p.occurredAt) && Date.parse(p.recordedAt)<=cutoff) {
        const s:Symptom={athleteId,eventId:`pain:${p.id}`,occurredAt:p.occurredAt,knownAt:p.recordedAt,region,kind:'PAIN',severity:p.score,sourceId:'fk-pain-log-v1'}
        symptoms.push(s);sources.push({id:s.eventId,label:'自报疼痛',occurredAt:s.occurredAt,knownAt:s.knownAt,actualSets:null,detail:`${p.part} · ${p.score}/10`})
      } else gaps.push(`${p.date} 自报${String(p.part??'部位未知')}疼痛 ${p.score}/10；时间或肌群位置不够明确，不补造发生时刻或肌群诊断`)
    }
  } catch { unreadable=true; gaps.push('部分训练来源无法读取，不能当作没有训练或没有疼痛') }
  const review=buildMuscleReview({athleteId,asOf:effectiveAsOf,parts,symptoms})
  review.gaps=[...new Set([...review.gaps,...gaps])]
  if(!review.regions.some(r=>r.state!=='UNKNOWN')) review.summary='无法判断具体肌群：缺少可信的实际动作明细或精确局部反馈。'
  // Current authorized runner only persists daily summaries. Its coverage is NOT promoted to continuous samples.
  const intraday=buildIntradayRecovery({athleteId,day,now:effectiveAsOf,utcOffsetMinutes:-new Date(asOf).getTimezoneOffset(),samples:[],sleepEvents:[],trainingEvents:[]})
  intraday.warnings.push('当前同步入口未核准逐时心率、电量、压力和明确午睡字段；日汇总仍在身体指标中保留。')
  return {athleteId,day,review,sources,intraday,unreadable,
    revision:shortHash(JSON.stringify([athleteId,day,review.regions,review.gaps,sources,unreadable])),automaticPrescription:false as const}
}
export type RecoveryProjection = ReturnType<typeof readRecoveryProjection>
export function recoveryExplanation(v: RecoveryProjection): string {
  const observed=v.review.regions.filter(r=>r.state!=='UNKNOWN')
  return [v.review.summary,...observed.map(r=>`${REGION_LABEL[r.region]}：${r.state==='PAIN_REVIEW'?'有自报疼痛，需先核对症状':r.state==='REPORTED_SORENESS'?'有自报酸痛':r.state==='OVERLAP_OBSERVED'?'跑步和力量参与重叠':'有已确认训练参与'}；依据 ${[...r.runEventIds,...r.strengthEventIds,...r.symptomEventIds].map(id=>v.sources.find(s=>s.id===id)?.detail??id).join('；')}`),
    ...v.review.gaps,'下一步：核对实际完成的动作、组次和具体不适部位；这不是肌肉疲劳百分比，也不自动更改课表。'].join('\n')
}
