import test from 'node:test'
import assert from 'node:assert/strict'
import {selectComparableSeries,summarizeSeries,fitIndependentTrend,auditRollingForecast,pairedDifference95} from '../../src/lib/core/personal-uncertainty.ts'
import {comparableHealthSeries} from '../../src/lib/health/personal-statistics-adapter.ts'
const DAY=86400000
const day=(i)=>new Date(Date.parse('2026-01-01T00:00:00Z')+i*DAY).toISOString().slice(0,10)
const mk=(n=55,fn=i=>55+i*.08+Math.sin(i*2.399963)*1.3)=>Array.from({length:n},(_,i)=>({observationId:'o'+i,athleteId:'A',metric:'RHR',day:day(i),value:fn(i),unit:'bpm',protocol:'garmin:rhr:v1',sourceId:'garmin:1',revision:'v1',recordedAt:day(i)+'T12:00:00Z',kind:'ACTUAL'}))
const scoped=(data=mk())=>selectComparableSeries({observations:data,athleteId:'A',metric:'RHR',protocol:'garmin:rhr:v1',unit:'bpm',asOf:'2026-04-01T00:00:00Z'})
test('valid series retains n and provenance',()=>{const x=scoped();assert.equal(x.status,'AVAILABLE');assert.equal(x.points.length,55);assert.deepEqual(x.sourceIds,['garmin:1']);assert.equal(x.decisionAuthorized,false)})
test('different athlete and protocol never mix',()=>{const x=scoped([...mk(10),{...mk(1)[0],athleteId:'B',value:900},{...mk(1)[0],protocol:'other',value:999}]);assert.equal(x.points.length,10)})
test('unknown and future revisions do not backfill',()=>{const x=scoped([...mk(8),{...mk(1)[0],observationId:'future',day:day(12),recordedAt:'2027-01-01T00:00:00Z'}]);assert.equal(x.points.length,8);assert(x.rejected.includes('future'))})
test('same observation retransmission deduplicates',()=>{const p=mk(1)[0],x=scoped([p,p]);assert.equal(x.points.length,1);assert.equal(x.conflictingDays.length,0)})
test('conflicting revisions cannot be silently chosen',()=>{const p=mk(1)[0],x=scoped([p,{...p,value:p.value+3}]);assert.equal(x.status,'CONFLICT');assert.equal(x.points.length,0)})
test('different same-day observations conflict',()=>{const p=mk(2),x=scoped([p[0],{...p[0],observationId:'second',value:70},p[1]]);assert.equal(x.status,'CONFLICT');assert.deepEqual(x.conflictingDays,[day(0)])})
test('missing days not zero-filled',()=>{const x=scoped(mk(10).filter((_,i)=>i!==3));assert.equal(x.points.length,9);assert(!x.points.some(p=>p.value===0))})
test('invalid numeric and timestamps are excluded',()=>{const x=scoped([...mk(5),{...mk(1)[0],observationId:'nan',value:NaN},{...mk(1)[0],observationId:'badtime',recordedAt:'nonsense'}]);assert.equal(x.points.length,5);assert.equal(x.rejected.length,2)})
test('descriptive statistics match known values',()=>{const x=scoped(mk(5,i=>i+1)),s=summarizeSeries(x);assert.equal(s.mean,3);assert.equal(s.median,3);assert.equal(s.sd,Math.sqrt(2.5));assert.equal(s.mad,1);assert.equal(s.p10,1.4)})
test('constant series sd zero but no imaginary confidence',()=>{const x=scoped(mk(10,()=>55)),s=summarizeSeries(x),t=fitIndependentTrend(x);assert.equal(s.sd,0);assert.equal(t.status,'ASSUMPTIONS_UNMET');assert.equal(t.slopeCi95,null)})
test('OLS slope, t confidence, PI are separate',()=>{const x=scoped(mk(35,i=>55+i*.08+Math.sin(i*4.3)*1.3)),t=fitIndependentTrend(x);assert.equal(t.status,'AVAILABLE');assert(t.slopePerDay>0);assert(t.slopeCi95[0]<t.slopePerDay&&t.slopeCi95[1]>t.slopePerDay);assert(t.nextPredictionInterval95[1]-t.nextPredictionInterval95[0]>t.slopeCi95[1]-t.slopeCi95[0])})
test('highly serially correlated residuals suppress CIs',()=>{const x=scoped(mk(40,i=>60+.1*i+4*Math.sin(i*.18))),t=fitIndependentTrend(x);assert.equal(t.status,'ASSUMPTIONS_UNMET');assert.equal(t.slopeCi95,null)})
test('too few observations suppress regression',()=>{assert.equal(fitIndependentTrend(scoped(mk(7))).status,'INSUFFICIENT')})
test('chronological forecast with holdout and no future leakage',()=>{const x=scoped(mk(70,i=>55+Math.sin(i*2.3))),r=auditRollingForecast(x);assert.equal(r.status,'AVAILABLE');assert(r.calibrationN>=19);assert(r.holdoutN>=5);assert(r.empiricalHoldoutCoverage>=0&&r.empiricalHoldoutCoverage<=1);assert(r.nextInterval[0]<r.nextPrediction)})
test('short history cannot claim finite 95% conformal interval',()=>{const r=auditRollingForecast(scoped(mk(23)));assert.equal(r.status,'INSUFFICIENT');assert.equal(r.nextInterval,null)})
test('a shift in holdout lowers coverage; do not hide failure',()=>{const r=auditRollingForecast(scoped(mk(70,i=>55+(i>=56?15:0)+Math.sin(i*2.3))));assert.equal(r.status,'REVIEW_REQUIRED');assert(r.empiricalHoldoutCoverage<.75);assert.equal(r.nextInterval,null)})
test('paired difference and interval',()=>{const p=Array.from({length:12},(_,i)=>({pairId:'p'+i,before:60+i,after:62+i+(i%3-1)}));const r=pairedDifference95(p,'bpm');assert.equal(r.status,'AVAILABLE');assert.equal(r.meanDifference,2);assert(r.ci95[0]<2&&r.ci95[1]>2)})
test('duplicate pair identifiers rejected',()=>{const p=Array.from({length:8},(_,i)=>({pairId:'same',before:i,after:i+1}));assert.equal(pairedDifference95(p,'bpm').status,'INSUFFICIENT')})
test('health adapter preserves V87 source and as-of',()=>{
 const points=mk(12).map((o,i)=>({id:o.observationId,metric:'RHR',day:o.day,value:o.value,source:'佳明',stream:'garmin:1',statistic:'日静息心率',method:'',updatedAt:o.recordedAt,measuredAt:o.recordedAt,legacy:false}));
 const view={metric:'RHR',label:'静息心率',state:'AVAILABLE',current:points.at(-1),candidates:[points.at(-1)],series:points,availableSources:[],selectedSource:null,baseline:null,notes:[]};
 const x=comparableHealthSeries({snapshot:{asOf:day(11),metrics:[view],unreadable:false},athleteId:'A',metric:'RHR',asOf:'2026-01-20T00:00:00Z'});assert.equal(x.points.length,12)
})
test('health adapter blocks unknown method HRV and unreadable snapshot',()=>{
 const p={id:'hrv',metric:'HRV',day:day(0),value:50,source:'设备',stream:'garmin:1',statistic:'日HRV',method:'UNKNOWN',updatedAt:day(0)+'T12:00:00Z',measuredAt:null,legacy:false};
 const view={metric:'HRV',label:'HRV',state:'AVAILABLE',current:p,candidates:[],series:[p],availableSources:[],selectedSource:null,baseline:null,notes:[]};
 const x=comparableHealthSeries({snapshot:{asOf:day(0),metrics:[view],unreadable:false},athleteId:'A',metric:'HRV',asOf:'2026-01-20T00:00:00Z'});assert.equal(x.points.length,0)
 const y=comparableHealthSeries({snapshot:{asOf:day(0),metrics:[{...view,current:{...p,method:'RMSSD'}}],unreadable:true},athleteId:'A',metric:'HRV',asOf:'2026-01-20T00:00:00Z'});assert.equal(y.points.length,0)
})

