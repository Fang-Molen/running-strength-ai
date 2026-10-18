import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCoachEvolution, type EvolutionEvidence } from './coach-evolution-v4.ts'
import { compareCompetingHypotheses } from './coach-evolution-v4-c10.ts'
const e=(id:string,metric:EvolutionEvidence['metric'],value:number,patch:Partial<EvolutionEvidence>={}):EvolutionEvidence=>({
 id,athleteId:'test-ath',occurrenceId:'s1',sourceId:'src:'+id,metric,value,unit:metric==='SLEEP_HOURS'?'h':metric==='SESSION_RPE'?'score':'s',
 context:'400m repeat',eventAt:'2026-03-01T10:00:00Z',recordedAt:'2026-03-01T11:00:00Z',source:'TRAINING_FACT',confirmation:'CONFIRMED',...patch})
const review=(evidence:EvolutionEvidence[],scopeOccurrenceIds?:string[])=>evaluateCoachEvolution({athleteId:'test-ath',asOf:'2026-03-10T12:00:00Z',question:'这次训练掉速如何解释',evidence,...(scopeOccurrenceIds?{scopeOccurrenceIds}: {})})
test('R6 formal repeated slots in the same round actually support an observed slowdown',()=>{
 const s=review([e('a','SPLIT_SECONDS',64,{context:'running:c:rep:b:step:1:1:400m'}),e('b','SPLIT_SECONDS',70,{context:'running:c:rep:b:step:1:2:400m',eventAt:'2026-03-01T10:05:00Z'})])
 assert.deepEqual(s.hypotheses.find(h=>h.id==='PACING_OR_REST')?.supports,['src:a','src:b'])
})
test('R6 recovery observations from another session do not justify this session',()=>{
 const s=review([e('a','SPLIT_SECONDS',64),e('other-rpe','SESSION_RPE',9,{occurrenceId:'s2'})],['s1'])
 assert.deepEqual(s.hypotheses.find(h=>h.id==='RECOVERY')?.supports,[])
 assert.ok(s.missing.includes('NO_SESSION_RPE'))
})
test('R6 different rest durations from different sessions are not a changed rest protocol',()=>{
 const s=review([e('rest1','REST_SECONDS',120),e('rest2','REST_SECONDS',240,{occurrenceId:'s2'})])
 assert.ok(!s.hypotheses.find(h=>h.id==='PACING_OR_REST')?.supports.includes('src:rest2'))
})
test('R6 null values are unknown, not an assessed symptom or explicit goal',()=>{
 const s=review([{...e('pain','PAIN_SCORE',0),value:null,unit:'score'},{...e('goal','GOAL_SECONDS',60),value:null}])
 assert.ok(s.missing.includes('NO_SYMPTOM_ASSESSMENT'));assert.ok(s.missing.includes('NO_EXPLICIT_PLAN_OR_GOAL'))
})
test('R6 challenge citations are actual source IDs rather than labels or confound codes',()=>{
 const s=review([e('sleep','SLEEP_HOURS',8),e('r1','REST_SECONDS',120),e('r2','REST_SECONDS',240)])
 const hypotheses=compareCompetingHypotheses(s)
 assert.deepEqual(hypotheses.find(h=>h.id==='RECOVERY')?.challengeSourceIds,['src:sleep'])
 const ids=new Set(s.active.map(e=>e.sourceId));assert.ok(hypotheses.every(h=>h.challengeSourceIds.every(id=>ids.has(id))))
})
test('R6 a missing selection cannot borrow recovery facts from history',()=>{
 const s=review([e('sleep','SLEEP_HOURS',4),e('rpe','SESSION_RPE',9)],[])
 assert.deepEqual(s.hypotheses.find(h=>h.id==='RECOVERY')?.supports,[])
})
test('R6 explicit repeat ordinal determines comparison order, not random event IDs',()=>{
 const s=review([e('z-first','SPLIT_SECONDS',64,{context:'running:c:rep:b:step:1:1:400m'}),e('a-last','SPLIT_SECONDS',70,{context:'running:c:rep:b:step:1:2:400m'})])
 assert.deepEqual(s.hypotheses.find(h=>h.id==='PACING_OR_REST')?.supports,['src:z-first','src:a-last'])
})
test('R6 rounds, actual distances, and different source methods stay separate',()=>{
 for(const patch of [{context:'running:c:rep:b:step:2:2:400m'},{context:'running:c:rep:b:step:1:2:200m'},{source:'DEVICE' as const,confirmation:'UNVERIFIED' as const}]){
  const s=review([e('a','SPLIT_SECONDS',64,{context:'running:c:rep:b:step:1:1:400m'}),e('b','SPLIT_SECONDS',70,{context:'running:c:rep:b:step:1:2:400m',...patch})])
  assert.deepEqual(s.hypotheses.find(h=>h.id==='PACING_OR_REST')?.supports,[])
 }
})
test('R6 missing measurements are not evidence against a hypothesis',()=>{
 const h=compareCompetingHypotheses(review([])).find(h=>h.id==='RECOVERY')!
 assert.deepEqual(h.counterEvidence,[]);assert.deepEqual(h.challengeSourceIds,[]);assert.ok(h.missingEvidence.includes('NO_SLEEP_DATA'))
})
