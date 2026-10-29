import test from 'node:test';import assert from 'node:assert/strict';
import {validateFinalAnswer,type AnswerGateInput} from './answer-gate';import {verifyDeliveredAnswer} from './answer-delivery';import {questionCalculations} from './question-calculation';import {resolveAnswerRetrieval} from './answer-tools';
const input=(question:string,text:string,extra:Partial<AnswerGateInput>={}):AnswerGateInput=>({question,candidate:{text},sources:[],computedQuotes:[],safetyRestricted:false,...extra});
const block=(kind:any,text:string)=>({text,blocks:[{id:'b',kind,text,evidenceRefs:[],groupId:'g',dependsOn:[]}]});
const calc=(q:string,prior:string[])=>questionCalculations(q,prior).map(r=>r.detail).join('\n');
test('review 1: existing plan dose cannot be transferred to a different activity or intensity',()=>{
 const q='我腿疼，原计划明天轻松跑30分钟，请给我明天安排建议。',text='如果状态合适，建议安排明天冲刺30分钟。';
 const r=validateFinalAnswer(input(q,text,{candidate:block('CANDIDATE_ADVICE',text),safetyRestricted:true}));assert.doesNotMatch(r.text,/冲刺30分钟/);
 const second=validateFinalAnswer(input('原计划明天轻松跑30分钟，请给安排建议。','如果状态合适，建议明天冲刺30分钟。'));assert.doesNotMatch(second.text,/冲刺30分钟/);
});
test('review 2: nonnumeric accomplishments and comparison conclusions require evidence for every kind',()=>{
 for(const kind of ['UNCERTAINTY','CANDIDATE_ADVICE','GENERAL_KNOWLEDGE']){
  const text='你已经完成原计划。';const r=validateFinalAnswer(input('我原计划明天轻松跑30分钟。',text,{candidate:block(kind,text)}));assert.doesNotMatch(r.text,/你已经完成/);
 }
 const text='配速相同。';assert.doesNotMatch(validateFinalAnswer(input('比较两次训练配速。',text,{candidate:block('GENERAL_KNOWLEDGE',text)})).text,/配速相同/);
});
test('review 3: a request to formulate a future plan cannot be completed by clarification alone',()=>{
 const text='请提供近期训练记录。';const r=validateFinalAnswer(input('请给我制定未来四周的训练计划。',text,{candidate:block('UNCERTAINTY',text)}));assert.ok(['PARTIAL','NEEDS_CLARIFICATION'].includes(r.decision));assert.ok(r.reasonCodes.includes('TASK_DROPPED'));
});
test('review 4: multiple corrections within each current or prior message apply in textual order',()=>{
 const s=calc('更正第2组为60秒；再更正第2组为58秒，其他不变。',['成绩依次为60、61、62秒。']);assert.match(s,/新总时间180秒/);
 const p=['成绩依次为60、61、62秒。','更正第1组为58秒；第2组为59秒，其他不变。'];assert.match(calc('更正第3组为59秒，其他不变。',p),/新总时间176秒/);
});
test('review 5: completion punctuation does not convert completion into unknown timing',()=>{
 const s=calc('4×400米，前三组是60、61、62秒；第四组完成，但没有计时。',[]);assert.match(s,/完成1600米.*183秒.*总.*未知/);assert.doesNotMatch(s,/完成1200米/);
});
test('review 6: retrieval uses the receipt-validation clock, not the earlier personal snapshot',async()=>{
 const t=Date.parse('2026-10-29T12:00:00Z');let clock=t;
 const r=await resolveAnswerRetrieval('查询最新食物标签。',true,async()=>{clock+=10;return [{id:'e',url:'https://example.test',quote:'标签原文。',fetchedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+1000).toISOString()}];},()=>clock);
 assert.equal(r.state,'SUCCEEDED');
});
test('review 7: retrieved evidence is delivered and checked consistently by server and client',()=>{
 const now='2026-10-29T12:00:01Z',question='查询最新资料再解释。',quote='每周锻炼有益健康。',url='https://example.test/source';
 const tools={retrieval:{state:'SUCCEEDED' as const,enabled:true,sources:[{id:'e',url,quote,fetchedAt:'2026-10-29T12:00:00.100Z',expiresAt:'2026-10-30T12:00:00Z'}]}};
 const text='根据本次检索到的资料：'+quote+url;const gate=validateFinalAnswer(input(question,text,{tools,now}));assert.ok(['VALIDATED','REPAIRED'].includes(gate.decision));
 assert.equal(verifyDeliveredAnswer(gate,{question,factQuotes:[],citedQuotes:[],computedQuotes:[],safetyRestricted:false,tools,now}),true);
 assert.equal(verifyDeliveredAnswer(gate,{question,factQuotes:[],citedQuotes:[],computedQuotes:[],safetyRestricted:false,now}),false);
});