test('missing days block day-ahead prediction',()=>{const r=auditRollingForecast(scoped(mk(70).filter((_,i)=>i!==22)));assert.equal(r.status,'INSUFFICIENT');assert.equal(r.reason,'GAPS_IN_DAILY_SERIES')})
test('future-dated observation is excluded even if recordedAt claims past',()=>{const x=scoped([...mk(5),{...mk(1)[0],observationId:'futureDay',day:'2026-04-02',recordedAt:'2026-03-01T00:00:00Z'}]);assert.equal(x.points.length,5);assert(x.rejected.includes('futureDay'))})
test('conflicted source cannot generate summary',()=>{const p=mk(4),x=scoped([...p,{...p[0],observationId:'another',value:999}]);assert.equal(summarizeSeries(x).status,'INSUFFICIENT')})

test('later corrections cannot change as-of historical statistics',()=>{const base=mk(15),later={...base[3],observationId:'correction',value:99,recordedAt:'2027-01-01T00:00:00Z'};const a=scoped(base),b=scoped([...base,later]);assert.equal(summarizeSeries(a).mean,summarizeSeries(b).mean)})
import {buildPersonalStatisticsCard} from '../../src/lib/health/personal-statistics-view.ts'
test('UI card does not show a fake interval after regime shift',()=>{
 const c=buildPersonalStatisticsCard(scoped(mk(70,i=>55+(i>=56?15:0)+Math.sin(i*2.3))));
 assert.equal(c.status,'STATISTICAL_REVIEW');assert(!c.lines.some(s=>s.includes('下一日统计预测')));assert(c.caveats.some(s=>s.includes('已隐藏')))
})
test('UI card clearly marks historical data, not current state',()=>{
 const c=buildPersonalStatisticsCard(scoped(mk(12)));
 assert.equal(c.status,'HISTORY_ONLY');assert(c.caveats.some(s=>s.includes('不能代表今天')))
})
import {draftPersonalForecast} from '../../src/lib/core/personal-forecast-decision-bridge.ts'
test('bridge makes a precommitted read-only decision draft with source revision',()=>{
 const x=selectComparableSeries({observations:mk(70,i=>55+Math.sin(i*2.3)),athleteId:'A',metric:'RHR',protocol:'garmin:rhr:v1',unit:'bpm',asOf:day(69)+'T18:00:00Z'})
 const d=draftPersonalForecast({series:x,decisionId:'D1',caseId:'C1',createdAt:day(69)+'T18:00:00Z',dueAt:day(70)+'T18:00:00Z',direction:'LOWER_BETTER',safetyHold:false})
 assert(d);assert.equal(d.planWrite,false);assert.equal(d.athleteId,'A');assert.deepEqual(d.sources,[{sourceId:'garmin:1',revision:'v1'}]);assert.equal(d.forecastValue,auditRollingForecast(x).nextPrediction)
})
test('bridge blocks stale series and uncertain forecasts',()=>{
 const x=scoped(mk(70,i=>55+(i>=56?15:0)+Math.sin(i*2.3)))
 assert.equal(draftPersonalForecast({series:x,decisionId:'D',caseId:'C',createdAt:'2026-03-11T18:00:00Z',dueAt:'2026-03-12T18:00:00Z',direction:'LOWER_BETTER',safetyHold:false}),null)
})
import {auditDecision} from '../../src/lib/core/coach-decision-calibration.ts'
test('real V87 decision calibration accepts U09 draft and audits future outcome',()=>{
 const x=selectComparableSeries({observations:mk(70,i=>55+Math.sin(i*2.3)),athleteId:'A',metric:'RHR',protocol:'garmin:rhr:v1',unit:'bpm',asOf:day(69)+'T18:00:00Z'})
 const d=draftPersonalForecast({series:x,decisionId:'D1',caseId:'C1',createdAt:day(69)+'T18:00:00Z',dueAt:day(70)+'T18:00:00Z',direction:'LOWER_BETTER',safetyHold:false})
 const o={id:'O1',athleteId:'A',caseId:'C1',observedAt:day(70)+'T10:00:00Z',recordedAt:day(70)+'T12:00:00Z',source:{sourceId:'garmin:1',revision:'v1'},metricId:'RHR',protocolKey:'garmin:rhr:v1',unit:'bpm',value:55.3,measurementValid:true}
 assert.equal(auditDecision(d,o,{'garmin:1':'v1'}).state,'EVALUABLE')
 assert.equal(auditDecision(d,o,{'garmin:1':'v2'}).state,'SUPERSEDED')
})

