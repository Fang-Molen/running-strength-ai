import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, meta, threshold, performance } from './test-fixtures'
import type { PlannedModelSession } from './types'
import type { ResponseFact } from '../../health/analysis-contract'
import { buildTrainingCandidates } from './candidates'
import { selectTrainingModels } from './selection'
import { TRAINING_MODEL_EVIDENCE, TRAINING_MODEL_KNOWLEDGE_VERSION } from './evidence'
import { TRAINING_DECISION_KNOWLEDGE } from './knowledge'

function input(){const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)];return i}
function response(measure:ResponseFact['measure'],value:number):ResponseFact {
 return {...meta(measure),occurredAt:'2026-10-23T10:00:00.000Z',knownAt:'2026-10-23T10:01:00.000Z',receivedAt:'2026-10-23T10:01:00.000Z',kind:'RESPONSE',measure,value,scale:measure==='FUNCTION'?'FUNCTION_LIMITATION_0_1':'0-10_HIGH_WORSE',relatedTrainingRefs:[],region:'calves',side:'BILATERAL',observationProtocol:'usual-checkin',elapsedHours:null,functionTaskId:measure==='FUNCTION'?'usual-warmup':null,notes:null}
}
function purpose(s:PlannedModelSession,p:PlannedModelSession['purpose']){s.purpose=p;const run=s.plan.components[0];if(run.modality==='RUNNING')run.purpose=p==='EASY'?'EASY_AEROBIC':p==='SPEED'?'REPETITION_SPEED':'TEMPO_THRESHOLD'}

