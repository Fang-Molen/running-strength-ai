import test from 'node:test';import assert from 'node:assert/strict';
import {resolveAnswerRetrieval,actionReceiptMatches} from './answer-tools';
test('network preference and actual retrieval state remain separate; no retry on failed adapter',async()=>{
 let calls=0;const port=async()=>{calls++;throw Error('timeout');};
 assert.equal((await resolveAnswerRetrieval('配速含义是什么？',true,port)).state,'NOT_NEEDED');assert.equal(calls,0);
 const r=await resolveAnswerRetrieval('查询最新食物标签。',true,port);assert.equal(r.state,'FAILED');assert.equal(r.enabled,true);assert.equal(calls,1);
});
test('retrieval receipts require current real-shaped source metadata, not only a URL',async()=>{
 const now=Date.parse('2026-10-29T12:00:00Z');
 const source={id:'label',url:'https://example.test/label',quote:'每100毫升40千卡。',fetchedAt:'2026-10-29T11:00:00Z',expiresAt:'2026-10-30T11:00:00Z'};
 assert.equal((await resolveAnswerRetrieval('查询最新标签。',true,async()=>[source],now)).state,'SUCCEEDED');
 assert.equal((await resolveAnswerRetrieval('查询最新标签。',true,async()=>[{...source,expiresAt:'2026-10-28T00:00:00Z'}],now)).state,'FAILED');
});
test('action success binds current owner, permission, date, item, portion and idempotency key',()=>{
 const intent={requestId:'r',owner:'synthetic-a',date:'2026-10-29',target:'breakfast',item:'milk',quantity:'250ml',idempotencyKey:'milk-r'};const receipt={...intent,status:'SUCCEEDED'};
 assert.equal(actionReceiptMatches(intent,receipt,intent.owner,true),true);
 for(const changed of [{owner:'other'},{date:'2026-10-30'},{quantity:'500ml'},{idempotencyKey:'other'},{status:'UNKNOWN'}])assert.equal(actionReceiptMatches(intent,{...receipt,...changed},intent.owner,true),false);
 assert.equal(actionReceiptMatches(intent,receipt,'other',true),false);assert.equal(actionReceiptMatches(intent,receipt,intent.owner,false),false);
});
