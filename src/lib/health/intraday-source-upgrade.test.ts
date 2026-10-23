import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as store from './intraday-store'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { typicalDay, typicalDayExplanation } from './intraday-recovery-bridge-v89'
import { runGarminSyncJob, type GarminDailyProgress } from './garmin-sync-runner'
import { shiftDay, shortHash } from './observation'
import type { IntradayDay } from './garmin-intraday'

const today = '2026-10-23', now = today + 'T12:00:00Z', athlete = 'synthetic'
const sourceId = 'garmin:' + shortHash('cn:synthetic')
const row = (day: string, source: string | undefined = sourceId): IntradayDay => ({
  schemaVersion: 1, eventTimingVersion: 2, source: 'garmin', sourceId: source,
  day, fetchedAt: now, offsetMin: 0, hr: [[Date.parse(day + 'T08:00:00Z'), 60]],
  bb: [[Date.parse(day + 'T08:00:00Z'), 70]], restingHr: 50, sleep: null, training: [],
})
let data: Map<string, string>
beforeEach(() => { data = new Map(); setStoreBackend({getItem: k => data.get(k) ?? null, setItem: (k,v) => {data.set(k,v)}, keys: () => [...data.keys()]}); setEventContext({athleteId: athlete}) })
afterEach(() => {setStoreBackend(null); setEventContext({athleteId: 'local'})})
const needsRefresh = (day: string, source: string) => (store as typeof store & {intradayNeedsSourceRefresh?: (d: string, s: string) => boolean}).intradayNeedsSourceRefresh?.(day, source) ?? false

test('legacy complete days must be revalidated instead of permanently skipped by source migration', () => {
  const d = row(shiftDay(today, -2)); delete d.sourceId; store.saveIntraday([d])
  assert.equal(store.intradayComplete(d.day), true)
  assert.equal(needsRefresh(d.day, sourceId), true)
})

test('partial new-account results never relabel legacy body battery as the new account', () => {
  const d = row(today); delete d.sourceId; store.saveIntraday([d])
  const original = store.loadIntraday()[today]
  store.saveIntraday([{...row(today), bb: [], failedReadings: ['bb'], fetchedAt: today + 'T13:00:00Z'}])
  assert.deepEqual(store.loadIntraday()[today].bb, [])
  const archives = [...data.entries()].filter(([k]) => k.includes('source-archive'))
  assert.equal(archives.length, 1, 'original unverified source must remain recoverable')
  assert.deepEqual(Object.values(JSON.parse(archives[0][1]).entries), [original])
})

test('account replacement is refused if its original source cannot be archived', () => {
  const d = row(today, 'garmin:old'); store.saveIntraday([d])
  setStoreBackend({getItem:k=>data.get(k)??null, setItem:(k,v)=>{if(k.includes('source-archive')) throw Error('quota'); data.set(k,v)}, keys:()=>[...data.keys()]})
  assert.equal(store.saveIntraday([row(today)]), 0)
  assert.equal(store.loadIntraday()[today].sourceId, 'garmin:old')
})

test('same-source partial sync retains its previous values and metric receipt time', () => {
  const d = row(today); store.saveIntraday([d])
  store.saveIntraday([{...d, bb:[], failedReadings:['bb'], fetchedAt:today+'T13:00:00Z'}])
  assert.deepEqual(store.loadIntraday()[today].bb, d.bb)
  assert.equal(store.loadIntraday()[today].readingFetchedAt?.bb, now)
  assert.equal(needsRefresh(today, sourceId), false)
})

test('chart exposes excluded legacy history instead of claiming the stored history is absent', () => {
  const days: Record<string, IntradayDay> = {[today]:row(today)}
  for(let i=1;i<=27;i++){const d=row(shiftDay(today,-i));delete d.sourceId;days[d.day]=d}
  const result = typicalDay(days, today, 'bb', 7, 28, now)
  assert.equal(result.historyDays, 0); assert.deepEqual(result.hours, [])
  assert.equal((result as any).excludedSourceDays, 27)
  assert.equal((result as any).unverifiedSourceDays, 27)
  assert.match(typicalDayExplanation(result).label, /同来源 0\/7 天/)
  assert.match(typicalDayExplanation(result).detail, /27天旧记录缺少账号来源标识/)
})

