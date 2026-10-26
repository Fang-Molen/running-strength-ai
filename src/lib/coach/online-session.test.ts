import test from 'node:test'
import assert from 'node:assert/strict'
import { selectCoachDeclarations, runOnlineExplanation, type OnlinePreview } from './online-session.ts'
import { COACH_DISCLOSURE_VERSION, declarationQuote } from './online-contract.ts'
import type { AnalysisFact } from '../health/analysis-contract.ts'
import { readAnalysis } from '../health/analysis-host.ts'

const now = new Date().toISOString()
const fact = (extra: object) => ({ id:'manual', revision:2, athleteId:'local', provider:'MANUAL', status:'CONFIRMED', quality:'AVAILABLE', occurredAt:now, knownAt:now, ...extra } as AnalysisFact)
test('only owned actual scalar evidence is sent; no plans, foreign devices or unknown scales', () => {
 const facts = [fact({kind:'TRAINING',actualDurationSeconds:600,sessionRpe:6,sessionRpeScale:'0-10_SESSION_RPE'}),
  fact({id:'plan',kind:'TRAINING',status:'PLANNED',actualDurationSeconds:3600}),
  fact({id:'other',athleteId:'other',kind:'METRIC',metric:'SLEEP',value:8,unit:'h'}),
  fact({id:'device',provider:'GARMIN',kind:'METRIC',metric:'SLEEP',value:7,unit:'h'}),
  fact({id:'unknown',kind:'RESPONSE',measure:'RECOVERY_FEELING',value:5,scale:'UNKNOWN'})]
 const result=selectCoachDeclarations(facts,'local',now)
 assert.deepEqual(result.map(d=>[d.metric,d.value,d.unit]),[['duration',600,'s'],['session_rpe',6,'/10']])
 assert.equal(new Set(result.map(d=>d.recordId)).size,1)
})
test('explicit zero stays zero; out of range, future and expired records are omitted',()=>{
 const result=selectCoachDeclarations([
 fact({kind:'RESPONSE',measure:'SORENESS',value:0,scale:'0-10_HIGH_WORSE'}),
 fact({id:'future',kind:'METRIC',metric:'SLEEP_SELF_REPORT',value:8,unit:'h',occurredAt:'2099-01-01T00:00:00Z'}),
 fact({id:'old',kind:'METRIC',metric:'SLEEP_SELF_REPORT',value:8,unit:'h',occurredAt:'2001-01-01T00:00:00Z'}),
 fact({id:'invalid',kind:'METRIC',metric:'SLEEP_SELF_REPORT',value:30,unit:'h'})], 'local', now)
 assert.deepEqual(result.map(d=>d.value),[0])
})
function fixture(){
 const declarations=selectCoachDeclarations([fact({kind:'METRIC',metric:'SLEEP_SELF_REPORT',value:7,unit:'h'})],'local',now)
 const preview:OnlinePreview={owner:'local',question:'今天训练后状态怎么观察？',day:now.slice(0,10),preparedAt:now,sourceVersion:'v1',declarations,packet:readAnalysis().packet,omittedRecords:0}
 const ref={snapshotId:'snapshot-test',consentId:'consent-test',asOf:now}
 const receipt={ok:true,snapshotRef:ref,expiresAt:new Date(Date.now()+60000).toISOString(),sourceVersion:'server-v1',provenance:'USER_DECLARED',disclosureVersion:COACH_DISCLOSURE_VERSION,factQuotes:declarations.map(declarationQuote)}
 let current={owner:'local',sourceVersion:'v1',enabled:true}; const calls:{url:string;init?:RequestInit}[]=[]
 const ports={current:()=>current,headers:async()=>({'content-type':'application/json'}),fetch:async(url:string,init?:RequestInit)=>{
 calls.push({url,init}); if(init?.method==='GET')return Response.json({service:'fangkun-coach',configured:true});
 if(init?.method==='DELETE')return Response.json({ok:true});
 if(url.endsWith('snapshot'))return Response.json(receipt);
 return Response.json({ok:true,text:declarationQuote(declarations[0])+' 建议保留实际反馈，暂不改变训练量。',planChanged:false,route:'LOW',model:'synthetic-model'})}}
 return {preview,receipt,calls,ports,change:()=>{current={...current,sourceVersion:'v2'}}}
}
test('explicit consent creates snapshot, sends only reference, validates exact numeric quote and revokes',async()=>{
 const f=fixture(),r=await runOnlineExplanation(f.preview,{consent:true},f.ports)
 assert.ok('text'in r,JSON.stringify(r)); assert.match(r.text,/7小时/)
 const chat=f.calls.find(c=>c.url.endsWith('chat')&&c.init?.method==='POST')!
 assert.deepEqual(Object.keys(JSON.parse(String(chat.init?.body))).sort(),['asOf','consentId','question','requestId','snapshotId'])
 assert.equal(f.calls.at(-1)?.init?.method,'DELETE')
})
test('no consent, changed evidence or disabled preference cannot upload',async()=>{
 for(const reason of ['consent','changed','disabled']){const f=fixture();if(reason==='changed')f.change();if(reason==='disabled')f.ports.current=()=>({owner:'local',sourceVersion:'v1',enabled:false});
 const r=await runOnlineExplanation(f.preview,{consent:reason!=='consent'},f.ports);assert.ok('error'in r);assert.equal(f.calls.length,0)}
})
test('changed evidence after snapshot prevents provider call and revokes authorization',async()=>{
 const f=fixture(),fetch=f.ports.fetch;f.ports.fetch=async(u,i)=>{const r=await fetch(u,i);if(u.endsWith('snapshot')&&i?.method==='POST')f.change();return r}
 assert.ok('error'in await runOnlineExplanation(f.preview,{consent:true},f.ports));assert.equal(f.calls.filter(c=>c.url.endsWith('chat')&&c.init?.method==='POST').length,0);assert.equal(f.calls.at(-1)?.init?.method,'DELETE')
})
test('server cannot replace displayed consent facts or introduce an unsupported numeric prescription',async()=>{
 for(const attack of ['receipt','answer']){const f=fixture(),fetch=f.ports.fetch;
 if(attack==='receipt')f.receipt.factQuotes=['用户申报睡眠8小时'];
 else f.ports.fetch=async(u,i)=>u.endsWith('chat')&&i?.method==='POST'?Response.json({ok:true,text:'明天跑20公里。',planChanged:false,route:'LOW',model:'synthetic-model'}):fetch(u,i)
 assert.ok('error'in await runOnlineExplanation(f.preview,{consent:true},f.ports))}
})
test('identity changes and cancellation during a pending response cannot deliver its text',async()=>{
 for(const reason of ['owner','cancel','cleanup']){const f=fixture(),controller=new AbortController(),fetch=f.ports.fetch;
  f.ports.fetch=async(u,i)=>{const r=await fetch(u,i);if((reason==='cleanup'&&i?.method==='DELETE')||(reason!=='cleanup'&&u.endsWith('chat')&&i?.method==='POST')){
   if(reason==='cancel')controller.abort();else f.ports.current=()=>({owner:'another-athlete',sourceVersion:'v1',enabled:true})
  }return r}
  assert.ok('error'in await runOnlineExplanation(f.preview,{consent:true,signal:controller.signal},f.ports),reason)
 }
})
