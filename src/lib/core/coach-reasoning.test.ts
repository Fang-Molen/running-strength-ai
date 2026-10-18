import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCoachModelRequest, interpretCoachModelOutput } from '../strength/coach-pipeline'
import { answerLocally } from './coach-local-first.ts'
import { latestReasoningBasis, readReasoningBasis, reasoningForModel, reasoningReadFailure } from './coach-reasoning.ts'
import { freshMemory, saveCoach, loadCoach } from '../strength/coach'
import { A,BEFORE,AFTER,row,baseRows,request } from '../../../evaluation/r6/fixtures.ts'
const local=(d:ReturnType<typeof request>)=>answerLocally(d.brief,{frame:d.v4!.reasoning,snapshot:d.v4!.review.audit.snapshot})
test('R6 failed evidence reads still retain emergency and medical referral, without invented records',()=>{
 assert.match(reasoningReadFailure('我刚刚跑步晕倒了'),/急救|急诊/)
 assert.match(reasoningReadFailure('分析这节训练',true),/运动医学|康复/)
 assert.match(reasoningReadFailure('分析这节训练'),/读取失败/)
})
test('R6 production packet contains bounded software reasoning, not a receipt promoted to facts',()=>{
 const r=buildCoachModelRequest(request(baseRows())),packet=JSON.parse(r.packet)
 assert.equal(packet.personalEvidenceV4.reasoningFrame.stage,'EXPLAIN_EVIDENCE')
 assert.equal(packet.personalEvidenceV4.reasoningFrame.basis,undefined)
 assert.match(r.system,/缺失不当反证/)
 assert.equal(packet.personalEvidenceV4.reasoningFrame.decision.planWrite,false)
})
test('R6 local actual entry reads formal rows and supplies supported plus unsupported explanations',()=>{
 const a=local(request(baseRows()))
 assert.deepEqual(a.reasoning!.computed.points.map(p=>p.seconds),[64,70]);assert.match(a.text,/记录睡眠 5小时/)
 assert.match(a.text,/可能解释1/);assert.match(a.text,/可能解释2/);assert.match(a.text,/若/)
 assert.ok(a.reasoning!.hypotheses.every(h=>h.causalConfidence==='UNDETERMINED'))
 assert.equal(a.reasoning!.basis.athleteId,A)
})
test('R6 corrective evidence withdraws the old source through actual request normalization',()=>{
 const before=request(baseRows())
 const after=request([...baseRows(),row('rep2-fixed','SPLIT_SECONDS',63,{...baseRows()[1],recordId:'rep2-fixed',sourceEventId:'rep2-fixed',value:63,knownAt:'2026-03-05T11:00:00Z',supersedesRecordId:'rep2'})],AFTER,before.v4!.reasoning.basis)
 assert.equal(after.v4!.reasoning.revision.status,'REASSESS_REQUIRED')
 assert.ok(after.v4!.reasoning.revision.withdrawnSources.includes('rep2'))
 assert.deepEqual(after.v4!.reasoning.hypotheses.find(h=>h.id==='PACING_OR_REST')!.supportSourceIds,[])
 assert.match(local(after).text,/撤回相关解释/);assert.doesNotMatch(local(after).text,/70秒/)
})
test('R6 new sleep feedback changes hypothesis support instead of repeating the prior recovery explanation',()=>{
 const before=request(baseRows()),after=request([...baseRows(),row('sleep-fixed','SLEEP_HOURS',8,{knownAt:'2026-03-05T11:00:00Z',supersedesRecordId:'sleep'})],AFTER,before.v4!.reasoning.basis)
 const h=after.v4!.reasoning.hypotheses.find(h=>h.id==='RECOVERY')!
 assert.deepEqual(h.supportSourceIds,[]);assert.deepEqual(h.challengeSourceIds,['sleep-fixed'])
 assert.ok(h.missingEvidence.every(c=>c.startsWith('NO_')))
 assert.equal(after.v4!.reasoning.decision.causalEffectKnown,false)
})
test('R6 overwritten data with reused source IDs invalidates an unreproducible historical receipt',()=>{
 const before=request(baseRows()),changed=baseRows().map(r=>r.recordId==='rep2'?{...r,value:62}:r)
 const after=request(changed,AFTER,before.v4!.reasoning.basis)
 assert.ok(after.v4!.reasoning.revision.reasons.includes('HISTORICAL_BASIS_CHANGED'))
 assert.equal(after.v4!.reasoning.revision.status,'REASSESS_REQUIRED')
})
test('R6 new backfill is invisible earlier and requests reassessment only after known time',()=>{
 const added=row('new-rest','REST_SECONDS',180,{knownAt:'2026-03-05T12:00:00Z'})
 const before=request([...baseRows(),added])
 assert.ok(before.v4!.reasoning.unknowns.some(s=>s.includes('恢复未知')))
 const after=request([...baseRows(),added],AFTER,before.v4!.reasoning.basis)
 assert.equal(after.v4!.reasoning.revision.status,'REASSESS_REQUIRED')
 assert.ok(!after.v4!.reasoning.unknowns.some(s=>s.includes('恢复未知')))
})
test('R6 unchanged evidence stays unchanged without claiming previous advice was correct',()=>{
 const before=request(baseRows()),after=request(baseRows(),AFTER,before.v4!.reasoning.basis)
 assert.equal(after.v4!.reasoning.revision.status,'UNCHANGED')
 assert.equal(after.v4!.reasoning.decision.causalEffectKnown,false)
})
test('R6 borrowed athlete, other session, future and malformed receipts never become facts',()=>{
 const b=request(baseRows()).v4!.reasoning.basis
 for(const bad of [{...b,athleteId:'other'},{...b,scopeOccurrenceIds:['other']},{...b,asOf:'2099-01-01T00:00:00Z'},{...b,sources:[{sourceId:1,signature:null}]}])assert.equal(readReasoningBasis(bad,A,AFTER,['s1']),null)
 const d=request(baseRows(),AFTER,{...b,athleteId:'other'})
 assert.equal(d.v4!.reasoning.revision.status,'UNVERIFIED_PRIOR')
 assert.equal(d.v4!.review.audit.snapshot.active.length,baseRows().length)
 assert.equal(latestReasoningBasis([{role:'coach',analysisBasis:b},{role:'coach',analysisBasis:{athleteId:A,scopeOccurrenceIds:null}}],A,AFTER,['s1'])!.asOf,BEFORE)
})
test('R6 conflicting actual sources suspend review and expose unknown evidence',()=>{
 const rows=[...baseRows(),row('conflict','SESSION_RPE',9)]
 const d=request(rows)
 assert.equal(d.v4!.reasoning.stage,'RESOLVE_CONFLICT');assert.equal(d.v4!.reasoning.decision.status,'VERIFY_FIRST')
 assert.match(local(d).text,/不平均、不挑选/)
})
test('R6 another session recovery conflict does not block a clean selected session',()=>{
 const d=request([...baseRows(),row('other-rpe1','SESSION_RPE',3,{trainingOccurrenceId:'s2'}),row('other-rpe2','SESSION_RPE',9,{trainingOccurrenceId:'s2'})])
 assert.equal(d.v4!.reasoning.stage,'EXPLAIN_EVIDENCE')
 assert.ok(d.v4!.reasoning.hypotheses.every(h=>!h.supportSourceIds.some(id=>id.startsWith('other'))))
})
test('R6 symptom risk overrides better times and survives local and model output paths',()=>{
 const d=request([...baseRows(),row('pain','PAIN_SCORE',3)])
 assert.equal(d.v4!.reasoning.stage,'SAFETY_FIRST');assert.equal(d.v4!.reasoning.hypotheses.length,0)
 assert.match(local(d).text,/运动医学|康复/);assert.equal(local(d).escalationAvailable,false)
 const contractFixture=JSON.stringify({mode:'ask',text:'请先核对记录。',citations:[],nextStep:null,medicalReferral:false})
 const out=interpretCoachModelOutput(d,contractFixture);assert.equal(out.turn.medicalReferral,true);assert.match(out.turn.text,/运动医学|康复/)
})
test('R6 safe structural model fixture cannot omit the correction notice; this is not a real model answer',()=>{
 const before=request(baseRows()),after=request([...baseRows(),row('sleep-fixed','SLEEP_HOURS',8,{knownAt:'2026-03-05T11:00:00Z',supersedesRecordId:'sleep'})],AFTER,before.v4!.reasoning.basis)
 const out=interpretCoachModelOutput(after,JSON.stringify({mode:'answer',text:'本次主观强度6/10，仍需核对实际休息。',citations:['ev:s1:rpe'],nextStep:null,medicalReferral:false}))
 assert.match(out.turn.text,/撤回相关解释/);assert.equal(out.turn.planChanged,false)
})
test('R6 truncated dependency basis is declared and cannot certify old conclusions',()=>{
 const many=Array.from({length:40},(_,i)=>row(`many-${i}`,'SPLIT_SECONDS',60+i,{protocol:`running:c:rep:b:step:1:${i+1}:400m`,occurredAt:`2026-03-01T10:${String(i).padStart(2,'0')}:00Z`}))
 const before=request(many);assert.equal(before.v4!.reasoning.basis.sources.length,32);assert.equal(before.v4!.reasoning.basis.complete,false)
 const after=request(many,AFTER,before.v4!.reasoning.basis);assert.equal(after.v4!.reasoning.revision.status,'UNVERIFIED_PRIOR')
 for(const n of [1200,2000,3000])assert.ok(JSON.stringify(reasoningForModel(after.v4!.reasoning,n)).length<=n)
})
test('R6 analysis dependency receipt survives chat save/reload without becoming an athlete fact',()=>{
 const previous=globalThis.localStorage,store=new Map<string,string>()
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)}})
 try{
  const b=request(baseRows()).v4!.reasoning.basis,mem={...freshMemory(),messages:[{id:'r6',role:'coach' as const,text:'deterministic local explanation',analysisBasis:b}]}
  assert.equal(saveCoach(mem),true);assert.deepEqual(loadCoach().messages[0].analysisBasis,b)
  assert.equal(request(baseRows(),AFTER,loadCoach().messages[0].analysisBasis).v4!.reasoning.revision.status,'UNCHANGED')
 }finally{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previous})}
})
