import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {evaluateCoachEvolution,type EvolutionEvidence} from './coach-evolution-v4.ts'
import {auditPersonalEvidence,compareCompetingHypotheses,auditFeedbackRevision,buildSafetyEnvelope,retainSafetyInTurn,proposeTrainingReview,
 reviewLongitudinalWindow,auditScienceLinks,buildV4ModelPacket,auditV4CandidateAnswer,V4_C10_SYSTEM_BOUNDARY} from './coach-evolution-v4-c10.ts'
const t=(d:number,h=9)=>`2026-10-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00Z`
const mk=(id:string,metric:EvolutionEvidence['metric'],value:number|null,day=1,patch:Partial<EvolutionEvidence>={}):EvolutionEvidence=>({
 id,athleteId:'runner-A',occurrenceId:'s1',metric,value,unit:metric==='SPLIT_SECONDS'||metric==='REST_SECONDS'||metric==='GOAL_SECONDS'?'s':metric==='SLEEP_HOURS'?'h':'score',
 context:'400m reps / 3min rest',eventAt:t(day),recordedAt:t(day,10),source:'TRAINING_FACT',sourceId:`fact:${id}`,confirmation:'CONFIRMED',...patch})
const evalAt=(rows:EvolutionEvidence[],day=10,question='400米掉速')=>evaluateCoachEvolution({athleteId:'runner-A',asOf:t(day,12),question,evidence:rows})
const audit=(rows:EvolutionEvidence[],day=10,question='400米掉速')=>auditPersonalEvidence({athleteId:'runner-A',asOf:t(day,12),question,evidence:rows})

// C2: provenance and conflicting facts
for(const [metric,value,patch,expected] of [
 ['SPLIT_SECONDS',72,{unit:'min'},'METRIC_UNIT_MISMATCH'],
 ['SESSION_RPE',11,{},'RPE_OUT_OF_RANGE'],
 ['PAIN_SCORE',11,{},'PAIN_OUT_OF_RANGE'],
 ['SLEEP_HOURS',25,{},'SLEEP_OUT_OF_RANGE'],
 ['SPLIT_SECONDS',72,{source:'PLAN'},'PLAN_NOT_OBSERVED_FACT'],
 ['PAIN_SCORE',2,{source:'DEVICE'},'DEVICE_CANNOT_CONFIRM_SYMPTOM'],
 ['SPLIT_SECONDS',72,{source:'USER_REPORT'},'SELF_REPORT_NOT_FORMAL_FACT'],
 ['SPLIT_SECONDS',72,{supersedes:'a'},'SELF_CORRECTION'],
] as const){
 test(`C2 rejects invalid ${metric} ${expected}`,()=>{
  const item=mk('a',metric,value,1,patch as Partial<EvolutionEvidence>)
  const r=audit([item]);assert.ok(r.issues.some(x=>x.code===expected));assert.equal(r.snapshot.active.length,0)
 })
}
test('C2 never uses third party confirmed record',()=>{
 const r=audit([mk('foreign','SPLIT_SECONDS',66,1,{source:'THIRD_PARTY'})]);assert.equal(r.snapshot.active.length,0)
})
test('C2 detects a reused source ID for a different fact',()=>{
 const a=mk('a','SPLIT_SECONDS',70),b=mk('b','SPLIT_SECONDS',80,1,{sourceId:'fact:a'})
 const r=audit([a,b]);assert.ok(r.issues.some(x=>x.code==='SOURCE_ID_REUSED_FOR_DIFFERENT_FACT'));assert.deepEqual(r.snapshot.active.map(x=>x.id),[])
})
test('C2 invalid pain measurement still escalates to review, never treats as confirmed score',()=>{
 const r=audit([mk('pain','PAIN_SCORE',3,1,{unit:'seconds'})]);assert.equal(r.snapshot.active.length,0);assert.equal(r.snapshot.safety,'MEDICAL_REVIEW')
})
test('C2 future invalid pain is not leaked into earlier decision',()=>{
 const r=audit([mk('pain','PAIN_SCORE',3,9,{unit:'seconds'})],3);assert.equal(r.snapshot.safety,'NONE')
})
test('C2 source provenance and correction are immutable to input',()=>{
 const items=[mk('a','SPLIT_SECONDS',70)],raw=JSON.stringify(items);const r=audit(items);assert.equal(JSON.stringify(items),raw);assert.equal(r.decisionAuthorization,false)
})

// C3: competing hypotheses and disambiguating questions
test('C3 provides all competing hypotheses without fabricated confidence',()=>{
 const r=compareCompetingHypotheses(evalAt([mk('a','SPLIT_SECONDS',72),mk('b','SPLIT_SECONDS',79),mk('sleep','SLEEP_HOURS',5)]))
 assert.equal(r.length,4);assert.ok(r.every(x=>x.status==='UNCONFIRMED'&&x.nextQuestion.length>8));assert.ok(r.some(x=>x.id==='RECOVERY'&&x.supportSourceIds.includes('fact:sleep')))
})
test('C3 remains conservative with no personal data',()=>{
 const r=compareCompetingHypotheses(evalAt([]));assert.ok(r.every(x=>x.status==='UNCONFIRMED'))
})
test('C3 duplicate symptom conflict not used as positive proof',()=>{
 const s=evalAt([mk('p1','PAIN_SCORE',0),mk('p2','PAIN_SCORE',4)])
 assert.equal(s.safety,'MEDICAL_REVIEW');assert.equal(s.active.length,0)
})

