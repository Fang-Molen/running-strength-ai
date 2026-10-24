import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveR4Conditions} from './conditions'
import {defaultPersonalProfile} from '../personal/host'

const asOf='2026-10-24T12:00:00Z',profile={...defaultPersonalProfile('a'),age:30,screen:'CLEAR' as const,weightKg:60,goal:'HYPERTROPHY' as const,revision:1}
test('only fresh saved same-owner adult screening establishes educational population applicability',()=>{
 const input={athleteId:'a',asOf,profile,profileSavedAt:'2026-10-24T10:00:00Z',feedback:[]}
 assert.equal(resolveR4Conditions(input).population,'healthy_adult')
 assert.notEqual(resolveR4Conditions(input).version,resolveR4Conditions({...input,asOf:'2026-12-01T12:00:00Z'}).version,'freshness expiry invalidates an answer without a storage write')
 for(const patch of [{athleteId:'b'},{profileSavedAt:'2026-08-01T00:00:00Z'},{profileSavedAt:'2027-01-01T00:00:00Z'},{profile:{...profile,age:null}},{profile:{...profile,screen:'UNKNOWN' as const}}])assert.notEqual(resolveR4Conditions({...input,...patch}).population,'healthy_adult')
 assert.equal(resolveR4Conditions({...input,profile:{...profile,screen:'MEDICAL'}}).population,'special')
 assert.equal(resolveR4Conditions({...input,feedback:[{at:asOf,value:{pain:true}}]}).population,'special')
 assert.equal(resolveR4Conditions({...input,profile:{...profile,age:16}}).population,'special')
})
