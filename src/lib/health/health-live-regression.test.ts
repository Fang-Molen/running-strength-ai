import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from '../core/storage'
import { setEventContext } from '../core/events'
import { saveDeviceRows } from './device-store'
import { loadVitals, validateVital } from '../nutrition/vitals'
import { loadHealthSnapshot, saveHealthSource } from './snapshot'
import { saveIntraday, loadIntraday } from './intraday-store'
import { HEALTH_CHANGED } from './observation'
import { refreshCorosHealth, mergeCorosHealth, invalidateCorosContext } from './coros-mcp-client'
import { onlineRecoveryFacts } from '../coach/online-recovery-facts'
import type { IntradayDay } from './garmin-intraday'
const DAY='2026-10-22', OLD=DAY+'T04:27:00Z', NOW=DAY+'T06:50:00Z'
let data: Map<string,string>, store: MemoryStore, win: EventTarget
const original=['window','localStorage','fetch'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const)
beforeEach(()=>{data=new Map();store={getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()]};win=new EventTarget();Object.defineProperty(globalThis,'window',{configurable:true,value:win});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store});setStoreBackend(store);setEventContext({athleteId:'local'});invalidateCorosContext()})
afterEach(()=>{invalidateCorosContext();setStoreBackend(null);setEventContext({athleteId:'local'});for(const [k,v]of original)v?Object.defineProperty(globalThis,k,v):Reflect.deleteProperty(globalThis,k)})
const metric=(m:string)=>loadHealthSnapshot(DAY).metrics.find(x=>x.metric===m)!
const observation=(source:string,kind='HRV')=>({key:source+':'+kind+':'+DAY,sourceId:source,statistic:'device-daily',syncedAt:NOW})
const intra=(at=NOW,v=41):IntradayDay=>({schemaVersion:1,day:DAY,source:'garmin',fetchedAt:at,offsetMin:480,eventTimingVersion:2,hr:[],bb:[[Date.parse(at),v]],restingHr:null,sleep:null,training:[]})
for(const brand of ['garmin','coros','polar','suunto','apple_health','health_connect','huawei'])test(`${brand} confirmed fractional HRV survives save and common snapshot`,()=>{
 const r=saveDeviceRows([{key:'x',source:brand,day:DAY,metric:'HRV',value:65.375,hrvMethod:'RMSSD',observation:observation(brand+':account')}]);assert.deepEqual(r.errors,[]);assert.equal(metric('HRV').current?.value,65.375);assert.equal(loadVitals().records[0].value,65.375)
})
test('manual integer rule and invalid device values remain rejected',()=>{assert.equal(validateVital({kind:'HRV',value:65.375,observedOn:DAY,source:'MANUAL',hrvMethod:'RMSSD'}).ok,false);for(const value of [NaN,Infinity,-1,301])assert.ok(saveDeviceRows([{key:'x',source:'device',day:DAY,metric:'HRV',value,observation:observation('a')}]).errors.length)})
test('COROS health cache is available in the common snapshot without duplicating persisted vitals',()=>{
 data.set('fk-coros-mcp-health-v1:local',JSON.stringify({accountRef:'account-a',fetchedAt:NOW,days:[{date:DAY,hrvMs:65.375,restingHr:47.25,sleepMinutes:273,steps:4200,activeKcal:250}],stress:[],recovery:{percent:80,at:NOW},issues:[],raw:{}}));
 assert.equal(metric('HRV').current?.value,65.375);assert.equal(metric('RHR').current?.value,47.25);assert.equal(metric('SLEEP').current?.value,4.55);assert.equal(metric('BODY_BATTERY').current,null);assert.equal(loadVitals().records.length,0)
 const out=onlineRecoveryFacts(DAY,DAY+'T07:00:00Z');assert.match(out.summary.join('\n'),/65\.38/);assert.match(out.summary.join('\n'),/4\.55/)
})
test('COROS main snapshot is athlete isolated and honors explicit source choice',()=>{
 data.set('fk-coros-mcp-health-v1:local',JSON.stringify({accountRef:'account-a',fetchedAt:NOW,days:[{date:DAY,hrvMs:65}],stress:[],recovery:null,issues:[],raw:{}}));
 saveDeviceRows([{key:'g',source:'佳明账号同步',day:DAY,metric:'HRV',value:48,observation:observation('garmin:account')}]);assert.equal(metric('HRV').state,'CONFLICT');const chosen=metric('HRV').availableSources.find(s=>s.id.startsWith('coros:'))!;assert.ok(chosen);saveHealthSource('HRV',chosen.id);assert.equal(metric('HRV').current?.value,65);setEventContext({athleteId:'other'});assert.equal(metric('HRV').current,null)
})
test('successful COROS save notifies common health subscribers after persistence',async()=>{
 let seen:number|undefined,notifications=0;win.addEventListener(HEALTH_CHANGED,()=>{notifications++;seen=metric('HRV').current?.value});globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,connected:true,sessionScope:'synthetic-session',accountRef:'account-a',fetchedAt:NOW,days:[{date:DAY,hrvMs:65.375}],stress:[],recovery:null,issues:[],raw:{}}));await refreshCorosHealth('local');assert.equal(notifications,1);assert.equal(seen,65.375)
})
test('partial COROS update retains prior field receipt time rather than freshening missing HRV',()=>{
 const first=mergeCorosHealth(null,{fetchedAt:OLD,days:[{date:DAY,hrvMs:61}],stress:[],recovery:null,issues:[],raw:{}});const second=mergeCorosHealth(first,{fetchedAt:NOW,days:[{date:DAY,hrvMs:null,restingHr:48}],stress:[],recovery:null,issues:[],raw:{}});data.set('fk-coros-mcp-health-v1:local',JSON.stringify(second));assert.equal(metric('HRV').current?.updatedAt,OLD);assert.equal(metric('RHR').current?.updatedAt,NOW)
})
test('intraday committed write notifies health readers immediately',()=>{let received=0;win.addEventListener(HEALTH_CHANGED,()=>{received++;assert.equal(loadIntraday()[DAY].bb.at(-1)?.[1],41)});assert.equal(saveIntraday([intra()]),1);assert.equal(received,1)})
test('late older intraday response cannot roll back a newer day',()=>{saveIntraday([intra()]);saveIntraday([intra(OLD,50)]);assert.equal(loadIntraday()[DAY].bb.at(-1)?.[1],41);assert.equal(loadIntraday()[DAY].fetchedAt,NOW)})
test('intraday failure preserves real samples and their measurement timestamp',()=>{saveIntraday([intra(OLD,50)]);saveIntraday([{...intra(NOW),bb:[],failedReadings:['bb']}]);assert.deepEqual(loadIntraday()[DAY].bb,[[Date.parse(OLD),50]])})

