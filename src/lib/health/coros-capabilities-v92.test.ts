import test from 'node:test'
import assert from 'node:assert/strict'
import {corosRecoveryAvailability} from './coros-capabilities-v92'
import {adaptVerifiedCoros,type VerifiedBatch} from './coros-evidence-v92'
test('COROS no confirmed samples: do not claim availability',()=>{
 const b:VerifiedBatch={athleteId:'a',accountRef:'opaquehash001',verifiedOwner:true,source:'COROS_VERIFIED_SYNC',receivedAt:'2026-10-21T12:00:00Z',measures:[],sleeps:[],activities:[]}
 const a=corosRecoveryAvailability(adaptVerifiedCoros(b,'a',b.receivedAt))
 assert.equal(a.intradayHeartRate,'NO_DATA');assert.equal(a.bodyBattery,'UNSUPPORTED');assert.equal(a.muscleScenario,'NO_CONFIRMED_WORKOUT')
})
