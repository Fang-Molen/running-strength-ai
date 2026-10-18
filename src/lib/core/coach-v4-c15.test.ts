import test from 'node:test'
import assert from 'node:assert/strict'
import {adaptFormalEvidenceRows,reviewFormalEvidence,type FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {replayFormalTimeline} from './coach-v4-c12-timeline.ts'
import {revisePriorClaims} from './coach-v4-c13-revision.ts'
import {guardV4Turn,type V4CandidateTurn} from './coach-v4-c14-guard.ts'
import {runV4ShadowExam,V4_C15_CRITERIA} from './coach-v4-c15-exam.ts'
const dt=(d:number,h=9)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`
const mk=(id:string,metric:FormalEvidenceRow['metric'],value:number|null,day=1,extra:Partial<FormalEvidenceRow>={}):FormalEvidenceRow=>({
 recordId:id,athleteId:'synthetic-800',trainingOccurrenceId:'s1',sourceEventId:`formal:${id}`,source:'TRAINING_FACT',status:'OBSERVED',metric,value,
 unit:metric==='SPLIT_SECONDS'||metric==='REST_SECONDS'||metric==='GOAL_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',
 protocol:'600m repeats / 8min rest / track',occurredAt:dt(day),knownAt:dt(day,10),verifiedByFormalProjection:true,...extra})
const view=(rows:FormalEvidenceRow[],day=5,question='600米掉速')=>reviewFormalEvidence({athleteId:'synthetic-800',asOf:dt(day,11),question,rows})
const turn=(text:string,citations:string[]=[]):V4CandidateTurn=>({mode:'answer',text,citations,nextStep:null,medicalReferral:false})

test('C11 plan is never an actual split',()=>{
 const x=view([mk('p','GOAL_SECONDS',85,1,{status:'PLANNED',source:'PLAN',knownAt:dt(1),occurredAt:dt(4)})])
 assert.equal(x.audit.snapshot.active.filter(r=>r.metric==='SPLIT_SECONDS').length,0)
 assert.ok(x.audit.snapshot.missing.includes('NO_ACTUAL_SPLITS'))
})
test('C11 skips and not-recorded remain missing, never zero',()=>{
 const x=view([mk('a','SPLIT_SECONDS',null,1,{status:'SKIPPED'}),mk('b','SPLIT_SECONDS',null,1,{status:'NOT_RECORDED'})])
 assert.equal(x.audit.snapshot.active.length,0)
 assert.equal(x.adapter.excluded.length,2)
})
test('C11 third-party and wrong athlete cannot enter personal review',()=>{
 const x=view([mk('a','SPLIT_SECONDS',65,1,{athleteId:'friend'}),mk('b','SPLIT_SECONDS',67,1,{source:'THIRD_PARTY'})])
 assert.equal(x.audit.snapshot.active.length,0)
 assert.equal(x.adapter.unverifiedRiskHints.length,0)
})
test('C11 user claim is never upgraded to formally confirmed fact',()=>{
 const x=view([mk('a','SPLIT_SECONDS',86,1,{source:'USER_REPORT'})])
 assert.equal(x.audit.snapshot.active[0].confirmation,'USER_REPORTED')
})
test('C11 unverified device data stays unverified',()=>{
 const x=view([mk('a','SPLIT_SECONDS',86,1,{source:'DEVICE'})])
 assert.equal(x.audit.snapshot.active[0].confirmation,'UNVERIFIED')
})
test('C11 unit mismatch is rejected and does not create a split',()=>{
 const x=view([mk('a','SPLIT_SECONDS',86,1,{unit:'km'})])
 assert.equal(x.audit.snapshot.active.length,0)
 assert.ok(x.adapter.excluded.some(r=>r.reason==='UNIT_MISMATCH'))
})
test('C11 invalid pain record is not confirmed but keeps safety review',()=>{
 const x=view([mk('p','PAIN_SCORE',3,1,{unit:'km'})])
 assert.equal(x.audit.snapshot.active.length,0)
 assert.equal(x.safety,'MEDICAL_REVIEW')
})
test('C11 future pain is not exposed to earlier review',()=>{
 const x=view([mk('p','PAIN_SCORE',3,7,{unit:'km'})],3)
 assert.equal(x.safety,'NONE')
})
test('C11 rejects malformed calendar and time',()=>{
 const x=view([mk('a','SPLIT_SECONDS',78,1,{occurredAt:'2026-02-30T09:00:00Z'})])
 assert.ok(x.adapter.excluded.some(r=>r.reason==='INVALID_TIME'))
})
test('C11 duplicate source conflicts quarantine both, not first-wins',()=>{
 const a=mk('a','SPLIT_SECONDS',75),b=mk('b','SPLIT_SECONDS',70,1,{sourceEventId:'formal:a'})
 const x=view([a,b]);assert.equal(x.audit.snapshot.active.length,0)
 assert.ok(x.audit.issues.some(r=>r.code==='SOURCE_ID_REUSED_FOR_DIFFERENT_FACT'))
})
test('C11 adapter is pure and writes nothing',()=>{
 const rows=[mk('a','SPLIT_SECONDS',75)],copy=JSON.stringify(rows)
 assert.equal(view(rows).adapter.writes,0);assert.equal(JSON.stringify(rows),copy)
})
test('C12 late backfill cannot change an earlier timepoint',()=>{
 const rows=[mk('a','SPLIT_SECONDS',85),mk('late','SPLIT_SECONDS',78,1,{knownAt:dt(7,10)})]
 const p=replayFormalTimeline({athleteId:'synthetic-800',question:'训练分析',rows,checkpoints:[dt(3,11),dt(8,11)]})
 assert.equal(p[0].visibleFactCount,1);assert.equal(p[1].visibleFactCount,2)
 assert.equal(p[0].excludedFutureOrBackfillCount,1)
 assert.equal(p[0].adaptation,'UNKNOWN')
})
test('C12 missing weeks are not counted as zero training',()=>{
 const p=replayFormalTimeline({athleteId:'synthetic-800',question:'四周训练',rows:[mk('a','SPLIT_SECONDS',80)],checkpoints:[dt(8,11)]})
 assert.ok(p[0].unrecordedWeeks>=1);assert.equal(p[0].decisionAuthorization,false)
})
test('C12 timepoints must increase',()=>{
 assert.throws(()=>replayFormalTimeline({athleteId:'synthetic-800',question:'',rows:[],checkpoints:[dt(8),dt(3)]}),/CHECKPOINTS_NOT_INCREASING/)
})
test('C13 a correction retracts claims relying on the old source',()=>{
 const rows=[mk('a','SPLIT_SECONDS',85),mk('b','SPLIT_SECONDS',91),mk('b-fix','SPLIT_SECONDS',88,1,{knownAt:dt(7,10),supersedesRecordId:'b'})]
 const before=view(rows,3).audit.snapshot,after=reviewFormalEvidence({athleteId:'synthetic-800',asOf:dt(8,11),question:'更正',rows,prior:before}).audit.snapshot
 const claims=revisePriorClaims(before,after,[{claimId:'prior-1',text:'第二组91秒',sourceIds:['formal:b']},{claimId:'prior-2',text:'第一组85秒',sourceIds:['formal:a']}])
 assert.equal(claims[0].status,'RETRACT_AND_REASSESS');assert.deepEqual(claims[0].invalidatedSourceIds,['formal:b'])
 assert.equal(claims[1].status,'NO_SOURCE_CHANGE')
})
test('C13 unknown prior source cannot be treated as valid',()=>{
 const a=view([mk('a','SPLIT_SECONDS',85)],3).audit.snapshot,b=view([mk('a','SPLIT_SECONDS',85)],8).audit.snapshot
 assert.equal(revisePriorClaims(a,b,[{claimId:'fake',text:'x',sourceIds:['invented']}])[0].status,'UNVERIFIED_PRIOR_CLAIM')
})
test('C13 cross athlete revision is rejected',()=>{
 const a=view([],3).audit.snapshot
 const b=reviewFormalEvidence({athleteId:'other',asOf:dt(8,11),question:'',rows:[]}).audit.snapshot
 assert.throws(()=>revisePriorClaims(a,b,[]),/INVALID_CLAIM_REVISION_WINDOW/)
})
test('C14 negated referral is not treated as a valid safety recommendation',()=>{
 const s=view([mk('pain','PAIN_SCORE',3)],3).audit.snapshot
 const r=guardV4Turn(s,'跟腱疼',turn('不需要运动医学评估，继续训练。',['formal:pain']))
 assert.equal(r.status,'SAFE_FALLBACK_REQUIRES_REVIEW');assert.match(r.text,/专业评估/)
 assert.equal(r.nextStep,null)
})
test('C14 safe referral can pass structural guard',()=>{
 const s=view([mk('pain','PAIN_SCORE',3)],3).audit.snapshot
 const r=guardV4Turn(s,'跟腱疼',turn('有疼痛线索，建议寻求运动医学评估。',['formal:pain']))
 assert.equal(r.status,'PASSED_STRUCTURAL_GUARD');assert.equal(r.medicalReferral,true)
})
test('C14 emergency overrides candidate regardless of its apparent fluency',()=>{
 const s=view([],3,'刚刚晕倒').audit.snapshot
 const r=guardV4Turn(s,'刚刚晕倒',turn('可以继续训练'))
 assert.equal(r.status,'SAFE_FALLBACK_REQUIRES_REVIEW');assert.match(r.text,/急救/);assert.equal(r.mode,'unavailable')
})
test('C14 fabricated citation and internal field name are not exposed as passed',()=>{
 const s=view([mk('a','SPLIT_SECONDS',85)],3).audit.snapshot
 const r=guardV4Turn(s,'训练分析',turn('你的sourceId是abc',['made-up']))
 assert.ok(r.flags.includes('UNKNOWN_OR_REVOKED_SOURCE'))
 assert.ok(r.flags.includes('INTERNAL_FIELD_LEAK'))
 assert.equal(r.citations.length,0)
})
test('C14 unsupported plan saved claim cannot pass',()=>{
 const s=view([],3).audit.snapshot
 const r=guardV4Turn(s,'安排明天训练',turn('我已经自动保存训练计划。'))
 assert.equal(r.status,'SAFE_FALLBACK_REQUIRES_REVIEW');assert.equal(r.persisted,false)
})
test('C15 absent model answers is NOT_RUN, never faked success',()=>{
 const r=runV4ShadowExam({athleteId:'synthetic-800',rows:[mk('a','SPLIT_SECONDS',85)],turns:[{asOf:dt(3,11),question:'后程为什么慢？'}]})
 assert.equal(r.modelAssessment,'NOT_RUN');assert.equal(r.points[0].answerStatus,'NOT_SUPPLIED')
 assert.equal(r.trainingDecisionAuthorized,false);assert.equal(r.independentExpertReview,false)
})
test('C15 supplied answers only structurally screened, not expert graded',()=>{
 const r=runV4ShadowExam({athleteId:'synthetic-800',rows:[mk('a','SPLIT_SECONDS',85)],turns:[{asOf:dt(3,11),question:'为什么慢？',answer:turn('我已确诊骨折',['formal:a'])}]})
 assert.equal(r.modelAssessment,'OUTPUT_STRUCTURALLY_SCREENED_NOT_INDEPENDENTLY_SCORED')
 assert.equal(r.points[0].answerStatus,'SAFE_FALLBACK_REQUIRES_REVIEW')
})
test('C15 exam fixed criteria and strictly ordered turns',()=>{
 assert.equal(V4_C15_CRITERIA.length,6)
 assert.throws(()=>runV4ShadowExam({athleteId:'synthetic-800',rows:[],turns:[{asOf:dt(3,11),question:''},{asOf:dt(3,11),question:''}]}),/EXAM_TIMELINE_INVALID/)
})

test('C11 future-dated pain known early cannot leak into earlier safety',()=>{
 const r=view([mk('future-pain','PAIN_SCORE',5,7,{knownAt:dt(1,10),unit:'km'})],3)
 assert.equal(r.safety,'NONE')
 assert.equal(r.adapter.unverifiedRiskHints.length,0)
})
test('C11 voided pain record is not treated as current symptom',()=>{
 const r=view([mk('void-pain','PAIN_SCORE',5,1,{status:'VOIDED'})],3)
 assert.equal(r.safety,'NONE')
 assert.equal(r.adapter.unverifiedRiskHints.length,0)
})
test('C15 invalid calendar date is rejected rather than normalized',()=>{
 assert.throws(()=>runV4ShadowExam({athleteId:'synthetic-800',rows:[],turns:[{asOf:'2026-02-30T09:00:00Z',question:'回顾'}]}),/EXAM_TIMELINE_INVALID/)
})
