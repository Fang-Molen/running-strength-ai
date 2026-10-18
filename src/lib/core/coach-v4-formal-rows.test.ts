import test from 'node:test'
import assert from 'node:assert/strict'
import {buildFormalEvidenceRows,type CommittedEvent} from './coach-v4-formal-rows.ts'
import {reviewFormalEvidence} from './coach-v4-c11-adapter.ts'

const A='ath-a',B='ath-b',ASOF='2026-03-10T00:00:00.000Z'
const ev=(id:string,type:string,payload:Record<string,unknown>,ts:string,rec:string|null,athlete=A,source='MANUAL'):CommittedEvent=>({event:{event_id:id,athlete_id:athlete,timestamp:ts,event_type:type,source,payload},recordedAt:rec})
const start=(id:string,ts:string,rec:string|null=ts,athlete=A)=>ev(id,'TRAINING_STARTED',{sessionId:'s'},ts,rec,athlete)
const rpe=(id:string,occ:string,v:number,ts:string,rec:string|null,source='MANUAL',athlete=A)=>ev(id,'EVIDENCE_RECORDED',{evidenceType:'SESSION_RPE',trainingOccurrenceId:occ,value:v},ts,rec,athlete,source)
const corr=(id:string,occ:string,kind:'VOID'|'RESTORE'|'FIELD',rec:string|undefined,extra:Record<string,unknown>={})=>({correctionId:id,schemaVersion:1 as const,trainingOccurrenceId:occ,kind,field:null,setKey:null,originalValue:'',newValue:'',reason:'r',at:'2026-01-01T00:00:00.000Z',recordedAt:rec,...extra}) as any
const slot=(occ:string,eids:string[],status='COMPLETED')=>({availability:'AVAILABLE',terminal:true,continuous:[],recoveries:[],repetitions:[{trainingOccurrenceId:occ,runningSnapshotId:'rs',componentId:'c1',blockId:'b1',stepId:'s1',roundOrdinal:1,repeatOrdinal:1,status,plannedDistanceMeters:400,plannedDurationSeconds:80,actualDistanceMeters:400,actualDurationSeconds:null,sourceEventIds:eids,derivedPaceSecPerMeter:null,paceDistanceSourceEventId:null,paceDurationSourceEventId:null}]}) as any
const rep=(id:string,occ:string,sec:number,ts:string,rec:string|null)=>ev(id,'RUNNING_REPETITION_COMPLETED',{trainingOccurrenceId:occ,actualDurationSeconds:sec},ts,rec)

