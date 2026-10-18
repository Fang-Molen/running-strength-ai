import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzePeriodicObservations} from './coach-periodic-observations.ts'
const header='week_start,week_end,cycle_id,activity_count,running_sessions,rhr_days,rhr_mean\n'
const row='2026-10-05,2026-10-11,OBS-A,5,4,2,60'
test('weekly observations expose facts but no course count, scoring, diagnosis or writes',()=>{const r=analyzePeriodicObservations(header+row,'synthetic')!;assert.equal(r.activityCount,5);assert.equal(r.rhrWeeklyMean,60);assert.equal(r.confirmedTrainingSessions,null);assert.equal(r.fatigue,'UNKNOWN');assert.equal(r.planWrite,false);assert.equal(r.storageWrite,false);assert.ok(r.abilityAxes.every(a=>a.score===null))})
test('missing weekly counts and RHR are not zero-filled',()=>{const r=analyzePeriodicObservations(header+'2026-10-05,2026-10-11,OBS-A,,,,','synthetic')!;assert.equal(r.activityCount,null);assert.equal(r.rhrWeeklyMean,null);assert.equal(r.missingActivityWeeks,1);assert.equal(r.emptyWeeks,0)})
test('duplicate weeks cannot be silently merged as same athlete/device',()=>assert.throws(()=>analyzePeriodicObservations(header+row+'\n'+row,'synthetic'),/重复/))
test('unknown date, malformed structure and impossible coverage are rejected',()=>{for(const bad of [row.replace('2026-10-05','2026-02-30'),row+',extra',row.replace(',2,60',',8,60'),row.replace(',5,4',',3,4')])assert.throws(()=>analyzePeriodicObservations(header+bad,'synthetic'))})
test('unrecognized CSV is not promoted to a weekly training dataset',()=>assert.equal(analyzePeriodicObservations('id,time\na,1','synthetic'),null))
