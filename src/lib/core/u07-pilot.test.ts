import test from 'node:test'
import assert from 'node:assert/strict'
import {projectPilotHealth,buildIntradayCurve,projectPilotRecoveryMessage,inspectPlanMutationGate,pilotInbox,guardLegacyRecoveryVerdict} from './u07-pilot.ts'
import type {HealthSnapshot,HealthMetricView} from '../health/snapshot'
import type {FatigueReview} from '../health/analysis'
import type {PlanHostContext} from './coach-plan-execution'

const now='2026-10-20T08:00:00Z'
const fatigue=(state:FatigueReview['state']='INSUFFICIENT'):FatigueReview=>({ruleStatus:'RESEARCH_CANDIDATE',automaticPrescription:false,state,title:'',signals:[],excluded:[],action:'',followup:'',diagnosis:false,planChanged:false})
function metric(metric:string,opts:{value?:number;statistic?:string;measuredAt?:string|null;state?:HealthMetricView['state'];source?:string}={}):HealthMetricView{
 const state=opts.state??'AVAILABLE';const value=opts.value??55
 const point={id:'e1',metric,day:'2026-10-20',value,source:opts.source??'Garmin',stream:'garmin:hash',statistic:opts.statistic??'最近观测值',method:'',updatedAt:now,measuredAt:opts.measuredAt===undefined?'2026-10-20T07:55:00Z':opts.measuredAt,legacy:false}
 return {metric,label:metric,state,current:state==='MISSING'||state==='CONFLICT'?null:point,candidates:[],series:[],availableSources:[],selectedSource:null,baseline:null,notes:[]}
}
const snapshot=(metrics:HealthMetricView[],unreadable=false):HealthSnapshot=>({asOf:'2026-10-20',metrics,unreadable})
const point=(overrides:Record<string,unknown>={})=>({athleteId:'a',metric:'HEART_RATE',kind:'INTRADAY_SAMPLE',sourceId:'watch1',eventId:'1',revision:'1',value:67,measuredAt:'2026-10-20T07:00:00Z',knownAt:'2026-10-20T07:01:00Z',...overrides}) as any
const curve=(points:any[],metric:'HEART_RATE'|'BODY_BATTERY'='HEART_RATE')=>buildIntradayCurve({athleteId:'a',metric,asOf:now,points})

