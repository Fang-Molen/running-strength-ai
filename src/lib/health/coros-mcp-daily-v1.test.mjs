// @ts-nocheck  研究模块原样保留（纯 JS，休眠，未接入界面）
import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCorosDailyBatch,corosRecoveryEvidence} from './coros-mcp-daily-v1.mjs';
const b={provider:'COROS_MCP',verifiedOwner:true,athleteId:'a',accountRef:'coros123',days:[{date:'2026-10-21',recordId:'d1',steps:14000,activeEnergyKcal:650,sleepMinutes:430,restingHr:52,sleepHrvMs:60,final:false}]};
test('reject unverified identity',()=>assert.equal(normalizeCorosDailyBatch({...b,verifiedOwner:false},'a').facts.length,0));
test('normalizes daily facts without invented body battery',()=>{const r=normalizeCorosDailyBatch(b,'a');assert.equal(r.facts.length,5);const e=corosRecoveryEvidence(r.facts,'2026-10-21');assert.equal(e.steps,14000);assert.equal(e.bodyBattery,null);assert.equal(e.trainingPermission,'UNDETERMINED')});
test('rejects same revision conflicts',()=>{const r=normalizeCorosDailyBatch({...b,days:[b.days[0],{...b.days[0],steps:15000}]},'a');assert.equal(r.facts.some(x=>x.metric==='STEPS'),false)});
test('newer revision supersedes old',()=>{const r=normalizeCorosDailyBatch({...b,days:[b.days[0],{...b.days[0],revision:1,steps:15000}]},'a');assert.equal(r.facts.find(x=>x.metric==='STEPS').value,15000)});
test('does not confuse active and total calories',()=>{const r=normalizeCorosDailyBatch({...b,days:[{...b.days[0],totalEnergyKcal:2100}]},'a');assert.equal(r.facts.find(x=>x.metric==='ACTIVE_ENERGY').value,650);assert.equal(r.facts.find(x=>x.metric==='TOTAL_ENERGY').value,2100)});
