import {test} from 'node:test'
import assert from 'node:assert/strict'
import {adaptTrainingModelInput,trainingModelSummary} from './host'
import {buildTrainingCandidates} from './candidates'
import {fixture,meta} from './test-fixtures'
import {projectAnalysisEvidence} from '../../health/analysis-evidence'
import type {MetricFact} from '../../health/analysis-contract'
const fact=(marker:'LT1_SPEED'|'LT2_SPEED',value:number):MetricFact=>({...meta(marker),sourceRecordId:'lab-report-7',protocolKey:'LAB:4MIN:METHOD_DECLARED',kind:'METRIC',metric:marker,value,unit:'m/s',statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:null,isFinal:true,energyKind:null})
test('existing snapshot explicit lab metrics adapt into paired thresholds; unknown profile stays unknown',()=>{
 const i=fixture();i.snapshot=projectAnalysisEvidence({context:i.context,facts:[fact('LT1_SPEED',3),fact('LT2_SPEED',4)]})
 const a=adaptTrainingModelInput(i.snapshot,null)
 const r=buildTrainingCandidates(a).review
 assert.deepEqual(r.physiology.thresholds.speed?.values,[3,4]);assert.equal(a.profile.eventMeters,null);assert.equal(r.allowTrainingCandidates,false)
 assert.match(trainingModelSummary(r),/LT1/);assert.match(trainingModelSummary(r),/未写入/)
})
test('age max HR and generic 4mmol values never adapt to an individual LT2',()=>{
 const i=fixture();i.snapshot=projectAnalysisEvidence({context:i.context,facts:[{...fact('LT1_SPEED',3),metric:'HRMAX_ESTIMATE'}, {...fact('LT2_SPEED',4),metric:'OBLA4'}]})
 const r=buildTrainingCandidates(adaptTrainingModelInput(i.snapshot,null)).review
 assert.equal(r.physiology.thresholds.speed,null);assert.match(trainingModelSummary(r),/缺/)
})
test('summary preserves method status and never invents a professional capability score',()=>{
 const i=fixture();const r=buildTrainingCandidates(i).review
 assert.equal(r.scientificallyValidated,false);assert.equal(r.planWritten,false);assert.match(trainingModelSummary(r),/双阈值/)
})
