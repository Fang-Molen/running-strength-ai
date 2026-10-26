import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { buildTrainingCandidates as currentBuilder } from '../../src/lib/coach/training-models/candidates'
import { fixture, meta, threshold } from '../../src/lib/coach/training-models/test-fixtures'
import type { ModelInput } from '../../src/lib/coach/training-models/types'
import type { ResponseFact } from '../../src/lib/health/analysis-contract'

function feedback(measure:ResponseFact['measure'], value:number):ResponseFact {
 return {...meta(measure),occurredAt:'2026-10-23T10:00:00.000Z',knownAt:'2026-10-23T10:01:00.000Z',receivedAt:'2026-10-23T10:01:00.000Z',kind:'RESPONSE',measure,value,scale:measure==='FUNCTION'?'FUNCTION_LIMITATION_0_1':'0-10_HIGH_WORSE',relatedTrainingRefs:[],region:null,side:'UNSPECIFIED',observationProtocol:'current-checkin',elapsedHours:null,functionTaskId:measure==='FUNCTION'?'usual-warmup':null,notes:null}
}
function base():ModelInput {const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)];return i}
const baseline=process.argv.includes('--refresh-before-from-base')
const baselineModule='../../src/lib/coach/training-models/.r6-baseline-candidates.ts'
const buildTrainingCandidates:typeof currentBuilder=baseline?(await import(baselineModule)).buildTrainingCandidates:currentBuilder
function purpose(i:ModelInput,p:'EASY'|'SPEED'){i.sessions[0].purpose=p;const run=i.sessions[0].plan.components[0];if(run.modality==='RUNNING')run.purpose=p==='EASY'?'EASY_AEROBIC':'REPETITION_SPEED'}
function describe(i:ModelInput){const r=buildTrainingCandidates(i);return {methods:r.review.methods.map(m=>({method:m.method,status:m.status,...('dimension' in m?{dimension:m.dimension}:{}),...('conditionalRank' in m?{conditionalRank:m.conditionalRank}:{}),...('candidateAllowed' in m?{candidateAllowed:m.candidateAllowed}:{}),missing:m.missing})),candidates:r.candidates.map(c=>({sessionId:c.sessionId,action:c.action,changedVariable:c.changedVariable,after:c.after,...('risk' in c?{risk:c.risk}:{}),...('observation' in c?{observation:c.observation}:{})})),missing:r.missing,notes:r.review.notes}}
const cases:Record<string,ModelInput>={}
const double=base();double.thresholds=[];Object.assign(double.profile,{experience:'ADVANCED',doubleThresholdExperience:true,lactateMonitoring:true,coachSupervision:true});cases.no_lt2_double=double
const basePhase=base();Object.assign(basePhase.profile,{eventMeters:5000,phase:'BASE'});cases.base_phase=basePhase
const competition=base();Object.assign(competition.profile,{eventMeters:5000,phase:'TAPER',raceDate:'2026-10-26'});cases.competition_phase=competition
for(const eventMeters of [400,800]){const i=base();i.profile.eventMeters=eventMeters;purpose(i,'SPEED');i.sessions=[i.sessions[0],{...structuredClone(i.sessions[0]),id:'strength',purpose:'STRENGTH',plan:{...structuredClone(i.sessions[0].plan),components:[{componentId:'strength',modality:'STRENGTH',strengthSessionId:'existing-strength'}]}}];cases['event_'+eventMeters+'_strength_overlap']=i}
for(const concern of [false,true]){const i=base();purpose(i,'SPEED');i.recovery!.signalState=concern?'MIXED_SIGNALS':'NO_ADVERSE_SIGNAL_OBSERVED';i.snapshot.facts=[feedback('PAIN',0),feedback('FUNCTION',0),feedback('SORENESS',concern?3:0)];cases['same_plan_'+(concern?'fatigued':'stable')]=i}
const pain=base();pain.snapshot.facts=[feedback('PAIN',2),feedback('FUNCTION',0),{...meta('HRV'),occurredAt:'2026-10-23T10:00:00.000Z',knownAt:'2026-10-23T10:01:00.000Z',receivedAt:'2026-10-23T10:01:00.000Z',kind:'METRIC',metric:'HRV',value:65,unit:'ms',statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:null,isFinal:true,energyKind:null}];pain.snapshot.safetyConstraints=[{id:'pain',version:'1',scope:'PAIN',evidenceRefs:[{id:'PAIN',revision:0}]}];cases.normal_hrv_pain=pain
const noHrv=base();purpose(noHrv,'EASY');noHrv.snapshot.facts=[feedback('PAIN',0),feedback('FUNCTION',0),feedback('SORENESS',2)];noHrv.recovery!.signalState='MIXED_SIGNALS';noHrv.recovery!.missingDecisionInputs=['HRV未记录，不补零'];cases.no_hrv_actual_feedback=noHrv
const path=new URL('./model-comparison.json',import.meta.url)
if(process.argv.includes('--capture-before')||baseline){
 if(existsSync(path)&&!baseline)throw Error('BASELINE_ALREADY_CAPTURED')
 const original=baseline&&existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null
 writeFileSync(path,JSON.stringify({base:'50872a8',baselineExecutedAt:new Date().toISOString(),initialBaselineExecutedAt:original?.baselineExecutedAt??null,baselineMethod:baseline?'Executed original 50872a8 selection.ts and candidates.ts via transient sibling modules; component purposes corrected to match declared session purposes.':'Executed before implementation changes.',scientificallyValidated:false,cases:Object.entries(cases).map(([id,input])=>({id,input,before:describe(input)}))},null,2)+'\n')
}else{
 const report=JSON.parse(readFileSync(path,'utf8'))
 report.afterExecutedAt=new Date().toISOString()
 for(const row of report.cases){row.after=describe(row.input);row.changed=JSON.stringify(row.before)!==JSON.stringify(row.after)}
 writeFileSync(path,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({cases:report.cases.length,changed:report.cases.filter((c:{changed:boolean})=>c.changed).length,scientificallyValidated:false}))
}
