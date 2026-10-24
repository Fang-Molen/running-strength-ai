import test from 'node:test'
import assert from 'node:assert/strict'
import type { AnalysisFact, DerivedFact, EvidenceSnapshot, TrainingFact } from './analysis-contract'
import { context, metric, set, training } from './analysis-fixtures'
import { projectAnalysisEvidence, sourceScope } from './analysis-evidence'
import { deriveAnalysisFacts } from './analysis-derived'
import { analysisFromParts } from './analysis-from-parts'
import { modelFixtures } from '../../../evaluation/deepseek-development/model-fixtures'

const fixture = (id:string) => modelFixtures().find(f => f.caseId === id)!
const factsFor = (id:string) => deriveAnalysisFacts(projectAnalysisEvidence(fixture(id)))
const snap = (facts:AnalysisFact[]) => projectAnalysisEvidence({context, facts})
const find = (facts:DerivedFact[], metric:string, ref?:string) => {
 const result = facts.find(f => f.metric === metric && (!ref || f.evidenceRefs.some(r => r.id === ref)))
 assert.ok(result, `missing ${metric}${ref ? ` for ${ref}` : ''}`)
 return result
}
const run = (id='run'):TrainingFact => training({id, sourceRecordId:id, modality:'RUN', componentId:'running', strengthSets:[], runSegments:[30,34,38,42].map((durationSeconds,i) => ({id:`${id}-${i}`,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM:200,durationSeconds,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}))})

test('E01 derives every historical course with exact sums and distinct source labels', () => {
 const rows = factsFor('E01')
 assert.equal(find(rows,'OCCURRENCE_COUNT').value,4)
 for (const [id,total] of [['s3',144],['s0',138],['s2',132],['s1',121]] as const) {
  const fact = find(rows,'RUN_WORK_SECONDS',id)
  assert.equal(fact.value,total)
  assert.equal(fact.scope.occurrenceId,id)
  assert.match(fact.text,new RegExp(`${id}@1`))
  assert.ok(fact.text.includes(id === 's3' ? '2026-10-15' : id === 's0' ? '2026-10-16' : id === 's2' ? '2026-10-17' : '2026-10-18'))
  assert.equal(fact.inputs.reduce((n,x) => n+x.value,0),total)
  assert.equal(fact.formulaVersion,'FK_DERIVED_1')
 }
 assert.equal(find(rows,'RUN_TIME_CHANGE_SECONDS','s3').value,12)
 assert.equal(find(rows,'RUN_TIME_CHANGE_PERCENT','s3').value,40)
 assert.ok(Math.abs(find(rows,'RUN_SPEED_DECLINE_PERCENT','s3').value-100*2/7)<1e-10)
 assert.equal(new Set(rows.map(f => f.id)).size,rows.length)
})

test('C07 distinguishes a longer elapsed time from a speed decline', () => {
 const rows=factsFor('C07')
 assert.equal(find(rows,'RUN_DISTANCE_M').value,4000)
 assert.equal(find(rows,'RUN_WORK_SECONDS').value,980)
 assert.equal(find(rows,'RUN_PACE_SECONDS_PER_KM').value,245)
 assert.equal(find(rows,'RUN_TIME_CHANGE_SECONDS').value,30)
 assert.ok(Math.abs(find(rows,'RUN_TIME_CHANGE_PERCENT').value-30/230*100)<1e-10)
 assert.ok(Math.abs(find(rows,'RUN_SPEED_DECLINE_PERCENT').value-30/260*100)<1e-10)
})

