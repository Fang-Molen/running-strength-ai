import test from 'node:test';import assert from 'node:assert/strict';import {buildAthleteBaseline} from './athlete-baseline.mjs';
test('missing values stay unknown',()=>{const x=buildAthleteBaseline([{date:'2026-01-01',resting_hr_mean:''}]);assert.equal(x.metrics.resting_hr_mean.status,'INSUFFICIENT_DATA');assert.equal(x.fatigue,'UNKNOWN')});
test('two disjoint windows',()=>{const rows=Array.from({length:40},(_,i)=>({date:`2026-01-${String(i+1).padStart(2,'0')}`,resting_hr_mean:i<20?50:52}));const x=buildAthleteBaseline(rows,{recentDays:20,minimumDays:10});assert.equal(x.metrics.resting_hr_mean.delta,2);assert.equal(x.recovery,'UNKNOWN')});
test('duplicates fail closed',()=>assert.throws(()=>buildAthleteBaseline([{date:'2026-01-01'},{date:'2026-01-01'}]),/DUPLICATE_DATE/));
test('invalid values not counted',()=>{const x=buildAthleteBaseline([{date:'2026-01-01',resting_hr_mean:'oops'}]);assert.equal(x.metrics.resting_hr_mean.totalDays,0)});
