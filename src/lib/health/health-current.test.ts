import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBodyBattery } from './health-current'
import { buildHealthSnapshot } from './snapshot'
import type { IntradayDay } from './garmin-intraday'
const day='2026-10-22',at=(h:string)=>`${day}T${h}:00+08:00`,now=at('15:00')
const sample=(options:Partial<IntradayDay>={}):IntradayDay=>({schemaVersion:1,day,source:'garmin',sourceId:'garmin:a',fetchedAt:at('12:30'),offsetMin:480,bb:[[Date.parse(at('12:27')),50]],hr:[],restingHr:null,sleep:null,training:[],...options})
const daily=(value=41,stat='同步时最近值',synced=at('14:50'),measuredAt:string|null=null,source='garmin:a')=>({metric:'BODY_BATTERY' as const,day,value,source:'佳明账号同步',observation:{key:`${source}:bb:${day}`,sourceId:source,statistic:stat,syncedAt:synced,measuredAt}})
const view=(row= daily(),preferred:Record<string,string>={})=>buildHealthSnapshot([], [row],day,preferred).metrics.find(m=>m.metric==='BODY_BATTERY')!
test('newer daily most-recent value wins over old curve but never invents a measurement time',()=>{const d=sample(),r=resolveBodyBattery(view(),d,day,now);assert.equal(r.value,41);assert.equal(r.basis,'DAILY_RECENT');assert.equal(r.measuredAt,null);assert.equal(r.syncedAt,at('14:50'));assert.equal(d.bb.length,1);assert.equal(d.bb[0][1],50)})
test('newer intraday sample wins over earlier summary',()=>{const r=resolveBodyBattery(view(),sample({fetchedAt:at('14:59'),bb:[[Date.parse(at('14:58')),39]]}),day,now);assert.equal(r.value,39);assert.equal(r.measuredAt,new Date(at('14:58')).toISOString())})
test('newly retrieved summary with known older measurement does not override newer sample',()=>{assert.equal(resolveBodyBattery(view(daily(41,'同步时最近值',at('14:50'),at('11:00'))),sample(),day,now).value,50)})
test('daily maximum never becomes a live reading when a real sample exists',()=>{assert.equal(resolveBodyBattery(view(daily(80,'当日最高（非当前值）')),sample(),day,now).value,50)})
test('daily maximum alone stays explicitly a daily summary',()=>{const r=resolveBodyBattery(view(daily(80,'当日最高（非当前值）')),null,day,now);assert.equal(r.basis,'DAILY_SUMMARY');assert.equal(r.measuredAt,null);assert.match(r.statistic,/最高/)})
test('chosen daily max is respected, not silently changed to current sample',()=>{const row=daily(80,'当日最高（非当前值）'),v=view(row);v.selectedSource=v.current!.stream;assert.equal(resolveBodyBattery(v,sample(),day,now).value,80)})
test('cross-source conflicts are not hidden behind the Garmin curve',()=>{const v=buildHealthSnapshot([], [daily(),daily(70,'同步时最近值',at('14:50'),null,'garmin:b')],day).metrics.find(m=>m.metric==='BODY_BATTERY')!;assert.equal(resolveBodyBattery(v,sample(),day,now).basis,'CONFLICT');assert.equal(resolveBodyBattery(v,sample(),day,now).value,null)})
test('different identified Garmin accounts must not be mixed automatically',()=>{assert.equal(resolveBodyBattery(view(),sample({sourceId:'garmin:b'}),day,now).basis,'CONFLICT')})
test('explicit source selection has precedence over another account curve',()=>{const v=view();v.selectedSource=v.current!.stream;assert.equal(resolveBodyBattery(v,sample({sourceId:'garmin:b'}),day,now).value,41)})
test('unsupported selected source is not filled with Garmin data',()=>{const v=view();v.selectedSource='coros:unknown|bb|';v.current=null;v.series=[];v.candidates=[];v.state='MISSING';assert.equal(resolveBodyBattery(v,sample(),day,now).value,null)})
test('failed series fetch cannot freshen preserved points and suppress a real new daily value',()=>{assert.equal(resolveBodyBattery(view(),sample({fetchedAt:at('14:59'),failedReadings:['bb'],readingFetchedAt:{bb:at('12:30')}}),day,now).value,41)})
test('future and invalid samples are not used',()=>{const r=resolveBodyBattery(undefined,sample({bb:[[Date.parse(at('15:01')),99],[NaN,22],[Date.parse(at('12:00')),40]]}),day,now);assert.equal(r.value,40)})
test('a later sync does not replace a genuine sample timestamp',()=>{const r=resolveBodyBattery(undefined,sample({fetchedAt:at('14:59')}),day,now);assert.equal(r.measuredAt,new Date(at('12:27')).toISOString())})
test('historical day never borrows today data',()=>{assert.equal(resolveBodyBattery(view(),sample(), '2026-10-21',now).value,null)})
test('future daily receipt is not used before it becomes known',()=>{assert.equal(resolveBodyBattery(view(),null,day,at('12:00')).value,null)})
test('same sync receipt: most-recent day snapshot wins over an older intraday sample',()=>{const r=resolveBodyBattery(view(),sample({fetchedAt:at('14:50')}),day,now);assert.equal(r.value,41);assert.equal(r.basis,'DAILY_RECENT');assert.equal(r.measuredAt,null)})
test('same receipt with an equally timed actual measurement keeps the measured sample',()=>{const r=resolveBodyBattery(view(),sample({fetchedAt:at('14:50'),bb:[[Date.parse(at('14:50')),40]]}),day,now);assert.equal(r.value,40);assert.equal(r.basis,'INTRADAY')})
test('a conflicting record received after the cutoff does not hide the earlier available reading',()=>{
 const a=daily(41,'同步时最近值',at('14:50')),b=daily(70,'同步时最近值',at('15:10'),null,'garmin:b')
 const v=buildHealthSnapshot([], [a,b],day).metrics.find(m=>m.metric==='BODY_BATTERY')!
 assert.equal(v.state,'CONFLICT');const r=resolveBodyBattery(v,null,day,now);assert.equal(r.value,41);assert.equal(r.basis,'DAILY_RECENT')
})
