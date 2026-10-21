import {test} from 'node:test';import {strict as assert} from 'node:assert';import {corosDailyRecoveryTrend,corosRecoveryInterpretation} from './coros-recovery-trend-v93.ts'
const f=(metric:any,value:number,id:string,unit:string,day='2026-10-20')=>({metric,value,unit,recordId:id,sourceId:'coros:account',measuredAt:day+'T10:00:00Z',statistic:'DAILY_TOTAL'})
test('COROS-only steps and sleep produce daily facts without body battery',()=>{const a=corosDailyRecoveryTrend([f('STEPS',12000,'s1','steps'),f('SLEEP_MINUTES',440,'z1','min')],0);assert.equal(a[0].steps,12000);assert.equal(a[0].sleepMinutes,440);assert.equal(corosRecoveryInterpretation(a).fatigueStatus,'UNDETERMINED')})
test('duplicate record does not double count',()=>{const x=f('STEPS',10000,'x','steps');assert.equal(corosDailyRecoveryTrend([x,x],0)[0].steps,10000)})
test('conflicting sources fail closed',()=>{const a=corosDailyRecoveryTrend([f('STEPS',10000,'x','steps'),f('STEPS',13000,'y','steps')],0);assert.equal(a[0].steps,null);assert.ok(a[0].warnings.length)})
test('missing HRV stays missing',()=>{assert.equal(corosDailyRecoveryTrend([f('STEPS',5000,'x','steps')],0)[0].hrvMs,null)})
test('timezone maps to athlete local day',()=>{assert.equal(corosDailyRecoveryTrend([f('STEPS',5000,'x','steps')],480)[0].day,'2026-10-20')})
