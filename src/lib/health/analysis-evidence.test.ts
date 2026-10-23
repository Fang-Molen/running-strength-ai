import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAnalysisEvidence } from './analysis-evidence'
import { buildMuscleExposure } from './muscle-exposure'
import { evaluateRecoveryEvidence } from './recovery-assessment'
import type { Context, MetricFact, TrainingFact, StrengthSet } from './analysis-contract'
import {context,metric,training,set} from './analysis-fixtures'
test('T1 future correction excluded; retraction never resurrects older revision',()=>{
 const facts=[metric(),metric({revision:2,value:8,knownAt:'2026-10-22T21:00:00Z',receivedAt:'2026-10-22T21:00:00Z'})]
 assert.equal((projectAnalysisEvidence({context,facts}).facts[0] as MetricFact).value,6)
 assert.equal(projectAnalysisEvidence({context,facts:[metric(),metric({revision:2,status:'RETRACTED'})]}).facts.length,0)
})
test('T1 source and athlete isolated, same revision conflict withheld',()=>{
 const s=projectAnalysisEvidence({context,facts:[metric(),metric({value:8}),metric({athleteId:'SYN-B'})]})
 assert.equal(s.facts.length,0);assert.equal(s.conflicts.length,1)
})
test('T2 mixed occurrence retains two components; precise segments and independent dimensions',()=>{
 const run=training({id:'run1',sourceRecordId:'run1',componentId:'run',modality:'RUN',observedType:'SPRINT',observedTypeBasis:[{id:'run1',revision:1}],strengthSets:[],runSegments:[{id:'r1',blockId:'b1',roundIndex:1,stepIndex:1,distanceM:200,durationSeconds:28.4,restAfterSeconds:120,rawResolutionSeconds:.1,gradePercent:null,surface:null,completion:'COMPLETED'}]})
 const s=projectAnalysisEvidence({context,facts:[training(),run]});assert.equal(s.facts.length,2)
 const e=buildMuscleExposure(s),h=e.regions.find(x=>x.region==='hamstrings')!
 assert.equal(h.runDistanceM,200);assert.equal(h.runWorkSeconds,28.4);assert.equal(h.volumeLoadKgRepsByExercise[0].value,300);assert.equal(h.overlapObserved,true)
 assert.equal(e.isMeasuredMuscleFatigue,false)
})
test('T3 unknown is insufficient; unrelated directions do not create data conflict',()=>{
 const a=evaluateRecoveryEvidence(projectAnalysisEvidence({context,facts:[]}));assert.equal(a.signalState,'INSUFFICIENT');assert.equal(a.safetyState,'UNKNOWN')
 const s=projectAnalysisEvidence({context,facts:[metric({value:8}),training({sessionRpe:9,sessionRpeScale:'CR10'})]})
 assert.equal(s.conflicts.length,0);assert.notEqual(evaluateRecoveryEvidence(s).dataQuality,'CONFLICT')
})
