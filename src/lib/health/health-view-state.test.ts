import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileHealthDay, intradayMatchesSource } from './health-view-state'
import { buildHealthSnapshot, type HealthMetricView } from './snapshot'
import { shortHash } from './observation'
import type { IntradayDay } from './garmin-intraday'
const state={day:'2026-10-21',today:'2026-10-22',previousToday:'2026-10-22',historyPinned:false,hasTodayData:true}
test('automatic recent-day fallback returns to today when today data arrives',()=>assert.equal(reconcileHealthDay(state),'2026-10-22'))
test('manual yesterday and earlier history are never changed by a sync',()=>assert.equal(reconcileHealthDay({...state,historyPinned:true}),'2026-10-21'))
test('without new data automatic recent-day fallback remains visible',()=>assert.equal(reconcileHealthDay({...state,hasTodayData:false}),'2026-10-21'))
test('live-today view follows local midnight even before new device samples arrive',()=>assert.equal(reconcileHealthDay({...state,previousToday:'2026-10-21',hasTodayData:false}),'2026-10-22'))
const d:IntradayDay={schemaVersion:1,day:'2026-10-20',source:'garmin',sourceId:'garmin:a',fetchedAt:'2026-10-20T12:00:00Z',offsetMin:0,hr:[],bb:[],restingHr:null,sleep:null,training:[]}
const view=(selectedSource:string|null):HealthMetricView=>({...buildHealthSnapshot([],[],d.day).metrics.find(m=>m.metric==='RHR')!,selectedSource})
test('selected COROS source never displays a Garmin heart-rate curve',()=>assert.equal(intradayMatchesSource(view('coros:a|日静息心率|'),d),false))
test('selected same Garmin account keeps its continuous curve',()=>assert.equal(intradayMatchesSource(view('garmin:a|日静息心率|'),d),true))
test('another Garmin account is not interchangeable',()=>assert.equal(intradayMatchesSource(view('garmin:b|日静息心率|'),d),false))
test('unknown old account cannot satisfy an explicitly chosen account',()=>assert.equal(intradayMatchesSource(view('garmin:a|日静息心率|'),{...d,sourceId:undefined}),false))
test('an unselected cache without daily metric still exposes its original samples',()=>assert.equal(intradayMatchesSource(undefined,d),true))
test('unified source protocol matches its own device identity only',()=>assert.equal(intradayMatchesSource(view(JSON.stringify(['GARMIN','a','w','RHR_DAILY','bpm'])),{...d,sourceId:`garmin:${shortHash('a:w')}`}),true))