test('daily max body battery is not current',()=>{const r=projectPilotHealth(snapshot([metric('BODY_BATTERY',{value:90,statistic:'当日最高'})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='BODY_BATTERY')?.currentValue,false);assert.equal(r.trainingClearance,false)})
test('old body battery observation not current',()=>{const r=projectPilotHealth(snapshot([metric('BODY_BATTERY',{measuredAt:'2026-10-20T07:00:00Z'})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='BODY_BATTERY')?.currentValue,false)})
test('recent body battery observation can be shown with measurement time',()=>{const r=projectPilotHealth(snapshot([metric('BODY_BATTERY')]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='BODY_BATTERY')?.currentValue,true)})
test('daily summary with unknown measurement time not current',()=>{const r=projectPilotHealth(snapshot([metric('BODY_BATTERY',{measuredAt:null})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='BODY_BATTERY')?.currentValue,false)})
test('stale body battery is not current',()=>{const r=projectPilotHealth(snapshot([metric('BODY_BATTERY',{state:'STALE'})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='BODY_BATTERY')?.currentValue,false)})
test('unreadable source is error not missing or zero',()=>{const r=projectPilotHealth(snapshot([metric('RHR')],true),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='RHR')?.state,'SOURCE_ERROR');assert.equal(r.metrics.find(x=>x.metric==='RHR')?.value,null)})
test('conflicting source remains conflict',()=>{const r=projectPilotHealth(snapshot([metric('HRV',{state:'CONFLICT'})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='HRV')?.state,'CONFLICT')})
test('future measurement cannot be shown as valid',()=>{const r=projectPilotHealth(snapshot([metric('RHR',{measuredAt:'2026-10-20T09:00:00Z'})]),fatigue(),now);assert.equal(r.metrics.find(x=>x.metric==='RHR')?.state,'UNVERIFIED_TIME')})
test('no input yields invalid and never clearance',()=>{const r=projectPilotHealth(null as any,fatigue(),now);assert.equal(r.status,'INVALID_INPUT');assert.equal(r.trainingClearance,false)})
test('daily summary is never converted into a curve',()=>{const r=curve([point({kind:'DAILY_SUMMARY'}),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',kind:'DAILY_SUMMARY'})]);assert.equal(r.status,'UNAVAILABLE')})
test('one actual sample is insufficient for curve',()=>assert.equal(curve([point()]).status,'UNAVAILABLE'))
test('two actual samples give exact non-interpolated points',()=>{const r=curve([point(),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z',value:79})]);assert.equal(r.status,'AVAILABLE');assert.deepEqual(r.points.map(p=>p.value),[67,79])})
test('two sources do not get merged into a fake single curve',()=>{const r=curve([point(),point({sourceId:'watch2',eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z'})]);assert.equal(r.status,'CONFLICT')})
test('other athlete points are excluded',()=>{const r=curve([point(),point({athleteId:'b',eventId:'2',measuredAt:'2026-10-20T07:30:00Z'})]);assert.equal(r.status,'UNAVAILABLE')})
test('future knownAt samples are excluded',()=>{const r=curve([point(),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T09:00:00Z'})]);assert.equal(r.status,'UNAVAILABLE')})
test('bad date samples are excluded',()=>{const r=curve([point(),point({eventId:'2',measuredAt:'2026-02-30T07:30:00Z'})]);assert.equal(r.status,'UNAVAILABLE')})
test('same event latest revision replaces earlier event without double counting',()=>{const r=curve([point(),point({revision:'2',value:68,knownAt:'2026-10-20T07:02:00Z'}),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z'})]);assert.equal(r.status,'AVAILABLE');assert.equal(r.points.length,2);assert.equal(r.points[0].value,68)})
test('same revision contradictory values block curve',()=>{const r=curve([point(),point({value:99}),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z'})]);assert.equal(r.status,'CONFLICT')})
test('body battery out-of-range samples excluded',()=>{const r=curve([point({metric:'BODY_BATTERY',value:110}),point({metric:'BODY_BATTERY',eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z'})],'BODY_BATTERY');assert.equal(r.status,'UNAVAILABLE')})
test('no new fatigue score or plan write',()=>{const r=projectPilotRecoveryMessage(fatigue('NO_ADVERSE_SIGNAL'),false);assert.equal(r.trainingClearance,false);assert.equal(r.planWrite,false)})
test('pain overrides otherwise favorable summary',()=>{const r=projectPilotRecoveryMessage(fatigue('NO_ADVERSE_SIGNAL'),true);assert.equal(r.status,'SAFETY_REVIEW')})
test('V87 local incomplete calendar blocks mutation even if confirmed',()=>{const host={actor:{scope:'LOCAL_DEVICE_ONLY'},readState:'AVAILABLE',calendarCoverage:'UNKNOWN',persistenceBoundary:'UNCOORDINATED',safety:'UNKNOWN'} as PlanHostContext;const r=inspectPlanMutationGate(host,true);assert.equal(r.pilotAllowsWrite,false);assert.ok(r.reasons.includes('CALENDAR_INCOMPLETE'));assert.ok(r.reasons.includes('WRITE_BOUNDARY_UNCOORDINATED'))})
test('even host with coordinated local boundary cannot get pilot write permission',()=>{const host={actor:{scope:'LOCAL_DEVICE_ONLY'},readState:'AVAILABLE',calendarCoverage:'COMPLETE',persistenceBoundary:'COORDINATED_LOCAL',safety:'ALLOW_DATE_MOVE'} as PlanHostContext;assert.equal(inspectPlanMutationGate(host,true).pilotAllowsWrite,false)})
test('safety review is not hidden by declined, seen, or quiet',()=>{const tasks=[{athleteId:'a',eventKey:'pain',revision:'2',kind:'SAFETY_REVIEW',material:true}] as const;const key=JSON.stringify(['a','pain','2']);const r=pilotInbox({athleteId:'a',tasks:[...tasks],declined:[key],seen:[key],quiet:true});assert.equal(r.primary?.kind,'SAFETY_REVIEW');assert.equal(r.primary?.channel,'IN_APP_ONLY')})
test('duplicate informational prompt collapses',()=>{const task={athleteId:'a',eventKey:'sync',revision:'1',kind:'INFO_UPDATE',material:true} as const;const r=pilotInbox({athleteId:'a',tasks:[task,task]});assert.ok(r.primary);assert.equal(r.queued.length,0)})
test('safety replaces duplicate lower-priority event',()=>{const base={athleteId:'a',eventKey:'k',revision:'1',material:true} as const;const r=pilotInbox({athleteId:'a',tasks:[{...base,kind:'INFO_UPDATE'},{...base,kind:'SAFETY_REVIEW'}]});assert.equal(r.primary?.kind,'SAFETY_REVIEW')})
test('quiet ordinary prompts are queued',()=>{const r=pilotInbox({athleteId:'a',quiet:true,tasks:[{athleteId:'a',eventKey:'x',revision:'1',kind:'RECOVERY_CHANGE',material:true}]});assert.equal(r.primary,null);assert.equal(r.queued.length,1)})
test('cross-athlete task cannot enter inbox',()=>{const r=pilotInbox({athleteId:'a',tasks:[{athleteId:'b',eventKey:'x',revision:'1',kind:'SAFETY_REVIEW',material:true}]});assert.equal(r.primary,null);assert.deepEqual(r.ignored,['WRONG_SCOPE'])})

const blankRecovery={readiness:null,bodyBattery:null,sleepH:null,sleepBase:null,hrv:null,hrvBase:null,rhr:null,rhrBase:null,subjective:null,stress:null}
test('legacy battery-only GO is downgraded to insufficient observation',()=>{const r=guardLegacyRecoveryVerdict({...blankRecovery,bodyBattery:90},{level:'go',title:'适合正常训练',reasons:[],note:''});assert.equal(r.status,'INSUFFICIENT');assert.equal(r.trainingClearance,false)})
test('legacy battery-only REDUCE is not treated as prescription',()=>{const r=guardLegacyRecoveryVerdict({...blankRecovery,bodyBattery:20},{level:'reduce',title:'建议降强度',reasons:[],note:''});assert.equal(r.status,'INSUFFICIENT');assert.equal(r.planWrite,false)})
test('legacy sharp pain remains safety review even with high battery',()=>{const r=guardLegacyRecoveryVerdict({...blankRecovery,bodyBattery:95,pain:'sharp'},{level:'go',title:'适合正常训练',reasons:[],note:''});assert.equal(r.status,'SAFETY_REVIEW')})

test('later sync cannot silently change a value under same revision',()=>{const r=curve([point(),point({value:99,knownAt:'2026-10-20T07:02:00Z'}),point({eventId:'2',measuredAt:'2026-10-20T07:30:00Z',knownAt:'2026-10-20T07:31:00Z'})]);assert.equal(r.status,'CONFLICT')})
