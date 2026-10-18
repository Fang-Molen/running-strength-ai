import test from 'node:test'
import assert from 'node:assert/strict'
import type {FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {reviewFormalEvidence} from './coach-v4-c11-adapter.ts'
import {replayFormalTimeline} from './coach-v4-c12-timeline.ts'
import {revisePriorClaims} from './coach-v4-c13-revision.ts'
import {guardV4Turn} from './coach-v4-c14-guard.ts'
import {runV4ShadowExam} from './coach-v4-c15-exam.ts'
const ts=(d:number,h=9)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`
const f=(id:string,metric:FormalEvidenceRow['metric'],value:number,day:number,extra:Partial<FormalEvidenceRow>={}):FormalEvidenceRow=>({
 recordId:id,athleteId:'synthetic-800',trainingOccurrenceId:'600m-session',sourceEventId:`evt:${id}`,source:'TRAINING_FACT',status:'OBSERVED',metric,value,
 unit:metric==='SPLIT_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',protocol:'600m×2; 8min rest; track',occurredAt:ts(day),knownAt:ts(day,10),verifiedByFormalProjection:true,...extra})
test('C11-C15 six-turn feedback replay: facts, counterhypotheses, revision, safety, no write',()=>{
 const rows:FormalEvidenceRow[]=[f('a','SPLIT_SECONDS',85,1),f('b','SPLIT_SECONDS',91,1)]
 const t1=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(1,11),question:'第二组变慢是否证明专项耐力不足？',rows}).audit.snapshot
 assert.equal(t1.hypotheses.length,4)
 rows.push(f('sleep','SLEEP_HOURS',5,2))
 const t2=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(2,11),question:'昨晚只睡5小时',rows,prior:t1}).audit.snapshot
 assert.ok(t2.hypotheses.find(x=>x.id==='RECOVERY')?.supports.includes('evt:sleep'))
 rows.push(f('b-fix','SPLIT_SECONDS',88,1,{knownAt:ts(3,10),supersedesRecordId:'b'}))
 const t3=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(3,11),question:'第二组成绩录错',rows,prior:t2}).audit.snapshot
 const revision=revisePriorClaims(t2,t3,[{claimId:'slow',sourceIds:['evt:b'],text:'91秒'}])
 assert.equal(revision[0].status,'RETRACT_AND_REASSESS')
 rows.push(f('again','SPLIT_SECONDS',90,4,{trainingOccurrenceId:'next-session'}))
 const t4=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(4,11),question:'又出现较慢的一组',rows,prior:t3}).audit.snapshot
 assert.equal(t4.causalEffectKnown,false)
 rows.push(f('pain','PAIN_SCORE',3,5))
 const t5=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(5,11),question:'跟腱疼痛，可以直接加高强度吗？',rows,prior:t4}).audit.snapshot
 assert.equal(t5.safety,'MEDICAL_REVIEW')
 const ask=guardV4Turn(t5,'跟腱疼痛',{mode:'ask',text:'不需要运动医学评估。',citations:['evt:pain'],nextStep:null,medicalReferral:false})
 assert.equal(ask.status,'SAFE_FALLBACK_REQUIRES_REVIEW')
 assert.match(ask.text,/运动医学/)
 rows.push(f('future','SPLIT_SECONDS',75,7,{trainingOccurrenceId:'third-session'}))
 const t6=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(6,11),question:'过去几周是否确定变强？',rows,prior:t5}).audit.snapshot
 assert.equal(t6.active.some(x=>x.id==='future'),false)
 const history=replayFormalTimeline({athleteId:'synthetic-800',question:'回顾',rows,checkpoints:[ts(1,11),ts(3,11),ts(5,11),ts(6,11)]})
 assert.ok(history[0].visibleFactCount<history[3].visibleFactCount)
 const exam=runV4ShadowExam({athleteId:'synthetic-800',rows,turns:[{asOf:ts(1,11),question:'掉速'},{asOf:ts(3,11),question:'更正'},{asOf:ts(6,11),question:'回顾'}]})
 assert.equal(exam.modelAssessment,'NOT_RUN')
 assert.ok([t1,t2,t3,t4,t5,t6].every(s=>!s.trainingDecisionAuthorized&&!s.savedToTrainingPlan))
})
test('C11 device cannot confirm pain and still preserves visible risk hint',()=>{
 const rows=[f('device-pain','PAIN_SCORE',4,1,{source:'DEVICE'})]
 const r=reviewFormalEvidence({athleteId:'synthetic-800',asOf:ts(2,11),question:'运动恢复',rows})
 assert.equal(r.audit.snapshot.active.length,0)
 assert.ok(r.adapter.excluded.some(x=>x.reason==='DEVICE_CANNOT_ASSESS_SYMPTOM'))
 assert.equal(r.safety,'MEDICAL_REVIEW')
})
