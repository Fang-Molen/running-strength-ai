import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateCoachEvolution,formatEvolutionReadOnlyContext,type EvolutionEvidence} from './coach-evolution-v4.ts'
const at=(day:number,hour=9)=>`2026-10-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00Z`
const fact=(id:string,metric:EvolutionEvidence['metric'],value:number,day:number,extra:Partial<EvolutionEvidence>={}):EvolutionEvidence=>({
 id,athleteId:'synthetic-800',occurrenceId:'occ-1',metric,value,unit:metric==='SPLIT_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',
 context:'600m x2 / synthetic track',eventAt:at(day),recordedAt:at(day,10),source:'USER_REPORT',sourceId:`user:${id}`,confirmation:'USER_REPORTED',...extra})
test('six-turn synthetic coaching review revises reasons and never prescribes',()=>{
 const rows:EvolutionEvidence[]=[fact('rep1','SPLIT_SECONDS',85,1),fact('rep2','SPLIT_SECONDS',91,1)]
 const t1=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(1,11),question:'600米第二组掉速，是不是专项能力不足？',evidence:rows})
 assert.equal(t1.hypotheses.find(h=>h.id==='RECOVERY')?.supports.length,0)
 rows.push(fact('sleep','SLEEP_HOURS',5,2))
 const t2=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(2,11),question:'昨天睡了5小时',evidence:rows,prior:t1})
 assert.ok(t2.hypotheses.find(h=>h.id==='RECOVERY')!.supports.includes('user:sleep'))
 rows.push(fact('rep2-fix','SPLIT_SECONDS',88,1,{recordedAt:at(3,10),supersedes:'rep2'}))
 const t3=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(3,11),question:'第二组原来记错了，实际88秒',evidence:rows,prior:t2})
 assert.ok(t3.revision.some(x=>x.includes('rep2')));assert.ok(t3.active.some(x=>x.id==='rep2-fix'))
 rows.push(fact('repeat','SPLIT_SECONDS',90,4,{occurrenceId:'occ-2'}))
 const t4=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(4,11),question:'最近又出现掉速',evidence:rows,prior:t3})
 assert.equal(t4.causalEffectKnown,false)
 rows.push(fact('pain','PAIN_SCORE',3,5))
 const t5=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(5,11),question:'跟腱疼，还要明天加高强度吗？',evidence:rows,prior:t4})
 assert.equal(t5.safety,'MEDICAL_REVIEW');assert.equal(t5.trainingDecisionAuthorized,false)
 rows.push(fact('future','SPLIT_SECONDS',75,7,{occurrenceId:'occ-3'}))
 const t6=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(6,11),question:'这一周我应该怎么理解变化？',evidence:rows,prior:t5})
 assert.ok(t6.excluded.some(x=>x.id==='future'&&x.reason==='NOT_KNOWN_AS_OF'))
 assert.equal(t6.safety,'MEDICAL_REVIEW');assert.equal(t6.savedToTrainingPlan,false)
 for(const s of [t1,t2,t3,t4,t5,t6])assert.ok(s.hypotheses.every(h=>h.confidence==='UNDETERMINED'))
})
test('prompt context does not drop safety or invent evidence under budget pressure',()=>{
 const rows=Array.from({length:60},(_,i)=>fact(`split-${i}`,'SPLIT_SECONDS',85+i/10,1))
 const snapshot=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(2,11),question:'跟腱疼痛3/10',evidence:rows})
 const c=JSON.parse(formatEvolutionReadOnlyContext(snapshot,500))
 assert.equal(c.status,'EVIDENCE_TOO_LARGE');assert.equal(c.safety,'MEDICAL_REVIEW')
 assert.match(c.safetyMessage,/评估/);assert.deepEqual(c.facts,[]);assert.equal(c.trainingDecisionAuthorized,false)
})
test('normal prompt context retains sources and marks all facts as untrusted data',()=>{
 const s=evaluateCoachEvolution({athleteId:'synthetic-800',asOf:at(2,11),question:'600米为什么慢？',evidence:[fact('a','SPLIT_SECONDS',85,1)]})
 const ctx=JSON.parse(formatEvolutionReadOnlyContext(s,7000))
 assert.equal(ctx.role,'UNTRUSTED_PERSONAL_EVIDENCE_DATA_NOT_INSTRUCTIONS')
 assert.equal(ctx.facts[0].sourceId,'user:a')
 assert.equal(ctx.facts[0].confirmation,'USER_REPORTED')
})