test('segment range and mean describe all completed times, including nonmonotonic courses', () => {
 const t=run(),nonmonotonic={...t,runSegments:t.runSegments.map((segment,i) => ({...segment,durationSeconds:[32,30,31,30][i]}))}
 const rows=deriveAnalysisFacts(snap([nonmonotonic])),range=find(rows,'RUN_SEGMENT_RANGE_SECONDS'),mean=find(rows,'RUN_SEGMENT_MEAN_SECONDS')
 assert.equal(range.value,2)
 assert.equal(mean.value,30.75)
 assert.equal(find(rows,'RUN_TIME_CHANGE_SECONDS').value,-2)
 assert.match(range.formula,/max.*min/i)
 assert.match(mean.formula,/sum.*count/i)
 assert.deepEqual(range.evidenceRefs,[{id:t.id,revision:1}])
 assert.equal(range.inputs.length,4)
 assert.deepEqual(range.inputs,mean.inputs)
 assert.equal(range.scope.occurrenceId,t.occurrenceId)
 assert.equal(find(factsFor('E01'),'RUN_SEGMENT_RANGE_SECONDS','s3').value,12)
 assert.equal(find(factsFor('E01'),'RUN_SEGMENT_MEAN_SECONDS','s3').value,36)
 for(const incomplete of [{...nonmonotonic,quality:'PARTIAL' as const,runSegments:nonmonotonic.runSegments.map((s,i) => i===1?{...s,durationSeconds:null}:s)},{...nonmonotonic,runSegments:nonmonotonic.runSegments.map((s,i) => i===1?{...s,durationSeconds:null}:s)}]) {
  assert.equal(deriveAnalysisFacts(snap([incomplete])).some(f => f.metric==='RUN_SEGMENT_RANGE_SECONDS'||f.metric==='RUN_SEGMENT_MEAN_SECONDS'),false)
 }
})

test('A03 counts one mixed occurrence and preserves independent running and strength doses', () => {
 const rows=factsFor('A03')
 assert.equal(find(rows,'OCCURRENCE_COUNT').value,1)
 assert.equal(find(rows,'RUN_DISTANCE_M').value,400)
 assert.equal(find(rows,'RUN_WORK_SECONDS').value,61)
 assert.equal(find(rows,'STRENGTH_SETS').value,2)
 assert.equal(find(rows,'STRENGTH_REPS').value,16)
 assert.equal(find(rows,'STRENGTH_EXTERNAL_VOLUME_KG_REPS').value,320)
 assert.ok(rows.filter(f => f.metric!=='OCCURRENCE_COUNT').every(f => f.scope.occurrenceId==='mixed-occurrence'))
 assert.equal(find(rows,'RUN_WORK_SECONDS').evidenceRefs[0].id,'mixed-run')
 assert.equal(find(rows,'STRENGTH_REPS').evidenceRefs[0].id,'mixed-strength')
})

test('complete PARTIAL training calculates each known dose without promoting its quality or inventing RPE', () => {
 const r={...run(),quality:'PARTIAL' as const},s=training({quality:'PARTIAL',sessionRpe:null,strengthSets:[set({id:'s1',loadKg:20,reps:8}),set({id:'s2',loadKg:20,reps:8})]})
 const snapshot=snap([r,s]),before=JSON.stringify(snapshot),rows=deriveAnalysisFacts(snapshot)
 assert.equal(find(rows,'RUN_DISTANCE_M').value,800)
 assert.equal(find(rows,'RUN_WORK_SECONDS').value,144)
 assert.equal(find(rows,'RUN_SEGMENT_RANGE_SECONDS').value,12)
 assert.equal(find(rows,'RUN_SEGMENT_MEAN_SECONDS').value,36)
 assert.equal(find(rows,'STRENGTH_SETS').value,2)
 assert.equal(find(rows,'STRENGTH_REPS').value,16)
 assert.equal(find(rows,'STRENGTH_EXTERNAL_VOLUME_KG_REPS').value,320)
 assert.ok(snapshot.facts.every(f => f.quality==='PARTIAL'))
 assert.equal(JSON.stringify(snapshot),before)
 assert.equal(rows.some(f => f.inputs.some(i => i.field==='sessionRpe')),false)
 const unknownReps=deriveAnalysisFacts(snap([training({quality:'PARTIAL',strengthSets:[set({reps:null})]})]))
 assert.equal(find(unknownReps,'STRENGTH_SETS').value,1)
 assert.equal(unknownReps.some(f => f.metric==='STRENGTH_REPS'||f.metric==='STRENGTH_EXTERNAL_VOLUME_KG_REPS'),false)
})

