import test from 'node:test';import assert from 'node:assert/strict';import {computedCoachQuotes} from './context-comparison';import type {CoachRequestContext} from './online-contract';
test('comparison of two explicitly labelled reported distances preserves roles and computes their difference',()=>{
 const records=[['本人',7000],['朋友',9000]].map(([label,d],i)=>({recordId:'d'+i,revision:'1',category:'TRAINING',state:'ACTUAL',source:'USER_DECLARED:SELF_REPORT',occurredAt:null,knownAt:null,fields:[{name:'modality',value:'RUN',unit:null},{name:'comparisonLabel',value:label,unit:null},{name:'knownDistance',value:d,unit:'m'},{name:'distanceComplete',value:true,unit:null}]})) as CoachRequestContext['records'];
 const context:CoachRequestContext={version:'coach-context-v2',records,dependencyVersions:[],coverage:{selected:2,omitted:0,unknowns:[]}};
 const text=computedCoachQuotes('比较我和朋友的距离。',context).join('');assert.match(text,/本人7公里.*朋友9公里.*朋友.*多2公里/);
 assert.equal(computedCoachQuotes('合计今天跑量。',context).length,0);
});
