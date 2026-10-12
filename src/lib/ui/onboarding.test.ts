import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyProfile } from '../strength/profile.ts'
import { DEFAULT_SPORT_GOAL } from './sport-goal.ts'
import { onboardingSteps } from './onboarding.ts'

test('new athlete remains unconfirmed, including safety', () => {
 const steps = onboardingSteps(emptyProfile(), DEFAULT_SPORT_GOAL)
 assert.equal(steps[0].complete, false)
 assert.equal(steps[1].complete, false)
 assert.equal(steps[2].complete, false)
})
test('goal and result do not imply safety confirmation', () => {
 const profile = emptyProfile()
 profile.marks[0].recent = '52.3'
 profile.limit = ''
 const steps = onboardingSteps(profile, DEFAULT_SPORT_GOAL)
 assert.deepEqual(steps.map(s=>s.complete), [true,true,false])
})
