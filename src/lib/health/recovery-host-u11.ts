import { getRunningPlanSnapshot } from '../core/running-plan'
import { readSavedSessionLoads } from '../core/coach-load-metrics-store'
import { analysisFromParts } from './analysis-from-parts'
import { buildMuscleExposure, exposureText } from './muscle-exposure'
import type { StrengthSet } from './analysis-contract'
/** Read-only projection of the existing event journal, V4 feedback and imports.
 * No training store, physiology score or plan writer is introduced here. */
import { currentAthleteId, loadCommittedEventRecords } from '../core/events'
import { currentStore } from '../core/storage'
import { getTrainingPlanSnapshot, listTrainingOccurrences } from '../core/occurrence'
import { effectiveStrengthFields, listCorrections, occurrenceVoided, readTrainingCorrectionsAsOf } from '../core/training-correction'
import { projectRunningExecution } from '../core/running-execution'
import { loadRunMatch } from '../ui/training-read-model'
import type { V4Day } from '../ui/plan400-view'
import { planDays, planTag, planPrefix } from '../plan/active-plan'
import { libraryKey, purposeRunType, RUN_TYPE_LABEL, v4RunType } from './muscle-log-source'
import { coachImports } from '../core/coach-import-evidence'
import { loadOwnedComponents } from '../ui/plan400-components-store'
import { garminRows } from '../ui/training-read-model'
import { garminViewKey } from './garmin-view-scope'
import { localDay, shortHash, validDay } from './observation'
import { providerOf } from './brand-isolation'
import { buildMuscleReview, exerciseRegions, REGION_LABEL, type Region, type Symptom, type TrainingPart } from './muscle-recovery-u11'
import { buildIntradayRecovery } from './intraday-recovery-u10'
import { loadIntraday } from './intraday-store'
import { intradayRecoveryFromStore } from './intraday-recovery-bridge-v89'
import { buildMuscleTimeline, type SymptomUpdate } from './muscle-timeline-u12'

const mdOf=(d:string)=>`${Number(d.slice(5,7))}-${d.slice(8,10)}`
export type RecoverySource = {
  id: string; label: string; occurredAt: string | null; knownAt: string | null
  actualSets: number | null; detail: string
  /** v89.4：这次力量里涉及各肌群的实际组数（动作库映射；未映射动作不计） */
  regionSets?: Partial<Record<Region, number>>
}
export const regionFromExplicitLabel = (label: string): Region | null => {
  const exact = Object.entries(REGION_LABEL).find(([,name]) => name === label.trim().replace(/^(左|右)(侧)?[ ·]?/, ''))
  return exact ? exact[0] as Region : null
}
const iso = (v: unknown): v is string => typeof v === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
export const partEvidenceKey = (p: TrainingPart) => p.occurrenceId && p.componentId
  ? `${p.athleteId}|${p.occurrenceId}|${p.componentId}|${p.modality}` : `${p.athleteId}|${p.sourceId}|${p.eventId}|${p.modality}`
