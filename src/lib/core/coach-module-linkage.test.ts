import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from './storage.ts'
import {createTrainingImportDraft,confirmTrainingImport,permanentlyDeleteConfirmedTrainingImport} from './training-import.ts'
import {readFormalEvidenceRows} from './coach-v4-formal-rows-store.ts'
import {assembleCoachBrief} from './coach-brief.ts'
import {buildFormalEvidenceRows,type CommittedEvent} from './coach-v4-formal-rows.ts'
import {reviewFormalEvidence} from './coach-v4-c11-adapter.ts'
import {computeV4Facts} from './coach-v4-computed.ts'
import {buildCoachModelRequest,normalizeAskCoachInput} from '../strength/coach-pipeline'
import {answerLocally} from './coach-local-first.ts'
import {vitalCoachSources,deviceCoachSources} from './coach-linked-context.ts'
import {makeDeviceRecord,parseDeviceEvidence} from './device-image-evidence.ts'
import {saveVital,loadVitals} from '../nutrition/vitals.ts'
const f=<T>(value:T)=>({value,status:'RECORDED',sourceIds:['user-confirmed']})
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},keys:()=>[...m.keys()]}}
test('confirmed import reaches actual brief, V4, model and local entry; delete withdraws it',()=>{
 setStoreBackend(memory())
 try{
  const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:f('2026-03-01T10:00:00Z'),runningStructure:'REPEATED',sessionRpe:f(6),subjectiveRecovery:f(7),soreness:f({location:'腿',intensity:2}),runningSegments:[1,2].map(n=>({id:`r${n}`,kind:'REPETITION',round:f(1),repeat:f(n),distanceMeters:f(400),durationSeconds:f(60+n),completion:'COMPLETED',sourceIds:['user-confirmed']}))},'TEXT',['user-confirmed'])
  const saved=confirmTrainingImport(draft);assert.ok(saved.ok)
  const occ=saved.record.confirmedImportId,asOf=new Date(Date.now()+1000).toISOString()
  const formal=readFormalEvidenceRows('local',asOf),brief=assembleCoachBrief(null,'分析这次实际配速',occ)
  assert.equal(brief.occurrenceId,occ);assert.equal(brief.subjectiveRecovery,7)
  const d=normalizeAskCoachInput({brief,v4:{athleteId:'local',asOf,rows:formal.rows}})
  assert.equal(d.v4!.reasoning.computed.points.length,2)
  assert.match(buildCoachModelRequest(d).packet,/2:33|2:35/)
  assert.match(answerLocally(brief,{frame:d.v4!.reasoning,snapshot:d.v4!.review.audit.snapshot}).text,/400米/)
  assert.equal(readFormalEvidenceRows('another-athlete',asOf).rows.length,0)
  assert.equal(confirmTrainingImport(draft).ok,true)
  assert.equal(readFormalEvidenceRows('local',asOf).rows.length,formal.rows.length)
  assert.ok(permanentlyDeleteConfirmedTrainingImport(occ))
  assert.equal(readFormalEvidenceRows('local',asOf).rows.length,0)
 }finally{setStoreBackend(null)}
})
const ev=(id:string,event_type:string,payload:Record<string,unknown>):CommittedEvent=>({event:{event_id:id,athlete_id:'a',event_type,source:'MANUAL',timestamp:'2026-03-01T10:00:00Z',payload},recordedAt:'2026-03-01T10:00:01Z'})
test('strength real amounts and corrections reach computed; no planned weight and no skipped volume',()=>{
 const committed=[ev('s','TRAINING_STARTED',{}),ev('set','TRAINING_SET_COMPLETED',{trainingOccurrenceId:'s',moveId:'squat',setIndex:1,mode:'reps',completed:true,skipped:false,actualWeight:60,actualAmount:8}),ev('skip','TRAINING_SET_COMPLETED',{trainingOccurrenceId:'s',moveId:'squat',setIndex:2,mode:'reps',skipped:true,plannedWeight:90,plannedAmount:10})]
 const args={athleteId:'a',asOf:'2026-03-03T00:00:00Z',committed}
 const rows=buildFormalEvidenceRows({...args,corrections:[{correctionId:'fix',schemaVersion:1,trainingOccurrenceId:'s',kind:'FIELD',field:'weight',setKey:'squat:1',newValue:'50',originalValue:'60',reason:'核对',at:'2026-03-02T00:00:00Z',recordedAt:'2026-03-02T00:00:00Z'}]}).rows
 const review=reviewFormalEvidence({...args,question:'力量训练如何',rows,scopeOccurrenceIds:['s']})
 const facts=computeV4Facts(review.audit.snapshot,'s').facts.filter(f=>f.kind==='STRENGTH_SET')
 assert.equal(facts.length,1);assert.match(facts[0].text,/50kg × 8次/);assert.match(facts[0].text,/400kg/);assert.ok(facts[0].cites.includes('fix'));assert.ok(!facts[0].cites.includes('set:STRENGTH_KG'))
 assert.ok(!review.audit.snapshot.active.some(r=>r.sourceId.startsWith('skip')))
})
test('subjective recovery and soreness formally conflict without becoming pain',()=>{
 const args={athleteId:'a',asOf:'2026-03-03T00:00:00Z',committed:[ev('s','TRAINING_STARTED',{}),ev('r1','EVIDENCE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SUBJECTIVE_RECOVERY',value:7}),ev('r2','EVIDENCE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SUBJECTIVE_RECOVERY',value:3}),ev('sore','EVIDENCE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SORENESS',intensity:4})],corrections:[]}
 const rows=buildFormalEvidenceRows(args).rows,review=reviewFormalEvidence({...args,question:'分析',rows,scopeOccurrenceIds:['s']})
 assert.equal(review.audit.snapshot.active.filter(r=>r.metric==='SUBJECTIVE_RECOVERY').length,0)
 assert.ok(review.audit.snapshot.active.some(r=>r.metric==='SORENESS'&&r.value===4));assert.equal(review.safety,'NONE')
})
test('vital comparisons require same explicit device, method and time; legacy missing metadata is never filled',()=>{
 setStoreBackend(memory())
 try{
  for(const [i,value] of [45,48].entries())assert.ok(saveVital({kind:'RHR',value,observedOn:`2026-03-0${i+1}`,observedAt:'07:00',source:'MANUAL',deviceLabel:'watch1',measurementMethod:'晨起静息'},`v${i}`,`2026-03-0${i+1}T09:00:00Z`).ok)
  const records=loadVitals().records
  assert.equal(vitalCoachSources(records,'2026-03-04T00:00:00Z').filter(s=>s.id.startsWith('linked:trend')).length,1)
  assert.equal(vitalCoachSources(records.map(r=>({...r,deviceLabel:undefined})),'2026-03-04T00:00:00Z').filter(s=>s.id.startsWith('linked:trend')).length,0)
  assert.equal(vitalCoachSources(records,'2026-02-01T00:00:00Z').length,0)
 }finally{setStoreBackend(null)}
})
test('device vault readings reach bounded context without original image or raw OCR and without guessed session binding',()=>{
 const r=makeDeviceRecord({draft:parseDeviceEvidence('静息心率 49bpm'),deviceLabel:'watch',recordedAt:'2026-03-01T07:00:00Z',confirmedAt:'2026-03-01T08:00:00Z',acknowledged:true,imageName:'private-image.jpg',imageSha256:'secret-image-hash',id:'device1'})
 const sources=deviceCoachSources([r],'2026-03-02T00:00:00Z')
 assert.equal(sources.length,1);assert.match(sources[0].detail,/49bpm/);assert.match(sources[0].detail,/课次未核实/);assert.doesNotMatch(JSON.stringify(sources),/private-image|secret-image/)
})
test('heart rate requires explicit value, method and matching segment; protocol text never supplies it',()=>{
 setStoreBackend(memory())
 try{
  const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:f('2026-03-01T10:00:00Z'),runningStructure:'REPEATED',runningSegments:[1,2].map(n=>({id:`hr${n}`,kind:'REPETITION',round:f(1),repeat:f(n),distanceMeters:f(400),durationSeconds:f(80),averageHeartRateBpm:f(150+n),...(n===1?{heartRateMethod:f('胸带 watch-A')}:{}),completion:'COMPLETED',sourceIds:['user-confirmed']}))},'TEXT',['user-confirmed'])
  const saved=confirmTrainingImport(draft);assert.ok(saved.ok)
  const asOf=new Date(Date.now()+1000).toISOString(),formal=readFormalEvidenceRows('local',asOf)
  assert.equal(formal.rows.filter(r=>r.metric==='HR_AVG_BPM').length,1)
  const d=normalizeAskCoachInput({brief:assembleCoachBrief(null,'心率和分段如何',saved.record.confirmedImportId),v4:{athleteId:'local',asOf,rows:formal.rows}})
  assert.equal(d.v4!.reasoning.computed.heartRates.length,1)
  assert.equal(d.v4!.reasoning.computed.heartRates[0].value,151)
  assert.match(buildCoachModelRequest(d).packet,/胸带 watch-A/)
  assert.equal(d.v4!.reasoning.computed.physiologicalCauseKnown,false)
 }finally{setStoreBackend(null)}
})
test('real running finish RPE_RECORDED and continuous execution reach formal rows',()=>{
 const args={athleteId:'a',asOf:'2026-03-03T00:00:00Z',committed:[ev('s','TRAINING_STARTED',{}),ev('finish-rpe','RPE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SESSION_RPE',value:8}),ev('continuous','RUNNING_CONTINUOUS_COMPLETED',{trainingOccurrenceId:'s',componentId:'warmup',actualDurationSeconds:600,actualDistanceMeters:1500})],corrections:[],running:{s:{availability:'AVAILABLE',repetitions:[],recoveries:[],continuous:[{componentId:'warmup',sourceEventIds:['continuous']}]} as any}}
 const rows=buildFormalEvidenceRows(args).rows
 assert.ok(rows.some(r=>r.metric==='SESSION_RPE'&&r.value===8&&r.sourceEventId==='finish-rpe'))
 assert.ok(rows.some(r=>r.metric==='SPLIT_SECONDS'&&r.value===600&&r.protocol==='running:warmup:continuous:1500m'))
})

test('24H and 48H recovery retain distinct endpoints and as-of visibility',()=>{
 const a=ev('24','RPE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SUBJECTIVE_RECOVERY',horizon:'24H',value:4})
 const b=ev('48','RPE_RECORDED',{trainingOccurrenceId:'s',evidenceType:'SUBJECTIVE_RECOVERY',horizon:'48H',value:7})
 b.recordedAt='2026-03-02T10:00:00Z'
 const args={athleteId:'a',asOf:'2026-03-03T00:00:00Z',committed:[ev('s','TRAINING_STARTED',{}),a,b],corrections:[]}
 const rows=buildFormalEvidenceRows(args).rows
 const review=reviewFormalEvidence({...args,question:'恢复变化',rows,scopeOccurrenceIds:['s']})
 assert.equal(review.audit.snapshot.active.filter(r=>r.metric==='SUBJECTIVE_RECOVERY').length,2)
 assert.deepEqual(rows.map(r=>r.protocol).sort(),['subjective_recovery:24H','subjective_recovery:48H'])
 assert.equal(buildFormalEvidenceRows({...args,asOf:'2026-03-01T12:00:00Z'}).rows.length,1)
})
