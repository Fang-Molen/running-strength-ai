import test from 'node:test';import assert from 'node:assert/strict';
import {validateFinalAnswer} from './answer-gate';import {computedCoachQuotes} from './context-comparison';
import type {CoachRequestContext} from './online-contract';
const base=(question:string,text:string)=>({question,candidate:{text},sources:[],computedQuotes:[],safetyRestricted:false});
test('missing medical records do not prevent accurate authority clarification',()=>{
 const r=validateFinalAnswer(base('小腿酸痛，我当前有哪些已知信息？','你已申报医生限制训练，而且没有得到医疗许可。'));
 assert.match(r.text,/医疗许可状态未知/);assert.match(r.text,/系统建议/);assert.doesNotMatch(r.text,/你已申报医生/);
});
test('tool failure and uncertain submission are explicit technical states, with no retry or completion',()=>{
 const r=validateFinalAnswer({...base('查询最新食物标签再解释。','我刚刚查证最新标签。'),tools:{retrieval:{state:'FAILED',enabled:true,sources:[]}}});assert.equal(r.decision,'FAILED_TECHNICAL');
 const intent={requestId:'r',owner:'u',date:'2026-10-29',target:'breakfast',item:'synthetic-milk',quantity:'250ml',idempotencyKey:'one'};
 const a=validateFinalAnswer({...base('登记这杯牛奶。','已成功登记。'),tools:{retrieval:{state:'NOT_NEEDED',enabled:true,sources:[]},action:{intent,receipt:{...intent,status:'UNKNOWN'},currentOwner:'u',authorized:true,claimText:'已登记。'}}});assert.equal(a.decision,'FAILED_TECHNICAL');assert.match(a.text,/对账/);assert.doesNotMatch(a.text,/已成功登记/);
});
test('missing nutrition quantity and sleep data get specific useful clarification',()=>{
 assert.match(validateFinalAnswer(base('我吃了一碗面，帮我登记。','已按精确650千卡登记。')).text,/份量|重量/);
 assert.match(validateFinalAnswer(base('睡眠没同步，昨夜睡了多少？','你睡了0小时，极度疲劳。')).text,/未知/);
});
test('watch timer and elapsed remain separate; lineage dedup is explicit and no unrelated activity lost',()=>{
 const record=(id:string,lineage:string)=>({recordId:id,revision:'1',occurredAt:'2026-10-29T08:00:00Z',knownAt:'2026-10-29T12:00:00Z',category:'TRAINING' as const,state:'ACTUAL' as const,source:'USER_DECLARED:SYNTHETIC_'+id,fields:[{name:'modality',value:'RUN',unit:null},{name:'subjectRole',value:'SELF',unit:null},{name:'knownDistance',value:6010,unit:'m'},{name:'distanceComplete',value:true,unit:null},{name:'activityLineage',value:lineage,unit:null},{name:'timerSeconds',value:1611.94,unit:'s'},{name:'elapsedSeconds',value:3223.87,unit:'s'}]});
 const context:CoachRequestContext={version:'coach-context-v2',records:[record('watch','one'),record('phone','one')],dependencyVersions:[],coverage:{selected:2,omitted:0,unknowns:[]}};
 const quotes=computedCoachQuotes('为何这次跑步有两个时长？合计今天跑量。',context).join('\n');assert.match(quotes,/6.01公里/);assert.match(quotes,/4:28\/km/);assert.match(quotes,/不能相加/);
 const more={...context,records:[...context.records,record('other','two')]};assert.match(computedCoachQuotes('合计今天跑量。',more).join('\n'),/12.02公里/);
});
