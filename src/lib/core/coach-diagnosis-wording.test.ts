import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DIAGNOSIS_TERMS,diagnosisWordingIssues,filterDiagnosisWording} from './coach-diagnosis-wording.ts'
import {request} from '../../../evaluation/r6/fixtures.ts'
import {interpretCoachModelOutput} from '../strength/coach-pipeline'
test('R11 diagnosis vocabulary has at least eighty entries',()=>assert.ok(new Set(DIAGNOSIS_TERMS).size>=80))
for(const [i,line] of readFileSync(new URL('./__fixtures__/diagnosis-wording.jsonl',import.meta.url),'utf8').trim().split('\n').entries())test(`R11 diagnosis context ${i}`,()=>{
 const row=JSON.parse(line)
 assert.equal(diagnosisWordingIssues(row.text).length>0,row.violation)
 const filtered=filterDiagnosisWording(row.text)
 assert.equal(diagnosisWordingIssues(filtered.text).length,0)
 if(row.text.includes('40分钟'))assert.match(filtered.text,/40分钟/)
})
for(const term of ['髌腱炎','心肌炎','低钠血症','应力性骨折'])test(`R11 pipeline diagnosis filtering ${term}`,()=>{
 const result=interpretCoachModelOutput(request([],undefined,undefined,'想了解训练后不适的处理原则'),JSON.stringify({mode:'answer',text:`需要核对现场信息。解释1：可能是${term}。`,citations:[],nextStep:null}))
 assert.equal(diagnosisWordingIssues(result.turn.text).length,0)
 assert.ok(result.turn.text.length>25)
})
