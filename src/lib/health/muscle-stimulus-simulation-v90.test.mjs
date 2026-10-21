// @ts-nocheck — 合入包原测试（纯 JS）
import test from 'node:test'
import assert from 'node:assert/strict'
import {simulateMuscleStimulus} from './muscle-stimulus-simulation-v90.ts'
const now='2026-10-21T12:00:00Z'
const run={id:'run1',modality:'RUN',occurredAt:'2026-10-20T12:00:00Z'}
const lift={id:'lift1',modality:'STRENGTH',occurredAt:'2026-10-20T18:00:00Z',actualSets:3}
test('missing training does not generate imaginary curve',()=>assert.equal(simulateMuscleStimulus({asOf:now,evidence:[]}),null))
test('unverified strength without completed sets does not enter',()=>assert.equal(simulateMuscleStimulus({asOf:now,evidence:[{...lift,actualSets:null}]}),null))
test('future and stale events excluded',()=>assert.equal(simulateMuscleStimulus({asOf:now,evidence:[{...run,occurredAt:'2026-10-22T00:00:00Z'},{...lift,occurredAt:'2026-10-10T00:00:00Z'}]}),null))
test('same event not counted twice',()=>{const a=simulateMuscleStimulus({asOf:now,evidence:[run,run,lift,lift]});assert.equal(a.eventCount,2);assert.equal(a.strengthEvents,1);assert.equal(a.runningEvents,1)})
test('different evidence changes the simulation',()=>{const a=simulateMuscleStimulus({asOf:now,evidence:[run]}),b=simulateMuscleStimulus({asOf:now,evidence:[run,lift]});assert.notDeepEqual(a.points,b.points)})
test('scenario has no training permission or recovery percentage',()=>{const a=simulateMuscleStimulus({asOf:now,evidence:[lift]});assert.equal(a.mode,'ILLUSTRATIVE_UNCALIBRATED');assert.equal(a.isRecoveryPercent,false);assert.equal(a.canAuthorizeTraining,false);assert.match(a.disclaimer,/未校准/)})
test('future illustrative stimulus declines after last training',()=>{const a=simulateMuscleStimulus({asOf:now,evidence:[run,lift]});const p=x=>a.points.find(t=>t.offsetHours===x).central;assert.ok(p(48)<p(24));assert.ok(p(24)<p(0))})
test('correction of strength sets changes projection',()=>{const a=simulateMuscleStimulus({asOf:now,evidence:[run,lift]}),b=simulateMuscleStimulus({asOf:now,evidence:[run,{...lift,actualSets:6}]});assert.notDeepEqual(a.points,b.points)})
test('unknown timestamps and invalid time are rejected',()=>{assert.equal(simulateMuscleStimulus({asOf:now,evidence:[{...run,occurredAt:null}]}),null);assert.throws(()=>simulateMuscleStimulus({asOf:'bad',evidence:[run]}))})
