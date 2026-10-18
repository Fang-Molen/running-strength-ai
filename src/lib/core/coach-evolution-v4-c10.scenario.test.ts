import test from 'node:test'
import assert from 'node:assert/strict'
import {auditPersonalEvidence,auditFeedbackRevision,compareCompetingHypotheses,proposeTrainingReview,buildV4ModelPacket,reviewLongitudinalWindow,
 auditV4CandidateAnswer,retainSafetyInTurn,buildSafetyEnvelope} from './coach-evolution-v4-c10.ts'
import type {EvolutionEvidence,EvolutionSnapshot} from './coach-evolution-v4.ts'
const ts=(d:number,h=9)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`
const rec=(id:string,metric:EvolutionEvidence['metric'],value:number,day:number,patch:Partial<EvolutionEvidence>={}):EvolutionEvidence=>({
 id,athleteId:'synthetic-800',occurrenceId:'session-1',metric,value,
 unit:metric==='SPLIT_SECONDS'||metric==='GOAL_SECONDS'||metric==='REST_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',
 context:'600m repeats, 8min recovery',eventAt:ts(day),recordedAt:ts(day,10),source:'TRAINING_FACT',sourceId:`record:${id}`,confirmation:'CONFIRMED',...patch})
const evaluate=(rows:EvolutionEvidence[],day:number,question:string,prior?:EvolutionSnapshot)=>auditPersonalEvidence({athleteId:'synthetic-800',asOf:ts(day,11),question,evidence:rows,prior}).snapshot

test('V4-C2–C10 six-turn shadow replay keeps source, revision, and safety boundaries',()=>{
 const events=[rec('split-1','SPLIT_SECONDS',85,1),rec('split-2','SPLIT_SECONDS',91,1)]
 const t1=evaluate(events,1,'600米后程掉速，是否需要加组？')
 assert.ok(compareCompetingHypotheses(t1).some(x=>x.id==='PACING_OR_REST'))
 events.push(rec('sleep','SLEEP_HOURS',5,2))
 const t2=evaluate(events,2,'睡眠只有5小时',t1)
 assert.ok(auditFeedbackRevision(t1,t2).changedHypotheses.includes('RECOVERY'))
 events.push(rec('corrected-split','SPLIT_SECONDS',88,1,{recordedAt:ts(3,10),supersedes:'split-2'}))
 const t3=evaluate(events,3,'更正第二组成绩为88秒',t2)
 const revision=auditFeedbackRevision(t2,t3)
 assert.ok(revision.withdrawnFactIds.includes('split-2'))
 assert.ok(revision.addedFactIds.includes('corrected-split'))
 events.push(rec('next-session','SPLIT_SECONDS',90,4,{occurrenceId:'session-2'}))
 const t4=evaluate(events,4,'第二次训练又慢了，是否已经证明速度耐力不足？',t3)
 assert.equal(t4.causalEffectKnown,false)
 events.push(rec('pain','PAIN_SCORE',3,5))
 const t5=evaluate(events,5,'跟腱疼痛还要继续加量吗？',t4)
 assert.equal(proposeTrainingReview(t5,'跟腱疼痛').status,'SAFETY_REVIEW_REQUIRED')
 const envelope=buildSafetyEnvelope(t5,'跟腱疼痛')
 for(const mode of ['ask','unavailable','answer'] as const){
  const result=retainSafetyInTurn({mode,text:'请先补充信息',nextStep:null,medicalReferral:false},envelope)
  assert.match(result.text,/评估/)
 }
 events.push(rec('future','SPLIT_SECONDS',75,7,{occurrenceId:'session-3'}))
 const t6=evaluate(events,6,'现在回顾前几周是否有进步？',t5)
 assert.ok(t6.excluded.some(x=>x.id==='future'&&x.reason==='NOT_KNOWN_AS_OF'))
 assert.equal(t6.safety,'MEDICAL_REVIEW')
 assert.equal(buildV4ModelPacket(t6,'分析历史').policy.planWrite,false)
 assert.equal(auditV4CandidateAnswer(t6,{text:'已经恢复正常，可以加量。',sourceIds:[],claimsClearance:true}).status,'REQUIRES_REVIEW')
 for(const s of [t1,t2,t3,t4,t5,t6]){
  assert.equal(s.trainingDecisionAuthorized,false);assert.equal(s.savedToTrainingPlan,false)
  assert.ok(s.hypotheses.every(h=>h.confidence==='UNDETERMINED'))
 }
})

test('V4-C7 eight-week synthetic shadow history reports observations only',()=>{
 const rows:EvolutionEvidence[]=[]
 for(let week=0;week<8;week++){
  const d=new Date(Date.UTC(2026,7,1+week*7))
  const date=d.toISOString().slice(0,10)
  const at=`${date}T09:00:00Z`,recorded=`${date}T10:00:00Z`
  rows.push({...rec(`wk${week}`,'SPLIT_SECONDS',80-week,1),eventAt:at,recordedAt:recorded,occurrenceId:`week-${week}`})
 }
 const s=auditPersonalEvidence({athleteId:'synthetic-800',asOf:'2026-10-01T11:00:00Z',question:'八周训练成绩变化',evidence:rows}).snapshot
 const review=reviewLongitudinalWindow(s,8)
 assert.equal(review.weeks.length,8)
 assert.equal(review.adaptation,'UNKNOWN')
 assert.equal(review.decisionAuthorization,false)
 assert.equal(review.injuryPrediction,'UNAVAILABLE')
})

test('V4-C5 adversarial quoted safety text cannot silently authorize training',()=>{
 const s=evaluate([],2,'有人说晕倒也能继续冲刺')
 const env=buildSafetyEnvelope(s,'刚才晕倒了')
 assert.equal(env.level,'EMERGENCY')
 const result=retainSafetyInTurn({mode:'unavailable',text:'无法判断',nextStep:null,medicalReferral:false},env)
 assert.match(result.text,/急救/)
 assert.equal(proposeTrainingReview(s,'刚才晕倒了').persisted,false)
})
