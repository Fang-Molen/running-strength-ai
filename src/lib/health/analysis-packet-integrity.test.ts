import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {modelFixtures} from '../../../evaluation/deepseek-development/model-fixtures'
import {context,metric,training,set} from './analysis-fixtures'
import {projectAnalysisEvidence,sourceScope,stableJson} from './analysis-evidence'
import {buildMuscleExposure} from './muscle-exposure'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {analysisModelView,buildCoachAnalysisPacket,validateCoachAnalysisReply} from './analysis-packet'
import * as packetApi from './analysis-packet'
import type {AnalysisFact,AnalysisPacketOptions,EvidenceSnapshot} from './analysis-contract'

const fixture=(id:string)=>modelFixtures().find(x=>x.caseId===id)!
const packet=(s:EvidenceSnapshot,options:AnalysisPacketOptions={})=>buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s),options)
const fromFixture=(id:string,options:AnalysisPacketOptions={})=>packet(projectAnalysisEvidence(fixture(id)),options)
const catalog=JSON.parse(readFileSync(new URL('../../../evaluation/deepseek-development/cases-60.json',import.meta.url),'utf8'))
const actualQuestion=(id:string):string=>catalog.cases.find((c:{id:string})=>c.id===id).prompt

test('D04 packet retains every eligible HRV/RHR baseline day and current metric',()=>{
 const f=fixture('D04'),p=fromFixture('D04',{question:'同设备RMSSD和静息心率较个人基线变化多少？'})
 assert.equal(p.permittedFacts.length,f.facts.length)
 assert.equal(p.permittedFacts.filter(x=>x.kind==='METRIC').length,12)
 assert.ok(p.derivedFacts?.some(x=>/^RMSSD_/.test(x.metric)))
 assert.ok(p.derivedFacts?.some(x=>/^RHR_/.test(x.metric)))
 assert.ok(p.requirements?.requiredDerivedFactIds.length)
 assert.equal(p.requirements?.genuinelyMissing.some(x=>/HRV.*未记录|RMSSD.*未记录/i.test(x)),false)
 assert.equal(p.assessment.missingDecisionInputs.some(x=>/HRV未记录/.test(x)),false)
})

test('A03 packet counts independent occurrences while preserving both actual components',()=>{
 const p=fromFixture('A03',{question:'同一次混合课跑步和力量各完成多少，总共几次训练？'})
 assert.equal(p.permittedFacts.length,2)
 assert.equal(p.derivedFacts?.find(x=>x.metric==='OCCURRENCE_COUNT')?.value,1)
 assert.ok(p.derivedFacts?.some(x=>/^RUN_/.test(x.metric)))
 assert.ok(p.derivedFacts?.some(x=>/^STRENGTH_/.test(x.metric)))
})

test('E01 packet keeps all four courses and their original adverse history',()=>{
 const p=fromFixture('E01',{question:'与此前三次同协议课比较，最新课是否更稳定？'})
 assert.equal(p.permittedFacts.length,4)
 assert.deepEqual(p.permittedFacts.map(x=>x.id).sort(),['s0','s1','s2','s3'])
 assert.ok(p.requirements?.requiredFactRefs.some(x=>x.id==='s3'))
 const view=analysisModelView(p).view
 assert.equal(view.facts.length,4)
 assert.match(JSON.stringify(view.facts),/42/)
})

test('packet independently enforces athlete/asOf/revision scope and preserves safety constraints',()=>{
 const older=metric({revision:1,value:5}),latest=metric({revision:2,value:6})
 const eligible=projectAnalysisEvidence({context,facts:[latest],safetyConstraints:[{id:'trusted-hold',version:'v1',scope:'PAIN_REVIEW',evidenceRefs:[{id:latest.id,revision:latest.revision}]}]})
 const injected={...eligible,facts:[older,latest,metric({id:'foreign',sourceRecordId:'foreign',athleteId:'OTHER'}),metric({id:'future',sourceRecordId:'future',knownAt:'2026-10-23T08:00:00Z',receivedAt:'2026-10-23T08:00:00Z'}),metric({id:'planned',sourceRecordId:'planned',status:'PLANNED'})]}
 const p=packet(injected)
 assert.deepEqual(p.permittedFacts.map(x=>[x.id,x.revision]),[[latest.id,2]])
 assert.deepEqual(p.safetyConstraints,eligible.safetyConstraints)
})

