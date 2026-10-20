import test from 'node:test'
import assert from 'node:assert/strict'
import { intradayMonitoringLine } from './u07-v88-host.ts'
import type { HealthSnapshot } from './snapshot.ts'
import type { FatigueReview } from './analysis.ts'
const asOf='2026-10-20T09:00:00Z'
const review={state:'INSUFFICIENT'} as FatigueReview
const snap=(statistic:string,measuredAt:string|null,value=90):HealthSnapshot=>({asOf:'2026-10-20',unreadable:false,metrics:[{metric:'BODY_BATTERY',label:'身体电量',state:'AVAILABLE',current:{id:'x',metric:'BODY_BATTERY',day:'2026-10-20',value,source:'Garmin',stream:'garmin:1',statistic,method:'',updatedAt:asOf,measuredAt,legacy:false},candidates:[],series:[],availableSources:[],selectedSource:null,baseline:null,notes:[]}]})
test('V88 daily maximum never masquerades as current battery',()=>{const r=intradayMonitoringLine(snap('当日最高','2026-10-20T08:55:00Z'),review,asOf);assert.equal(r.state,'DAILY_OR_STALE');assert.match(r.text,/非当前电量/);assert.equal(r.authorizedToTrain,false)})
test('V88 recent timestamped battery is only a device reading, not clearance',()=>{const r=intradayMonitoringLine(snap('最近值','2026-10-20T08:55:00Z'),review,asOf);assert.equal(r.state,'CURRENT');assert.match(r.text,/不是训练许可/);assert.equal(r.authorizedToTrain,false)})
test('V88 missing battery is not zero',()=>{const r=intradayMonitoringLine({...snap('日最高',asOf),metrics:[]},review,asOf);assert.equal(r.state,'UNAVAILABLE');assert.doesNotMatch(r.text,/0\/100/)})
test('V88 unreadable source does not claim recovery',()=>{const r=intradayMonitoringLine({...snap('最近值',asOf),unreadable:true},review,asOf);assert.equal(r.state,'SOURCE_ERROR')})
