import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
import {saveSelfReportedRest,readRestHistory,restContextLines,correctSelfReportedRest} from './rest-store.ts'
const now=Date.parse('2026-10-20T12:00:00Z')
function mem(){const m=new Map<string,string>();return {m,keys:()=>[...m.keys()],getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}}
function input(id:string,kind:'NAP'|'QUIET_REST'='NAP'){return {athleteId:'local',requestId:id,contextDay:'2026-10-20',kind,duration:{low:20,high:30},start:null,end:null,timezone:'Asia/Shanghai'}}
test.afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
test('V88 nap writes one durable scoped journal entry, retry is idempotent',()=>{const s=mem();setStoreBackend(s);const a=saveSelfReportedRest(input('nap1'),now);assert.equal(a.ok,true);const b=saveSelfReportedRest(input('nap1'),now+1);assert.equal(b.ok,true);assert.equal(s.m.size,1);assert.equal(readRestHistory(s,now+1).selection?.records.length,1)})
test('V88 quiet rest is never recorded as nap sleep',()=>{const s=mem();setStoreBackend(s);assert.equal(saveSelfReportedRest(input('quiet','QUIET_REST'),now).ok,true);const t=restContextLines('2026-10-20',now);assert.ok(t.some(x=>x.includes('安静休息')));assert.ok(t.some(x=>x.includes('未证明全天睡眠')))})
test('V88 athlete switch cannot read another athlete rest',()=>{const s=mem();setStoreBackend(s);saveSelfReportedRest(input('mine'),now);setEventContext({athleteId:'other'});assert.equal(readRestHistory(s,now).selection?.records.length,0);assert.equal(saveSelfReportedRest(input('wrong'),now).ok,false)})
test('V88 correction only with matching revision and explicit confirmation',async()=>{const s=mem();setStoreBackend(s);saveSelfReportedRest(input('nap'),now);const first=readRestHistory(s,now).selection!.records[0];const r=await correctSelfReportedRest({athleteId:'local',originEventId:first.originEventId!,expectedRevision:1,requestId:'fix',kind:'NAP',duration:{low:25,high:35},confirmation:'CORRECT_SELECTED_REST'},{now:now+1,lock:async work=>work()});assert.equal(r.ok,true);const rows=readRestHistory(s,now+1).records;assert.equal(rows.length,2);assert.equal(rows.at(-1)?.revision,2)})
