/** STAGE 2 — PREPARED ONLY. Not included in the 134 authorized R173 executions.
 * Synthetic fixtures only. Execute after separate stage-2 test authorization.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ABILITY_METRICS, ABILITY_STANDARD_VERSION, APPROVED_ABILITY_REFERENCES, calculateAbilityMetric, scoreAbilityMeasurement, buildAbilityProfile, compareAbilityMeasurements, abilityGoalProgress, type AbilityMetricRequest, type ApprovedAbilityReference } from './coach-ability-standard.ts'
import { auditPredictionTimeline, reviseHypotheses, type EvidenceDependency } from './coach-development-projection.ts'
import { prepareDeviceActivity, summarizeDevicePreparation, type DecodedDeviceActivity } from './coach-device-preparation.ts'
import { buildOfflineReview } from './coach-offline-loop.ts'
import { evaluateCoachEvolution, type EvolutionEvidence } from './coach-evolution-v4.ts'
import type { QuantDatum, QuantInput } from './coach-quantitative.ts'

const asOf='2026-10-13T23:59:59Z',time='2026-10-10T10:00:00Z',protocol='synthetic-matched-protocol-v1',athleteId='synthetic-athlete'
const datum=(id:string,value:number|null,unit:string,extra:Partial<QuantDatum>={}):QuantDatum=>({id,athleteId,value,unit,sourceIds:['synthetic:'+id],revision:'synthetic-v1',kind:'ACTUAL',at:time,recordedAt:time,protocol,...extra})
const request=(metricId:AbilityMetricRequest['metricId'],values:Record<string,QuantDatum>,conditions:string[]=[],extra:Partial<AbilityMetricRequest>={}):AbilityMetricRequest=>({id:'synthetic:'+metricId,metricId,protocolKey:protocol,input:{athleteId,asOf,values,conditions,conditionSourceIds:['synthetic:protocol-review']},...extra})
const r173=JSON.parse(readFileSync(new URL('./__fixtures__/r173-quantitative.json',import.meta.url),'utf8')) as {ruleId:string;input:QuantInput;expected:{value:number;unit:string}}[]
const reuse=(metricId:AbilityMetricRequest['metricId'],ruleId:string):AbilityMetricRequest=>({id:'synthetic:'+metricId,metricId,protocolKey:protocol,input:structuredClone(r173.find(r=>r.ruleId===ruleId)!.input)})
const structure=(ordinal:number)=>({sessionId:'synthetic-race',componentId:'main',blockId:'main',stepId:'400m',round:1,ordinal})
const cs=reuse('AER01','ABIL_CS');cs.input.conditions=[...cs.input.conditions!,'CS_FIT_REVIEWED']
const strength=reuse('PWR01','STR_E1RM');strength.input.values={...strength.input.values,bodyMassKg:datum('body',70,'kg')};strength.input.conditions=[...strength.input.conditions!,'BODY_MASS_MATCHED_TO_TEST']
const behavior=request('BEH01',{due:datum('due',5,'session',{kind:'PLAN'}),completed:datum('done',3,'session'),skipped:datum('skipped',1,'session'),notRecorded:datum('missing',1,'session')},['DUE_PLAN_REVISION_CONFIRMED','EXECUTION_STATUSES_DISTINCT'])
behavior.input.window={startDay:'2026-10-07',endDay:'2026-10-13',complete:true,sourceIds:['synthetic:window']}
const cases:{request:AbilityMetricRequest;value:number|null;unit:string;components?:number}[]=[
 {request:request('SPD01',{seconds:datum('fly',3,'s',{distanceMeters:30})},['FLYING_30M_CONFIRMED']),value:10,unit:'m/s'},
 {request:request('SPD02',{seconds:datum('accel',5,'s',{distanceMeters:30})},['START_30M_PROTOCOL_CONFIRMED']),value:6,unit:'m/s'},
 {request:request('SPD03',{seconds:datum('race200',25,'s',{distanceMeters:200})},['OFFICIAL_VALID_200M_RESULT']),value:25,unit:'s'},
 {request:request('SEN01',{shortSeconds:datum('r400',60,'s',{distanceMeters:400}),longSeconds:datum('r800',150,'s',{distanceMeters:800})},['OFFICIAL_CONTINUOUS_RESULTS','SAME_SEASON_AND_TIMING']),value:0.8,unit:'ratio'},
 {request:request('SEN02',{shortSeconds:datum('r800',150,'s',{distanceMeters:800}),longSeconds:datum('r1500',300,'s',{distanceMeters:1500})},['OFFICIAL_CONTINUOUS_RESULTS','SAME_SEASON_AND_TIMING']),value:0.9375,unit:'ratio'},
 {request:request('SEN03',{first400:datum('lap1',65,'s',{distanceMeters:400,structure:structure(1)}),last400:datum('lap2',70,'s',{distanceMeters:400,structure:structure(2)})},['SAME_800M_RACE']),value:5,unit:'s'},
 {request:reuse('SEN04','SESS_FADE'),value:-7.6923076923076925,unit:'%'},
 {request:cs,value:4,unit:'m/s'},
 {request:request('AER02',{speed:datum('lt1',3.5,'m/s')},['MEASURED_THRESHOLD_METHOD_RECORDED'],{variant:'LT1'}),value:3.5,unit:'m/s'},
 {request:{...request('AER03',{current:datum('standard-test',1800,'m')},['STANDARDIZED_TEST_DEFINED']),input:{...request('AER03',{}).input,metricUnit:'m',values:{current:datum('standard-test',1800,'m')},conditions:['STANDARDIZED_TEST_DEFINED']}},value:1800,unit:'m'},
 {request:strength,value:1,unit:'ratio'},
 {request:request('PWR02',{height:datum('cmj',32,'cm')},['CMJ_PROTOCOL_CONFIRMED']),value:32,unit:'cm'},
 {request:reuse('PWR03','STR_FREQ_PERIOD'),value:1,unit:'session'},
 {request:request('ECO01',{vo2:datum('oxygen',40,'ml/kg/min'),speedKmh:datum('speed',12,'km/h')},['STEADY_STATE_VO2_VALID','SHOES_GRADE_ENVIRONMENT_RECORDED']),value:200,unit:'ml/kg/km'},
 {request:request('ECO02',{cadence:datum('cadence',170,'steps/min'),groundContactTime:datum('gct',240,'ms')},['MATCHED_SPEED_DEVICE_GRADE']),value:null,unit:'mixed',components:2},
 {request:request('REC01',{sleepHours:datum('sleep',7,'h'),sessionRpe:datum('rpe',0,'/10')}),value:null,unit:'mixed',components:2},
 {request:behavior,value:60,unit:'%'},
]
test('R184-PENDING: all 17 dictionary identities have explicit synthetic references',()=>assert.deepEqual(cases.map(c=>c.request.metricId).sort(),Object.keys(ABILITY_METRICS).sort()))
for(const c of cases)test(`R184-PENDING: ${c.request.metricId} arithmetic, source and no mutation`,()=>{
 const before=JSON.stringify(c.request),result=calculateAbilityMetric(c.request)
 assert.equal(result.status,'RAW_AVAILABLE',result.reasons.join(','));assert.equal(result.unit,c.unit)
 if(c.value===null)assert.equal(result.value,null)
 else assert.ok(Math.abs(result.value!-c.value)<1e-9,`${result.value} !== ${c.value}`)
 if(c.components!==undefined)assert.equal(result.components.length,c.components)
 assert.ok(result.sourceRefs.length);assert.equal(JSON.stringify(c.request),before)
})

test('R184-PENDING: missing, future, other-athlete and plan facts cannot create a flying-speed measurement',()=>{
 for(const mutation of [(d:QuantDatum)=>{d.value=null},(d:QuantDatum)=>{d.recordedAt='2026-10-14T00:00:00Z'},(d:QuantDatum)=>{d.athleteId='synthetic-other'},(d:QuantDatum)=>{d.kind='PLAN'}]){
  const input=structuredClone(cases[0].request);mutation(input.input.values!.seconds!)
  const result=calculateAbilityMetric(input);assert.equal(result.status,'UNAVAILABLE');assert.equal(result.value,null)
 }
})
test('R184-PENDING: no approved norm, no fabricated axis score; behavior and technique stay separate',()=>{
 assert.equal(APPROVED_ABILITY_REFERENCES.length,0)
 const profile=buildAbilityProfile({athleteId,asOf,sport:'800米',populationKey:null,measurements:cases.map(c=>calculateAbilityMetric(c.request))})
 assert.equal(profile.axes.length,5);assert.ok(profile.axes.every(a=>a.score===null));assert.equal(profile.compositeScore,null)
 assert.ok(profile.scores.every(s=>s.score===null));assert.equal(profile.planWrite,false)
 assert.ok(profile.independent.find(d=>d.domain==='BEH')!.measurements.some(m=>m.metricId==='PWR03'))
 assert.ok(profile.independent.find(d=>d.domain==='TECHNIQUE')!.measurements.some(m=>m.metricId==='ECO02'))
})
test('R184-PENDING: approved scoring math has version, population and reliability gates',()=>{
 const m=calculateAbilityMetric(cases[0].request);m.validity='VALID'
 m.reliability={id:'synthetic-error',metricId:'SPD01',protocolKey:protocol,formulaVersion:m.formulaVersion,unit:m.unit,reviewedAt:time,reviewer:'synthetic-reviewer',sourceIds:['synthetic:error-study'],assumptionsReviewed:true,sem:0.1,te:null,swc:null}
 const ref:ApprovedAbilityReference={referenceId:'SYNTHETIC-TEST-ONLY',metricId:'SPD01',variant:null,version:'fixture-v1',formulaVersion:m.formulaVersion,unit:'m/s',protocolKey:protocol,sport:'800米',populationKey:'synthetic-population',direction:'higher',lowAnchor:8,highAnchor:12,approvalStatus:'APPROVED',reviewer:'synthetic-reviewer',approvedAt:time,source:'SYNTHETIC-NOT-A-REAL-NORM',hash:'synthetic-hash'}
 const ctx={athleteId,asOf,sport:'800米',populationKey:'synthetic-population'}
 assert.equal(scoreAbilityMeasurement(m,ref,ctx).score,50)
 assert.equal(scoreAbilityMeasurement(m,{...ref,approvalStatus:'CANDIDATE'},ctx).score,null)
 assert.equal(scoreAbilityMeasurement(m,ref,{...ctx,populationKey:'different'}).score,null)
 assert.equal(scoreAbilityMeasurement(m,ref,{...ctx,expectedReferenceVersion:'new-version'}).score,null)
})
test('R184-PENDING: observed changes need independent same-protocol measurements and fixed prior targets',()=>{
 const prior=calculateAbilityMetric(cases[0].request),current=structuredClone(prior)
 current.id='synthetic-new';current.value=11;current.eventTime='2026-10-11T10:00:00Z';current.recordedAt=current.eventTime
 assert.equal(compareAbilityMeasurements(prior,current,asOf).status,'UNAVAILABLE')
 current.sourceRefs=[{id:'synthetic:new-measurement',revision:'v1',role:'MEASUREMENT'}]
 const diff=compareAbilityMeasurements(prior,current,asOf);assert.equal(diff.delta,1);assert.equal(diff.mdc95,null);assert.equal(diff.beyondMdc,null)
 const target={value:12,version:'target-1',setAt:time,metricId:'SPD01' as const,variant:null,unit:'m/s',protocolKey:protocol}
 assert.equal(abilityGoalProgress(prior,current,target,asOf).rawPercent,50)
 assert.equal(abilityGoalProgress(prior,current,{...target,setAt:'2026-10-12T00:00:00Z'},asOf).rawPercent,null)
})
test('R184-PENDING: partial split arithmetic appears in the local answer, unknown purpose is not inferred',()=>{
 const evidence:EvolutionEvidence[]=[30,33].map((value,i)=>({id:`synthetic-${i}`,sourceId:`synthetic:split-${i}`,athleteId,occurrenceId:'synthetic-session',metric:'SPLIT_SECONDS',value,unit:'s',context:`running:main:rep:block:step:1:${i+1}:200m`,eventAt:time,recordedAt:time,source:'TRAINING_FACT',confirmation:'CONFIRMED'}))
 const snapshot=evaluateCoachEvolution({athleteId,asOf,question:'复盘',evidence,scopeOccurrenceIds:['synthetic-session']})
 const review=buildOfflineReview({snapshot,occurrenceId:'synthetic-session',question:'复盘'})
 assert.equal(review.purpose.purpose,'UNKNOWN');assert.match(review.text,/30秒/);assert.match(review.text,/33秒/)
 assert.equal(review.development!.cycleCandidate.planWrite,false);assert.equal(review.development!.prediction.seconds,null)
 const limited=buildOfflineReview({snapshot,occurrenceId:'synthetic-session',question:'我胸痛且呼吸困难'})
 assert.equal(limited.safetyRestricted,true);assert.equal(limited.development!.cycleCandidate.decision,'HOLD')
})
test('R184-PENDING: a missing source is not a refutation; an explicit source correction withdraws only its dependent hypothesis',()=>{
 const snapshot=evaluateCoachEvolution({athleteId,asOf:time,question:'复盘',evidence:[]})
 const prior=buildOfflineReview({snapshot,occurrenceId:'synthetic-session',question:'复盘'})
 prior.hypotheses=[{id:'synthetic-h',explanation:'synthetic hypothesis',support:['synthetic observation'],against:['synthetic alternative'],sourceIds:['synthetic:old']}]
 const dependency:EvidenceDependency={id:'old',sourceId:'synthetic:old',occurrenceId:'synthetic-session',signature:'synthetic-old',eventAt:time,recordedAt:time}
 prior.development!.dependencies=[dependency]
 const current=structuredClone(prior);current.asOf=asOf;current.development!.dependencies=[]
 assert.equal(reviseHypotheses('prior',prior,current)[0].status,'PENDING')
 current.development!.dependencies=[{...dependency,id:'new',sourceId:'synthetic:new',signature:'synthetic-new'}]
 current.development!.corrections=[{replacedId:'old',replacementId:'new'}]
 assert.equal(reviseHypotheses('prior',prior,current)[0].status,'WITHDRAWN')
 assert.equal(prior.hypotheses.length,1)
})
test('R184-PENDING: future or overlapping prediction evidence never generates a precise result',()=>{
 const result=auditPredictionTimeline({predictionAt:time,trainingCutoff:time,modelApproved:true,validation:{trainEnd:time,holdoutStart:time,holdoutEnd:time,reviewedAt:time,reviewer:'synthetic',modelVersion:'synthetic',approved:true},features:[{eventAt:time,recordedAt:asOf}]})
 assert.equal(result.eligibleForModelReview,false);assert.ok(result.reasons.includes('FUTURE_INFORMATION_LEAKAGE'));assert.equal(result.predictionSeconds,null)
})
test('R184-PENDING: device activities preserve mixed distances, missing laps, raw rest positions and identities',()=>{
 const activity:DecodedDeviceActivity={sourceFileHash:'synthetic-file-hash',activityId:'synthetic-device-activity',sourceId:'synthetic:activity',athleteId,identityConfirmed:true,deviceId:'synthetic-device',protocolKey:protocol,sport:'RUNNING',startedAt:time,recordedAt:time,totalDistanceMeters:null,timerSeconds:null,elapsedSeconds:null,expectedLapOrdinals:[1,2],occurrenceBinding:null,reportedRests:[{seconds:75,scope:'UNLOCATED',afterLapId:null,sourceId:'synthetic:rest',originalText:'synthetic rest'}],laps:[{id:'lap2',ordinal:2,sourceId:'synthetic:lap2',kind:'UNKNOWN',distance:{value:0.45,unit:'km'},timerSeconds:100,elapsedSeconds:102,averageHeartRateBpm:130,maximumHeartRateBpm:150,timingMethod:'synthetic-device-timer',heartRateMethod:'synthetic-wrist-average',structure:null}]}
 const prepared=prepareDeviceActivity(activity,asOf)
 assert.deepEqual(prepared.missingLapOrdinals,[1]);assert.equal(prepared.candidate.runningSegments[0].distanceMeters.value,450)
 assert.equal(prepared.candidate.runningSegments[0].averageHeartRateBpm!.value,130);assert.equal(prepared.candidate.runningSegments[0].recoverySeconds.value,null)
 assert.equal(prepared.raw.laps[0].maximumHeartRateBpm,150);assert.equal(prepared.raw.reportedRests[0].seconds,75)
 assert.equal(prepared.comparisonKey,null);assert.equal(summarizeDevicePreparation([prepared]).confirmedTrainingOccurrenceCount,null)
 assert.equal(prepared.automaticImport,false);assert.equal(prepared.planWrite,false);assert.equal(ABILITY_STANDARD_VERSION,'FK-ABILITY-STD-1.0-ADAPTER-1')
})
