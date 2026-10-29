import test from 'node:test';import assert from 'node:assert/strict';
import {validateFinalAnswer,type AnswerGateInput} from './answer-gate';
const input=(question:string,text:string,extra:Partial<AnswerGateInput>={}):AnswerGateInput=>({question,candidate:{text},sources:[],computedQuotes:[],safetyRestricted:false,...extra});
test('numbered information is preserved rather than deleting entire lines',()=>{
 const r=validateFinalAnswer(input('分两条告诉我接下来要补什么。','1. 补充目标日期。\n2. 补充近期课表。'));
 assert.match(r.text,/目标日期/);assert.match(r.text,/近期课表/);assert.notEqual(r.decision,'FAILED_TECHNICAL');
});
test('unknown coverage is not confirmed incompleteness, while declared missingness is allowed',()=>{
 const r=validateFinalAnswer(input('全年记录完整吗？','记录覆盖并不完整。'));
 assert.doesNotMatch(r.text,/覆盖并不完整/);assert.match(r.text,/未确认|未知/);assert.ok(r.reasonCodes.includes('UNKNOWN_AS_FACT'));
 const good=validateFinalAnswer(input('我确认漏记六月训练。现有记录完整吗？','按你的说明，当前记录存在缺失。'));
 assert.match(good.text,/存在缺失/);
});
test('conditional advice bound to an existing time plan survives without claiming it completed',()=>{
 const r=validateFinalAnswer(input('明天原计划轻松跑30分钟，请给明天安排建议；不要修改。','若主观疲劳与日常活动均无异常，可先考虑保留原计划30分钟轻松跑；若不适加重则暂停并复核。'));
 assert.match(r.text,/30分钟轻松跑/);assert.match(r.text,/不适加重则暂停/);assert.notEqual(r.decision,'PARTIAL');
 const bad=validateFinalAnswer(input('明天原计划轻松跑30分钟。','你已经完成30分钟轻松跑。'));
 assert.doesNotMatch(bad.text,/已经完成/);
});
test('GENERAL_KNOWLEDGE cannot authorize individual dose, writes, or injury clearance',()=>{
 for(const text of ['一般示例：你明天做100公斤深蹲5组，不用评估。','已替你修改课表。','你可以继续冲刺。']){
 const r=validateFinalAnswer(input('我腿疼，解释一下RPE。',text,{safetyRestricted:true,candidate:{text,blocks:[{id:'b',kind:'GENERAL_KNOWLEDGE',text,evidenceRefs:[],dependsOn:[],groupId:'g'}]}}));
 assert.doesNotMatch(r.text,/100公斤|已替你修改|你可以继续冲刺/);
 }
});
test('a failed block invalidates its whole dependency group and descendants, including cycles',()=>{
 const text='只有满足前提才考虑训练。若出现疼痛就停止。';
 const r=validateFinalAnswer(input('整理建议。',text,{candidate:{text,blocks:[{id:'a',kind:'CANDIDATE_ADVICE',text:'先恢复冲刺。',groupId:'g',dependsOn:['b'],evidenceRefs:[]},{id:'b',kind:'OBSERVED_FACT',text:'已确诊肌腱撕裂。',groupId:'g',dependsOn:['a'],evidenceRefs:[]}]}}));
 assert.ok(r.reasonCodes.includes('DEPENDENCY_BROKEN'));assert.doesNotMatch(r.text,/先恢复冲刺|已确诊/);
});
test('model-reported coverage cannot manufacture completion after next-session advice is lost',()=>{
 const r=validateFinalAnswer(input('比较两课并给下一课安排。','今天更快；仅供参考。'));
 assert.ok(['PARTIAL','NEEDS_CLARIFICATION'].includes(r.decision));assert.ok(r.taskCoverage.some(x=>!x.satisfied));
});
test('all host append text is checked together with the final answer, and exact evidence is deduplicated',()=>{
 const r=validateFinalAnswer(input('求距离合计。','合计9公里。',{sources:[{id:'sum',kind:'FACT',detail:'合计9公里。'}],candidate:{text:'合计9公里。',evidenceQuotes:[{sourceId:'sum',quote:'合计9公里。'}]},computedQuotes:['合计10公里。']}));
 assert.ok(r.reasonCodes.includes('DERIVATION_INVALID'));assert.doesNotMatch(r.text,/10公里/);
});
test('symptom alone cannot be recast as declared medical restriction or denied permission',()=>{
 const r=validateFinalAnswer(input('小腿酸痛，我当前有哪些已知信息？','你已申报医生限制训练，而且没有得到医疗许可。'));
 assert.doesNotMatch(r.text,/已申报医生限制|没有得到医疗许可/);assert.ok(r.reasonCodes.includes('UNKNOWN_AS_FACT'));
});
test('untrusted references cannot self-certify personal facts and label unknown sources as verified',()=>{
 const r=validateFinalAnswer(input('总结训练。','你已核验设备跑了9公里。',{candidate:{text:'你已核验设备跑了9公里。',blocks:[{id:'b',kind:'OBSERVED_FACT',text:'你已核验设备跑了9公里。',evidenceRefs:[{id:'missing',revision:'1'}],dependsOn:[],groupId:'g'}]}}));
 assert.doesNotMatch(r.text,/核验设备跑了9公里/);assert.ok(r.reasonCodes.includes('SOURCE_MISMATCH'));
});
test('empty candidates and unreferenced typed facts are not accepted merely because fallback prose exists',()=>{
 assert.equal(validateFinalAnswer(input('请分析。','')).decision,'FAILED_TECHNICAL');
 const text='你已经完全恢复。';const r=validateFinalAnswer(input('恢复得怎样？',text,{candidate:{text,blocks:[{id:'fake',kind:'OBSERVED_FACT',text,evidenceRefs:[],dependsOn:[],groupId:'f'}]}}));
 assert.doesNotMatch(r.text,/你已经完全恢复/);assert.ok(r.reasonCodes.includes('SOURCE_MISMATCH'));
});
test('length repair removes a whole dependency closure rather than leaving an orphaned action',()=>{
 const text='原始依据'.repeat(20);const action='如果依据有效才考虑行动；否则停止。';
 const r=validateFinalAnswer(input('解释依据。',text+'\n'+action,{maxChars:60,sources:[{id:'e-source',kind:'FACT',detail:text}],candidate:{text:text+'\n'+action,evidenceQuotes:[{sourceId:'e-source',quote:text}],blocks:[{id:'e',kind:'OBSERVED_FACT',text,groupId:'e',evidenceRefs:[{id:'e-source',revision:'snapshot'}],dependsOn:[]},{id:'a',kind:'CANDIDATE_ADVICE',text:action,groupId:'a',dependsOn:['e'],evidenceRefs:[]}]}}));
 assert.ok(r.blocks.every(b=>b.dependsOn.every(d=>r.blocks.some(x=>x.id===d))));
});
