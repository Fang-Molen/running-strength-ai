import test from 'node:test';import assert from 'node:assert/strict';
import {groupCalibration,strictBlindCompare,proposeRuleReview,type EvaluatedCase} from './coach-p7-evaluation.ts';
const make=(actor:EvaluatedCase['actor'],error:number,source='o1',athlete='a'):EvaluatedCase=>({athleteId:athlete,caseId:'c1',metricId:'800m',protocolKey:'electronic',unit:'s',decisionAt:'2026-01-01T00:00:00Z',outcomeAt:'2026-01-02T00:00:00Z',actor,outcomeSourceId:source,outcomeSourceRevision:'v1',result:{decisionId:actor+athlete+source,state:'EVALUABLE',error,absoluteError:Math.abs(error),reason:'MATCHED'}});
test('strict blind matching requires exact same outcome source',()=>{
 assert.equal(strictBlindCompare([make('FANGKUN',1),make('HUMAN_COACH',3,'o2')]).pairs,0);
 const v=strictBlindCompare([make('FANGKUN',1),make('HUMAN_COACH',3)]);
 assert.equal(v.pairs,1);assert.equal(v.meanAbsoluteErrorDifference,-2);assert.equal(v.superiorityEstablished,false);
});
test('grouped calibration retains units and excludes invalid cases',()=>{
 const bad={...make('FANGKUN',1),result:{...make('FANGKUN',1).result,state:'INCONCLUSIVE' as const,error:null,absoluteError:null}};
 const v=groupCalibration([make('FANGKUN',2),bad]);assert.equal(v[0].n,1);assert.equal(v[0].excluded,1);assert.equal(v[0].mae,2);
});
test('proposals never automatically approve rules',()=>{
 assert.equal(proposeRuleReview({id:'x',ruleId:'r',reason:'error',proposal:'review',supportingCaseIds:['c'],counterEvidenceCaseIds:[],sourceVersions:['v']})?.automaticApproval,false);
 assert.equal(proposeRuleReview({id:'x',ruleId:'r',reason:'error',proposal:'review',supportingCaseIds:[],counterEvidenceCaseIds:[],sourceVersions:['v']}),null);
});
