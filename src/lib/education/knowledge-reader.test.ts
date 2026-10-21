import test from 'node:test'
import assert from 'node:assert/strict'
import { SPORT_DOCUMENTS, searchSportKnowledge } from './knowledge-catalog.ts'
import { athleteReading } from './knowledge-reader.ts'
import { learningQuestion, answerLearningQuestion } from './knowledge-presentation.ts'
import readings from './knowledge-reader.json' with { type: 'json' }

test('all 61 lessons have short readable conclusions, limited points and a retained qualification',()=>{
 const lessons=SPORT_DOCUMENTS.filter(d=>d.kind==='lesson')
 assert.equal(readings.length,lessons.length);assert.equal(new Set(readings.map(r=>r.id)).size,lessons.length)
 for(const doc of lessons){
  const r=athleteReading(doc);assert.equal(r.id,doc.id)
  assert.ok(r.summary.length<=45,doc.id);assert.ok(r.title.length<=32,doc.id)
  assert.ok(r.points.length>=2&&r.points.length<=3,doc.id);assert.ok(r.note.length>5,doc.id)
  assert.doesNotMatch(JSON.stringify(r),/Session|Component|Block|Step|生产|处方授权|映射|schema/)
  assert.ok(doc.sourceIds.length>0);assert.equal(doc.personalPrescription,false)
 }
})
test('all human questions identify one exact item; personal follow-ups still use normal coach pipeline',()=>{
 const questions=SPORT_DOCUMENTS.map(learningQuestion);assert.equal(new Set(questions).size,questions.length)
 for(const q of questions){assert.doesNotMatch(q,/EDU\d|资料编号/);assert.ok(answerLearningQuestion(q));assert.equal(answerLearningQuestion(q+'我胸痛还能继续吗'),null)}
})
test('plain-language titles and original terms both remain searchable',()=>{
 for(const [query,id] of [['能举多重','EDU007'],['肌肥大','EDU007'],['起跑','EDU039'],['Session','EDU058']])assert.ok(searchSportKnowledge({query,kind:'lesson',limit:1000}).items.some(r=>r.id===id),query)
})
