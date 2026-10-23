import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { saveReviewedFacts } from './unified-fact-store'
import { factHealthRows } from './unified-import'
import { factProtocol, type UnifiedFact } from './unified-facts'
import { saveDeviceRows } from './device-store'
import { loadHealthSnapshot, saveHealthSource } from './snapshot'
import { resolveBodyBattery } from './health-current'
import { shortHash } from './observation'
import { intradayInput, typicalDay } from './intraday-recovery-bridge-v89'
import type { IntradayDay } from './garmin-intraday'
const day = '2026-10-20', at = (d: string, h = '10:00') => `${d}T${h}:00Z`
const reading = (d = day, source = 'garmin:new', value = 50): IntradayDay => ({schemaVersion:1, day:d, source:'garmin', sourceId:source, fetchedAt:at(d,'11:00'), offsetMin:0, hr:[[Date.parse(at(d)),60]], bb:[[Date.parse(at(d)),value]], restingHr:48, sleep:null, training:[]})
const fact = (patch: Partial<UnifiedFact> = {}): UnifiedFact => ({athleteId:'local',provider:'GARMIN',accountRef:'new',deviceId:'watch',recordId:'bb',metric:'BODY_BATTERY',value:41,unit:'score',protocol:'LATEST',start:null,end:null,receivedAt:at(day,'12:00'),day,utcOffsetMinutes:0,quality:'VALID',revision:1,...patch})
let data: Map<string,string>
beforeEach(() => { data=new Map();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()]});setEventContext({athleteId:'local'}) })
afterEach(() => {setStoreBackend(null);setEventContext({athleteId:'local'})})
test('personal hourly baseline never mixes different identified watch accounts', () => {
 const days: Record<string, IntradayDay> = {[day]:reading()}
 for(let i=12;i<20;i++){const d=`2026-10-${i}`;days[d]=reading(d,i===19?'garmin:new':'garmin:old',i===19?60:10)}
 const result=typicalDay(days,day,'bb',7)
 assert.equal(result.historyDays,1);assert.deepEqual(result.hours,[])
})
test('unidentified legacy days are not silently merged into an identified account baseline', () => {
 const old=reading('2026-10-19');delete old.sourceId
 assert.equal(typicalDay({[day]:reading(),'2026-10-19':old},day,'bb',1).hours.length,0)
})
test('U10 bridge keeps the original account id and per-metric receipt times', () => {
 const d=reading();d.fetchedAt=at(day,'14:00');d.readingFetchedAt={bb:at(day,'11:00'),hr:at(day,'14:00')};d.failedReadings=['bb']
 const out=intradayInput({[day]:d},'local',day,at(day,'12:00'))
 const bb=out.samples.find(s=>s.metric==='BODY_BATTERY')!
 assert.equal(bb.sourceId,'garmin:new');assert.equal(bb.knownAt,new Date(at(day,'11:00')).toISOString())
})
test('reviewed same-source latest battery is not confused with its JSON protocol identifier', () => {
 const f=fact();assert.equal(saveReviewedFacts([f]).saved,1);saveDeviceRows(factHealthRows([f]))
 const view=loadHealthSnapshot(day).metrics.find(v=>v.metric==='BODY_BATTERY')!
 const sourceId=`garmin:${shortHash('new:watch')}`
 const result=resolveBodyBattery(view,reading(day,sourceId),day,new Date().toISOString())
 assert.equal(result.value,41);assert.equal(result.sourceId,sourceId)
})
test('choosing one source is not blanked by a newer day from another provider', () => {
 const a=fact({day:'2026-10-19',metric:'HRV',value:61,unit:'ms',protocol:'NIGHT_RMSSD',recordId:'hrv'})
 const b=fact({provider:'COROS',metric:'HRV',value:72,unit:'ms',protocol:'NIGHT_RMSSD',recordId:'hrv',accountRef:'other'})
 saveReviewedFacts([a,b]);saveDeviceRows(factHealthRows([a,b]));saveHealthSource('HRV',factProtocol(a))
 const view=loadHealthSnapshot(day).metrics.find(v=>v.metric==='HRV')!
 assert.equal(view.state,'STALE');assert.equal(view.current?.value,61);assert.equal(view.current?.day,'2026-10-19');assert.ok(!view.notes.some(n=>n.includes('所选来源暂无')))
})
test('an unrelated source conflict cannot block an explicitly chosen device', () => {
 const a=fact({metric:'HRV',unit:'ms',protocol:'NIGHT_RMSSD',value:61,recordId:'hrv'})
 const b=fact({...a,provider:'COROS',accountRef:'other',value:72})
 saveReviewedFacts([a,b,{...b,value:73}]);saveDeviceRows(factHealthRows([a]));saveHealthSource('HRV',factProtocol(a))
 assert.equal(loadHealthSnapshot(day).metrics.find(v=>v.metric==='HRV')?.current?.value,61)
})
test('previously selected exact device stream survives upgrade to reviewed fact projection',()=>{
 const f=fact(),rows=factHealthRows([f]);saveDeviceRows(rows)
 const legacy=loadHealthSnapshot(day).metrics.find(v=>v.metric==='BODY_BATTERY')!.current!.stream
 saveHealthSource('BODY_BATTERY',legacy);saveReviewedFacts([f])
 const v=loadHealthSnapshot(day).metrics.find(v=>v.metric==='BODY_BATTERY')!
 assert.equal(v.current?.value,41);assert.equal(v.selectedSource,factProtocol(f))
})
test('personal hourly baseline excludes data received after analysis cutoff',()=>{
 const old=reading('2026-10-19');old.fetchedAt=at(day,'14:00')
 const result=typicalDay({[day]:reading(),'2026-10-19':old},day,'bb',1,28,at(day,'12:00'))
 assert.equal(result.historyDays,0)
})
