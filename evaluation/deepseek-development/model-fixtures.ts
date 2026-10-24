/** Missing synthetic bindings only. Original 60 questions and legacy four fixtures stay byte-identical. */
import type {ABFixture} from './prepare-chain-ab'
import type {TrainingFact,MetricFact,ResponseFact,AnalysisFact} from '../../src/lib/health/analysis-contract'
const asOf='2026-10-19T12:00:00Z'
const meta=(id:string,day='2026-10-18')=>({id,revision:1,athleteId:'synthetic-A',provider:'MANUAL' as const,accountRef:null,deviceId:null,protocolKey:'same-hand-timing-200m-rest120',sourceRecordId:id,occurredAt:day+'T10:00:00Z',knownAt:day+'T11:00:00Z',receivedAt:day+'T11:00:00Z',sourceTimeZone:'UTC',status:'CONFIRMED' as const,quality:'AVAILABLE' as const,ownershipReceiptId:null})
const run=(id:string,seconds:(number|null)[],day='2026-10-18',distance=200,rest=120):TrainingFact=>({...meta(id,day),kind:'TRAINING',canonicalActivityId:id,occurrenceId:id,componentId:'running',modality:'RUN',startedAt:day+'T10:00:00Z',endedAt:null,plannedPurpose:'重复跑原批准协议',observedType:null,observedTypeBasis:[],sessionRpe:null,sessionRpeScale:null,actualDurationSeconds:null,runSegments:seconds.map((durationSeconds,i)=>({id:id+'-'+i,blockId:'main',roundIndex:1,stepIndex:i+1,distanceM:distance,durationSeconds,restAfterSeconds:rest,rawResolutionSeconds:1,gradePercent:null,surface:null,completion:'COMPLETED'})),strengthSets:[],jumpContacts:null})
const metric=(id:string,name:string,value:number|null,unit:string,day='2026-10-18'):MetricFact=>({...meta(id,day),kind:'METRIC',metric:name,value,unit,statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:day,isFinal:true,energyKind:null})
const response=(id:string,related:TrainingFact,value:number,day:string):ResponseFact=>({...meta(id,day),kind:'RESPONSE',relatedTrainingRefs:[{id:related.id,revision:related.revision}],region:null,side:'UNSPECIFIED',measure:'RECOVERY_FEELING',value,scale:'1-10_HIGH_BETTER',observationProtocol:'SELF_REPORT',elapsedHours:null,functionTaskId:null,notes:null})
export function modelFixtures():ABFixture[]{
 const out:ABFixture[]=[]
 const add=(caseId:string,facts:AnalysisFact[],coachContext:Record<string,unknown>={},cutoff=asOf)=>out.push({caseId,facts,coachContext,context:{athleteId:'synthetic-A',asOf:cutoff,timeZone:'UTC',planVersion:'synthetic-approved-plan',consentVersion:'NOT_GRANTED',analysisVersion:'LOGIC_LOAD_1'},provenance:'PUBLIC_SYNTHETIC',frozenVersion:'V89.10.16-PUBLIC-DEVELOPMENT-1',source:'evaluation/deepseek-development/run-local.ts#'+caseId})
 const planned={distanceM:1000,seconds:240,repetitions:4,restSeconds:120}
 add('C02',[{...run('plan-only',[]),status:'PLANNED'}],{coachIntent:'控制节奏，不要求逐组加速',actual:'NOT_RECORDED',planned})
 add('C03',[run('s1',[238,240,241,240],'2026-10-18',1000)],{stage:'基础期',coachIntent:'稳定节奏',planned})
 add('C04',[run('s1',[238,240,241,240],'2026-10-18',1000)],{stage:'备赛期',competitionDate:'2026-10-26',competitionPriority:'A',coachIntent:'保持节奏',planned})
 add('C07',[run('s1',[230,240,250,260],'2026-10-18',1000)],{coachIntent:'控制节奏',planned})
 add('D01',[{...run('s1',[30,31,32]),sessionRpe:7,sessionRpeScale:'CR10'},metric('sleep','sleep',7,'h'),{...metric('hrv-missing','hrv',null,'ms'),quality:'NOT_RECORDED'}])
 const baselines=[10,11,12,13,14].flatMap(d=>['rhr','rmssd'].map(name=>({...metric(name+'-'+d,name,name==='rhr'?50:60,name==='rhr'?'bpm':'ms','2026-10-'+d),provider:'GARMIN' as const,accountRef:'synthetic-watch-account',deviceId:'synthetic-watch-device',ownershipReceiptId:'synthetic-ownership-receipt',protocolKey:'matched-device-A-'+name})))
 add('D04',[...baselines,{...metric('rhr-current','rhr',60,'bpm'),provider:'GARMIN',accountRef:'synthetic-watch-account',deviceId:'synthetic-watch-device',ownershipReceiptId:'synthetic-ownership-receipt',protocolKey:'matched-device-A-rhr'},{...metric('hrv-current','rmssd',48,'ms'),provider:'GARMIN',accountRef:'synthetic-watch-account',deviceId:'synthetic-watch-device',ownershipReceiptId:'synthetic-ownership-receipt',protocolKey:'matched-device-A-rmssd'},run('s1',[30,31,32,33])],{baselineWindow:{startDay:'2026-10-10',endDay:'2026-10-14',complete:true,protocolConfirmed:true}})
 add('D05',[metric('breakfast-only','logged_intake',400,'kcal','2026-10-19')],{dietCoverage:'BREAKFAST_ONLY',dailyTargetKcal:2000,targetIsPlan:true,fullDayIntake:'UNKNOWN'})
 // The original E01 adapter had only two previous courses despite the three-course
 // question. The extra older course below is explicitly NEW PUBLIC SYNTHETIC data.
 add('E01',[run('s3',[30,34,38,42],'2026-10-15'),run('s0',[30,33,36,39],'2026-10-16'),run('s2',[30,32,34,36],'2026-10-17'),run('s1',[30,30,31,30])],{addedBinding:'Third older course is synthetic supplement; no real athlete observations'})
 add('E02',[run('s0',[30,31,32,33],'2026-10-17',200,60),run('s1',[45,46,47,48],'2026-10-18',300,120)])
 add('E03',[run('s1',[30,33])])
 const prior=run('s0',[30,31,32,33],'2026-10-16'),current=run('s1',[30,31,32,33])
 add('E04',[prior,response('recovery-old',prior,3,'2026-10-16'),current,response('recovery-new',current,8,'2026-10-18')],{priorHypothesis:{claim:'近期疲劳影响后程',status:'PENDING',knownAt:'2026-10-16T12:00:00Z'}})
 add('E05',[run('course1',[30],'2026-10-15'),{...run('unfinished',[null],'2026-10-16'),quality:'PARTIAL',runSegments:[{...run('unused',[null]).runSegments[0],completion:'NOT_RECORDED'}]},run('adverse',[35])],{outcomeCoverage:'All three recorded courses retained, including missing result'})
 add('E06',[run('known-v1',[30],'2026-10-09'),{...run('late-correction',[31],'2026-10-09'),knownAt:'2026-10-15T10:00:00Z',receivedAt:'2026-10-15T10:00:00Z'},run('future-result',[26],'2026-10-15')],{predictionModelApproved:false},'2026-10-10T12:00:00Z')
 const mixedRun=run('mixed-run',[30,31]);mixedRun.occurrenceId='mixed-occurrence';mixedRun.canonicalActivityId='mixed-activity'
 const mixedStrength:TrainingFact={...mixedRun,id:'mixed-strength',sourceRecordId:'mixed-strength',componentId:'strength',modality:'STRENGTH',runSegments:[],strengthSets:[1,2].map(n=>({id:'squat-'+n,catalogId:'back-squat',catalogVersion:'U11_1',side:'BILATERAL',loadKg:20,loadBasis:'TOTAL_EXTERNAL',reps:8,holdSeconds:null,setRpe:null,rir:null,effortScale:null,eccentricSeconds:null,rangeProtocol:null,completion:'COMPLETED'}))}
 add('A03',[mixedRun,mixedStrength],{completedComponents:['RUN','STRENGTH'],planIsActual:false})
 const pain=response('pain-walking',mixedRun,4,'2026-10-18');pain.measure='PAIN';pain.scale='0-10_HIGH_WORSE';pain.region='hamstrings';pain.notes='拉伤后走路痛'
 const fn={...pain,id:'function-walking',sourceRecordId:'function-walking',measure:'FUNCTION' as const,value:1,scale:'FUNCTION_LIMITATION_0_1',functionTaskId:'WALKING'}
 add('F03',[pain,fn,metric('watch-readiness','readiness',90,'/100')],{symptoms:'拉伤后走路痛',professionalClearance:'NOT_RECORDED'})
 const e04=out.find(x=>x.caseId==='E04')!;e04.priorHypotheses=[{id:'old-fatigue-hypothesis',athleteId:'synthetic-A',claim:'近期疲劳影响后程',knownAt:'2026-10-16T12:00:00Z',status:'PENDING',supportingRefs:[{id:prior.id,revision:prior.revision},{id:'recovery-old',revision:1}],weakeningRefs:[]}]
 return out
}
export const PAID_SUBSET=['A03','C03','C04','C07','D01','D04','D05','E01','E02','E04','E05','E06','F03'] as const
export const PILOT_CASES=['A03','D04'] as const
