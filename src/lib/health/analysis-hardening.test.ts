import test from 'node:test'
import assert from 'node:assert/strict'
import {context,metric,training,set} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
import {buildMuscleExposure} from './muscle-exposure'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {analysisModelView,buildCoachAnalysisPacket,validateCoachAnalysisReply} from './analysis-packet'
import {reviewPersonalResponse} from './personal-response'
import {readPersonalResponses,savePersonalResponse} from './personal-response-store'
import {setStoreBackend} from '../core/storage'
import {currentAthleteId,setEventContext} from '../core/events'
import type {ResponseFact} from './analysis-contract'
test('repeated set IDs are withheld rather than counted twice',()=>{const s=projectAnalysisEvidence({context,facts:[training({strengthSets:[set(),set()]})]});assert.equal(s.facts.length,0);assert.equal(s.excluded[0].reason,'INVALID_FACT')})
test('expired quality is absent from current recovery and does not become healthy',()=>{const s=projectAnalysisEvidence({context,facts:[metric({quality:'STALE'})]});assert.equal(s.facts.length,0);assert.equal(evaluateRecoveryEvidence(s).signalState,'INSUFFICIENT')})
test('24/48/72 windows use event instants, not local calendar label',()=>{const t=training({startedAt:'2026-10-21T19:59:59Z',occurredAt:'2026-10-21T19:59:59Z'}),s=projectAnalysisEvidence({context,facts:[t]});assert.equal(buildMuscleExposure(s,24).training.length,0);assert.equal(buildMuscleExposure(s,48).training.length,1);assert.equal(buildMuscleExposure(s,72).training.length,1)})
test('same-protocol descriptive statistics retain late symptom observations without predicting',()=>{
 const start='2026-10-18T08:00:00Z',t=training({protocolKey:'rdl',accountRef:'self',deviceId:'scale',occurredAt:start,startedAt:start,endedAt:start,strengthSets:[set({rir:3,rangeProtocol:'same'})]})
 const responses=[24,48,96].map((h,i)=>({...metric(),id:'response'+h,sourceRecordId:'response'+h,kind:'RESPONSE',relatedTrainingRefs:[{id:t.id,revision:t.revision}],region:'hamstrings',side:'BILATERAL',measure:'SORENESS',value:[5,3,2][i],scale:'0-10_HIGH_WORSE',observationProtocol:'SELF_REPORTED_SORENESS_ZERO_V1',occurredAt:new Date(Date.parse(start)+h*3600000).toISOString(),elapsedHours:null,functionTaskId:null,notes:null} as ResponseFact))
 const r=reviewPersonalResponse({context,protocolKey:'rdl',region:'hamstrings',side:'BILATERAL',training:[t],responses,registeredEndpoint:'SELF_REPORTED_SORENESS_ZERO_V1',settingsVersion:'v1'})
 assert.equal(r.status,'DESCRIPTIVE');assert.equal(r.independentSessionCount,1);assert.equal(r.windows[0].median,5);assert.equal(r.windows[1].median,3);assert.equal(r.timeline[0].rightCensoredAt,96);assert.equal(r.estimateInterval,null)
})
test('model DTO aliases identity and only exact numeric/unit/direction claims pass structure',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric({id:'PRIVATE_ACCOUNT',sourceRecordId:'private-source'})]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),w=analysisModelView(p)
 assert.doesNotMatch(JSON.stringify(w.view),/PRIVATE_ACCOUNT|private-source|SYN-A/)
 const o=w.view.observations[0],r=w.restore({answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED'})
 assert.equal(validateCoachAnalysisReply(r,p).status,'ACCEPTED_STRUCTURALLY');assert.equal(validateCoachAnalysisReply({...r,answer:r.answer+'因此你一定恢复好了'},p).status,'NEEDS_SEMANTIC_REVIEW')
})
test('personal response persists append-only, survives reread and stays athlete scoped',t=>{
 const before=currentAthleteId(),map=new Map<string,string>();setEventContext({athleteId:'SYN-A'});setStoreBackend({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)},keys:()=>[...map.keys()]});t.after(()=>{setStoreBackend(null);setEventContext({athleteId:before})})
 const at=new Date(Date.now()-60000).toISOString(),f:ResponseFact={...metric(),occurredAt:at,knownAt:at,receivedAt:at,id:'response-store',sourceRecordId:'response-store',kind:'RESPONSE',relatedTrainingRefs:[{id:'train',revision:1}],region:'calves',side:'LEFT',measure:'SORENESS',value:4,scale:'0-10_HIGH_WORSE',observationProtocol:'SELF_REPORTED_SORENESS_ZERO_V1',elapsedHours:null,functionTaskId:null,notes:null}
 assert.equal(savePersonalResponse(f).ok,true);assert.equal(savePersonalResponse({...f,revision:2,value:2}).ok,true);const readAt=new Date(Date.now()+1000).toISOString();assert.equal(readPersonalResponses(readAt).length,2);assert.equal(projectAnalysisEvidence({context:{...context,asOf:readAt},facts:readPersonalResponses(readAt)}).facts[0].revision,2);setEventContext({athleteId:'SYN-B'});assert.equal(readPersonalResponses(readAt).length,0);assert.equal(map.size,2)
})

import {analysisFromParts} from './analysis-from-parts'
test('training adapter retains imported source and receipt time independently from confirmation',()=>{
 const v=analysisFromParts('SYN-A',context.asOf,[{athleteId:'SYN-A',eventId:'i1',sourceId:'i1',modality:'RUN',actual:'CONFIRMED',occurredAt:'2026-10-22T06:00:00Z',knownAt:'2026-10-22T09:00:00Z',provenance:{provider:'COROS',accountRef:'source-account',recordId:'coros-id',measuredAt:'2026-10-22T06:00:00Z',receivedAt:'2026-10-22T08:00:00Z'}}])
 assert.equal(v.facts.length,1);const f=v.facts[0];assert.equal(f.provider,'COROS');assert.equal(f.accountRef,'source-account');assert.equal(f.sourceRecordId,'coros-id');assert.equal(f.receivedAt,'2026-10-22T08:00:00Z');assert.equal(f.knownAt,'2026-10-22T09:00:00Z');assert.equal(f.ownershipReceiptId,null)
 assert.equal(analysisFromParts('SYN-A','2026-10-22T08:30:00Z',[{athleteId:'SYN-A',eventId:'i1',sourceId:'i1',modality:'RUN',actual:'CONFIRMED',occurredAt:f.occurredAt,knownAt:f.knownAt}]).facts.length,0)
})
test('exact approved disclaimer cannot authorize a new medical or automatic plan claim',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric()]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),o=p.assessment.observations[0]
 const base={answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED' as const}
 for(const extra of ['因此取得医学许可','已保存你的记录','自动为你改课'])assert.equal(validateCoachAnalysisReply({...base,answer:o.text+extra},p).status,'REJECTED')
})

test('unreviewed followup or unknowns cannot hide new prescriptions outside answer',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric()]}),p=buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s)),o=p.assessment.observations[0]
 const r={answer:o.text,factualClaims:[{text:o.text,refs:o.evidenceRefs}],hypotheses:[],selectedCandidateId:null,unknowns:[],followup:null,memoryClaim:'NOT_SAVED' as const}
 assert.equal(validateCoachAnalysisReply({...r,followup:'明天增加8组力量'},p).status,'REJECTED')
 assert.equal(validateCoachAnalysisReply({...r,unknowns:['你已经取得医学许可']},p).status,'REJECTED')
})