export function readRecoveryProjection(day = localDay(), asOf = new Date().toISOString(), sourceWindowHours=72) {
  if (!validDay(day) || !iso(asOf)) throw Error('INVALID_RECOVERY_TIME')
  const athleteId = currentAthleteId(), parts: TrainingPart[] = [], symptoms: Symptom[] = []
  const sources: RecoverySource[] = [], gaps: string[] = [], notes: string[] = [], painUpdates: SymptomUpdate[] = [], painLabel = new Map<string, string>()
  const endOfDay = new Date(`${day}T23:59:59.999`).getTime()
  const cutoff = Math.min(Date.parse(asOf), endOfDay), effectiveAsOf = new Date(cutoff).toISOString()
  const recent = (time: string) => iso(time) && Date.parse(time) <= cutoff && Date.parse(time) >= cutoff - sourceWindowHours * 3600000
  let unreadable = !currentStore(), painReviewRequired = false
  const add = (p: TrainingPart, label: string, detail: string, actualSets: number | null = null) => {
    const regionSets: Partial<Record<Region, number>> = {}
    for (const e of p.exercises ?? []) for (const r of exerciseRegions(e.catalogId)) regionSets[r] = (regionSets[r] ?? 0) + (e.actualSets ?? 0)
    parts.push(p); sources.push({id:partEvidenceKey(p),label,occurredAt:p.occurredAt,knownAt:p.knownAt,actualSets,detail,...(p.modality==='STRENGTH'?{regionSets}:{})})
  }
  try {
    // Legacy readers degrade to empty. Expose corrupt containers before using them.
    for (const key of ['fr255-events-v1','fr255-training-occurrence-v1','fr255-training-correction-v1','fk-plan400-v4-components-v1','fk-pain-log-v1']) {
      const raw = currentStore()?.getItem(key); if (raw) JSON.parse(raw)
    }
    const records = loadCommittedEventRecords()
    if(records.some(r=>r.event.athlete_id===athleteId && recent(r.event.timestamp) && !iso(r.recordedAt))) gaps.push('部分训练缺少可核对的入库时间，保留原始记录，但不进入冻结时间分析。')
    const events = records.filter(r => r.event.athlete_id === athleteId && iso(r.event.timestamp) &&
      Date.parse(r.event.timestamp) <= cutoff && iso(r.recordedAt) && Date.parse(r.recordedAt) <= cutoff).map(r => r.event)
    const occurrences = listTrainingOccurrences()
    // v89.2：与训练日志同一份记录——这次训练自己的逐组事件（日志“逐组已记”的同一口径），不再要求原计划快照逐组对齐。
    const strengthDays = new Set<string>(), runDays = new Set<string>(), phoneRunPlans = new Set<string>(), phoneOccurrences = new Map<string,string[]>()
    const loads = readSavedSessionLoads(athleteId,effectiveAsOf)
    for (const occurrence of occurrences) {
      const oid = occurrence.trainingOccurrenceId
      if (!occurrence.startedAt || !recent(occurrence.startedAt)) continue
      if (!events.some(e => e.event_id === occurrence.startEventId)) continue
      const corrections = readTrainingCorrectionsAsOf(oid,effectiveAsOf)
      if (corrections.unknownCommitTime.length) { gaps.push('训练更正缺少可靠录入时间，历史肌群依据未知'); continue }
      if (corrections.voided) continue
      const closed = events.find(e=>e.event_id===occurrence.closeEventId)
      const endedAt=closed&&iso(occurrence.endedAt)&&Date.parse(occurrence.endedAt)<=cutoff?occurrence.endedAt:null
      const load=loads.find(s=>s.id===oid)
      const actualProtocols=[...new Set(events.filter(e=>e.payload?.trainingOccurrenceId===oid).map(e=>e.payload?.trainingProtocol).filter((v):v is string=>typeof v==='string'&&!!v.trim()))]
      const meta={endedAt,protocolKey:actualProtocols.length===1?actualProtocols[0]:null,sessionRpe:load?.sessionRpe??null,sessionRpeScale:load?.sessionRpe!=null?'0-10_SESSION_RPE':null}
      const snapshot = occurrence.trainingPlanSnapshotId ? getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId) : null
      const latest = new Map<string, (typeof records)[number]>()
      for (const r of records) {
        const q = r.event.payload as Record<string, unknown> | undefined
        if (r.event.event_type !== 'TRAINING_SET_COMPLETED' || r.event.athlete_id !== athleteId || q?.trainingOccurrenceId !== oid) continue
        if (!iso(r.event.timestamp) || Date.parse(r.event.timestamp) > cutoff || (!iso(r.recordedAt) || Date.parse(r.recordedAt) > cutoff)) continue
        if (typeof q.moveId !== 'string' || typeof q.setIndex !== 'number') continue
        latest.set(`${q.moveId}:${q.setIndex}`, r) // 同一组重记以最后一次为准
      }
      const exercises: NonNullable<TrainingPart['exercises']> = []
      const strengthSets:StrengthSet[]=[]
      let known = ''
      for (const r of latest.values()) {
        const q = r.event.payload as Record<string, unknown>
        if (q.completed !== true || q.skipped === true) continue
        const eff = effectiveStrengthFields(q,{corrections:corrections.rows}), timed = q.mode === 'seconds'
        const amount = timed ? (typeof q.actualAmount === 'number' ? q.actualAmount : null) : eff.reps.value
        if (!(eff.reps.status === 'UNKNOWN' || amount != null && amount > 0)) continue // 更正成 0 / 没有完成量 = 这组不算
        const planned = snapshot?.exercises.find(e => e.moveId === q.moveId)
        const name = (typeof q.name === 'string' && q.name.trim()) || planned?.name || String(q.moveId)
        const key = libraryKey(name, typeof q.catalogId === 'string' ? q.catalogId : planned?.catalogId) ?? undefined
        const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null
        strengthSets.push({id:r.event.event_id,catalogId:key??null,catalogVersion:'U11_CATALOG_1',side:['LEFT','RIGHT','BILATERAL'].includes(String(q.side))?q.side as StrengthSet['side']:'UNSPECIFIED',loadKg:eff.weight.value,loadBasis:['TOTAL_EXTERNAL','PER_HAND','ASSISTANCE','BODYWEIGHT'].includes(String(q.loadBasis))?q.loadBasis as StrengthSet['loadBasis']:'UNKNOWN',reps:timed?null:eff.reps.value,holdSeconds:timed?n(q.actualAmount):null,setRpe:n(q.setRpe),rir:n(q.rir),effortScale:typeof q.effortScale==='string'?q.effortScale:null,eccentricSeconds:n(q.eccentricSeconds),rangeProtocol:typeof q.rangeProtocol==='string'?q.rangeProtocol:null,completion:'COMPLETED'})
        const same = exercises.find(e => e.catalogId === key && e.name === name)
        if (same) same.actualSets!++
        else exercises.push({ catalogId: key, name, actualSets: 1, verified: true })
        const correctionAt=corrections.rows.filter(c=>c.kind==='FIELD'&&(c.field==='weight'||c.field==='reps')&&c.setKey===`${q.moveId}:${q.setIndex}`).map(c=>c.recordedAt!).sort().at(-1)
        const at = correctionAt && Date.parse(correctionAt)>Date.parse(r.recordedAt!) ? correctionAt : r.recordedAt!
        if (at > known) known = at
      }
      if (exercises.length) {
        const p: TrainingPart = { athleteId, eventId: oid, occurrenceId: oid, componentId: 'strength', modality: 'STRENGTH', occurredAt: occurrence.startedAt,
          knownAt: known < occurrence.startedAt ? occurrence.startedAt : known, sourceId: oid, actual: 'CONFIRMED', ...meta, exercises, strengthSets, revision:listCorrections(oid,effectiveAsOf).length }
        add(p, events.some(e=>e.event_id===occurrence.closeEventId) ? '力量逐组记录' : '力量逐组记录（进行中）', exercises.map(e => `${e.name} ${e.actualSets}组`).join('；'), exercises.reduce((n, e) => n + (e.actualSets ?? 0), 0))
        const d = localDay(new Date(occurrence.startedAt)); strengthDays.add(d)
        const v4 = /plan400:(\d{4}-\d\d-\d\d)/.exec(occurrence.sessionId)?.[1]; if (v4) strengthDays.add(v4)
      }
      // 跑步与力量并列读取，不能用力量完成替代跑步完成。
      // 逐段跑步（手机执行）：类型按计划课，不按配速/心率
      let run: ReturnType<typeof projectRunningExecution> | null = null
      try { run = projectRunningExecution(oid, events) } catch { run = null }
      if (run?.availability !== 'AVAILABLE' || ![...run.repetitions, ...run.continuous].some(x => x.status === 'COMPLETED')) continue
      const v4 = /plan400:(\d{4}-\d\d-\d\d)/.exec(occurrence.sessionId)?.[1]
      const runType = v4 ? v4RunType(planDays().find(x => x.date === v4)) : 'UNKNOWN'
      const runCorrections=listCorrections(oid,effectiveAsOf).filter(c=>c.kind==='FIELD'&&(c.field==='distance'||c.field==='duration'))
      if(runCorrections.length){gaps.push('跑步存在尚未绑定逐段位置的更正；不继续引用旧分段数值，请在日志核对。');continue}
      const runSegments=[...run.repetitions.map(x=>({id:x.sourceEventIds[0]??`${x.componentId}:${x.blockId}:${x.roundOrdinal}:${x.stepId}:${x.repeatOrdinal}`,blockId:x.blockId,roundIndex:x.roundOrdinal,stepIndex:x.repeatOrdinal,distanceM:x.actualDistanceMeters,durationSeconds:x.actualDurationSeconds,restAfterSeconds:run!.recoveries.find(r=>r.componentId===x.componentId&&r.blockId===x.blockId&&r.stepId===x.stepId&&r.roundOrdinal===x.roundOrdinal&&r.afterRepeatOrdinal===x.repeatOrdinal)?.actualRecoverySeconds??null,rawResolutionSeconds:null,gradePercent:null,surface:null,completion:x.status==='COMPLETED'?'COMPLETED' as const:x.status==='SKIPPED'?'SKIPPED' as const:'NOT_RECORDED' as const})),...run.continuous.map(x=>({id:x.sourceEventIds[0]??x.componentId,blockId:x.componentId,roundIndex:null,stepIndex:1,distanceM:x.actualDistanceMeters,durationSeconds:x.actualDurationSeconds,restAfterSeconds:null,rawResolutionSeconds:null,gradePercent:null,surface:null,completion:x.status==='COMPLETED'?'COMPLETED' as const:'NOT_RECORDED' as const}))]
      const runIds=new Set([...run.repetitions,...run.continuous,...run.recoveries].flatMap(x=>x.sourceEventIds));const close = records.filter(r=>runIds.has(r.event.event_id)).map(r=>r.recordedAt).filter((x):x is string=>!!x&&iso(x)&&Date.parse(x)<=cutoff).sort().at(-1)
      if (!iso(close)) { gaps.push('逐段跑步缺少可靠录入时间，未补造知晓时刻'); continue }
      const plan = v4 ? `v4run:${v4}` : oid
      const frozen=getRunningPlanSnapshot(oid)
      const purposes=frozen&&iso(frozen.capturedAt)&&Date.parse(frozen.capturedAt)<=cutoff?frozen.components.flatMap(c=>c.modality==='RUNNING'?[c.purpose]:[]).filter(p=>p!=='UNSPECIFIED'&&p!=='OTHER'):[]
      const completedRunEvents=events.filter(e=>runIds.has(e.event_id)), explicitTypes=[...new Set(completedRunEvents.map(e=>(e.payload as Record<string,unknown>)?.observedRunType).filter(v=>['EASY','TEMPO','INTERVAL','SPRINT','HILL','LONG','SPEED_ENDURANCE','HILL_SPRINT','ACCELERATION'].includes(String(v))))]
      // A measured repetition/rest structure can establish intervals, never sprint intensity.
      const observedType:TrainingPart['runType']=explicitTypes.length===1?explicitTypes[0] as TrainingPart['runType']:run.repetitions.some(r=>r.status==='COMPLETED')&&run.recoveries.some(r=>r.actualRecoverySeconds!==null)?'INTERVAL':'UNKNOWN'
      add({ athleteId, eventId: oid, occurrenceId: oid, componentId: 'running', modality: 'RUN', occurredAt: occurrence.startedAt, knownAt: iso(close) && close >= occurrence.startedAt ? close : occurrence.startedAt,
        sourceId: oid, actual: 'CONFIRMED',...meta,plannedPurpose:purposes.length?[...new Set(purposes)].join(' / '):null,runType:observedType,runSegments,runningStructure:run,revision:listCorrections(oid,effectiveAsOf).length }, '逐段跑步记录', `${v4 ? `${planPrefix()}${mdOf(v4)} 计划课` : '计划课'} · ${RUN_TYPE_LABEL[runType]}`)
      phoneOccurrences.set(plan,[...(phoneOccurrences.get(plan)??[]),oid])
      phoneRunPlans.add(plan); runDays.add(localDay(new Date(occurrence.startedAt))); if (v4) runDays.add(v4)
    }
    // v89.10.6：先读手表跑步关联——已关联计划课的那条手表跑步，导入记录（同一来源标识）不再重复列出。
    let match: ReturnType<typeof loadRunMatch> = { links: [], suggestions: [] }
    try { match = loadRunMatch() } catch { match = { links: [], suggestions: [] } }
    const imports = coachImports(athleteId,effectiveAsOf)
    const confirmedLinks=loadOwnedComponents(currentStore()).days
    for (const record of imports) {
      if (!record.occurredAt.value || !recent(record.occurredAt.value)) continue
      const corrections = readTrainingCorrectionsAsOf(record.confirmedImportId,effectiveAsOf)
      if (corrections.unknownCommitTime.length) { gaps.push('导入训练更正缺少可靠录入时间，历史肌群依据未知'); continue }
      if (corrections.voided) continue
      if (listCorrections(record.confirmedImportId,effectiveAsOf).some(c=>c.kind==='FIELD')) {
        gaps.push('导入训练已有更正，肌群分析不再引用更正前明细'); continue
      }
      const linked=match.links.find(l=>l.by==='user'&&record.sourceRecordIdentity&&[l.run.id,...l.run.originIds].includes(record.sourceRecordIdentity))
      const linkedDay=linked?/^plan400:(\d{4}-\d\d-\d\d):running$/.exec(linked.entry.id)?.[1]:null
      const receipt=linkedDay?confirmedLinks[linkedDay]?.running?.device:null
      const phoneIds=linkedDay?phoneOccurrences.get(`v4run:${linkedDay}`)??[]:[]
      const confirmedPhone=receipt?.linkedBy==='user'&&iso(receipt.linkedAt)&&Date.parse(receipt.linkedAt)<=cutoff&&phoneIds.length===1?phoneIds[0]:null
      const cc=record.comparisonContext
      const fullSeconds=record.sport!=='MIXED'&&record.durationSeconds.status==='RECORDED'?record.durationSeconds.value:null
      const computedEnd=fullSeconds!==null&&iso(record.occurredAt.value)?new Date(Date.parse(record.occurredAt.value)+fullSeconds*1000).toISOString():null
      const durationValid=computedEnd!==null&&Date.parse(computedEnd)<=cutoff&&Date.parse(computedEnd)<=Date.parse(record.confirmedAt)
      const base = {actualDurationSeconds:durationValid?fullSeconds:null,endedAt:durationValid?computedEnd:null,sourceKind:!record.sourceRecordIdentity&&!record.provenance?'MANUAL_IMPORT' as const:undefined,
        deviceId:cc?.deviceId.status==='RECORDED'?cc.deviceId.value:null,protocolKey:cc?.protocolKey.status==='RECORDED'?cc.protocolKey.value:null,
        athleteId,eventId:record.confirmedImportId,occurrenceId:record.confirmedImportId,
        occurredAt:record.occurredAt.value,knownAt:record.confirmedAt,sourceId:record.confirmedImportId,actual:'CONFIRMED' as const,provenance:record.provenance??{provider:providerOf(record.sourceRecordIdentity),accountRef:null,recordId:record.sourceRecordIdentity??record.confirmedImportId,measuredAt:record.occurredAt.value,receivedAt:record.confirmedAt},sessionRpe:record.sessionRpe.status==='RECORDED'?record.sessionRpe.value:null,sessionRpeScale:record.sessionRpe.status==='RECORDED'?'0-10_SESSION_RPE':null}
      if (record.sport === 'STRENGTH' || record.sport === 'MIXED') {
        const exercises: NonNullable<TrainingPart['exercises']> = []
        for (const s of record.strengthSets) {
          if (s.completion!=='COMPLETED' || s.exerciseName.status!=='RECORDED' ||
            ![s.repetitions,s.durationSeconds].some(f=>f.status==='RECORDED' && f.value!=null && f.value>0)) continue
          // Exact library name/alias only; no free-text/AI fuzzy matching.
          const catalogId = libraryKey(s.exerciseName.value) ?? undefined
          const old = exercises.find(e=>e.catalogId===catalogId && e.name===s.exerciseName.value)
          if(old) old.actualSets!++
          else exercises.push({catalogId,name:s.exerciseName.value??undefined,actualSets:1,verified:true})
        }
        add({...base,componentId:'strength',modality:'STRENGTH',exercises,strengthSets:record.strengthSets.map(s=>({id:s.id,catalogId:libraryKey(s.exerciseName.value)??null,catalogVersion:'U11_CATALOG_1',side:s.side?.status==='RECORDED'?(s.side.value??'UNSPECIFIED'):'UNSPECIFIED',loadKg:s.weightKg.status==='RECORDED'?s.weightKg.value:null,loadBasis:s.loadBasis?.status==='RECORDED'?(s.loadBasis.value??'UNKNOWN'):'UNKNOWN',reps:s.repetitions.status==='RECORDED'?s.repetitions.value:null,holdSeconds:s.durationSeconds.status==='RECORDED'?s.durationSeconds.value:null,setRpe:null,rir:s.rir?.status==='RECORDED'?s.rir.value:null,effortScale:s.rir?.status==='RECORDED'?'RIR':null,eccentricSeconds:null,rangeProtocol:s.rangeProtocol?.status==='RECORDED'?s.rangeProtocol.value:null,completion:s.completion==='COMPLETED'?'COMPLETED':s.completion==='SKIPPED'?'SKIPPED':'NOT_RECORDED'}))},'已确认导入力量',
          exercises.map(e=>`${e.name} ${e.actualSets}组`).join('；')||'无法判断具体肌群：只有摘要，没有动作明细',
          exercises.length ? exercises.reduce((n,e)=>n+(e.actualSets??0),0) : null)
      }
      if(confirmedPhone)notes.push('已确认关联的手表跑步与手机逐段记录属于同课：本次只采用手机逐段实际，手表原始记录保留，不永久合并来源。')
      if (!confirmedPhone&&(record.sport==='RUNNING'||record.sport==='MIXED'))
        add({...base,componentId:'running',modality:'RUN',runType:record.observedRunType?.status==='RECORDED'?(record.observedRunType.value??'UNKNOWN'):'UNKNOWN',runningStructure:record.runningSegments,runSegments:record.runningSegments.filter(s=>s.kind!=='RECOVERY').map((s,i)=>({id:s.id,blockId:'import',roundIndex:s.round.value,stepIndex:s.repeat.value??i+1,restScope:s.recoveryScope??'UNSPECIFIED',kind:s.kind==='CONTINUOUS'?'CONTINUOUS':s.kind==='REPETITION'?'REPETITION':'UNKNOWN',averageHeartRateBpm:s.averageHeartRateBpm?.status==='RECORDED'?s.averageHeartRateBpm.value:null,heartRateMethod:s.heartRateMethod?.status==='RECORDED'?s.heartRateMethod.value:null,distanceM:s.distanceMeters.status==='RECORDED'?s.distanceMeters.value:null,durationSeconds:s.durationSeconds.status==='RECORDED'?s.durationSeconds.value:null,restAfterSeconds:s.recoverySeconds.status==='RECORDED'?s.recoverySeconds.value:null,rawResolutionSeconds:null,gradePercent:cc?.gradePercent.status==='RECORDED'?cc.gradePercent.value:null,surface:cc?.surface.status==='RECORDED'?cc.surface.value:null,completion:s.completion==='COMPLETED'?'COMPLETED':s.completion==='SKIPPED'?'SKIPPED':'NOT_RECORDED'}))},`导入的跑步${brandLabel(record.sourceRecordIdentity)}`,importedRunDetail(record))
      for (const [kind,field] of [['PAIN',record.pain],['SORENESS',record.soreness]] as const) {
        if (field.status!=='RECORDED'||!field.value) continue
        const region=regionFromExplicitLabel(field.value.location)
        if(!region) { if(kind==='PAIN'&&(field.value.intensity===null||field.value.intensity>0))painReviewRequired=true; gaps.push(`${kind==='PAIN'?'疼痛':'酸痛'}位置未精确到肌群，保留原反馈，请核对具体部位`); continue }
        const s: Symptom={...base,eventId:`${base.eventId}:${kind}`,region,kind,severity:field.value.intensity??undefined}
        symptoms.push(s);sources.push({id:s.eventId,label:'导入的局部反馈',occurredAt:s.occurredAt,knownAt:s.knownAt,actualSets:null,detail:`${field.value.location} · ${kind==='PAIN'?'疼痛':'酸痛'} ${s.severity??'程度未知'}`})
      }
    }
    // v89.2：手表跑步——已关联计划课的按计划课类型计入；未关联的只留一句说明。手表力量只有摘要，同日已有逐组记录时不再重复提示。
    const linkedIds = new Set<string>()
    for (const l of match.links) {
      if (!recent(l.run.startedAt)) continue
      l.run.originIds.forEach(id => linkedIds.add(id)); linkedIds.add(l.run.id)
      const v4 = /^plan400:(\d{4}-\d\d-\d\d):running$/.exec(l.entry.id)?.[1]
      const plan = v4 ? `v4run:${v4}` : l.entry.id
      if (phoneRunPlans.has(plan)) continue // 同一节已有逐段记录，只算一次
      // A link is not a receipt of the device data. Retain the confirmed
      // import (with its real knownAt/provenance) rather than fabricate one
      // at the workout start. Historical links are not silently backdated.
      const imported=imports.some(r=>r.sourceRecordIdentity && [l.run.id,...l.run.originIds].includes(r.sourceRecordIdentity))
      if(!imported) gaps.push('已关联手表跑步缺少已确认导入及入库时间；日志关联保留，本次冻结分析暂不引用其数值。')
      runDays.add(l.run.date); if (v4) runDays.add(v4)
    }
    const watchRaw=currentStore()?.getItem(garminViewKey('fk-garmin-acts-v1'))
    let unlinkedRuns=0, watchLifts=0
    for(const row of garminRows(watchRaw?JSON.parse(watchRaw):{})) if(recent(row.startedAt)) {
      if(row.sport==='RUNNING'){ if(!linkedIds.has(row.id)&&!row.originIds.some(id=>linkedIds.has(id)))unlinkedRuns++ }
      else if(!strengthDays.has(row.date))watchLifts++
    }
    if(unlinkedRuns)notes.push(`${unlinkedRuns} 条手表跑步未关联计划课：类型未知，未计入肌群（可在日志里关联）`)
    if(watchLifts)notes.push(`${watchLifts} 条手表力量只有摘要、没有逐组动作，未计入肌群`)
    const evalOnly:string[]=[]
    for (const [date,row] of Object.entries(loadOwnedComponents(currentStore()).days)) {
      for (const name of ['running','strength'] as const) {
        const p=row[name], doneOn=p?.doneOn||date
        if(!p || !validDay(doneOn) || doneOn>day || doneOn<localDay(new Date(cutoff-72*3600000))) continue
        const logged=name==='running'?runDays.has(date)||runDays.has(doneOn):strengthDays.has(date)||strengthDays.has(doneOn)
        if((p.status==='done'||p.status==='reduced')&&!logged) evalOnly.push(`${mdOf(doneOn)}${name==='running'?'跑步':'力量'}`)
        if(p.pain && (p.pain.score===null || p.pain.score>0)) {
          const region=regionFromExplicitLabel(p.pain.area)
          // Date-only actual time stays unknown: report the symptom without fabricating a timestamp.
          gaps.push(`${doneOn} 自报${p.pain.area||'部位未明确'}疼痛${p.pain.score==null?'':` ${p.pain.score}/10`}；${region?'缺少发生时刻，保留反馈但未自动映射':'不能由部位猜测具体肌肉'}，设备分数不能解除限制`)
        }
      }
    }
    if(evalOnly.length)notes.push(`${evalOnly.join('、')}只有分项评价、没有逐组/逐段或关联手表记录，未计入肌群`)
    const rawPain=JSON.parse(currentStore()?.getItem('fk-pain-log-v1')??'[]')
    if(!Array.isArray(rawPain)) throw Error('INVALID_PAIN_SOURCE')
    // v89.3（合入 U12 时间线）：自报疼痛不随 72 小时窗口自动消失——超过 36 小时没有新反馈 = 待复核；之后明确报 0 才解除（但不等于组织已恢复）。
    for(const p of rawPain) if((p?.athleteId??'local')===athleteId && validDay(p?.date) && p.date<=day && typeof p.score==='number' && p.score>=0 && p.score<=10) {
      const region=regionFromExplicitLabel(String(p.part??''))
      if(!region&&p.score>0&&iso(p.recordedAt)&&Date.parse(p.recordedAt)<=cutoff&&(!iso(p.occurredAt)||Date.parse(p.occurredAt)<=cutoff))painReviewRequired=true
      if(region && iso(p.occurredAt) && iso(p.recordedAt) && Date.parse(p.occurredAt)<=cutoff && Date.parse(p.recordedAt)<=cutoff && Date.parse(p.recordedAt)>=Date.parse(p.occurredAt)) {
        painUpdates.push({athleteId,reportId:String(p.id),sourceId:'fk-pain-log-v1',region,kind:'PAIN',severity:p.score,occurredAt:p.occurredAt,knownAt:p.recordedAt,revision:0,status:'RECORDED'})
        painLabel.set(String(p.id),`${p.part} · ${p.score}/10`)
      } else if(p.score>0 && p.date>=localDay(new Date(cutoff-72*3600000))) gaps.push(`${p.date} 自报${String(p.part??'部位未知')}疼痛 ${p.score}/10；时间或肌群位置不够明确，不补造发生时刻或肌群诊断`)
    }
  } catch { unreadable=true; gaps.push('部分训练来源无法读取，不能当作没有训练或没有疼痛') }
  const review=buildMuscleReview({athleteId,asOf:effectiveAsOf,parts,symptoms})
  let timeline:ReturnType<typeof buildMuscleTimeline>|null=null
  try{timeline=buildMuscleTimeline({athleteId,asOf:effectiveAsOf,parts:[],symptomUpdates:painUpdates})}catch{gaps.push('自报疼痛记录无法按时间整理，请核对')}
  for(const t of timeline?.regions??[]){
    const r=review.regions.find(x=>x.region===t.region)!
    if(t.state==='PAIN_ACTIVE'||t.state==='PAIN_RECHECK'){
      const last=painUpdates.filter(u=>u.region===t.region&&u.kind==='PAIN'&&u.severity>0).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))[0]
      if(last){const id=`pain:${last.reportId}`
        if(!sources.some(x=>x.id===id))sources.push({id,label:t.state==='PAIN_RECHECK'?'自报疼痛（待复核）':'自报疼痛',occurredAt:last.occurredAt,knownAt:last.knownAt,actualSets:null,detail:painLabel.get(last.reportId)??`${t.label} · ${last.severity}/10`})
        if(!r.symptomEventIds.includes(id))r.symptomEventIds.push(id)}
      r.state='PAIN_REVIEW'
    }else if(t.state==='SOURCE_CONFLICT')gaps.push(`${t.label}：同一时刻有互相矛盾的疼痛反馈，请核对`)
    for(const n of t.notes)if(!/训练参与|跑步与力量/.test(n)&&!r.notes.includes(n))r.notes.push(n)
  }
  const observedN=review.regions.filter(r=>r.state!=='UNKNOWN').length
  if(observedN)review.summary=`近72小时${observedN}个区域有训练参与或主观反馈（疼痛按最近一次反馈，未复核不自动解除），不能据此估算恢复百分比。`
  review.gaps=[...new Set([...review.gaps,...gaps,...notes])]
  if(!review.regions.some(r=>r.state!=='UNKNOWN')) review.summary='无法判断具体肌群：缺少可信的实际动作明细或精确局部反馈。'
  // Current authorized runner only persists daily summaries. Its coverage is NOT promoted to continuous samples.
  // v89：日内曲线只有一套——数据源是 v88.3 手表日内存储，算法是 U10 投影；没有样本时保持空投影，不拼日汇总。
  let stored:ReturnType<typeof loadIntraday>={}
  try{stored=loadIntraday(athleteId)}catch{stored={}}
  const intraday=intradayRecoveryFromStore(stored,athleteId,day,effectiveAsOf)??buildIntradayRecovery({athleteId,day,now:effectiveAsOf,utcOffsetMinutes:-new Date(asOf).getTimezoneOffset(),samples:[],sleepEvents:[],trainingEvents:[]})
  if(!stored[day])intraday.warnings.push('这天没有手表逐时样本；日汇总仍在身体指标中保留，不拼成全天曲线。')
  intraday.warnings.push('午睡时段：佳明午睡字段未核准，自报午睡只有估计时长、没有起止时间，不画进曲线。')
  const analysis=analysisFromParts(athleteId,effectiveAsOf,parts)
  const exposure=buildMuscleExposure(analysis)
  return {athleteId,day,review,sources,intraday,unreadable,painReviewRequired,analysis,exposure,parts,
    revision:shortHash(JSON.stringify([athleteId,day,review.regions,review.gaps,sources,unreadable,painReviewRequired,parts])),automaticPrescription:false as const}
}
export type RecoveryProjection = ReturnType<typeof readRecoveryProjection>
const STATE_TEXT:Record<string,string>={PAIN_REVIEW:'有自报疼痛，需先核对症状',REPORTED_SORENESS:'有自报酸痛',OVERLAP_OBSERVED:'跑步和力量参与重叠',TRAINING_EXPOSURE:'有已确认训练参与'}
/** v89.2：同一状态的肌群合并成一行、依据每条记录只列一次（不再每个肌群重复整节动作清单）。 */
export function recoveryLines(v: RecoveryProjection) {
  const observed=v.review.regions.filter(r=>r.state!=='UNKNOWN'), groups:string[]=[]
  for(const st of ['PAIN_REVIEW','REPORTED_SORENESS','OVERLAP_OBSERVED','TRAINING_EXPOSURE']){
    const rs=observed.filter(r=>r.state===st); if(rs.length) groups.push(`${rs.map(r=>REGION_LABEL[r.region]).join('、')}：${STATE_TEXT[st]}`)
  }
  const used=[...new Set(observed.flatMap(r=>[...r.runEventIds,...r.strengthEventIds,...r.symptomEventIds]))]
  const evidence=used.map(id=>v.sources.find(s=>s.id===id)).filter((s):s is RecoverySource=>!!s)
    .map(s=>`依据 ${s.label}${s.occurredAt?`（${mdOf(localDay(new Date(s.occurredAt)))}）`:''}：${s.detail}`)
  return {summary:v.review.summary,groups,evidence,gaps:v.review.gaps,next:'下一步：核对实际完成的动作、组次和具体不适部位；这不是肌肉疲劳百分比，也不自动更改课表。'}
}
export function recoveryExplanation(v: RecoveryProjection): string {
  const l=recoveryLines(v)
  return [l.summary,...l.groups,...l.evidence,exposureText(v.exposure),...l.gaps,l.next].join('\n')
}

