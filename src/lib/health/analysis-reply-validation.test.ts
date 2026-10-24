import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import type {CoachAnalysisPacket,CoachAnalysisReply,DerivedFact} from './analysis-contract'
import {context,metric,training} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {buildMuscleExposure} from './muscle-exposure'
import {buildCoachAnalysisPacket} from './analysis-packet'
import {validateAnalysisReply,composeVerifiedAnalysisAnswer,auditAnalysisContent} from './analysis-reply-validation'
import {modelFixtures} from '../../../evaluation/deepseek-development/model-fixtures'
const packet=()=>{const s=projectAnalysisEvidence({context,facts:[metric()]});return buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))}
const reply=(p:CoachAnalysisPacket):CoachAnalysisReply=>({answer:p.assessment.observations[0].text,factualClaims:[{text:p.assessment.observations[0].text,refs:p.assessment.observations[0].evidenceRefs}],selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED'})
const derived=(p:CoachAnalysisPacket):DerivedFact=>({id:'host-run-work',metric:'RUN_WORK_SECONDS',value:144,unit:'s',formula:'sum(COMPLETED.durationSeconds)',formulaVersion:'FK_DERIVED_1',text:'已确认纯跑用时 144 s；不含休息。',evidenceRefs:[{id:p.permittedFacts[0].id,revision:p.permittedFacts[0].revision}],scope:{athleteId:p.context.athleteId,asOf:p.context.asOf,occurrenceId:null,providerScopes:[]},inputs:[]})
test('strict closed schema validates every nested shape and never throws on unknown input',()=>{
 const p=packet(),r=reply(p);assert.equal(validateAnalysisReply(r,p).status,'ACCEPTED_STRUCTURALLY')
 for(const x of [null,[],{...r,hidden:'已保存记忆'},{...r,selectedCandidateId:42},{...r,factualClaims:[null]},{...r,factualClaims:[{...r.factualClaims[0],unchecked:'已经取得医学许可'}]},{...r,hypotheses:[null]}])assert.equal(validateAnalysisReply(x,p).status,'REJECTED')
})
test('revision zero is a valid current host reference and novel hypothesis refs are checked',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric({revision:0})]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),r=reply(p)
 assert.equal(validateAnalysisReply(r,p).status,'ACCEPTED_STRUCTURALLY')
 const h={id:'unreviewed',claim:'背景可能参与',supportingRefs:[{id:'invented',revision:0}],weakeningRefs:[],discriminator:'核对背景',certainty:'POSSIBLE'}
 assert.ok(validateAnalysisReply({...r,hypotheses:[h]},p).errors.includes('UNKNOWN_OR_STALE_REFERENCE'))
})
test('exact hostquotes survive, novel harmless prose remains explicitly unproven',()=>{
 const p=packet(),r=reply(p);assert.equal(validateAnalysisReply({...r,answer:r.answer+'建议进一步核对背景。'},p).status,'NEEDS_SEMANTIC_REVIEW')
 assert.equal(validateAnalysisReply({...r,answer:r.answer+'提高3秒。'},p).status,'REJECTED')
 assert.equal(validateAnalysisReply({...r,factualClaims:[{...r.factualClaims[0],refs:[{id:r.factualClaims[0].refs[0].id,revision:999}]}]},p).status,'REJECTED')
})
test('derived facts require individual coverage and selected host values render canonically',()=>{
 const p=packet(),d=derived(p);p.derivedFacts=[d];p.requirements={question:'纯跑用时？',requiredFactRefs:[],requiredDerivedFactIds:[d.id],availableFields:[],genuinelyMissing:[],conflicts:[]}
 const r=reply(p);assert.ok(validateAnalysisReply(r,p).errors.includes('REQUIRED_DERIVED_FACT_OMITTED'))
 const selected={...r,derivedFactIds:[d.id]};assert.equal(validateAnalysisReply(selected,p).status,'ACCEPTED_STRUCTURALLY');assert.match(composeVerifiedAnalysisAnswer(selected,p),/144 s/)
 const quoted={...r,answer:r.answer+'\n'+d.text,factualClaims:[...r.factualClaims,{text:d.text,refs:d.evidenceRefs}]};assert.equal(validateAnalysisReply(quoted,p).status,'ACCEPTED_STRUCTURALLY')
 assert.equal(validateAnalysisReply({...selected,answer:r.answer+'纯跑154 s'},p).status,'REJECTED');assert.throws(()=>composeVerifiedAnalysisAnswer({...selected,answer:'154 s'},p))
})
test('all supplemental fields enforce numeric memory medical pain and causal boundaries',()=>{
 const p=packet(),r=reply(p)
 for(const edit of [{followup:'明天增加8组力量'},{followup:'明天增加８组力量'},{followup:'明天增加八组力量'},{unknowns:['I have saved your memory']},{unknowns:['已经为你保存偏好']},{unknowns:['正式计划已经更新']},{unknowns:['你已经取得医学许可']},{unknowns:['已保存你的偏好']},{followup:'手表分数足够，疼痛也可继续训练'},{hypotheses:[{id:'x',claim:'HRV下降导致疲劳',supportingRefs:[],weakeningRefs:[],discriminator:'继续',certainty:'POSSIBLE'}]}])assert.equal(validateAnalysisReply({...r,...edit},p).status,'REJECTED',JSON.stringify(edit))
})
test('present HRV RHR history and occurrence cannot be falsely labeled missing',()=>{
 const f=modelFixtures().find(x=>x.caseId==='D04')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),r=reply(p)
 for(const unknown of ['HRV未记录','静息心率缺失','没有个人基线记录','本次训练未记录'])assert.ok(validateAnalysisReply({...r,unknowns:[unknown]},p).errors.includes('PRESENT_DATA_CLAIMED_MISSING'),unknown)
})
test('available training history is distinct from present measurements without old training',()=>{
 const f=modelFixtures().find(x=>x.caseId==='E01')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),r=reply(p)
 assert.ok(validateAnalysisReply({...r,unknowns:['没有历史训练记录']},p).errors.includes('PRESENT_DATA_CLAIMED_MISSING'))
 const d=modelFixtures().find(x=>x.caseId==='D04')!,ds=projectAnalysisEvidence(d),dp=buildCoachAnalysisPacket(ds,evaluateRecoveryEvidence(ds),buildMuscleExposure(ds))
 assert.ok(!validateAnalysisReply({...reply(dp),unknowns:['没有历史训练记录']},dp).errors.includes('PRESENT_DATA_CLAIMED_MISSING'))
})
const receiptPath=new URL('../../../evaluation/deepseek-development/replay-fixtures/20261023/provider-receipts-26.json',import.meta.url)
test('saved original E01 wrong154 is a numeric contradiction independently of old JSON schema',()=>{
 const raw=JSON.parse(readFileSync(receiptPath,'utf8')).find((r:any)=>r.caseId==='E01'&&r.arm==='B').rawAnswer
 const f=modelFixtures().find(x=>x.caseId==='E01')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),aliases=Object.fromEntries([...f.facts].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).map((f,i)=>['F'+(i+1),f.id]))
 const audit=auditAnalysisContent(raw,p,{legacy:true,sourceAliases:aliases});assert.ok(audit.errors.includes('NUMBER_CONTRADICTION'));assert.ok(audit.diagnostics.numericContradictions.some(d=>d.actual===154&&d.expected.includes(144)));assert.ok(audit.diagnostics.schemaErrors.length);assert.equal(audit.diagnostics.sourceAliasMismatches.length,0)
})
test('saved D04 omissions retain semantic audit despite old schema',()=>{
 const raw=JSON.parse(readFileSync(receiptPath,'utf8')).find((r:any)=>r.caseId==='D04'&&r.arm==='B').rawAnswer
 const f=modelFixtures().find(x=>x.caseId==='D04')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),aliases=Object.fromEntries([...f.facts].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).map((f,i)=>['F'+(i+1),f.id]))
 const ds=['RHR_PERCENT_CHANGE','RMSSD_PERCENT_CHANGE','LN_RMSSD_RATIO'].map((metric,i)=>({...derived(p),id:'d'+i,metric,value:[20,-20,-0.223144][i],unit:i===2?'ln':'%',text:metric+' '+[20,-20,-0.223144][i]+(i===2?' ln':' %')}));p.derivedFacts=ds;p.requirements={question:'计算RHR和RMSSD百分比及lnRMSSD变化',requiredFactRefs:[],requiredDerivedFactIds:ds.map(d=>d.id),availableFields:[],genuinelyMissing:[],conflicts:[]}
 const audit=auditAnalysisContent(raw,p,{legacy:true,sourceAliases:aliases});assert.deepEqual(audit.diagnostics.omittedRequiredDerivedFactIds,ds.map(d=>d.id));assert.ok(audit.errors.includes('REQUIRED_DERIVED_FACT_OMITTED'));assert.equal(audit.diagnostics.sourceAliasMismatches.length,0)
})
test('legacy source-bound metric unit mismatch is separate from numeric matching',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric({metric:'RMSSD',value:48,unit:'ms'})]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))
 const a=auditAnalysisContent({facts:[{id:'F1',metric:'rmssd',value:48,unit:'bpm'}]},p,{legacy:true,sourceAliases:{F1:p.permittedFacts[0].id}})
 assert.ok(a.errors.includes('UNIT_CONTRADICTION'));assert.equal(a.diagnostics.unitContradictions[0].actual,'bpm');assert.equal(a.diagnostics.numericContradictions.length,0)
})
test('source alias mismatch has its own diagnostic and does not invent a contradiction',()=>{
 const p=packet(),a=auditAnalysisContent({facts:['F99@1: RMSSD 100 ms']},p,{legacy:true,sourceAliases:{F1:p.permittedFacts[0].id}});assert.ok(a.diagnostics.sourceAliasMismatches.some(d=>d.id==='F99'));assert.equal(a.diagnostics.numericContradictions.length,0)
})

