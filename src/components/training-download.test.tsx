import test from 'node:test'
import assert from 'node:assert/strict'
import {download} from './training-model-panel'
import {setEventContext} from '@/lib/core/events'
import type {TrainingExportReceipt} from '@/lib/coach/training-models/confirmation'
const receipt:TrainingExportReceipt={id:'receipt1',proposalId:'proposal1',athleteId:'download-a',confirmedAt:'2026-10-23T10:00:00Z',asOf:'2026-10-23T10:00:00Z',kind:'CONFIRMED_EXPORT',scheduleWritten:false,automaticExecution:false,plan:null,action:'SKIP',sourcePlanId:'plan1',hash:'hash1',notice:'仅确认导出'}
function dom(t:test.TestContext){
 const original=Object.getOwnPropertyDescriptor(globalThis,'document'),create=URL.createObjectURL,revoke=URL.revokeObjectURL,fetch=globalThis.fetch
 let attached=false,clicks=0,network=0
 const link={href:'',download:'',click(){assert.equal(attached,true);clicks++},remove(){attached=false}}
 Object.defineProperty(globalThis,'document',{configurable:true,value:{body:{appendChild(){attached=true}},createElement(){return link}}})
 URL.createObjectURL=()=> 'blob:local-test';URL.revokeObjectURL=()=>{};globalThis.fetch=(async()=>{network++;throw Error('unexpected')}) as typeof fetch
 setEventContext({athleteId:'download-a'})
 t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete(globalThis as {document?:unknown}).document;URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.fetch=fetch;setEventContext({athleteId:'local'})})
 return {link,counts:()=>({clicks,network})}
}
test('local export initiates a download without claiming the file was saved or using network',t=>{
 const d=dom(t);const r=download(receipt) as any
 assert.equal(r.status,'REQUESTED');assert.match(r.message,/浏览器下载/);assert.doesNotMatch(r.message,/下载完成|已下载/);assert.deepEqual(d.counts(),{clicks:1,network:0})
})
test('another athlete cannot re-download a retained receipt',t=>{
 const d=dom(t);setEventContext({athleteId:'download-b'});const r=download(receipt) as any
 assert.equal(r.status,'BLOCKED');assert.equal(d.counts().clicks,0)
})
test('local blob failure is a download error, not a model or network error',t=>{
 const d=dom(t);URL.createObjectURL=()=>{throw Error('quota')};const r=download(receipt) as any
 assert.equal(r.status,'FAILED');assert.match(r.message,/下载/);assert.doesNotMatch(r.message,/网络不可用|DeepSeek.*失败/);assert.equal(d.counts().network,0)
})
