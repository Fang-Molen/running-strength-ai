// @ts-nocheck — 合入包 U12 原测试（纯 JS），逻辑模块本身受类型检查
import test from 'node:test';import assert from 'node:assert/strict'
import {buildMuscleTimeline} from './muscle-timeline-u12.ts'
const now='2026-10-20T22:00:00Z',ago=(h)=>new Date(Date.parse(now)-h*3600000).toISOString()
const run={athleteId:'a',eventId:'run',sourceId:'garmin',occurredAt:ago(18),knownAt:ago(17),actual:'CONFIRMED',modality:'RUN',runType:'INTERVAL',occurrenceId:'v4-19',componentId:'RUN'}
const lift={athleteId:'a',eventId:'lift',sourceId:'phone',occurredAt:ago(17),knownAt:ago(16),actual:'CONFIRMED',modality:'STRENGTH',occurrenceId:'v4-19',componentId:'SQ',exercises:[{catalogId:'back-squat',actualSets:3,verified:true}]}
const pain=(severity,h=3,revision=0,reportId='p')=>({athleteId:'a',reportId,sourceId:'phone',region:'quads',kind:'PAIN',severity,occurredAt:ago(h),knownAt:ago(h),revision,status:'RECORDED'})
const runIt=(parts=[],symptomUpdates=[],asOf=now)=>buildMuscleTimeline({athleteId:'a',asOf,parts,symptomUpdates})
const quad=(v)=>v.regions.find(r=>r.region==='quads')
test('confirmed running and lifting overlap but no fatigue percentage',()=>{const v=runIt([run,lift]);assert.equal(quad(v).state,'OVERLAP_OBSERVED');assert.equal(v.recoveryPercent,null);assert.equal(v.measuredMuscleFatigue,false)})
test('planned training does not become actual exposure',()=>assert.equal(quad(runIt([{...run,actual:'PLANNED'}])).state,'NO_CURRENT_EVIDENCE'))
test('unknown running type does not invent muscle load',()=>assert.equal(quad(runIt([{...run,runType:'UNKNOWN'}])).state,'NO_CURRENT_EVIDENCE'))
test('wrong athlete ignored',()=>assert.equal(quad(runIt([{...run,athleteId:'b'}])).state,'NO_CURRENT_EVIDENCE'))
test('active pain overrides training overlap',()=>assert.equal(quad(runIt([run,lift],[pain(7)])).state,'PAIN_ACTIVE'))
test('36h+ old pain is not assumed healed',()=>assert.equal(quad(runIt([run,lift],[pain(7,40)])).state,'PAIN_RECHECK'))
test('old unresolved pain remains recheck even outside 7d training window',()=>assert.equal(quad(runIt([],[pain(7,240)])).state,'PAIN_RECHECK'))
test('explicit later no-pain report removes active pain but not training exposure',()=>assert.equal(quad(runIt([run,lift],[pain(7,20),pain(0,2,0,'new')])).state,'OVERLAP_OBSERVED'))
test('same report corrected by higher revision supersedes old pain',()=>assert.equal(quad(runIt([run],[pain(7,3,0),pain(0,3,1)])).state,'TRAINING_EXPOSURE'))
test('same revision contradictory report flagged as conflict',()=>assert.equal(quad(runIt([],[pain(7),pain(0)])).state,'SOURCE_CONFLICT'))
test('future-known correction does not rewrite past judgment',()=>{const t=runIt([],[pain(7),{...pain(0),revision:1,knownAt:'2026-10-21T08:00:00Z'}]);assert.equal(quad(t).state,'PAIN_ACTIVE')})
test('stale soreness asks followup, no automatic clearance',()=>{const s={...pain(5,45),kind:'SORENESS',reportId:'s'};assert.equal(quad(runIt([],[s])).state,'SORENESS_RECHECK')})
test('old training exits current 168h view but remains in source input history',()=>assert.equal(quad(runIt([{...run,occurredAt:ago(170),knownAt:ago(169)}])).state,'NO_CURRENT_EVIDENCE'))
test('duplicate import does not duplicate evidence',()=>assert.equal(quad(runIt([run,run])).runCount,1))
test('explicit zero severity is not muscle recovery permission',()=>{const v=runIt([],[pain(0)]);assert.equal(v.autoPlanChange,false);assert.equal(v.recoveryPercent,null)})
test('source fingerprint stable under duplicated identical imports',()=>assert.equal(runIt([run]).sourceFingerprint,runIt([run,run]).sourceFingerprint))