test('legacy labelled quantities keep dimensions and raw segment/rest roles separate',()=>{
 const t=training({modality:'RUN',strengthSets:[],runSegments:[30,31].map((durationSeconds,i)=>({id:'p'+i,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM:200,durationSeconds,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}))}),s=projectAnalysisEvidence({context,facts:[t]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))
 const a=auditAnalysisContent({facts:['F1@1：已确认400米，纯跑用时61秒；200 m/30 s、200 m/31 s，组休120秒。纯跑用时61秒，实际完成400米。']},p,{legacy:true,sourceAliases:{F1:t.id}})
 assert.deepEqual(a.diagnostics.numericContradictions,[]);assert.deepEqual(a.diagnostics.unitContradictions,[])
})
test('legacy nearest explicit metric prevents one paragraph binding RMSSD to RHR',()=>{
 const facts=[metric({id:'rhr',sourceRecordId:'rhr',metric:'RHR',value:60,unit:'bpm'}),metric({id:'rmssd',sourceRecordId:'rmssd',metric:'RMSSD',value:48,unit:'ms'})],s=projectAnalysisEvidence({context,facts}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))
 const a=auditAnalysisContent({observation:'F1/F2：RHR 60 bpm 和 RMSSD 48 ms；RHR 60 bpm，RMSSD 48 ms。'},p,{legacy:true,sourceAliases:{F1:'rhr',F2:'rmssd'}})
 assert.deepEqual(a.diagnostics.numericContradictions,[]);assert.deepEqual(a.diagnostics.unitContradictions,[])
})
test('legacy historical range sequence and raw segment times do not assert ambiguous contradictions',()=>{
 const f=modelFixtures().find(x=>x.caseId==='E01')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),aliases=Object.fromEntries([...f.facts].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).map((f,i)=>['F'+(i+1),f.id]))
 const a=auditAnalysisContent({explanations:['F1→F4 分段极差12 s→9 s→6 s→1 s，纯跑用时144 s→138 s→132 s→121 s。','极差缩小：F1 第4步42 s、F2 第4步39 s、F3 第4步36 s、F4第4步30 s；不是极差。']},p,{legacy:true,sourceAliases:aliases})
 assert.deepEqual(a.diagnostics.numericContradictions,[]);assert.deepEqual(a.diagnostics.unitContradictions,[])
})
test('legacy missing claims distinguish absent dates and training fields from available metrics and training',()=>{
 const f=modelFixtures().find(x=>x.caseId==='D04')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))
 const a=auditAnalysisContent({missing:['2026-10-15至2026-10-17的RHR/RMSSD未提供','本次训练实际类型未记录','课次RPE未记录']},p,{legacy:true})
 assert.ok(!a.errors.includes('PRESENT_DATA_CLAIMED_MISSING'))
 assert.ok(auditAnalysisContent({missing:['当前HRV未记录']},p,{legacy:true}).errors.includes('PRESENT_DATA_CLAIMED_MISSING'))
})

