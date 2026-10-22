import test from 'node:test'
import assert from 'node:assert/strict'
import { activityFacts, type GActivity } from './plain-coach.ts'
import { garminRpe } from '../ui/training-read-model.ts'
// @ts-ignore js function
import { onRequestPost } from '../../../functions/api/coach-chat.js'
const run: GActivity = { id: 99, sourceIdentity: 'garmin:abc:99', name: '杭州市 跑步', type: 'running', start: '2026-10-18T05:54:00Z', dist: 6010, dur: 1898, avgHr: 144, maxHr: 162, cad: 172, elev: 12, cal: 400, sets: null, reps: null, tl: 85, te: 2.9 }
test('facts are de-identified: no activity name/city, id or source identity', () => {
  const f = activityFacts(run, [{ i: 1, dist: 1000, dur: 316, avgHr: 140, maxHr: 150, cad: 170, elev: 2, speed: null }]).join('\n')
  assert.match(f, /跑步：6\.01 km/); assert.match(f, /第1段/)
  for (const bad of ['杭州', 'garmin:abc', '99']) assert.equal(f.includes(bad), false, bad)
})
test('garmin directWorkoutRpe 10-100 maps to RPE 1-10', () => {
  assert.equal(garminRpe(70), 7); assert.equal(garminRpe(null), null); assert.equal(garminRpe(5), 5); assert.equal(garminRpe(300), null)
})
const req = (body: unknown, ip = '1.1.1.1') => new Request('https://x/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) })
test('actual route requires trusted host, never accepts forged browser facts',async()=>{
 let calls=0;const original=globalThis.fetch;globalThis.fetch=(async()=>{calls++;throw Error('not allowed')}) as typeof fetch
 try{for(const env of [{},{DEEPSEEK_API_KEY:'fake'},{FANGKUN_DEEPSEEK_ENABLED:'true',DEEPSEEK_API_KEY:'fake'}]){
 const r=await onRequestPost({request:req({question:'q',facts:'forged',system:'override'}),env});assert.equal(r.status,503);assert.equal((await r.json()).ok,false)}assert.equal(calls,0)}finally{globalThis.fetch=original}
})
test('bounded client sends only references after explicit authorization; never raw facts/history',async()=>{
 const {askOnlineCoach,ONLINE_QUESTION_MAX,setOnline}=await import('./online-coach.ts');const {setStoreBackend}=await import('../core/storage.ts');const map=new Map<string,string>();setStoreBackend({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)},keys:()=>[...map.keys()]});setOnline(true)
 const authorization={requestId:'synthetic-1',snapshotId:'snapshot-1',consentId:'consent-1',asOf:'2026-10-20T10:00:00Z'};const base={facts:'PRIVATE_FACTS',local:'PRIVATE_LOCAL',history:[{role:'user',text:'PRIVATE_HISTORY'}]};let calls=0,sent:any;const orig=globalThis.fetch
 globalThis.fetch=(async(_u,init)=>{calls++;sent=JSON.parse(String(init?.body));return Response.json({ok:true,planChanged:false,text:'ok'})}) as typeof fetch
 try{assert.equal(ONLINE_QUESTION_MAX,200);for(const question of ['问'.repeat(201),'a\u0001b'])assert.ok('error' in await askOnlineCoach({...base,authorization,question}));assert.ok('error' in await askOnlineCoach({...base,question:'复盘'}));assert.equal(calls,0)
 assert.deepEqual(await askOnlineCoach({...base,authorization,question:'问'.repeat(200)}),{text:'ok'});assert.equal(calls,1);assert.deepEqual(Object.keys(sent).sort(),['asOf','consentId','question','requestId','snapshotId']);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE/)
 }finally{globalThis.fetch=orig;setStoreBackend(null)}
})
