import test from 'node:test'
import assert from 'node:assert/strict'
import {buildConflictReviewContext,retrieveConflictReviews,CONFLICT_REVIEW_COUNT} from './research-conflict-index.ts'
import {buildCurriculumModelContext,CURRICULUM_SYSTEM_BOUNDARY} from './coach-curriculum.ts'
test('four review flags do not claim independent verification or authority',()=>{
 assert.equal(CONFLICT_REVIEW_COUNT,4)
 for(const r of retrieveConflictReviews('ACWR RED-S HRV 训练适应',4)){
  assert.equal(r.decisionAuthorization,false);assert.equal(r.personalFact,false)
  assert.equal(r.resolution,'UNRESOLVED_REVIEW_REQUIRED')
  assert.equal(r.sourceStatus,'HISTORICAL_RECORDS_NOT_REVERIFIED')
 }
})
test('ACWR and RED-S disagreements are routed into the existing model context',()=>{
 const a=buildCurriculumModelContext('ACWR 负荷比能自动调整吗？',10000)
 assert.ok(a.conflictReviews.entries.some(r=>r.id==='CI-ACWR'))
 const b=buildCurriculumModelContext('RED-S 的因果证据有争议吗？',10000)
 assert.ok(b.conflictReviews.entries.some(r=>r.id==='CI-REDS'))
 assert.match(CURRICULUM_SYSTEM_BOUNDARY,/conflictReviews/)
})
test('irrelevant prompt yields no conflicts and output remains bounded',()=>{
 assert.equal(retrieveConflictReviews('今天星期几').length,0)
 for(const n of [350,500,900,1300,2500]){
  const c=buildConflictReviewContext('ACWR RED-S HRV 训练适应',n)
  assert.ok(JSON.stringify(c).length<=n)
 }
 for(const n of [1000,1400,3000,7000]){
  const c=buildCurriculumModelContext('ACWR RED-S HRV 训练适应',n)
  assert.ok(JSON.stringify(c).length<=n)
 }
})
test('retrieved arrays cannot mutate registry',()=>{
 const a=retrieveConflictReviews('ACWR')
 Reflect.set(a[0].sourceRecordIds,0,'POISON')
 assert.notEqual(retrieveConflictReviews('ACWR')[0].sourceRecordIds[0],'POISON')
})