test('question requirements retain hypothesis counterevidence without inventing missing RMSSD',()=>{
 const run=training({id:'run',sourceRecordId:'run',modality:'RUN',strengthSets:[],runSegments:[{id:'rep',blockId:'main',roundIndex:1,stepIndex:1,distanceM:200,durationSeconds:30,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}]})
 const noPain={...metric({id:'no-pain',sourceRecordId:'no-pain'}),kind:'RESPONSE',relatedTrainingRefs:[{id:run.id,revision:run.revision}],region:null,side:'UNSPECIFIED',measure:'PAIN',value:0,scale:'0-10_HIGH_WORSE',observationProtocol:null,elapsedHours:null,functionTaskId:null,notes:null} as AnalysisFact
 const s=projectAnalysisEvidence({context,facts:[run,noPain,metric({metric:'rmssd',value:48,unit:'ms'})]})
 const a=evaluateRecoveryEvidence(s)
 a.hypotheses.push({id:'test-h',claim:'训练背景可能参与当前表现',supportingRefs:[{id:run.id,revision:run.revision}],weakeningRefs:[{id:noPain.id,revision:noPain.revision}],discriminator:'对照原课程及反馈',certainty:'POSSIBLE'})
 const p=buildCoachAnalysisPacket(s,a,buildMuscleExposure(s),{question:'用已记录RMSSD与跑步表现区分训练解释和反证'})
 assert.ok(p.requirements?.requiredFactRefs.some(x=>x.id===noPain.id))
 assert.ok(p.requirements?.availableFields.some(x=>/rmssd/i.test(x)))
 assert.equal(p.requirements?.genuinelyMissing.some(x=>/rmssd|hrv/i.test(x)),false)
 assert.ok(p.assessment.hypotheses.find(x=>x.id==='test-h')?.weakeningRefs.length)
})

test('D01 aliases match neutral source scopes and strict quotations restore exactly',()=>{
 const p=fromFixture('D01'),ordered=p.permittedFacts.slice().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id)),f=ordered[0]
 const aliases={[stableJson([f.provider,f.accountRef,f.deviceId,f.protocolKey])]:'S1',[f.protocolKey!]:'P1'}
 const wrapped=analysisModelView(p,ordered.map(x=>x.id),aliases)
 const text=JSON.stringify(wrapped.view)
 assert.doesNotMatch(text,/synthetic-A|same-hand-timing|synthetic-approved-plan|"s1"/)
 assert.match(text,/MANUAL \/ S1/)
 assert.equal(wrapped.view.facts[0].source.scope,'S1')
 assert.equal(wrapped.view.facts[0].source.protocol,'P1')
 assert.deepEqual(wrapped.restore(wrapped.view).hypotheses,p.assessment.hypotheses)
 const o=wrapped.view.observations[0]
 const restored=wrapped.restore({answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED'})
 assert.equal(validateCoachAnalysisReply(restored,p).status,'ACCEPTED_STRUCTURALLY')
 const d=p.derivedFacts![0],dv=wrapped.view.derivedFacts.find((x:any)=>x.metric===d.metric)!
 assert.deepEqual(wrapped.restore({derivedFactIds:[dv.id]}).derivedFactIds,[d.id])
 assert.deepEqual(wrapped.restore({selectedCandidateId:wrapped.view.candidates[0].id}).selectedCandidateId,p.allowedCandidateIds[0])
 assert.equal(sourceScope(f).includes(f.athleteId),true)
})

