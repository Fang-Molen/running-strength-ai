import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateCoachEvolution,type EvolutionEvidence} from './coach-evolution-v4.ts'
import {preserveReferral} from './coach-referral-safety.ts'
const day=(n:number)=>`2026-10-${String(n).padStart(2,'0')}T09:00:00Z`
const known=(n:number)=>`2026-10-${String(n).padStart(2,'0')}T10:00:00Z`
const e=(id:string,metric:EvolutionEvidence['metric'],value:number|null,opts:Partial<EvolutionEvidence>={}):EvolutionEvidence=>({
 id,athleteId:'athlete-A',occurrenceId:'session-1',metric,value,unit:metric==='SPLIT_SECONDS'||metric==='REST_SECONDS'||metric==='GOAL_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',
 context:'400m reps 3min rest / track',eventAt:day(1),recordedAt:known(1),source:'TRAINING_FACT',sourceId:`fact:${id}`,confirmation:'CONFIRMED',...opts})
const review=(items:readonly EvolutionEvidence[],asOf=known(3),prior?:ReturnType<typeof evaluateCoachEvolution>,question='400米后程掉速怎么理解？')=>evaluateCoachEvolution({athleteId:'athlete-A',asOf,question,evidence:items,prior})
test('plan and goal never turn into completed splits',()=>{
 const x=review([e('target','GOAL_SECONDS',72,{source:'PLAN',recordedAt:day(1)})]);assert.equal(x.active.filter(y=>y.metric==='SPLIT_SECONDS').length,0);assert.ok(x.missing.includes('NO_ACTUAL_SPLITS'));assert.equal(x.trainingDecisionAuthorized,false)
})
test('later records are invisible at prior evaluation date',()=>{
 const rows=[e('a','SPLIT_SECONDS',72),e('b','SPLIT_SECONDS',79,{eventAt:day(5),recordedAt:known(5)})]
 const x=review(rows,known(3));assert.deepEqual(x.active.map(y=>y.id),['a']);assert.ok(x.excluded.some(y=>y.id==='b'&&y.reason==='NOT_KNOWN_AS_OF'))
})
test('backfilled historical record cannot leak into earlier as-of review',()=>{
 const rows=[e('a','SPLIT_SECONDS',72),e('late','SPLIT_SECONDS',79,{eventAt:day(1),recordedAt:known(5)})]
 assert.deepEqual(review(rows,known(3)).active.map(y=>y.id),['a'])
})
test('correction replaces old evidence only when correction becomes visible',()=>{
 const rows=[e('a','SPLIT_SECONDS',72),e('b','SPLIT_SECONDS',79),e('b-corrected','SPLIT_SECONDS',73,{recordedAt:known(5),supersedes:'b'})]
 const before=review(rows,known(3)),after=review(rows,known(6),before)
 assert.deepEqual(before.active.map(y=>y.id),['a','b']);assert.deepEqual(after.active.map(y=>y.id),['a','b-corrected'])
 assert.ok(after.revision.some(y=>y.includes('撤回或失效先前事实 b')));assert.equal(after.causalEffectKnown,false)
})
test('conflicting same id and forked corrections are quarantined',()=>{
 const duplicate=review([e('a','SPLIT_SECONDS',72),e('a','SPLIT_SECONDS',82)])
 assert.equal(duplicate.active.length,0);assert.ok(duplicate.quarantined.some(x=>x.reason==='DIVERGENT_DUPLICATE_ID'))
 const fork=review([e('a','SPLIT_SECONDS',72),e('c1','SPLIT_SECONDS',74,{supersedes:'a'}),e('c2','SPLIT_SECONDS',73,{supersedes:'a'})])
 assert.equal(fork.active.length,0);assert.ok(fork.quarantined.some(x=>x.reason==='FORKED_CORRECTION'))
})
test('unrelated athlete and third-party records never enter personal analysis',()=>{
 const x=review([e('a','SPLIT_SECONDS',72),e('foreign','SPLIT_SECONDS',60,{athleteId:'athlete-B'}),e('friend','SPLIT_SECONDS',62,{source:'THIRD_PARTY'})])
 assert.deepEqual(x.active.map(y=>y.id),['a']);assert.equal(x.excluded.length,2)
})
test('a missing correction target does not silently delete valid records',()=>{
 const x=review([e('a','SPLIT_SECONDS',72),e('bad','SPLIT_SECONDS',60,{supersedes:'unknown'})]);assert.deepEqual(x.active.map(y=>y.id),['a']);assert.ok(x.quarantined.some(y=>y.id==='bad'))
})
test('slowdown creates multiple competing explanations, not diagnosis',()=>{
 const x=review([e('a','SPLIT_SECONDS',72),e('b','SPLIT_SECONDS',78),e('sleep','SLEEP_HOURS',5),e('rpe','SESSION_RPE',9)])
 assert.equal(x.hypotheses.length,4);assert.deepEqual(x.hypotheses.find(h=>h.id==='RECOVERY')?.supports,['fact:sleep','fact:rpe']);assert.equal(x.hypotheses.find(h=>h.id==='TRAINING_SPECIFICITY')?.supports.length,0)
 assert.ok(x.hypotheses.every(h=>h.confidence==='UNDETERMINED'&&h.discriminatingQuestion.length>5))
})
test('adequate sleep challenges sleep-only explanation without ruling out fatigue',()=>{
 const x=review([e('sleep','SLEEP_HOURS',8)])
 assert.ok(x.hypotheses.find(h=>h.id==='RECOVERY')?.challenges.some(v=>v.startsWith('SLEEP_NOT_SHORT')))
 assert.equal(x.causalEffectKnown,false)
})
test('pain overrides better splits and retains professional review',()=>{
 const x=review([e('a','SPLIT_SECONDS',78),e('b','SPLIT_SECONDS',75),e('pain','PAIN_SCORE',3)])
 assert.equal(x.safety,'MEDICAL_REVIEW');assert.equal(x.nextAction,'MEDICAL_REVIEW');assert.match(x.safetyMessage!,/运动医学/);assert.equal(x.savedToTrainingPlan,false)
})
test('unselected training still detects emergency from conversation',()=>{
 const x=review([],known(3),undefined,'我刚刚跑完晕倒了，还想继续练')
 assert.equal(x.safety,'EMERGENCY');assert.equal(x.nextAction,'EMERGENCY_SUPPORT');assert.match(x.safetyMessage!,/急救/)
})
test('new evidence updates reasoning without inventing stable adaptation',()=>{
 const before=review([e('a','SPLIT_SECONDS',72),e('b','SPLIT_SECONDS',78)],known(3))
 const after=review([e('a','SPLIT_SECONDS',72),e('b','SPLIT_SECONDS',78),e('sleep','SLEEP_HOURS',5,{recordedAt:known(4)})],known(5),before)
 assert.ok(after.revision.some(x=>x.includes('RECOVERY')));assert.equal(after.trainingDecisionAuthorized,false)
})
test('invalid dates and impossible values are not silently treated as zero',()=>{
 const x=review([e('bad','SPLIT_SECONDS',-4),e('date','SPLIT_SECONDS',75,{eventAt:'2026-02-30T09:00:00Z'}),e('missing','SPLIT_SECONDS',null)])
 assert.equal(x.active.filter(y=>y.value!==null).length,0);assert.ok(x.excluded.some(y=>y.id==='bad'))
})
test('pure evaluator does not mutate inputs or write plan',()=>{
 const input=[e('a','SPLIT_SECONDS',72)],original=JSON.stringify(input)
 const x=review(input);assert.equal(JSON.stringify(input),original);assert.equal(x.proposedOnly,true);assert.equal(x.confirmedByUser,false);assert.equal(x.savedToTrainingPlan,false)
})
test('safety referral persists in ask and unavailable routes',()=>{
 for(const mode of ['ask','unavailable','answer']){
  const x=preserveReferral({mode,text:'请先核对原始记录。',nextStep:null,medicalReferral:false},true)
  assert.match(x.text,/运动医学/);assert.equal(x.medicalReferral,true)
 }
})
test('referral is not duplicated and unrelated requests are unchanged',()=>{
 const turn={mode:'ask',text:'请先寻求运动医学评估。',nextStep:null,medicalReferral:true}
 assert.equal(preserveReferral(turn,true).text,turn.text)
 assert.deepEqual(preserveReferral(turn,false),turn)
})
test('conflicting recovery values cannot be averaged or cherry-picked',()=>{
 const x=review([e('r1','SESSION_RPE',4),e('r2','SESSION_RPE',9)])
 assert.equal(x.active.length,0);assert.ok(x.quarantined.some(y=>y.reason==='CONFLICTING_SAME_ENDPOINT'))
 assert.ok(x.missing.includes('UNRESOLVED_EVIDENCE_CONFLICT'))
})
test('conflicting symptom reports retain conservative safety review',()=>{
 const x=review([e('p1','PAIN_SCORE',0),e('p2','PAIN_SCORE',3)])
 assert.equal(x.safety,'MEDICAL_REVIEW');assert.equal(x.active.length,0)
})
test('a later no-pain report does not silently clear an earlier professional review',()=>{
 const prior=review([e('p','PAIN_SCORE',3)],known(3))
 const after=review([e('p','PAIN_SCORE',3),e('c','PAIN_SCORE',0,{recordedAt:known(5),supersedes:'p'})],known(6),prior)
 assert.equal(after.safety,'MEDICAL_REVIEW');assert.ok(after.revision.some(x=>x.includes('p')))
})
test('future plan known now is allowed as plan, never as completed performance',()=>{
 const x=review([e('plan','GOAL_SECONDS',125,{source:'PLAN',eventAt:day(7),recordedAt:day(1)})],known(3))
 assert.deepEqual(x.active.map(y=>y.id),['plan']);assert.ok(x.missing.includes('NO_ACTUAL_SPLITS'))
})
test('correction of a conflicting endpoint cannot cherry-pick one branch',()=>{
 const x=review([e('r1','SESSION_RPE',4),e('r2','SESSION_RPE',9),e('corrected','SESSION_RPE',5,{supersedes:'r1'})])
 assert.equal(x.active.length,0);assert.ok(x.quarantined.some(y=>y.reason==='AMBIGUOUS_CORRECTION_ANCESTOR'))
})