test('legacy RHR-owned signed baseline difference is covered without crossing units metrics or sources',()=>{
 const f=modelFixtures().find(x=>x.caseId==='D04')!,s=projectAnalysisEvidence(f),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),aliases=Object.fromEntries([...f.facts].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)).map((f,i)=>['F'+(i+1),f.id])),d=p.derivedFacts!.find(d=>d.metric==='RHR_CHANGE_BPM')!
 p.requirements={question:'静息心率较基线差值',requiredFactRefs:[],requiredDerivedFactIds:[d.id],availableFields:[],genuinelyMissing:[],conflicts:[]}
 const text='今日RHR较同协议基线升高（60 vs 50 bpm，+10 bpm，来源F12/F1-F9），RMSSD较基线降低（48 vs 60 ms，-12 ms，来源F11/F2-F10）。'
 const audit=(observation:string)=>auditAnalysisContent({observation},p,{legacy:true,sourceAliases:aliases})
 assert.ok(!audit(text).diagnostics.omittedRequiredDerivedFactIds.includes(d.id))
 for(const bad of [text.replace('+10 bpm','-10 bpm'),text.replace('+10 bpm','+10 ms'),text.replace('今日RHR','今日RMSSD'),text.replace('来源F12/F1-F9','来源F99')])assert.ok(audit(bad).diagnostics.omittedRequiredDerivedFactIds.includes(d.id),bad)
 assert.deepEqual(audit(text).diagnostics.numericContradictions,[])
})