test('outgoing coach summary shares newer battery value and retains unknown measurement time',()=>{
 saveDeviceRows([{key:'bb-daily',source:'佳明账号同步',day:DAY,metric:'BODY_BATTERY',value:41,observation:{...observation('garmin:live','BODY_BATTERY'),statistic:'同步时最近值'}}])
 saveIntraday([{...intra(OLD,50),sourceId:'garmin:live'}])
 const result=onlineRecoveryFacts(DAY,DAY+'T07:00:00Z'),out=[...result.summary,...result.details].join('\n')
 assert.match(result.summary.join('\n'),/身体电量：41\/100/)
 assert.match(out,/测量时间未提供/);assert.match(out,/同步.*06:50/);assert.doesNotMatch(out,/测量\s+2026-10-22T06:50/)
})
test('outgoing coach summary shares newer measured value instead of an older day summary',()=>{
 saveDeviceRows([{key:'bb-daily',source:'佳明账号同步',day:DAY,metric:'BODY_BATTERY',value:50,observation:{...observation('garmin:live','BODY_BATTERY'),statistic:'同步时最近值',syncedAt:OLD}}])
 saveIntraday([{...intra(NOW,41),sourceId:'garmin:live'}])
 assert.match(onlineRecoveryFacts(DAY,DAY+'T07:00:00Z').summary.join('\n'),/身体电量：41\/100/)
})
test('failed COROS persistence reports failure, not a successful new value in a private panel',async()=>{
 const old={accountRef:'a',fetchedAt:OLD,days:[{date:DAY,hrvMs:51}],stress:[],recovery:null,issues:[],raw:{}}
 data.set('fk-coros-mcp-health-v1:local',JSON.stringify(old));let events=0;win.addEventListener(HEALTH_CHANGED,()=>events++)
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{...store,setItem:()=>{throw Error('quota')}}})
 setStoreBackend({...store,setItem:()=>{throw Error('quota')}}) // v89.11.13：COROS 健康缓存改经 currentStore() 读写，故障注入也要落在同一入口
 globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,connected:true,sessionScope:'synthetic-session',accountRef:'a',fetchedAt:NOW,days:[{date:DAY,hrvMs:65}],stress:[],recovery:null,issues:[],raw:{}}))
 await assert.rejects(refreshCorosHealth('local'),/保存失败/);assert.equal(metric('HRV').current?.value,51);assert.equal(events,0)
})