test('analysisFromParts real adapter retains complete running and strength arithmetic for PARTIAL facts', () => {
 const r=run(),common={athleteId:context.athleteId,eventId:'real-event',sourceId:'real-source',occurrenceId:'real-occurrence',revision:3,actual:'CONFIRMED' as const,occurredAt:r.occurredAt,knownAt:r.knownAt,sessionRpe:null}
 const snapshot=analysisFromParts(context.athleteId,context.asOf,[{...common,componentId:'running',modality:'RUN',runSegments:r.runSegments.slice(0,2)},{...common,componentId:'strength',modality:'STRENGTH',strengthSets:[set({id:'s1',loadKg:20,reps:8}),set({id:'s2',loadKg:20,reps:8})]}])
 assert.equal(snapshot.facts.length,2)
 assert.ok(snapshot.facts.every(f => f.quality==='PARTIAL'))
 const rows=deriveAnalysisFacts(snapshot)
 assert.equal(find(rows,'OCCURRENCE_COUNT').value,1)
 assert.equal(find(rows,'RUN_DISTANCE_M').value,400)
 assert.equal(find(rows,'RUN_WORK_SECONDS').value,64)
 assert.equal(find(rows,'STRENGTH_REPS').value,16)
 assert.equal(find(rows,'STRENGTH_EXTERNAL_VOLUME_KG_REPS').value,320)
 assert.deepEqual(find(rows,'RUN_WORK_SECONDS').evidenceRefs,[{id:'real-source:running',revision:3}])
 assert.deepEqual(find(rows,'STRENGTH_EXTERNAL_VOLUME_KG_REPS').evidenceRefs,[{id:'real-source:strength',revision:3}])
})

test('D04 derives five same-source RMSSD baselines, log ratio, and absolute RHR change', () => {
 const rows=factsFor('D04')
 const expected={RMSSD_CURRENT_MS:48,RMSSD_BASELINE_MEDIAN_MS:60,RMSSD_CHANGE_PERCENT:-20,RMSSD_BASELINE_SAMPLES:5,RHR_CURRENT_BPM:60,RHR_BASELINE_BPM:50,RHR_CHANGE_BPM:10,RHR_BASELINE_SAMPLES:5}
 for (const [key,value] of Object.entries(expected)) assert.equal(find(rows,key).value,value)
 const log=find(rows,'RMSSD_LOG_RATIO')
 assert.equal(log.value,Math.log(48/60))
 assert.equal(log.value,-0.2231435513142097)
 assert.deepEqual(new Set(log.evidenceRefs.map(r => r.id)),new Set(['hrv-current','rmssd-10','rmssd-11','rmssd-12','rmssd-13','rmssd-14']))
 assert.equal(log.scope.providerScopes.length,1)
 assert.equal(log.inputs.length,6)
})

test('RMSSD baselines exclude foreign account, device, protocol, provider, athlete and SDNN', () => {
 const original=fixture('D04'), baseline=original.facts.find(f => f.id==='rmssd-10')!
 const additions:AnalysisFact[]=[
  {...baseline,id:'wrong-account',sourceRecordId:'wrong-account',accountRef:'other'},
  {...baseline,id:'wrong-device',sourceRecordId:'wrong-device',deviceId:'other'},
  {...baseline,id:'wrong-protocol',sourceRecordId:'wrong-protocol',protocolKey:'SDNN'},
  {...baseline,id:'wrong-provider',sourceRecordId:'wrong-provider',provider:'COROS'},
  {...baseline,id:'wrong-athlete',sourceRecordId:'wrong-athlete',athleteId:'someone-else'},
  metric({id:'generic-hrv',sourceRecordId:'generic-hrv',metric:'HRV',unit:'ms',value:900}),
  metric({id:'sdnn',sourceRecordId:'sdnn',metric:'SDNN',unit:'ms',value:900}),
  metric({id:'ln-rmssd',sourceRecordId:'ln-rmssd',metric:'LN_RMSSD',unit:'ln(ms)',value:4}),
 ]
 const rows=deriveAnalysisFacts(projectAnalysisEvidence({...original,facts:[...original.facts,...additions]}))
 const comparison=find(rows,'RMSSD_CHANGE_PERCENT','hrv-current')
 assert.equal(comparison.value,-20)
 assert.equal(comparison.evidenceRefs.length,6)
 assert.equal(comparison.scope.providerScopes[0],sourceScope(baseline))
 assert.equal(rows.some(f => f.metric.startsWith('RMSSD') && f.evidenceRefs.some(r => ['generic-hrv','sdnn','ln-rmssd'].includes(r.id))),false)
})

