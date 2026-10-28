import test from 'node:test';
import assert from 'node:assert/strict';
import { context, metric, training } from './analysis-fixtures';
import { projectAnalysisEvidence, analysisReference } from './analysis-evidence';
import { descriptiveMetricTrajectory } from './metric-trajectory';
import { evaluateRecoveryEvidence } from './recovery-assessment';
import { buildCoachAnalysisPacket } from './analysis-packet';
import { buildMuscleExposure } from './muscle-exposure';
import type { AnalysisFact, MetricFact } from './analysis-contract';

const asOf='2026-10-28T20:00:00Z';
const sample=(day:string,value:number,patch:Partial<MetricFact>={})=>metric({id:'metric-'+day,sourceRecordId:'metric-'+day,metric:'RMSSD',value,unit:'ms',provider:'GARMIN',accountRef:'synthetic-account',deviceId:'watch-A',protocolKey:'NIGHT_RMSSD_V1',providerDate:day,occurredAt:day+'T08:00:00Z',knownAt:day+'T09:00:00Z',receivedAt:day+'T09:00:00Z',statistic:'DAILY_MEAN',...patch});
const current=sample('2026-10-28',50);
const declining=()=>[sample('2026-08-01',60),sample('2026-08-02',60),sample('2026-10-01',50),sample('2026-10-02',50),current];
const snap=(facts:AnalysisFact[])=>projectAnalysisEvidence({context:{...context,asOf},facts});

test('earlier segment prevents an unchanged rolling median from silently becoming a healthy new normal',()=>{
 const s=snap(declining()),r=analysisReference(s,current),t=descriptiveMetricTrajectory(s,current);
 assert.equal(r.deltaPercent,0);assert.equal(t.earlier?.median,60);assert.equal(t.later?.median,50);
 assert.equal(t.status,'DIRECTIONAL_SHIFT_REVIEW');assert.equal(t.direction,'LOWER');
 assert.equal(t.rule.calibration,'NOT_VALIDATED');assert.equal(t.medicalClearance,false);
 assert.equal(t.earlier?.refs.some(r=>r.id===current.id),false);
});
test('a stable series remains descriptive, while one prior day never becomes a stable baseline',()=>{
 const stable=descriptiveMetricTrajectory(snap(declining().map(f=>({...f,value:50}))),current);
 assert.equal(stable.status,'MULTI_DAY_DESCRIPTIVE');assert.equal(stable.direction,'UNCHANGED');
 const single=descriptiveMetricTrajectory(snap([sample('2026-10-01',60),current]),current);
 assert.equal(single.status,'SINGLE_DAY');assert.equal(single.priorDays,1);assert.equal(single.earlier,null);
 assert.doesNotMatch(single.text,/已恢复正常|稳定正常范围/);
});
test('changed device/protocol has separate source segments, not a synthetic physiological drop',()=>{
 const changed={...current,deviceId:'watch-B',protocolKey:'NIGHT_RMSSD_V2'};
 const result=descriptiveMetricTrajectory(snap([...declining().slice(0,-1),changed]),changed);
 assert.equal(result.priorDays,0);assert.equal(result.status,'SEGMENTED_INSUFFICIENT');assert.equal(result.sourceSegmentCount,2);
 assert.equal(result.direction,'UNKNOWN');assert.match(result.text,/设备|协议/);
});
test('duplicate daily samples do not inflate days, conflicting days are excluded and future/foreign facts cannot enter',()=>{
 const rows=declining(),dup={...rows[0],id:'duplicate',sourceRecordId:'duplicate'};
 const conflict={...rows[1],id:'conflicting',sourceRecordId:'conflicting',value:20};
 const future=sample('2026-10-27',90,{knownAt:'2026-11-01T09:00:00Z',receivedAt:'2026-11-01T09:00:00Z'});
 const t=descriptiveMetricTrajectory(snap([...rows,dup,conflict,future,{...rows[0],athleteId:'OTHER',id:'other'}]),current);
 assert.equal(t.priorDays,3);assert.equal(t.conflictingDays,1);assert.equal(t.earlier,null);
 assert.ok(t.refs.some(r=>r.id==='duplicate'));assert.equal(t.refs.some(r=>r.id==='other'),false);
});
test('source correction changes descriptive version and can withdraw the directional review',()=>{
 const before=descriptiveMetricTrajectory(snap(declining()),current);
 const corrected=declining().map(f=>f.providerDate!.startsWith('2026-08')?{...f,revision:2,value:50,knownAt:'2026-10-27T10:00:00Z',receivedAt:'2026-10-27T10:00:00Z'}:f);
 const after=descriptiveMetricTrajectory(snap(corrected),current);
 assert.notEqual(before.version,after.version);assert.equal(after.status,'MULTI_DAY_DESCRIPTIVE');
});
test('directional observations enter actual assessment and packet but never add a safety hold or change dose',()=>{
 const s=snap(declining()),a=evaluateRecoveryEvidence(s),p=buildCoachAnalysisPacket(s,a,buildMuscleExposure(s),{question:'HRV长期下降如何理解？'});
 assert.ok(a.observations.some(o=>/较早历史段.*较后历史段/.test(o.text)));
 assert.ok(p.assessment.observations.some(o=>/描述性方向变化/.test(o.text)));
 assert.equal(a.safetyState,'UNKNOWN');assert.equal(a.candidates[0].action,'KEEP');assert.equal(a.medicalClearance,false);
 assert.ok(a.hypotheses.some(h=>/历史参照/.test(h.claim)));
 assert.ok(a.hypotheses.some(h=>/可比.*表现|功能/.test(h.discriminator)));
});
test('known pain remains active independently of a stable metric series',()=>{
 const s=snap(declining().map(f=>({...f,value:50})));s.safetyConstraints=[{id:'medical',version:'1',scope:'PAIN_REVIEW',evidenceRefs:[]}];
 const a=evaluateRecoveryEvidence(s);assert.equal(a.safetyState,'HOLD_ACTIVE');assert.equal(a.candidates[0].action,'SKIP');
});
test('stable comparable execution is retained as counterevidence, not ignored to force a fatigue explanation',()=>{
 const runs=['2026-10-25','2026-10-26','2026-10-27'].map(day=>training({id:'run-'+day,sourceRecordId:'run-'+day,canonicalActivityId:'run-'+day,occurrenceId:'run-'+day,componentId:'run',modality:'RUN',provider:'MANUAL',accountRef:null,deviceId:'manual-stopwatch',protocolKey:'TRACK_400',plannedPurpose:'EASY_TECHNIQUE',observedType:'INTERVAL',occurredAt:day+'T10:00:00Z',startedAt:day+'T10:00:00Z',knownAt:day+'T11:00:00Z',receivedAt:day+'T11:00:00Z',sessionRpe:4,sessionRpeScale:'CR10',strengthSets:[],runSegments:[{id:'one',blockId:'work',roundIndex:1,stepIndex:1,kind:'REPETITION',distanceM:400,durationSeconds:100,restAfterSeconds:120,restScope:'AFTER_REPEAT',rawResolutionSeconds:1,gradePercent:0,surface:'TRACK',completion:'COMPLETED'}]}));
 const a=evaluateRecoveryEvidence(snap([...declining(),...runs]));
 const review=a.hypotheses.find(h=>h.id==='metric-history-review');assert.ok(review);
 assert.ok(review.weakeningRefs.some(r=>r.id.startsWith('run-')));assert.match(review.discriminator,/稳定.*削弱|削弱.*稳定/);
});