test('enough calendar days with sparse hours explains the actual same-hour coverage shortfall', () => {
  const days: Record<string, IntradayDay> = {[today]:row(today)}
  for(let i=1;i<=8;i++){const d=row(shiftDay(today,-i));d.bb=[[Date.parse(d.day+`T${String(i).padStart(2,'0')}:00:00Z`),70]];days[d.day]=d}
  const r=typicalDay(days,today,'bb',7,28,now)
  assert.equal(r.historyDays,8);assert.equal(r.hours.length,0);assert.equal((r as any).maxHourlyDays,1)
  assert.match(typicalDayExplanation(r).label, /同钟点最多 1\/7 天/)
})

function syncFixture(empty = false) {
  const days=Array.from({length:28},(_,i)=>shiftDay(today,-i))
  store.saveIntraday(days.map(day=>{const d=row(day);delete d.sourceId;return d}))
  let progress: GarminDailyProgress={checkedDays:days,pendingDays:[],lastSyncAt:now,intradayCheckedDays:days}
  const paths:string[]=[]
  const host={
    day:today, now, reason:'AUTO' as const, subject:()=>athlete, generation:()=>0, bindAccount:()=>true,
    progress:()=>{}, report:()=>{}, saveView:()=>{}, save:(health:unknown[])=>({saved:health.length,skipped:0,errors:[]}), sleep:async()=>{},
    backfill:{get:()=>90,set:()=>{}},dailyProgress:{get:()=>progress,set:(_:string,p:GarminDailyProgress)=>{progress=p}},
    intraday:{complete:(d:string)=>store.intradayComplete(d),needsSourceRefresh:needsRefresh,save:(d:IntradayDay[])=>store.saveIntraday(d)},
    api:async(path:string)=>{
      paths.push(path)
      if(path==='status')return {status:200,body:{loggedIn:true,region:'cn',profile:{displayName:'synthetic'}}}
      if(path.includes('activities'))return {status:200,body:[]}
      const day=path.match(/\d{4}-\d{2}-\d{2}/)![0]
      if(!empty&&path.includes('dailyHeartRate'))return {status:200,body:{calendarDate:day,heartRateValues:row(day).hr}}
      if(!empty&&path.includes('dailyStress'))return {status:200,body:{calendarDate:day,bodyBatteryValuesArray:row(day).bb}}
      if(!empty&&path.includes('usersummary'))return {status:200,body:{calendarDate:day,totalSteps:100}}
      return {status:204,body:null}
    },
  }
  return {host,paths}
}

test('upgrade refetches only bounded intraday gaps despite old checked receipts, restoring real baseline', async () => {
  const f=syncFixture(); const r=await runGarminSyncJob(f.host)
  assert.equal(r.status,'ok');assert.equal(r.healthDaysRequested,3)
  assert.equal(r.intraday?.requested,17, 'today/yesterday/day-2 + at most 14 older source gaps')
  const curve=typicalDay(store.loadIntraday(),today,'bb',7,28,now)
  assert.equal(curve.historyDays,16);assert.equal(curve.hours[0]?.median,70)
  f.paths.length=0;const second=await runGarminSyncJob(f.host)
  assert.equal(second.intraday?.requested,13)
  assert.equal(typicalDay(store.loadIntraday(),today,'bb',7,28,now).historyDays,27)
  f.paths.length=0;const third=await runGarminSyncJob(f.host)
  assert.equal(third.intraday?.requested,2, 'completed source migration must not repeat all history')
})

test('verified empty reread preserves original in archive but never makes up a curve or retries forever', async () => {
  const f=syncFixture(true)
  await runGarminSyncJob(f.host);await runGarminSyncJob(f.host)
  const r=await runGarminSyncJob(f.host)
  assert.equal(r.intraday?.requested,2)
  assert.deepEqual(typicalDay(store.loadIntraday(),today,'bb',7,28,now).hours,[])
  assert.ok([...data.keys()].some(k=>k.includes('source-archive')))
})