test('R6 compares distribution, organization and event separately; compatible double and polarized coexist',()=>{
 const i=input();Object.assign(i.profile,{experience:'ADVANCED',doubleThresholdExperience:true,lactateMonitoring:true,coachSupervision:true,twoSessionsAvailable:true})
 i.sessions=[i.sessions[0],{...structuredClone(i.sessions[0]),id:'second-threshold'}]
 const r=selectTrainingModels(i)
 assert.deepEqual(r.dimensions.distribution.map(m=>m.method),['PYRAMIDAL','POLARIZED','THRESHOLD_ORIENTED'])
 assert.deepEqual(r.dimensions.organization.map(m=>m.method),['SINGLE_THRESHOLD','DOUBLE_THRESHOLD','BLOCK'])
 assert.equal(r.dimensions.organization.find(m=>m.method==='DOUBLE_THRESHOLD')!.candidateAllowed,true)
 assert.equal(r.dimensions.distribution.find(m=>m.method==='POLARIZED')!.candidateAllowed,true)
 assert.equal(r.preferredMethod,null);assert.equal(r.ranking.universalBest,false)
 for(const m of r.methods){assert.ok(m.support.length);assert.ok(m.limits.length);assert.ok(m.applicability.length);assert.deepEqual(m.keyMissing,m.missing);assert.equal(m.conditionalRank.withinDimension,m.dimension)}
})
test('R6 no LT2 cannot be filled with CS or VDOT to admit double threshold or a threshold dose',()=>{
 const i=input();i.thresholds=[threshold('LT1',3)];Object.assign(i.profile,{experience:'ADVANCED',doubleThresholdExperience:true,lactateMonitoring:true,coachSupervision:true,twoSessionsAvailable:true})
 i.performances=[performance('1',1000,180),performance('2',2000,400),performance('3',3000,620),performance('5k',5000,1000)]
 const r=buildTrainingCandidates(i)
 assert.ok(r.review.physiology.vdot);assert.equal(r.review.physiology.thresholds.allPairs.length,0)
 assert.equal(r.review.methods.find(m=>m.method==='DOUBLE_THRESHOLD')!.candidateAllowed,false)
 assert.ok(r.candidates.every(c=>c.after===null));assert.ok(r.missing.some(m=>m.includes('阈值')))
})
test('R6 conditional discussion order changes near competition without promising a best method',()=>{
 const i=input();i.profile.phase='BASE';i.profile.eventMeters=5000
 const base=selectTrainingModels(i).methods.find(m=>m.method==='PYRAMIDAL')!
 i.profile.phase='TAPER';i.profile.raceDate='2026-10-26'
 const taper=selectTrainingModels(i).methods.find(m=>m.method==='PYRAMIDAL')!
 assert.equal(base.conditionalRank.priority,'CONSIDER_FIRST');assert.equal(taper.conditionalRank.priority,'COMPARE')
 assert.notEqual(base.conditionalRank.reason,taper.conditionalRank.reason);assert.equal(taper.status,'CONDITIONAL')
})
test('R6 event needs distinguish 400, 800, 1500 and long distance; strength overlap remains explicit',()=>{
 const descriptions=new Set<string>()
 for(const [eventMeters,eventFocus] of [[400,'400'],[800,'800'],[1500,'1500'],[5000,'LONG_DISTANCE']] as const){
  const i=input();i.profile.eventMeters=eventMeters;purpose(i.sessions[0],'SPEED');i.sessions=[i.sessions[0],{...structuredClone(i.sessions[0]),id:'strength',purpose:'STRENGTH'}]
  const r=selectTrainingModels(i);assert.equal(r.eventFocus,eventFocus);descriptions.add(r.eventPriorities.join('|'))
  assert.ok(r.notes.some(n=>n.includes('同日力量')));assert.equal(r.physiology.eventProfile.predicted400Seconds,null)
 }
 assert.equal(descriptions.size,4)
})
test('R6 same soreness and normal function permits familiar easy discussion but defers maximum-speed intensity',()=>{
 const i=input();i.recovery!.signalState='MIXED_SIGNALS';i.snapshot.facts=[response('PAIN',0),response('FUNCTION',0),response('SORENESS',2)]
 purpose(i.sessions[0],'EASY');const easy=buildTrainingCandidates(i)
 purpose(i.sessions[0],'SPEED');const speed=buildTrainingCandidates(i)
 assert.ok(easy.candidates.some(c=>c.action==='KEEP'&&c.after!==null))
 assert.ok(speed.candidates.every(c=>c.after===null));assert.equal(speed.review.purposeReadiness[0].allowReduce,false)
 assert.ok(speed.candidates.length>=2&&speed.candidates.length<=3)
})
test('R6 identical plans with different actual responses produce different candidates',()=>{
 const stable=input();purpose(stable.sessions[0],'SPEED');stable.snapshot.facts=[response('PAIN',0),response('FUNCTION',0),response('SORENESS',0)]
 const fatigued=structuredClone(stable);fatigued.recovery!.signalState='MIXED_SIGNALS';fatigued.snapshot.facts=[response('PAIN',0),response('FUNCTION',0),response('SORENESS',3)]
 assert.ok(buildTrainingCandidates(stable).candidates.some(c=>c.action==='KEEP'))
 assert.ok(buildTrainingCandidates(fatigued).candidates.every(c=>c.after===null))
})
test('R6 current pain or limited function dominates a positive HRV/assessment and medical holds never clear',()=>{
 for(const trigger of ['pain','function','medical'] as const){
  const i=input();purpose(i.sessions[0],'EASY');i.snapshot.facts=[response('PAIN',trigger==='pain'?2:0),response('FUNCTION',trigger==='function'?1:0)]
  i.snapshot.facts.push({...meta('HRV'),kind:'METRIC',metric:'HRV',value:65,unit:'ms',statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:null,isFinal:true,energyKind:null})
  if(trigger==='medical')i.snapshot.safetyConstraints.push({id:'medical-restriction',version:'1',scope:'MEDICAL',evidenceRefs:[]})
  const r=buildTrainingCandidates(i);assert.ok(r.candidates.every(c=>c.after===null));assert.equal(r.review.allowTrainingCandidates,false)
  assert.ok(r.review.methods.every(m=>m.status==='HOLD'));assert.equal(r.review.purposeReadiness[0].medicalClearance,false)
 }
})
test('R6 missing HRV does not block adequate actual feedback, while stale or foreign feedback cannot fill gaps',()=>{
 const i=input();purpose(i.sessions[0],'EASY');i.recovery!.signalState='MIXED_SIGNALS';i.recovery!.missingDecisionInputs=['HRV未记录，不补零']
 i.snapshot.facts=[response('PAIN',0),response('FUNCTION',0),response('SORENESS',2)]
 assert.ok(buildTrainingCandidates(i).candidates.some(c=>c.action==='KEEP'))
 i.snapshot.facts=i.snapshot.facts.map(r=>({...r,athleteId:'someone-else'}))
 assert.ok(buildTrainingCandidates(i).candidates.every(c=>c.after===null))
 i.snapshot.facts=[response('PAIN',0),response('FUNCTION',0)].map(r=>({...r,occurredAt:'2026-10-20T10:00:00.000Z'}))
 assert.ok(buildTrainingCandidates(i).candidates.every(c=>c.after===null))
})
test('R6 purpose label cannot downgrade saved threshold or speed execution to easy',()=>{
 const i=input();i.sessions[0].purpose='EASY';i.snapshot.facts=[response('PAIN',0),response('FUNCTION',0)]
 const r=buildTrainingCandidates(i);assert.ok(r.candidates.every(c=>c.after===null));assert.ok(r.missing.some(m=>m.includes('目的与保存')))
})
test('R6 insufficient current feedback never allows reduction at preserved speed',()=>{
 const i=input();purpose(i.sessions[0],'SPEED');i.recovery!.signalState='INSUFFICIENT'
 const r=buildTrainingCandidates(i);assert.ok(r.candidates.every(c=>c.after===null));assert.ok(r.missing.some(m=>m.includes('实际反馈不足')))
})
test('R6 candidates preserve input, carry risk and observation, and alter one repeat variable only',()=>{
 const i=input(),before=structuredClone(i),r=buildTrainingCandidates(i)
 assert.deepEqual(i,before);assert.ok(r.candidates.length>=2&&r.candidates.length<=3)
 for(const c of r.candidates){assert.ok(c.risk);assert.ok(c.observation);assert.ok(c.supportsWhen);assert.ok(c.weakensWhen);assert.equal(c.knowledgeVersion,TRAINING_MODEL_KNOWLEDGE_VERSION)}
 const reduced=r.candidates.find(c=>c.action==='REDUCE')!,expected=structuredClone(i.sessions[0].plan),run=expected.components[0]
 assert.equal(run.modality,'RUNNING');if(run.modality!=='RUNNING'||run.structure.kind!=='REPEATED')return assert.fail()
 run.structure.blocks[0].steps[0].repeatCount--
 assert.deepEqual(reduced.after,expected);assert.equal(r.planWritten,false)
})
test('R6 evidence policy preserves original provenance and separates principles, calculations, hypotheses and research',()=>{
 assert.equal(TRAINING_MODEL_EVIDENCE.length,10)
 for(const source of TRAINING_MODEL_EVIDENCE){assert.equal(source.version,TRAINING_MODEL_KNOWLEDGE_VERSION);assert.ok(source.population);assert.ok(source.method);assert.ok(source.applicableConditions.length);assert.ok(source.supportedConclusions.length);assert.ok(source.limitations.length);assert.equal(source.source.checkedOn,source.verification.checkedOn);assert.equal(source.prescriptionPermission.allowsAutomaticPrescription,false)}
 assert.deepEqual(new Set(TRAINING_DECISION_KNOWLEDGE.map(k=>k.permission)),new Set(['PRINCIPLE','VERIFIED_CALCULATION','ATHLETE_HYPOTHESIS','RESEARCH_ONLY']))
 const r=selectTrainingModels(input());assert.equal(r.evidencePolicy.scientificallyValidated,false);assert.equal(r.methods.find(m=>m.method==='BLOCK')!.candidateAllowed,false)
})
