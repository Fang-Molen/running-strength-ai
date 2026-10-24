import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveR4, scaleR4Reference, summarizeR4Nutrition } from './reference'

const input = {question:'只问今天的饮食', tasks:['nutrition'], population:'healthy_adult', fields:{foodEntries:[{name:'合成餐'}]}}
test('R4 keeps the original question and filters explicit tasks without granting authority',()=>{
 const r=retrieveR4(input)
 assert.equal(r.question,input.question)
 assert.ok(r.cards.some(c=>c.id==='K19'))
 assert.ok(r.cards.every(c=>c.tasks.includes('nutrition')))
 assert.equal(r.autoExecute,false);assert.equal(r.prescriptionApproved,false)
 assert.equal(r.version,'R4-20261024')
})
test('unknown population is not silently treated as healthy adult',()=>{
 const r=retrieveR4({...input,population:'unknown'})
 assert.deepEqual(r.cards,[]);assert.ok(r.excluded.length>0)
})
test('reference boundary rejects unknown task, invalid numeric condition and malformed fields',()=>{
 for(const bad of [{...input,tasks:['random']},{...input,fields:{weightKg:NaN}},{...input,fields:{weightKg:'60'}},{...input,fields:{foodEntries:'rice'}},{...input,fields:{availableMinutes:-1}}])assert.throws(()=>retrieveR4(bad))
})
test('retrieval is bounded explicitly and reports omissions rather than losing restrictions silently',()=>{
 const r=retrieveR4({...input,tasks:['nutrition','strength'],limit:1})
 assert.ok(r.cards.length<=1);assert.equal(r.autoExecute,false)
 assert.ok(r.needsInput.length>0)
})
test('reference uses the exact source and context, never a merged maximum',()=>{
 const r=scaleR4Reference({referenceId:'N-CARB',contextIndex:1,weightKg:60,population:'healthy_adult'})
 assert.deepEqual(r.range,[300,420]);assert.equal(r.source.id,'S09')
 assert.equal(r.status,'REFERENCE_NOT_PRESCRIPTION')
 assert.throws(()=>scaleR4Reference({referenceId:'N-CARB',contextIndex:999,weightKg:60,population:'healthy_adult'}))
 assert.throws(()=>scaleR4Reference({referenceId:'N-CARB',contextIndex:1,weightKg:60,population:'unknown'}))
})
test('partial nutrition preserves known sums, true zero and missing fields separately',()=>{
 const r=summarizeR4Nutrition([{kcal:400,protein:10},{kcal:null,protein:null},{kcal:0,protein:0}])
 assert.equal(r.kcal.knownSum,400);assert.equal(r.kcal.missing,1)
 assert.equal(r.protein.knownSum,10);assert.equal(r.protein.missing,1)
 assert.equal(r.coverage,'UNKNOWN');assert.equal(r.energyDeficit,null)
 const empty=summarizeR4Nutrition([])
 assert.equal(empty.kcal.status,'UNKNOWN');assert.equal(empty.kcal.knownSum,null)
})
