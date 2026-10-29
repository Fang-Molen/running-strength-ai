import test from 'node:test';import assert from 'node:assert/strict';
import {buildAnswerEvidenceState} from './answer-evidence';
import {contextModelQuote,type CoachRequestContext} from './online-contract';
const context:CoachRequestContext={version:'coach-context-v2',dependencyVersions:[],coverage:{selected:1,omitted:0,unknowns:[]},records:[{recordId:'pain',revision:'1',category:'RECOVERY',state:'ACTUAL',source:'USER_DECLARED:MANUAL',occurredAt:'2026-10-29T00:00:00Z',knownAt:'2026-10-29T01:00:00Z',fields:[{name:'measure',value:'PAIN',unit:null},{name:'notes',value:'右小腿酸痛；睡眠未记录',unit:null}]}]};
test('symptoms and caution never become declared medical restriction or denied clearance',()=>{
 const s=buildAnswerEvidenceState('最近恢复怎样？',context);
 assert.equal(s.clearance,'UNKNOWN');assert.equal(s.coverage,'UNKNOWN');assert.equal(s.declaredRestrictions.length,0);assert.equal(s.symptomReports.length,1);assert.ok(s.systemCautions.length);
});
test('coverage unknown and explicitly missing remain distinct; legacy false is not denied permission',()=>{
 assert.equal(buildAnswerEvidenceState('记录完整吗？',context).coverage,'UNKNOWN');
 assert.equal(buildAnswerEvidenceState('我确认漏记了六月的训练，记录完整吗？',context).coverage,'INCOMPLETE');
 const c={...context,records:[{...context.records[0],category:'RESTRICTION' as const,fields:[{name:'restriction',value:'医生限制冲刺到周五',unit:null},{name:'medicalClearance',value:false,unit:null}]}]};
 const s=buildAnswerEvidenceState('可以冲刺吗？',c);assert.equal(s.clearance,'UNKNOWN');assert.equal(s.declaredRestrictions.length,1);
});
test('compact user-facing evidence never renders false coverage as confirmed absence or machine enums',()=>{
 const quote=contextModelQuote({...context.records[0],source:'USER_DECLARED:CANONICAL_LOAD_SUMMARY',category:'ANALYSIS',fields:[{name:'distanceComplete',value:false,unit:null},{name:'sessions',value:2,unit:null},{name:'knownDistance',value:10000,unit:'m'},{name:'missingDays',value:5,unit:null}]});
 assert.doesNotMatch(quote,/完整距离覆盖=false|UNKNOWN|PAIN/);assert.match(quote,/覆盖未确认/);
});
