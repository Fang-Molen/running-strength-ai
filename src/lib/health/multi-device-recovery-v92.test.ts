import test from 'node:test'
import assert from 'node:assert/strict'
import { projectVerifiedMultiDeviceRecovery } from './multi-device-recovery-v92'
import type { VerifiedBatch } from './coros-evidence-v92'
import type { IntradayDay } from './garmin-intraday'
const now = '2026-10-21T12:00:00Z'
const request = () => ({ athleteId: 'a', day: '2026-10-21', now, utcOffsetMinutes: 0, garminDays: {} as Record<string,IntradayDay> })
const batch = (): VerifiedBatch => ({ athleteId:'a', accountRef:'opaque001', verifiedOwner:true, source:'COROS_VERIFIED_EXPORT',receivedAt:now,
 measures:[{id:'hr1',metric:'HEART_RATE',value:66,unit:'bpm',statistic:'INSTANT',measuredAt:'2026-10-21T09:00:00Z'}],
 sleeps:[{id:'nap1',startAt:'2026-10-21T10:00:00Z',endAt:'2026-10-21T10:20:00Z',kind:'NAP',evidence:'DEVICE_SLEEP'}],activities:[] })
const garmin = ():IntradayDay => ({schemaVersion:1,day:'2026-10-21',source:'garmin',fetchedAt:now,offsetMin:0,hr:[[Date.parse('2026-10-21T09:00:00Z'),70]],bb:[[Date.parse('2026-10-21T09:00:00Z'),51]],st:[],restingHr:50,sleep:null,training:[]})
test('COROS-only works without a Garmin day',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:batch()});assert.equal(v.view.metrics.HEART_RATE.status,'AVAILABLE');assert.equal(v.view.metrics.BODY_BATTERY.status,'NO_CONTINUOUS_DATA');assert.equal(v.corosAvailability?.bodyBattery,'UNSUPPORTED')})
test('verified device nap appears on the shared timeline',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:batch()});assert.ok(v.view.events.some(e=>e.kind==='NAP'&&e.status==='CONFIRMED'))})
test('Garmin-only preserves real Body Battery',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),garminDays:{'2026-10-21':garmin()}});assert.equal(v.view.metrics.BODY_BATTERY.status,'AVAILABLE');assert.equal(v.corosAvailability,null)})
test('two provider HR streams require explicit selection',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),garminDays:{'2026-10-21':garmin()},corosBatch:batch()});assert.equal(v.view.metrics.HEART_RATE.status,'SOURCE_CONFLICT');assert.equal(v.view.metrics.BODY_BATTERY.status,'AVAILABLE')})
test('user source preference selects COROS without merging HR',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),garminDays:{'2026-10-21':garmin()},corosBatch:batch(),preferredSources:{HEART_RATE:'coros:opaque001'}});assert.equal(v.view.metrics.HEART_RATE.status,'AVAILABLE');assert.equal(v.view.metrics.HEART_RATE.latest?.value,66)})
test('invalid ownership contributes no COROS data',()=>{const b=batch();b.verifiedOwner=false;const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:b});assert.equal(v.view.metrics.HEART_RATE.status,'NO_CONTINUOUS_DATA');assert.equal(v.corosAvailability?.loginVerified,false)})
test('athlete mismatch cannot leak health facts',()=>{const b=batch();b.athleteId='someone-else';const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:b});assert.equal(v.view.metrics.HEART_RATE.status,'NO_CONTINUOUS_DATA');assert.equal(v.dailyFacts.length,0)})
test('daily HRV is separate, not a fabricated intraday line',()=>{const b=batch();b.measures=[{id:'hrv1',metric:'HRV',value:64,unit:'ms',statistic:'DAILY_MEAN',measuredAt:'2026-10-21T07:00:00Z'}];const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:b});assert.equal(v.view.metrics.HEART_RATE.status,'NO_CONTINUOUS_DATA');assert.equal(v.dailyFacts[0]?.metric,'HRV')})
test('read-only projection cannot grant training permission',()=>{const v=projectVerifiedMultiDeviceRecovery({...request(),corosBatch:batch()});assert.equal(v.canAutoChangePlan,false);assert.equal(v.medicalClearance,false);assert.equal(v.coachFacts.autoPlanChange,false)})
