import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeActivities, applyV4Fact, activityWeeks, type ActivityRow } from './training-read-model'
import { v4DayFact } from './plan400-view'
import { fmtPace } from './activity-format'

const day = '2026-10-28'
const run = (id: string, source: ActivityRow['source'] = 'import'): ActivityRow => ({
  id, source, originIds: [id], date: day, startedAt: day+'T08:00:00Z', sport: 'RUNNING',
  distanceM: 6010, durationSec: 1611.94, strengthVolumeKg: null, sets: null, rpe: null,
})
const fact = { ...v4DayFact({ date:day, orig:day, weekday:'三', week:'1', title:'合成跑步', main:['轻松跑'], aux:[], strength:[] }, undefined, {runLinked:true}), date:day }

test('X01 linked import and watch count 26:51.94 once, before and after V4 projection/reload', () => {
  const a=run('import:A'), b={...run('garmin:A','garmin'),originIds:['garmin:A','import:A']}
  const original=JSON.stringify([a,b])
  const [row]=mergeActivities([a,b])
  applyV4Fact(row,fact)
  assert.equal(row.durationSec,1611.94)
  assert.equal(fmtPace(row.distanceM,row.durationSec),`4'28"/km`)
  assert.equal(activityWeeks([row],day,1)[0].minutes,27)
  const reloaded=JSON.parse(JSON.stringify(row))
  applyV4Fact(reloaded,fact)
  assert.equal(reloaded.durationSec,1611.94)
  assert.equal(JSON.stringify([a,b]),original,'read projection must not change source records')
})

test('X01 same day/time/distance without identity remains two activities; unlink restores two rows', () => {
  const a=run('A'), b=run('B','garmin')
  assert.equal(mergeActivities([a,b]).length,2)
  assert.equal(mergeActivities([a,{...b,originIds:['A','B']}]).length,1)
  assert.equal(mergeActivities([a,b]).length,2)
})

test('X01 conflicting source durations remain visible and are not summed or silently preferred', () => {
  const [row]=mergeActivities([run('A'),{...run('A','garmin'),durationSec:1800}])
  applyV4Fact(row,fact)
  assert.equal(row.durationSec,null)
  assert.match(row.measurementNote ?? '',/冲突/)
  assert.deepEqual(row.members?.map(m=>m.durationSec),[1611.94,1800])
})

test('X01 unknown duplicate is not a missing component or a zero-duration activity', () => {
  const [row]=mergeActivities([{...run('A'),durationSec:null},run('A','garmin')])
  applyV4Fact(row,fact)
  assert.equal(row.durationSec,1611.94)
  assert.equal(row.durationPartial,false)
})

test('X01 mixed session keeps run pace separate and does not invent non-overlapping component time', () => {
  const lift={...run('lift','execution'),sport:'STRENGTH' as const,distanceM:null,durationSec:1800,originIds:['session','lift']}
  const [row]=mergeActivities([lift,{...run('run'),originIds:['session','run']}])
  assert.equal(row.runningDurationSec,1611.94)
  assert.equal(row.runningDistanceM,6010)
  assert.equal(row.durationSec,null,'without separate timing, overlap/whole-session scope is unknown')
  assert.match(row.measurementNote ?? '',/分项|重叠/)
})

test('X01 remerging projected rows retains individual sources and remains idempotent', () => {
  const rows=[run('A'),run('A','garmin')]
  const once=mergeActivities(rows)
  assert.deepEqual(mergeActivities(once),once)
})

test('X01 explicit disjoint components can sum; overlap or a corrected conflicting source cannot',()=>{
 const a={...run('run'),endedAt:day+'T08:27:00Z',originIds:['session','run']};
 const b={...run('lift','execution'),sport:'STRENGTH' as const,distanceM:null,startedAt:day+'T08:30:00Z',endedAt:day+'T09:00:00Z',durationSec:1800,originIds:['session','lift']};
 assert.equal(mergeActivities([a,b])[0].durationSec,3411.94);
 assert.equal(mergeActivities([a,{...b,startedAt:day+'T08:15:00Z'}])[0].durationSec,null);
 const corrected={...a,durationSec:1600};
 assert.equal(mergeActivities([corrected,{...corrected,source:'garmin'}])[0].durationSec,1600);
 assert.equal(mergeActivities([corrected,{...a,source:'garmin'}])[0].durationSec,null);
});

test('1A a third source joining two explicit identities collapses the whole activity once in any input order', () => {
  const a = run('import:A'), b = run('import:B')
  const bridge = { ...run('garmin:A', 'garmin'), originIds: ['garmin:A', 'import:A', 'import:B'] }
  for (const rows of [[a, b, bridge], [b, a, bridge], [bridge, a, b]]) {
    const original = JSON.stringify(rows)
    const merged = mergeActivities(rows)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].durationSec, 1611.94)
    assert.equal(merged[0].distanceM, 6010)
    assert.equal(merged[0].members?.length, 3)
    assert.equal(activityWeeks(merged, day, 1)[0].minutes, 27)
    assert.equal(JSON.stringify(mergeActivities(JSON.parse(JSON.stringify(merged)))), JSON.stringify(merged))
    assert.equal(JSON.stringify(rows), original)
  }
})