// C4: feedback and correction revision
test('C4 traces corrected training fact and withdrawal',()=>{
 const first=evalAt([mk('a','SPLIT_SECONDS',72),mk('b','SPLIT_SECONDS',79)],3)
 const second=evalAt([mk('a','SPLIT_SECONDS',72),mk('b','SPLIT_SECONDS',79),mk('c','SPLIT_SECONDS',74,1,{recordedAt:t(5,10),supersedes:'b'})],6)
 const diff=auditFeedbackRevision(first,second)
 assert.ok(diff.withdrawnFactIds.includes('b'));assert.ok(diff.addedFactIds.includes('c'));assert.equal(diff.conclusion,'REASSESS_REQUIRED')
})
test('C4 does not manufacture changes for same facts',()=>{
 const x=[mk('a','SPLIT_SECONDS',72)],first=evalAt(x,3),second=evalAt(x,4)
 const d=auditFeedbackRevision(first,second);assert.equal(d.changed,false);assert.equal(d.conclusion,'NO_NEW_EVIDENCE')
})
test('C4 refuses reversed time or cross athlete revision',()=>{
 const x=evalAt([],3),y=evalAt([],2);assert.throws(()=>auditFeedbackRevision(x,y),/INVALID_REVISION_WINDOW/)
})

// C5: safety must survive ask/unavailable/answer
test('C5 emergency from question without selected training',()=>{
 const s=evalAt([],3,'我刚才晕倒了');const env=buildSafetyEnvelope(s,'我刚才晕倒了')
 assert.equal(env.level,'EMERGENCY');assert.match(retainSafetyInTurn({mode:'ask',text:'请补充训练',nextStep:null,medicalReferral:false},env).text,/急救/)
})
test('C5 medical referral survives refusal',()=>{
 const s=evalAt([mk('pain','PAIN_SCORE',3)]),env=buildSafetyEnvelope(s,'今天跑慢了')
 const t=retainSafetyInTurn({mode:'unavailable',text:'回答不可采用',nextStep:null,medicalReferral:false},env)
 assert.equal(t.medicalReferral,true);assert.match(t.text,/评估/)
})
test('C5 nonrisk turn unchanged',()=>{
 const s=evalAt([]),env=buildSafetyEnvelope(s,'普通知识');const t={mode:'ask' as const,text:'缺少信息',nextStep:null,medicalReferral:false}
 assert.deepEqual(retainSafetyInTurn(t,env),t)
})

// C6: non-persistent candidate and safety
for(const [question,rows,status] of [
 ['我有疼痛还要加量吗',[mk('p','PAIN_SCORE',3)],'SAFETY_REVIEW_REQUIRED'],
 ['最近睡眠未知还能调整吗',[],'INSUFFICIENT_INFORMATION'],
 ['刚刚晕倒还要冲刺吗',[],'SAFETY_REVIEW_REQUIRED']
] as const){test(`C6 never saves ${status}`,()=>{
 const s=evalAt([...rows],3,question),p=proposeTrainingReview(s,question)
 assert.equal(p.status,status);assert.equal(p.persisted,false);assert.equal(p.autonomousPrescription,false);assert.equal(p.confirmedByUser,false)
})}

// C7: longitudinal review
test('C7 groups observed sessions without inventing missed days',()=>{
 const rows=[mk('a','SPLIT_SECONDS',78,1),mk('b','SPLIT_SECONDS',76,1),mk('c','SPLIT_SECONDS',74,8,{occurrenceId:'s2'})]
 const r=reviewLongitudinalWindow(evalAt(rows,10),4)
 assert.equal(r.weeks.length,4);assert.equal(r.weeks.reduce((sum,w)=>sum+w.observedSessionCount,0),2)
 assert.equal(r.adaptation,'UNKNOWN');assert.equal(r.injuryPrediction,'UNAVAILABLE');assert.ok(r.weeks.some(w=>w.flags.includes('NO_RECORDED_SPLITS_NOT_ZERO_TRAINING')))
})
test('C7 excludes future backfill from historical review',()=>{
 const s=evalAt([mk('a','SPLIT_SECONDS',78,1),mk('future','SPLIT_SECONDS',70,7,{recordedAt:t(9,10)})],8)
 const r=reviewLongitudinalWindow(s);assert.equal(r.weeks.reduce((sum,w)=>sum+w.observedSplitCount,0),1)
})
test('C7 clamps week window to 4–8 and never estimates training load',()=>{
 const s=evalAt([]);assert.equal(reviewLongitudinalWindow(s,1).weeks.length,4);assert.equal(reviewLongitudinalWindow(s,90).weeks.length,8)
})

