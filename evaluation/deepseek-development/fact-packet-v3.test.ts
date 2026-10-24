import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import * as preparation from './prepare-chain-ab.v3'
import {modelFixtures,PAID_SUBSET} from './model-fixtures'

const generate=(caseIds:readonly string[]=PAID_SUBSET)=>preparation.prepareAB(modelFixtures(),'deepseek-flash',{caseIds,inputTokenLimit:32768,outputTokenLimit:8192})
test('new packet protocol is versioned while original questions and rubric bytes remain frozen',()=>{
 const result=generate(['C04'])
 assert.equal(result.protocolVersion,'FK_FACT_PACKET_3')
 assert.match(result.requests[0].request.question,/课次日.*2026-10-18.*asOf.*2026-10-19.*比赛日.*2026-10-26/)
 assert.equal(createHash('sha256').update(readFileSync(new URL('./cases-60.json',import.meta.url))).digest('hex'),'09e58ed82559f288e6229e2539bb4a75a96858263c1876da9d92732fb698d393')
 assert.equal(createHash('sha256').update(readFileSync(new URL('./scoring-frozen.json',import.meta.url))).digest('hex'),readFileSync(new URL('./scoring-frozen.sha256',import.meta.url),'utf8').trim())
})
test('D01 source aliases match shared neutral scopes instead of a separate S6 namespace',()=>{
 const r=generate(['D01']).requests
 assert.equal(r.length,2)
 assert.deepEqual(r[0].commonFacts,r[1].commonFacts)
 assert.doesNotMatch(r[1].request.context,/MANUAL\s*\/\s*S6|synthetic-watch-account|synthetic-A/)
 assert.equal(r[1].commonFacts.scopes[0].id,'S1')
})
test('B carries program-derived HRV values and same source evidence as A',()=>{
 const r=generate(['D04']).requests
 assert.equal(r.length,2)
 assert.equal(r[0].coverageHash,r[1].coverageHash)
 assert.match(r[1].request.context,/derivedFacts/)
 assert.match(r[1].request.context,/-20/)
 assert.match(r[1].request.context,/-0\.2231435513142097/)
 assert.match(r[1].request.context,/RMSSD_BASELINE_SAMPLES/)
 assert.match(r[1].request.context,/RHR_CHANGE_BPM/)
})
test('new preparation asks for the same fact-verified analysis JSON contract as the live controller',()=>{
 for(const r of generate(['A03']).requests){
  assert.match(r.providerRequest.messages[0].content,/factualClaims/)
  assert.match(r.providerRequest.messages[0].content,/derivedFactIds/)
  assert.match(r.providerRequest.messages[0].content,/NOT_SAVED/)
 }
})
test('old captured protocol preserves the original immutable request manifest',()=>{
 const r=preparation.prepareAB(modelFixtures(),'deepseek-flash',{caseIds:PAID_SUBSET,protocolVersion:'legacy-v2'})
 assert.equal(r.protocolVersion,'LEGACY_CAPTURED_V2')
 assert.equal(createHash('sha256').update(JSON.stringify(r.requests)).digest('hex'),'e66259ee2ffc3f179d0619950f6fa13fcad02b2d12675ec27094170f502f456b')
})
test('received-after-asOf raw facts never enter either arm or processed view',()=>{
 const f=modelFixtures().find(x=>x.caseId==='D01')!
 const late=structuredClone(f.facts.find(x=>x.kind==='METRIC'&&x.value!==null)!)
 late.id='late-received';late.sourceRecordId='late-received';late.receivedAt='2026-10-20T11:00:00Z'
 if(late.kind==='METRIC')late.value=98765
 const r=preparation.prepareAB([{...f,facts:[...f.facts,late]}],'deepseek-flash',{caseIds:['D01'],inputTokenLimit:32768,outputTokenLimit:8192})
 assert.equal(r.requests.length,2)
 for(const request of r.requests)assert.doesNotMatch(request.request.context,/98765|late-received/)
})
test('all historical courses and important linked counterevidence stay in both arms',()=>{
 const r=generate(['E01','E04']).requests
 assert.equal(r.length,4)
 for(const request of r.filter((x:any)=>x.caseId==='E01'))for(const day of ['2026-10-15','2026-10-16','2026-10-17','2026-10-18'])assert.ok(request.request.context.includes(day))
 const pair=r.filter((x:any)=>x.caseId==='E04')
 assert.deepEqual(pair[0].commonFacts,pair[1].commonFacts)
 assert.ok(pair[0].commonFacts.priorHypotheses.length)
 assert.match(pair[1].request.context,/weakeningRefs/)
})
test('compression lowers aggregate B bytes without dropping common source coverage',()=>{
 const before=JSON.parse(readFileSync(new URL('./replay-fixtures/20261023/frozen-preparation-v2.json',import.meta.url),'utf8')).requests
 const after=generate().requests
 assert.equal(after.length,26)
 const bytes=(rows:any[])=>rows.filter(r=>r.arm==='B').reduce((n,r)=>n+Buffer.byteLength(r.request.context),0)
 assert.ok(bytes(after)<bytes(before),`B bytes ${bytes(after)} must be below ${bytes(before)}`)
 for(const id of PAID_SUBSET){const pair=after.filter((r:any)=>r.caseId===id);assert.equal(pair[0].coverageHash,pair[1].coverageHash);assert.deepEqual(pair[0].commonFacts,pair[1].commonFacts)}
})