const BRAND_ZH = { GARMIN: '佳明', COROS: '高驰', POLAR: '博能', SUUNTO: '颂拓', HUAWEI: '华为', APPLE_HEALTH: '苹果健康', HEALTH_CONNECT: 'Health Connect', OTHER: '其他来源' } as const
function brandLabel(identity: string | undefined) { const p = providerOf(identity); return p === 'OTHER' ? '' : ` · ${BRAND_ZH[p]}` }
/** v89.10.6：导入跑步卡只写记录里真有的字段（标题/距离/用时/配速），不推断类型或肌群；说明它对肌肉恢复意味着什么、可以怎么做。 */
export function importedRunDetail(r: { title: { value: string | null }; totalDistanceMeters: { value: number | null }; durationSeconds: { value: number | null } }): string {
  const km = r.totalDistanceMeters.value && r.totalDistanceMeters.value > 0 ? r.totalDistanceMeters.value / 1000 : null
  const sec = r.durationSeconds.value && r.durationSeconds.value > 0 ? r.durationSeconds.value : null
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
  const facts = [r.title.value?.trim() || null, km ? `${km.toFixed(2)} km` : null, sec ? `用时 ${sec >= 3600 ? `${Math.floor(sec / 3600)}:` : ''}${sec >= 3600 ? mmss(sec % 3600).padStart(5, '0') : mmss(sec)}` : null, km && sec ? `配速 ${mmss(sec / km)}/km` : null].filter(Boolean)
  return `${facts.length ? facts.join(' · ') : '跑步（记录里没有距离/用时）'}。还不知道这次是轻松跑、间歇还是长距离，所以没算进肌肉负荷；在日志里把它关联到计划课后，会按课型计入。`
}