test('missing RMSSD is never manufactured from generic HRV or a missing metric', () => {
 assert.equal(factsFor('D01').some(f => f.metric.startsWith('RMSSD')),false)
 const row=metric({metric:'RMSSD',unit:'ms',value:48,accountRef:null,deviceId:null,protocolKey:null})
 const rows=deriveAnalysisFacts(snap([row]))
 assert.equal(find(rows,'RMSSD_CURRENT_MS').value,48)
 assert.equal(find(rows,'RMSSD_BASELINE_SAMPLES').value,0)
 assert.equal(rows.some(f => f.metric==='RMSSD_CHANGE_PERCENT' || f.metric==='RMSSD_BASELINE_MEDIAN_MS'),false)
})

test('C04 retains both calendar offsets to competition and applies the context timezone', () => {
 const f=fixture('C04'), rows=deriveAnalysisFacts(projectAnalysisEvidence(f),{competitionDate:'2026-10-26'})
 assert.equal(find(rows,'DAYS_TO_COMPETITION_FROM_TRAINING').value,8)
 assert.equal(find(rows,'DAYS_TO_COMPETITION_FROM_ASOF').value,7)
 const dateSources=[{kind:'ANALYSIS_AS_OF',value:f.context.asOf,athleteId:f.context.athleteId,asOf:f.context.asOf,version:f.context.analysisVersion},{kind:'COMPETITION_DATE',value:'2026-10-26',athleteId:f.context.athleteId,asOf:f.context.asOf,version:f.context.planVersion}]
 assert.deepEqual(find(rows,'DAYS_TO_COMPETITION_FROM_TRAINING').contextSources,dateSources)
 assert.deepEqual(find(rows,'DAYS_TO_COMPETITION_FROM_ASOF').contextSources,dateSources)
 assert.deepEqual(find(rows,'DAYS_TO_COMPETITION_FROM_ASOF').evidenceRefs,[])
 const revisedContext=deriveAnalysisFacts(projectAnalysisEvidence({...f,context:{...f.context,planVersion:'revised-calendar-source'}}),{competitionDate:'2026-10-26'})
 assert.notEqual(find(rows,'DAYS_TO_COMPETITION_FROM_ASOF').id,find(revisedContext,'DAYS_TO_COMPETITION_FROM_ASOF').id)
 const t=run(), localContext={...context,asOf:'2026-10-23T23:30:00Z',timeZone:'Asia/Shanghai'}
 const local=deriveAnalysisFacts(projectAnalysisEvidence({context:localContext,facts:[{...t,startedAt:'2026-10-22T23:30:00Z'}]}),{competitionDate:'2026-10-26'})
 assert.equal(find(local,'DAYS_TO_COMPETITION_FROM_TRAINING').value,3)
 assert.equal(find(local,'DAYS_TO_COMPETITION_FROM_ASOF').value,2)
 assert.equal(deriveAnalysisFacts(snap([run()]),{competitionDate:'2026-02-30'}).some(f => f.metric.startsWith('DAYS_TO_')),false)
})

test('missing and partial run doses do not become full totals or zeros', () => {
 const t=run()
 const variants=[
  {...t,runSegments:[]},
  {...t,quality:'PARTIAL' as const,runSegments:t.runSegments.map((s,i) => i===1 ? {...s,durationSeconds:null} : s)},
  {...t,runSegments:t.runSegments.map((s,i) => i===1 ? {...s,durationSeconds:null} : s)},
  {...t,runSegments:t.runSegments.map((s,i) => i===1 ? {...s,completion:'NOT_RECORDED' as const} : s)},
 ]
 for(const row of variants) {
  const rows=deriveAnalysisFacts(snap([row]))
  assert.equal(rows.some(f => f.metric==='RUN_WORK_SECONDS' || f.metric==='RUN_PACE_SECONDS_PER_KM'),false)
 }
 const e05=factsFor('E05')
 assert.equal(find(e05,'OCCURRENCE_COUNT').value,3)
 assert.equal(e05.some(f => f.metric.startsWith('RUN_') && f.evidenceRefs.some(r => r.id==='unfinished')),false)
})

