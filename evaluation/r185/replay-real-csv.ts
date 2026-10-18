import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {analyzePeriodicObservations} from '../../src/lib/core/coach-periodic-observations.ts'
const folder=process.env.R185_PRIVATE_DATA_DIR??'/workspace/fangkun/private-r185'
const csv=readFileSync(folder+'/weekly.csv','utf8')
const expected=JSON.parse(readFileSync(folder+'/expected.json','utf8')) as {cycleId:string;weeks:number;activities:number;runningActivities:number;meanWeeklyRhr:number|null;rhrWeeks:number}[]
for(const row of expected)test('real derived CSV local analysis: '+row.cycleId,()=>{
 const result=analyzePeriodicObservations(csv,'sha256:ea12fc08230e95492f43d28d545b1aa6e89f7359af27299140532b1ba64b00d6',row.cycleId)!
 assert.equal(result.weeks,row.weeks);assert.equal(result.activityCount,row.activities);assert.equal(result.runningActivityCount,row.runningActivities)
 assert.equal(result.rhrWeeks,row.rhrWeeks)
 if(row.meanWeeklyRhr===null)assert.equal(result.rhrWeeklyMean,null);else assert.ok(Math.abs(result.rhrWeeklyMean!-row.meanWeeklyRhr)<1e-9)
 for(const key of ['phase','purpose','fatigue','recovery'] as const)assert.equal(result[key],'UNKNOWN')
 assert.equal(result.confirmedTrainingSessions,null);assert.equal(result.planWrite,false);assert.equal(result.storageWrite,false)
 assert.ok(result.abilityAxes.every(a=>a.score===null&&a.trend===null&&a.status==='待评估'))
 assert.ok(result.text.includes(`活动汇总${row.activities}条`));assert.match(result.text,/活动条数不是训练课次数/);assert.match(result.text,/设备、同步或记录覆盖变化/)
})
