import test from 'node:test';import assert from 'node:assert/strict';
import {validateFinalAnswer} from './answer-gate';import {verifyDeliveredAnswer} from './answer-delivery';
test('delivered plan advice is independently checked with the same scope and task contract',()=>{
 const question='明天原计划轻松跑30分钟，请给明天安排建议。';const gate=validateFinalAnswer({question,candidate:{text:'若无不适，可先考虑保留原计划30分钟轻松跑；若不适出现则暂停。'},sources:[],computedQuotes:[],safetyRestricted:false});
 const input={question,factQuotes:[],citedQuotes:[],computedQuotes:[],safetyRestricted:false};
 assert.equal(verifyDeliveredAnswer(gate,input),true);
 assert.equal(verifyDeliveredAnswer(gate,{...input,safetyRestricted:true,question:'我腿疼，'+question}),false);
 assert.equal(verifyDeliveredAnswer({...gate,text:gate.text+'虚构另一个结论。'},input),false);
});
test('browser independently rejects mismatched registration receipts despite a valid final-text hash',()=>{
 const intent={requestId:'r',owner:'synthetic-owner',date:'2026-10-29',target:'breakfast',item:'synthetic-milk',quantity:'250ml',idempotencyKey:'once'};
 const action={intent,receipt:{...intent,status:'SUCCEEDED'},currentOwner:intent.owner,authorized:true,claimText:'已登记到指定早餐。'};
 const tools={retrieval:{state:'NOT_NEEDED' as const,enabled:true,sources:[]},action},question='请核实早餐登记结果';
 const gate=validateFinalAnswer({question,candidate:{text:action.claimText},sources:[],computedQuotes:[],safetyRestricted:false,tools});
 const input={question,factQuotes:[],citedQuotes:[],computedQuotes:[],safetyRestricted:false,tools};
 assert.equal(verifyDeliveredAnswer(gate,input),true);
 for(const receipt of [{...action.receipt,status:'UNKNOWN'},{...action.receipt,owner:'another-owner'},{...action.receipt,quantity:'500ml'},{...action.receipt,idempotencyKey:'other'}])assert.equal(verifyDeliveredAnswer(gate,{...input,tools:{...tools,action:{...action,receipt}}}),false);
});