test('strength totals exclude unrecorded sets and do not add assistance or bodyweight to external volume', () => {
 const t=training({strengthSets:[set({id:'external',loadKg:20,reps:8}),set({id:'hand',loadKg:10,reps:8,loadBasis:'PER_HAND'}),set({id:'body',loadKg:70,reps:8,loadBasis:'BODYWEIGHT'}),set({id:'assisted',loadKg:10,reps:8,loadBasis:'ASSISTANCE'}),set({id:'unknown',loadKg:10,reps:8,loadBasis:'UNKNOWN'}),set({id:'skip',loadKg:999,reps:99,completion:'SKIPPED'})]})
 const rows=deriveAnalysisFacts(snap([t])), volumes=rows.filter(f => f.metric==='STRENGTH_EXTERNAL_VOLUME_KG_REPS')
 assert.equal(find(rows,'STRENGTH_SETS').value,5)
 assert.equal(find(rows,'STRENGTH_REPS').value,40)
 assert.equal(volumes.length,2)
 assert.ok(volumes.some(f => f.value===160 && f.unit==='kg·reps' && f.text.includes('TOTAL_EXTERNAL')))
 assert.ok(volumes.some(f => f.value===80 && f.unit==='kg·reps/hand' && f.text.includes('PER_HAND')))
 assert.ok(volumes.every(f => !/BODYWEIGHT|ASSISTANCE/.test(f.text)))
 const unknown=deriveAnalysisFacts(snap([training({strengthSets:[set({reps:null,loadKg:null})]})]))
 assert.equal(unknown.some(f => f.metric==='STRENGTH_REPS' || f.metric==='STRENGTH_EXTERNAL_VOLUME_KG_REPS'),false)
 const incomplete=deriveAnalysisFacts(snap([training({strengthSets:[set(),set({id:'unrecorded',completion:'NOT_RECORDED'})]})]))
 assert.equal(incomplete.some(f => f.metric.startsWith('STRENGTH_')),false)
})

test('only same-distance segments support time and speed change and skipped segments contribute no dose', () => {
 const t=run(), mixed={...t,runSegments:t.runSegments.map((s,i) => i===3 ? {...s,distanceM:300} : s)}
 const rows=deriveAnalysisFacts(snap([mixed]))
 assert.equal(rows.some(f => ['RUN_TIME_CHANGE_SECONDS','RUN_TIME_CHANGE_PERCENT','RUN_SPEED_DECLINE_PERCENT'].includes(f.metric)),false)
 const skipped=deriveAnalysisFacts(snap([{...t,runSegments:t.runSegments.map((s,i) => i===3 ? {...s,completion:'SKIPPED' as const} : s)}]))
 assert.equal(find(skipped,'RUN_WORK_SECONDS').value,102)
 assert.equal(find(skipped,'RUN_DISTANCE_M').value,600)
})

test('derived facts recheck revisions, retractions, athlete and knowledge cutoff even for an untrusted snapshot', () => {
 const t=run(), raw:EvidenceSnapshot={...snap([]),facts:[t,{...t,revision:2,status:'RETRACTED'},{...t,id:'future',sourceRecordId:'future',canonicalActivityId:'future',knownAt:'2026-10-23T08:00:00Z',receivedAt:'2026-10-23T08:00:00Z'},{...t,id:'foreign',athleteId:'other'},{...t,id:'planned',sourceRecordId:'planned',status:'PLANNED'}]}
 assert.deepEqual(deriveAnalysisFacts(raw),[])
 const e06=factsFor('E06')
 assert.equal(find(e06,'OCCURRENCE_COUNT').value,1)
 assert.equal(find(e06,'RUN_WORK_SECONDS').value,30)
 assert.ok(e06.every(f => f.evidenceRefs.every(r => r.id==='known-v1')))
})

test('derived IDs, scope and arithmetic are deterministic without mutating evidence', () => {
 const f=fixture('D04'), s=projectAnalysisEvidence(f), before=JSON.stringify(s)
 const first=deriveAnalysisFacts(s), second=deriveAnalysisFacts({...s,facts:s.facts.slice().reverse()})
 assert.deepEqual(first,second)
 assert.equal(JSON.stringify(s),before)
 assert.ok(first.every(f => f.scope.athleteId===s.context.athleteId && f.scope.asOf===s.context.asOf && Number.isFinite(f.value)))
 const correction=run(), changed=deriveAnalysisFacts(snap([correction,{...correction,revision:2,runSegments:[{...correction.runSegments[0],durationSeconds:29}]}]))
 assert.equal(find(changed,'RUN_WORK_SECONDS').value,29)
 assert.ok(changed.every(f => f.evidenceRefs.every(r => r.revision===2)))
})