test('realistic per-day revisions require a trusted source-wide version',()=>{
 const data=mk(70,i=>55+Math.sin(i*2.3)).map((p,i)=>({...p,revision:'updated-'+i}))
 const x=selectComparableSeries({observations:data,athleteId:'A',metric:'RHR',protocol:'garmin:rhr:v1',unit:'bpm',asOf:day(69)+'T18:00:00Z'})
 assert.equal(auditRollingForecast(x).status,'AVAILABLE')
 const args={series:x,decisionId:'D2',caseId:'C2',createdAt:day(69)+'T18:00:00Z',dueAt:day(70)+'T18:00:00Z',direction:'LOWER_BETTER',safetyHold:false}
 assert.equal(draftPersonalForecast(args),null)
 const d=draftPersonalForecast({...args,sourceVersions:{'garmin:1':'host-stream-rev-70'},coverageVersion:{sourceId:'query:athlete-A:RHR:window',revision:'query-rev-70'}})
 assert(d)
 assert.deepEqual(d.sources,[{sourceId:'garmin:1',revision:'host-stream-rev-70'},{sourceId:'query:athlete-A:RHR:window',revision:'query-rev-70'}])
 assert.equal(auditDecision(d,null,{'garmin:1':'host-stream-rev-70','query:athlete-A:RHR:window':'query-rev-71'}).state,'SUPERSEDED')
 assert.equal(draftPersonalForecast({...args,sourceVersions:{'garmin:1':''}}),null)
})
