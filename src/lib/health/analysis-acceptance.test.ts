import test from 'node:test'
import assert from 'node:assert/strict'
import {context,metric,training,set} from './analysis-fixtures'
import type {AnalysisFact,ResponseFact,CoachAnalysisReply} from './analysis-contract'
import {projectAnalysisEvidence,analysisReference,analysisDigest} from './analysis-evidence'
import {buildMuscleExposure,trainingDose} from './muscle-exposure'
import {evaluateRecoveryEvidence} from './recovery-assessment'
import {reviewPersonalResponse,responseProtocol} from './personal-response'
import {buildCoachAnalysisPacket,validateCoachAnalysisReply,checkAnalysisCandidate} from './analysis-packet'
import {onRequestPost} from '../../../server/coach-deepseek/coach-chat.controller.js'
const snap=(facts:AnalysisFact[])=>projectAnalysisEvidence({context,facts})
const packet=(facts:AnalysisFact[])=>{const s=snap(facts);return buildCoachAnalysisPacket(s,evaluateRecoveryEvidence(s),buildMuscleExposure(s))}
const response=(o:Partial<ResponseFact>={}):ResponseFact=>({...metric(),id:'response',sourceRecordId:'response',kind:'RESPONSE',relatedTrainingRefs:[{id:'train1',revision:1}],region:'hamstrings',side:'BILATERAL',measure:'SORENESS',value:4,scale:'0-10_HIGH_WORSE',observationProtocol:'SELF_REPORTED_SORENESS_ZERO_V1',elapsedHours:null,functionTaskId:null,notes:null,...o})
const reply=(o:Partial<CoachAnalysisReply>={}):CoachAnalysisReply=>({answer:'',factualClaims:[],selectedCandidateId:null,hypotheses:[],unknowns:[],followup:null,memoryClaim:'NOT_SAVED',...o})
test('A01 missing stays null; zero unknown-definition energy does not imply readiness',()=>{
 const s=snap([metric({metric:'STEPS',value:null}),metric({id:'energy',sourceRecordId:'energy',metric:'ENERGY',value:0,unit:'kcal',energyKind:'UNKNOWN'})]);assert.equal((s.facts[0] as any).value,0);assert.equal(evaluateRecoveryEvidence(s).signalState,'INSUFFICIENT')
})
test('A02 arrival cutoff excludes future knowledge',()=>assert.equal(snap([metric({knownAt:'2026-10-23T01:00:00Z',receivedAt:'2026-10-23T01:00:00Z'})]).facts.length,0))
test('A03 latest revision and withdrawal never accumulate',()=>{assert.equal((snap([training(),training({revision:2,strengthSets:[set(),set({id:'s2'})]})]).facts[0] as any).strengthSets.length,2);assert.equal(snap([training(),training({revision:3,status:'RETRACTED'})]).facts.length,0)})
test('A04 and A05 history never mixes athlete, account, device or HRV method',()=>{
 const m=metric({metric:'HRV',value:40,unit:'ms',provider:'GARMIN',accountRef:'G',deviceId:'D',protocolKey:'RMSSD'}),old=metric({...m,id:'old',sourceRecordId:'old',providerDate:'2026-10-21',value:50})
 const s=snap([m,old,metric({...old,id:'other',sourceRecordId:'other',protocolKey:'SDNN',value:100}),metric({...old,athleteId:'OTHER',value:200})]);const b=analysisReference(s,m);assert.equal(b.median,50);assert.equal(b.sampleCount,1);assert.equal(b.deltaPercent,-20)
})
test('A06 cumulative daily energy revisions stay separate from workout energy',()=>{
 const m=metric({metric:'ACTIVE_KCAL',value:400,unit:'kcal',energyKind:'ACTIVE'}),s=snap([m,metric({...m,revision:2,value:520}),metric({id:'work',sourceRecordId:'work',metric:'WORKOUT_KCAL',value:200,energyKind:'WORKOUT',unit:'kcal'})]);assert.equal(s.facts.length,2);assert.equal((s.facts.find(f=>f.id==='m1') as any).value,520);assert.equal(s.facts.some((f:any)=>f.value===720||f.value===920),false)
})
test('A07 daily facts do not create hourly measurements; sleep retains interval',()=>{
 const f=metric({metric:'SLEEP',value:450,unit:'min',windowStart:'2026-10-21T23:00:00+08:00',windowEnd:'2026-10-22T06:30:00+08:00'}),s=snap([f]);assert.equal(s.facts.length,1);assert.equal((Date.parse(f.windowEnd!)-Date.parse(f.windowStart!))/60000,450)
})
const run=()=>training({id:'run',sourceRecordId:'run',componentId:'run',modality:'RUN',observedType:'SPRINT',observedTypeBasis:[{id:'run',revision:1}],strengthSets:[],runSegments:[{id:'rep',blockId:'b',roundIndex:1,stepIndex:1,distanceM:200,durationSeconds:28.4,restAfterSeconds:120,rawResolutionSeconds:.1,gradePercent:null,surface:null,completion:'COMPLETED'}]})
test('A08 mixed occurrence has two independent actual components',()=>{const s=snap([training(),run()]);assert.equal(s.facts.length,2);assert.equal(buildMuscleExposure(s).training.length,2)})
test('A09 planned/skipped sets are not completed doses',()=>{
 const t=training({strengthSets:[set(),set({id:'2'}),set({id:'3',completion:'SKIPPED'}),set({id:'4',completion:'NOT_RECORDED'})]});const e=buildMuscleExposure(snap([t]));assert.equal(trainingDose(t).sets,2);assert.equal(trainingDose(t).reps,10);assert.equal(e.regions[0].volumeLoadKgRepsByExercise[0].value,600)
})
test('A10 same sets different kg-rep vectors; no physiological ratio',()=>{
 const a=training({strengthSets:Array.from({length:4},(_,i)=>set({id:String(i),loadKg:60,reps:3}))}),b=training({strengthSets:Array.from({length:4},(_,i)=>set({id:String(i),loadKg:30,reps:12}))});assert.equal(buildMuscleExposure(snap([a])).regions[0].volumeLoadKgRepsByExercise[0].value,720);assert.equal(buildMuscleExposure(snap([b])).regions[0].volumeLoadKgRepsByExercise[0].value,1440)
})
test('A11 2x4 segments preserve decimal seconds, rounds and rest',()=>{
 const t=run(),times=[27.35,27.45,27.55,27.65,27.4,27.5,27.6,27.7];t.runSegments=times.map((d,i)=>({...t.runSegments[0],id:String(i),roundIndex:Math.floor(i/4)+1,stepIndex:i%4+1,durationSeconds:d,restAfterSeconds:i===3?480:120,rawResolutionSeconds:.01}));const s=snap([t]),d=trainingDose(s.facts[0] as any);assert.equal(d.distanceM,1600);assert.ok(Math.abs(d.workSeconds!-220.2)<1e-10);assert.equal((s.facts[0] as any).runSegments[3].restAfterSeconds,480);assert.equal((s.facts[0] as any).runSegments[4].roundIndex,2)
})
test('A12 known run and RDL share regions without common fatigue score',()=>{const r=run();r.runSegments[0].distanceM=360;const t=training({strengthSets:[0,1,2].map(i=>set({id:String(i),loadKg:50,reps:6}))});const e=buildMuscleExposure(snap([r,t])),h=e.regions.find(r=>r.region==='hamstrings')!;assert.equal(h.runDistanceM,360);assert.equal(h.volumeLoadKgRepsByExercise[0].value,900);assert.equal(h.overlapObserved,true);assert.equal(e.isMeasuredMuscleFatigue,false)})
test('A13 unmapped exercise does not fabricate regions or RIR',()=>{const t=training({sessionRpe:7,strengthSets:[set({catalogId:'unknown',rir:null})]}),e=buildMuscleExposure(snap([t]));assert.deepEqual(e.unmappedRefs,['train1']);assert.equal(e.regions.length,0);assert.equal(t.strengthSets[0].rir,null)})
test('A15 wrong direction and numeric delta rejected even with valid refs',()=>{const p=packet([metric({metric:'duration',value:240,unit:'s'})]);assert.equal(validateCoachAnalysisReply(reply({answer:'提高3秒，说明你变快了',factualClaims:[{text:'提高3秒，说明你变快了',refs:[{id:'m1',revision:1}]}]}),p).status,'REJECTED')})
test('A16 high session RPE and typical sleep are not same-fact conflict',()=>{const s=snap([metric({value:8}),training({sessionRpe:9})]);assert.equal(s.conflicts.length,0);assert.equal(evaluateRecoveryEvidence(s).medicalClearance,false)})
test('A17 HRV relative change is descriptive and never prescribes dose',()=>{const a=evaluateRecoveryEvidence(snap([metric({metric:'HRV',value:40,unit:'ms'})]));assert.equal(a.automaticPrescription,false);assert.equal(a.signalState,'INSUFFICIENT')})
test('A18 provider recovery cannot override pain safety',()=>{const a=evaluateRecoveryEvidence(snap([metric({metric:'vendorRecovery',value:95}),response({measure:'PAIN',value:1})]));assert.equal(a.safetyState,'HOLD_ACTIVE');assert.equal(a.candidates[0].kind,'DEFER_AND_REVIEW')})
test('A19 no data gives one decisive first question, no default healthy score',()=>{const a=evaluateRecoveryEvidence(snap([]));assert.equal(a.signalState,'INSUFFICIENT');assert.match(a.missingDecisionInputs[0],/疼痛|功能/);assert.equal(a.candidates[0].kind,'REQUEST_MINIMUM_DATA')})
test('A20 equal set count is not a comparable dose protocol',()=>{
 const common={protocolKey:'RDL',deviceId:'manual-scale',accountRef:'self'};const a=training({...common,strengthSets:[set({loadKg:70,reps:5,rir:1,rangeProtocol:'full'})]}),b=training({...common,strengthSets:[set({loadKg:40,reps:10,rir:4,rangeProtocol:'full'})]});assert.notEqual(responseProtocol(a),responseProtocol(b))
})
const personal=(ts=[training()],rs:ResponseFact[]=[])=>reviewPersonalResponse({context,protocolKey:'RDL',region:'hamstrings',side:'BILATERAL',training:ts,responses:rs,registeredEndpoint:'SELF_REPORTED_SORENESS_ZERO_V1',settingsVersion:'DESCRIPTIVE_1'})
test('A21 no soreness and decreased function remain distinct; never tissue clearance',()=>{const p=personal([training({protocolKey:'RDL'})],[response({value:0}),response({id:'function',sourceRecordId:'function',measure:'FUNCTION',scale:'percent_change',value:-10})]);assert.equal(p.observationCount,2);assert.equal(p.canAuthorizeTraining,false);assert.equal(p.isTissueRecoveryPrediction,false)})
test('A22 interval and right censoring keep non-resolved observations',()=>{
 const t=training({protocolKey:'RDL',startedAt:'2026-10-19T08:00:00Z',occurredAt:'2026-10-19T08:00:00Z'}),r=(h:number,v:number):ResponseFact=>response({id:'r'+h,sourceRecordId:'r'+h,occurredAt:new Date(Date.parse(t.startedAt)+h*3600000).toISOString(),value:v});const p=personal([t],[r(24,4),r(48,0)]);assert.deepEqual(p.timeline[0].endpointInterval,[24,48]);assert.equal(p.estimateInterval,null);const q=personal([t],[r(24,4),r(72,2)]);assert.equal(q.rightCensoredCount,1);assert.equal(q.timeline[0].rightCensoredAt,72)
})
test('A23 revision changes all shared packet identity, preserving earlier asOf',()=>{const old=metric(),updated=metric({revision:2,value:2,knownAt:'2026-10-22T21:00:00Z',receivedAt:'2026-10-22T21:00:00Z'});assert.equal(snap([old,updated]).facts[0].revision,1);assert.notEqual(packet([old]).inputDigest,packet([metric({revision:2,value:2})]).inputDigest)})
test('A24 three followups are one session, intervening training confounds',()=>{
 const t=training({protocolKey:'RDL',startedAt:'2026-10-19T08:00:00Z',occurredAt:'2026-10-19T08:00:00Z'}),rs=[24,48,72].map(h=>response({id:'r'+h,sourceRecordId:'r'+h,occurredAt:new Date(Date.parse(t.startedAt)+h*3600000).toISOString()}));const p=personal([t,training({id:'other',sourceRecordId:'other',canonicalActivityId:'other',protocolKey:'OTHER',occurredAt:'2026-10-20T20:00:00Z',startedAt:'2026-10-20T20:00:00Z'})],rs);assert.equal(p.independentSessionCount,1);assert.equal(p.observationCount,3);assert.equal(p.timeline[0].confounders.length,1)
})
test('A25 fake saved-memory claims rejected without host receipt',()=>{assert.equal(validateCoachAnalysisReply(reply({answer:'已保存你的8小时睡眠',memoryClaim:'HOST_RECEIPT_REQUIRED'}),packet([metric()])).status,'REJECTED')})
test('A26 receivedAt never overwrites measuredAt',()=>{const s=snap([metric({occurredAt:'2026-10-20T08:00:00Z',receivedAt:'2026-10-22T08:00:00Z',knownAt:'2026-10-22T08:00:00Z',providerDate:'2026-10-20'})]);assert.equal(s.facts[0].occurredAt,'2026-10-20T08:00:00Z');assert.match(evaluateRecoveryEvidence(s).observations[0].text,/2026-10-20/)})
test('A28 actual route blocks paid call without trusted authorization',async()=>{const r=await onRequestPost({request:new Request('https://local/api/coach-chat',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env:{}});assert.equal(r.status,503);assert.equal((await r.json()).error,'SERVICE_DISABLED')})
test('A29 changed plan version and executed sessions cannot execute candidate',()=>{const p=packet([response({measure:'PAIN',value:0})]);assert.equal(checkAnalysisCandidate(p,p.allowedCandidateIds[0],{snapshotId:p.snapshotId,planVersion:'P9',confirmed:true,alreadyExecuted:false}).available,false);assert.equal(checkAnalysisCandidate(p,p.allowedCandidateIds[0],{snapshotId:p.snapshotId,planVersion:'P8',confirmed:true,alreadyExecuted:true}).available,false)})
test('A30 explicit canonical choice counts one device; no implicit source choice',()=>{
 const a=run(),b={...run(),id:'other',provider:'COROS' as const,sourceRecordId:'other'};b.runSegments=[{...b.runSegments[0],distanceM:5020}];a.runSegments=[{...a.runSegments[0],distanceM:5000}];assert.equal(snap([a,b]).facts.length,0);const s=projectAnalysisEvidence({context,facts:[a,b],canonicalSelections:[{canonicalActivityId:a.canonicalActivityId,componentId:'run',selectedRef:{id:a.id,revision:a.revision},receiptId:'HOST_CONFIRMED'}]});assert.equal(s.facts.length,1);assert.equal(buildMuscleExposure(s).training[0].dose.distanceM,5000)
})
test('A32 training counterfactual changes exposure; display name is outside evidence contract',()=>{const a=packet([training()]),b=packet([training(),run()]);assert.notEqual(a.inputDigest,b.inputDigest);assert.equal(buildMuscleExposure(snap([training()])).training.length,1);assert.equal(buildMuscleExposure(snap([training(),run()])).training.length,2);assert.equal(analysisDigest(a),analysisDigest(structuredClone(a)))})
