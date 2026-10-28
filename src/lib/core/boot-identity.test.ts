import test from 'node:test'
import assert from 'node:assert/strict'
import { bootCore } from './boot'
import { currentAthleteId,setEventContext } from './events'
import { setStoreBackend } from './storage'
import { firstWeekMemory } from './coach-first-week.fixtures'
test('core boot preserves already authenticated athlete instead of switching to legacy local records',()=>{
 setStoreBackend(firstWeekMemory());setEventContext({athleteId:'account:synthetic-user'})
 try{bootCore();assert.equal(currentAthleteId(),'account:synthetic-user')}
 finally{setStoreBackend(null);setEventContext({athleteId:'local'})}
})