test('embedded private aliases roundtrip without replacing ordinary prose or alias substrings',()=>{
 const facts=[metric({id:'private-fact',accountRef:'account-private',deviceId:'watch-private',protocolKey:'account-private/wrist-protocol',sourceRecordId:'source-private'}),training({id:'private-training',sourceRecordId:'private-training',strengthSets:[set()]})]
 const p=packet(projectAnalysisEvidence({context,facts})),w=analysisModelView(p),serialized=JSON.stringify(w.view)
 assert.doesNotMatch(serialized,/SYN-A|account-private|watch-private|source-private|private-fact|private-training/)
 assert.deepEqual(w.restore(w.view).hypotheses,p.assessment.hypotheses)
 const host=p.assessment.observations.find(x=>x.text.includes('account-private/wrist-protocol'))!,o=w.view.observations.find(x=>x.evidenceRefs.some((r:any)=>r.id==='F1'))!
 const restored=w.restore({answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED'})
 assert.equal(restored.answer,host.text)
})

test('model DTO removes repeated candidate boilerplate while retaining facts and safety/missing provenance',()=>{
 const p=fromFixture('E01',{question:'三次历史课与最新课稳定性对照'}),view=analysisModelView(p).view
 assert.equal(view.facts.length,4)
 assert.equal(view.asOf,p.context.asOf)
 assert.ok(view.facts.every((x:any)=>x.sourceAsOf))
 assert.deepEqual(view.safetyConstraints,[])
 assert.ok(view.missing.length)
 assert.equal('conditions' in view.candidates[0],false)
 assert.ok(JSON.stringify(view).length<JSON.stringify(p).length*.5)
})

test('binding an actual question adds existing raw evidence requirements to a legacy packet',()=>{
 const p=packet(projectAnalysisEvidence({context,facts:[metric({metric:'HRV',value:48,unit:'ms'})]}))
 assert.deepEqual(p.requirements?.requiredFactRefs,[])
 assert.deepEqual(p.requirements?.requiredDerivedFactIds,[])
 const bind=(packetApi as any).bindAnalysisPacketQuestion
 assert.equal(typeof bind,'function')
 const bound=bind(p,'解释已记录HRV，不要把已存在的字段说成未记录')
 assert.deepEqual(bound.requirements.requiredFactRefs,[{id:'m1',revision:1}])
 assert.deepEqual(bound.requirements.genuinelyMissing,[])
 assert.deepEqual(p.requirements?.requiredFactRefs,[])
})

test('generated neutral source aliases are not interpreted again as raw private IDs',()=>{
 const f=training({id:'O1',sourceRecordId:'P1',occurrenceId:'session-private',protocolKey:'protocol-private',accountRef:'account-private',deviceId:'device-private'})
 const w=analysisModelView(packet(projectAnalysisEvidence({context,facts:[f]})))
 assert.equal(w.view.facts[0].ref.id,'F1')
 assert.equal(w.view.facts[0].occurrenceId,'O1')
 assert.equal(w.view.facts[0].source.protocol,'P1')
 assert.equal(w.view.facts[0].source.scope,'S1')
})

for(const [id,metrics] of [
 ['A03',['RUN_DISTANCE_M','RUN_WORK_SECONDS','STRENGTH_SETS','STRENGTH_REPS','STRENGTH_EXTERNAL_VOLUME_KG_REPS','OCCURRENCE_COUNT']],
 ['C07',['RUN_DISTANCE_M','RUN_WORK_SECONDS','RUN_TIME_CHANGE_SECONDS','RUN_TIME_CHANGE_PERCENT','RUN_SPEED_DECLINE_PERCENT']],
 ['E01',['RUN_DISTANCE_M','RUN_WORK_SECONDS','RUN_SEGMENT_RANGE_SECONDS']],
] as const)test(`${id} actual catalog question requires the numerical facts needed for its wording`,()=>{
 const p=fromFixture(id,{question:actualQuestion(id)}),required=new Set(p.requirements!.requiredDerivedFactIds)
 for(const metric of metrics){
  const facts=p.derivedFacts!.filter(f=>f.metric===metric)
  assert.ok(facts.length,`${id}: ${metric} available`)
  assert.ok(facts.every(f=>required.has(f.id)),`${id}: ${metric} required`)
 }
})

test('a multi-quotation answer restores every embedded source alias with its exact original text',()=>{
 const p=packet(projectAnalysisEvidence({context,facts:[metric({id:'private-metric',sourceRecordId:'private-source',accountRef:'account-private',deviceId:'watch-private',protocolKey:'account-private/wrist-protocol'}),training()]})),w=analysisModelView(p)
 const quotes=w.view.observations.slice(0,2)
 assert.equal(quotes.length,2)
 const r=w.restore({answer:quotes.map(o=>o.text).join('\n'),factualClaims:quotes.map(o=>({text:o.text,refs:o.evidenceRefs})),hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED'})
 assert.equal(validateCoachAnalysisReply(r,p).status,'ACCEPTED_STRUCTURALLY')
})

test('approved hypothesis identifiers remain exact when they resemble derived aliases',()=>{
 const s=projectAnalysisEvidence(fixture('A03')),a=evaluateRecoveryEvidence(s)
 a.hypotheses=[{id:'D1',claim:'这是一条待验证解释',supportingRefs:[{id:s.facts[0].id,revision:s.facts[0].revision}],weakeningRefs:[],discriminator:'继续观察已有课程',certainty:'POSSIBLE'}]
 const p=buildCoachAnalysisPacket(s,a,buildMuscleExposure(s)),w=analysisModelView(p)
 assert.deepEqual(w.restore(w.view).hypotheses,p.assessment.hypotheses)
})

for(const [field,value] of [['unit','ms'],['statistic','DAILY_TOTAL'],['quality','AVAILABLE'],['temporalResolution','INSTANT'],['energyKind','TOTAL']] as const)test(`a raw fact ID matching ${field} does not replace that semantic value`,()=>{
 const f=metric({id:value,sourceRecordId:value,metric:'RMSSD',unit:'ms',[field]:value})
 const w=analysisModelView(packet(projectAnalysisEvidence({context,facts:[f]})))
 assert.equal(w.view.facts[0].ref.id,'F1')
 assert.equal(w.view.facts[0][field],value)
})

const pacePacket=()=>{
 const f=training({id:'pace-run',sourceRecordId:'pace-run',modality:'RUN',strengthSets:[],runSegments:[1,2].map(i=>({id:`rep-${i}`,blockId:'main',roundIndex:1,stepIndex:i,distanceM:200,durationSeconds:30,restAfterSeconds:120,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'}))})
 return packet(projectAnalysisEvidence({context,facts:[f]}),{question:'这次跑步的平均配速是多少？'})
}

test('an average pace question requires 150 s/km alongside distance and work time',()=>{
 const p=pacePacket(),required=p.derivedFacts!.filter(f=>p.requirements!.requiredDerivedFactIds.includes(f.id))
 assert.equal(required.find(f=>f.metric==='RUN_PACE_SECONDS_PER_KM')?.value,150)
 assert.ok(required.some(f=>f.metric==='RUN_DISTANCE_M'))
 assert.ok(required.some(f=>f.metric==='RUN_WORK_SECONDS'))
 assert.equal(required.some(f=>f.metric==='RUN_SEGMENT_MEAN_SECONDS'),false)
 assert.deepEqual(required.map(f=>f.metric).sort(),['RUN_DISTANCE_M','RUN_WORK_SECONDS','RUN_PACE_SECONDS_PER_KM'].sort())
 const segmentMean=packet(projectAnalysisEvidence({context,facts:p.permittedFacts}),{question:'分段平均用时是多少？'})
 assert.ok(segmentMean.derivedFacts!.filter(f=>segmentMean.requirements!.requiredDerivedFactIds.includes(f.id)).some(f=>f.metric==='RUN_SEGMENT_MEAN_SECONDS'))
})

test('a reply omitting the required average pace is rejected even when its other numerical facts are supplied',()=>{
 const p=pacePacket(),o=p.assessment.observations.find(o=>/^已确认跑步/.test(o.text))!
 const reply={answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED' as const,derivedFactIds:p.derivedFacts!.filter(f=>p.requirements!.requiredDerivedFactIds.includes(f.id)&&f.metric!=='RUN_PACE_SECONDS_PER_KM').map(f=>f.id)}
 const result=validateCoachAnalysisReply(reply,p)
 assert.equal(result.status,'REJECTED')
 assert.ok(result.errors.includes('REQUIRED_DERIVED_FACT_OMITTED'))
})

test('a valid host competition date is retained as planned calendar context with neutral wire versions',()=>{
 const p=fromFixture('C04',{question:actualQuestion('C04'),competitionDate:'2026-10-26'})
 assert.deepEqual(p.calendarContext,{competitionDate:'2026-10-26',source:'HOST_COMPETITION_DATE',version:p.context.planVersion})
 const view=analysisModelView(p).view
 assert.deepEqual(view.calendarContext,{competitionDate:'2026-10-26',source:'HOST_COMPETITION_DATE',version:'PLAN'})
 assert.doesNotMatch(JSON.stringify(view),/synthetic-approved-plan|LOGIC_LOAD_1/)
 const asOf=view.derivedFacts.find((f:any)=>f.metric==='DAYS_TO_COMPETITION_FROM_ASOF')!
 assert.deepEqual(asOf.refs,[])
 assert.deepEqual(asOf.contextSources.map((s:any)=>s.kind),['ANALYSIS_AS_OF','COMPETITION_DATE'])
 assert.equal(asOf.contextSources.find((s:any)=>s.kind==='COMPETITION_DATE')!.version,'PLAN')
 assert.equal(fromFixture('C04',{competitionDate:'2026-02-30'}).calendarContext,undefined)
})

for(const field of ['distanceM','durationSeconds'] as const)test(`a requested complete run total stays explicitly unknown when a completed segment lacks ${field}`,()=>{
 const f=pacePacket().permittedFacts[0]
 assert.equal(f.kind,'TRAINING')
 if(f.kind!=='TRAINING')return
 f.runSegments[1][field]=null
 const isDistance=field==='distanceM',p=packet(projectAnalysisEvidence({context,facts:[f]}),{question:isDistance?'这次跑步完整总距离是多少？':'这次跑步完整纯跑总用时是多少？'})
 assert.equal(p.permittedFacts.length,1)
 assert.ok(p.requirements!.genuinelyMissing.some(x=>isDistance?/完整总距离.*未知/.test(x):/完整.*总用时.*未知/.test(x)))
 assert.equal(p.requirements!.genuinelyMissing.some(x=>/实际跑步明细未记录/.test(x)),false)
})
