import test from 'node:test'
import assert from 'node:assert/strict'
import {teachingReplay,sixWeekReplay,demonstrations} from './acceptance-replay'

test('twenty teaching inputs produce bounded outputs without passing answer keys into application functions',()=>{
 const rows=teachingReplay(),byId=(id:string)=>rows.find(r=>r.caseId===id)!
 assert.equal(rows.length,20)
 for(const row of rows){
  assert.doesNotMatch(JSON.stringify(row.input),/referenceAnswer|expectedDecision|evaluatorOnly/)
  assert.equal(row.actualOutput.review.selection.question,row.input.question)
  assert.equal(row.actualOutput.saved,false);assert.equal(row.actualOutput.modelCalled,false)
  assert.equal(row.actualOutput.review.selection.prescriptionApproved,false)
  assert.equal(row.verdict,'PARTIAL_DETERMINISTIC_OUTPUT_NOT_APP_ACCEPTED')
 }
 const c3=byId('C03').actualOutput.calculations
 assert.equal(c3.find(c=>c.metric==='RUN_WORK_SECONDS')?.value,980)
 assert.equal(c3.find(c=>c.metric==='RUN_DISTANCE_M')?.value,4000)
 assert.equal(byId('C05').actualOutput.assessment.safetyState,'HOLD_ACTIVE')
 assert.equal(byId('C10').actualOutput.calculations.find(c=>c.metric==='STRENGTH_EXTERNAL_VOLUME_KG_REPS')?.value,320)
 assert.deepEqual(byId('C17').referenceCalculation?.range,[300,420])
 assert.equal(byId('C01').actualOutput.review.nutrition.energyDeficit,null)
 assert.equal(byId('C15').actualOutput.review.nutrition.protein.status,'PARTIAL')
 assert.equal(byId('C20').actualOutput.calculations.find(c=>c.metric==='RUN_WORK_SECONDS')?.value,210)
})
test('six weeks preserve as-of corrections, device segmentation and distinct strength observations for equal runners',()=>{
 const result=sixWeekReplay()
 assert.equal(result.rows.length,12);assert.equal(result.fullAppAcceptance,false)
 const a=result.rows.find(r=>r.week===6&&r.athleteId==='adult-a')!,b=result.rows.find(r=>r.week===6&&r.athleteId==='adult-b')!
 assert.equal(a.result.review.capability.strength.records[0].sets[0].loadKg,60)
 assert.equal(b.result.review.capability.strength.records[0].sets[0].loadKg,10)
 assert.ok(result.rows.filter(r=>r.week>=5).every(r=>r.result.review.baselines.some(s=>s.missingDays>0)))
 assert.ok(result.rows.every(r=>r.result.review.baselines.every(s=>!s.values.includes(0))))
})
test('three actual component demonstrations recompute values while leaving write authority disabled',()=>{
 const result=demonstrations()
 assert.equal(result.browserEndToEndAccepted,false)
 assert.equal(result.runningCorrection.after.saved,false)
 assert.equal(result.sameOccurrenceRunningStrength.planWritten,false)
 assert.equal(result.nutritionCompletion.after.review.nutrition.protein.knownSum,25)
})