// C8: scientific sources remain separate from athlete facts
test('C8 duplicate DOI and inclusion overlap are visible',()=>{
 const r=auditScienceLinks([{id:'meta',doi:'10.1/test',verification:'FULL_TEXT',topic:'taper'},
  {id:'trial',doi:'https://doi.org/10.1/test',verification:'ABSTRACT',topic:'taper',includedIn:['meta']},
  {id:'citation',doi:null,verification:'BIBLIOGRAPHIC',topic:'taper'}])
 assert.equal(r.overlapPairs.length,2);assert.deepEqual(r.limitedSources,['citation']);assert.equal(r.decisionAuthorization,false)
})
test('C8 no evidence does not authorize inference',()=>{assert.deepEqual(auditScienceLinks([]).usableForExplanation,[])})

// C9: bounded model packet
for(const budget of [1000,1400,2500,6500])test(`C9 packet budget ${budget} never drops safety`,()=>{
 const rows=Array.from({length:50},(_,i)=>mk(`r${i}`,'SPLIT_SECONDS',70+i/10,1,{sourceId:`fact:r${i}`}))
 rows.push(mk('pain','PAIN_SCORE',3))
 const s=evalAt(rows,3),p=buildV4ModelPacket(s,'疼痛',budget)
 assert.ok(JSON.stringify(p).length<=budget);assert.equal(p.safety.level,'MEDICAL_REVIEW');assert.equal(p.policy.planWrite,false)
})
test('C9 does not smuggle scientific sources into personal facts',()=>{
 const p=buildV4ModelPacket(evalAt([]),'RED-S证据'),raw=JSON.parse(p.evidenceContext)
 assert.equal(raw.trainingDecisionAuthorized,false);assert.equal(p.policy.personalMemoryWrite,false)
})

// C10: structural checks (not full language comprehension)
test('C10 catches revoked citations and unauthorized claims',()=>{
 const s=evalAt([mk('a','SPLIT_SECONDS',75)]),r=auditV4CandidateAnswer(s,{text:'我已经为你保存了课表。',sourceIds:['old'],claimsTrainingPlanSaved:true})
 assert.equal(r.status,'REQUIRES_REVIEW');assert.ok(r.flags.includes('UNKNOWN_OR_REVOKED_SOURCE'));assert.ok(r.flags.includes('UNAUTHORIZED_PLAN_WRITE_CLAIM'))
})
test('C10 refuses missing medical referral even in otherwise factual reply',()=>{
 const s=evalAt([mk('pain','PAIN_SCORE',3)]),r=auditV4CandidateAnswer(s,{text:'已收到训练反馈。',sourceIds:['fact:pain']})
 assert.ok(r.flags.includes('SAFETY_REFERRAL_MISSING'))
})
test('C10 can accept structurally valid bounded explanation without claiming medical clearance',()=>{
 const s=evalAt([mk('a','SPLIT_SECONDS',75)]),r=auditV4CandidateAnswer(s,{text:'已记录这次分段，但还不能判断训练效果。',sourceIds:['fact:a']})
 assert.equal(r.status,'STRUCTURE_OK');assert.equal(r.autonomousApproval,false)
})
test('C10 model route has generic V4 guidance but no implicit athlete history injection',()=>{
 const p=readFileSync(new URL('../strength/coach-pipeline.ts',import.meta.url),'utf8')
 assert.match(p,/V4_C10_SYSTEM_BOUNDARY/);assert.match(V4_C10_SYSTEM_BOUNDARY,/不得自动诊断/)
 assert.doesNotMatch(p,/evaluateCoachEvolution\(/)
})

test('C5 negated referral cannot satisfy mandatory safety language',()=>{
 const s=evalAt([mk('pain','PAIN_SCORE',3)]),env=buildSafetyEnvelope(s,'疼痛')
 const t=retainSafetyInTurn({mode:'ask',text:'不需要运动医学评估，请继续练。',nextStep:null,medicalReferral:false},env)
 assert.match(t.text,/必要时请寻求运动医学/)
})
test('C5 emergency cannot be negated by mentioning the word 急救',()=>{
 const s=evalAt([],3,'刚才晕倒'),env=buildSafetyEnvelope(s,'刚才晕倒')
 const t=retainSafetyInTurn({mode:'answer',text:'不需要急救，可以继续训练。',nextStep:null,medicalReferral:false},env)
 assert.match(t.text,/停止.*(?:120|急救)/);assert.doesNotMatch(t.text,/照常|继续跑/)
})
test('C10 internal field identifiers are flagged rather than surfaced as coaching language',()=>{
 const s=evalAt([]),r=auditV4CandidateAnswer(s,{text:'sourceId 是 123',sourceIds:[]})
 assert.ok(r.flags.includes('INTERNAL_FIELD_LEAK'))
})