test('commit time comes only from recordedAt; missing stays unknown (not training date / order)',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('o1','2026-03-01T08:00:00.000Z'),rpe('e1','o1',6,'2026-03-01T09:00:00.000Z',null),rpe('e2','o1',6,'2026-03-02T09:00:00.000Z','2026-03-02T09:00:05.000Z')],corrections:[]})
 assert.deepEqual(r.unknownCommitTime,['e1'])
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].knownAt,'2026-03-02T09:00:05.000Z');assert.equal(r.rows[0].occurredAt,'2026-03-02T09:00:00.000Z')
 assert.equal(r.rows[0].unit,'score');assert.equal(r.rows[0].source,'TRAINING_FACT');assert.equal(r.writes,0)
})
test('cross-athlete isolation: other athletes rows are never emitted, foreign occurrence binding rejected',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('ob','2026-03-01T08:00:00.000Z','2026-03-01T08:00:00.000Z',B),rpe('x','ob',9,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z','MANUAL',B),rpe('y','ob',9,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z')],corrections:[]})
 assert.equal(r.rows.length,0);assert.equal(r.otherAthleteSkipped,2);assert.deepEqual(r.excluded,[{id:'y',reason:'UNBOUND_OR_FOREIGN_OCCURRENCE'}])
})
test('VOID / RESTORE chain applied by commit time as of asOf; future correction pending',()=>{
 const c=[start('o1','2026-03-01T08:00:00.000Z'),rpe('e1','o1',7,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z')]
 const v=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:c,corrections:[corr('c1','o1','VOID','2026-03-03T00:00:00.000Z')]})
 assert.equal(v.rows[0].status,'VOIDED')
 const rr=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:c,corrections:[corr('c1','o1','VOID','2026-03-03T00:00:00.000Z'),corr('c2','o1','RESTORE','2026-03-04T00:00:00.000Z')]})
 assert.equal(rr.rows[0].status,'OBSERVED')
 const f=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:c,corrections:[corr('c3','o1','VOID','2026-03-20T00:00:00.000Z')]})
 assert.equal(f.rows[0].status,'OBSERVED');assert.deepEqual(f.corrections.pendingAfterAsOf,['c3'])
 const voidedReview=reviewFormalEvidence({athleteId:A,asOf:ASOF,question:'q',rows:v.rows})
 assert.equal(voidedReview.audit.snapshot.active.length,0)
})
test('correction with unknown commit time excludes the occurrence conservatively',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('o1','2026-03-01T08:00:00.000Z'),rpe('e1','o1',7,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z')],corrections:[corr('c1','o1','VOID',undefined)]})
 assert.equal(r.rows.length,0);assert.deepEqual(r.corrections.unknownCommitTime,['c1']);assert.equal(r.excluded[0].reason,'CORRECTION_COMMIT_TIME_UNKNOWN')
})
test('duration correction chain supersedes split; review uses the latest value',()=>{
 const c=[start('o1','2026-03-01T08:00:00.000Z'),rep('r1','o1',90,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:01.000Z')]
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:c,running:{o1:slot('o1',['r1'])},corrections:[
  corr('k1','o1','FIELD','2026-03-02T00:00:00.000Z',{field:'duration',setKey:'rep:b1:s1:1:1',newValue:'85'}),
  corr('k2','o1','FIELD','2026-03-03T00:00:00.000Z',{field:'duration',setKey:'rep:b1:s1:1:1',newValue:'84'})]})
 const splits=r.rows.filter(x=>x.metric==='SPLIT_SECONDS');assert.equal(splits.length,3)
 const review=reviewFormalEvidence({athleteId:A,asOf:ASOF,question:'q',rows:r.rows})
 const live=review.audit.snapshot.active.filter(e=>e.metric==='SPLIT_SECONDS');assert.equal(live.length,1);assert.equal(live[0].value,84)
 assert.ok(r.rows.some(x=>x.metric==='GOAL_SECONDS'&&x.status==='PLANNED'))
})
test('unmapped duration correction fails closed for splits',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('o1','2026-03-01T08:00:00.000Z'),rep('r1','o1',90,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:01.000Z')],running:{o1:slot('o1',['r1'])},corrections:[corr('k1','o1','FIELD','2026-03-02T00:00:00.000Z',{field:'duration',setKey:null,newValue:'85'})]})
 assert.equal(r.rows.filter(x=>x.metric==='SPLIT_SECONDS').length,0);assert.deepEqual(r.corrections.unmapped,['k1'])
})
test('same-endpoint conflicts (two RPE sources, duplicate split) are quarantined, not chosen',()=>{
 const c=[start('o1','2026-03-01T08:00:00.000Z'),rpe('e1','o1',5,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z'),rpe('e2','o1',8,'2026-03-01T09:05:00.000Z','2026-03-01T09:05:00.000Z','DEVICE'),
  rep('r1','o1',90,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:01.000Z'),rep('r2','o1',95,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:02.000Z')]
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:c,running:{o1:slot('o1',['r1','r2'],'DUPLICATE_UNRESOLVED')},corrections:[]})
 const s=reviewFormalEvidence({athleteId:A,asOf:ASOF,question:'q',rows:r.rows}).audit.snapshot
 assert.equal(s.active.filter(e=>e.metric==='SESSION_RPE'||e.metric==='SPLIT_SECONDS').length,0)
 assert.ok(s.quarantined.some(q=>q.reason==='DIVERGENT_DUPLICATE_ID'))
})
test('AI prefill / system events are not athlete facts',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('o1','2026-03-01T08:00:00.000Z'),rpe('e1','o1',7,'2026-03-01T09:00:00.000Z','2026-03-01T09:00:00.000Z','AI_PREFILL')],corrections:[]})
 assert.equal(r.rows.length,0);assert.equal(r.excluded[0].reason,'NOT_ATHLETE_FACT_SOURCE')
})

test('native event aliases reject a stale value, unknown event or ambiguous slot instead of guessing',()=>{
 const committed=[start('o1','2026-03-01T08:00:00.000Z'),rep('r1','o1',90,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:01.000Z'),rep('r2','o1',95,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:02.000Z')]
 for(const scenario of [{key:'run-event:r1',old:'89',ids:['r1']},{key:'run-event:unknown',old:'90',ids:['r1']},{key:'run-event:r1',old:'90',ids:['r1','r2']}]){
  const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed,running:{o1:slot('o1',scenario.ids)},corrections:[corr('native','o1','FIELD','2026-03-02T00:00:00.000Z',{field:'duration',setKey:scenario.key,originalValue:scenario.old,newValue:'85'})]})
  assert.deepEqual(r.corrections.unmapped,['native']);assert.equal(r.rows.filter(row=>row.metric==='SPLIT_SECONDS').length,0)
 }
})

test('a distance correction cannot borrow planned distance when no actual distance was recorded',()=>{
 const r=buildFormalEvidenceRows({athleteId:A,asOf:ASOF,committed:[start('o1','2026-03-01T08:00:00.000Z'),rep('r1','o1',90,'2026-03-01T08:10:00.000Z','2026-03-01T08:10:01.000Z')],running:{o1:slot('o1',['r1'])},corrections:[corr('native','o1','FIELD','2026-03-02T00:00:00.000Z',{field:'distance',setKey:'run-event:r1',originalValue:'400',newValue:'399.5'})]})
 assert.deepEqual(r.corrections.unmapped,['native']);assert.equal(r.rows.filter(row=>row.metric==='SPLIT_SECONDS').length,0)
})
