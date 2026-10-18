import test from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from './storage.ts'
import {createTrainingImportDraft,confirmTrainingImport} from './training-import.ts'
import {confirmImportedSessionRpe,loadImportRatings} from './coach-import-rating.ts'
import {importedFormalRows,importedCoachParts} from './coach-import-evidence.ts'
import {listBoundTrainings} from './coach-compare.ts'
import {row,request} from '../../../evaluation/r6/fixtures.ts'
import {interpretCoachModelOutput} from '../strength/coach-pipeline'
import {validateCoachCompletion,redactCoachIdentifiers} from './coach-output-contract.ts'
const f=<T>(value:T)=>({value,status:'RECORDED',sourceIds:['user-confirmed']})
test('R11 confirmed imported session rating is explicit, append-only, as-of scoped and duplicate-safe',()=>{
 const map=new Map<string,string>();setStoreBackend({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)}})
 try{
  const saved=confirmTrainingImport(createTrainingImportDraft({sport:'RUNNING',occurredAt:f('2026-01-01T10:00:00Z'),runningStructure:'CONTINUOUS',runningSegments:[{id:'jog',kind:'CONTINUOUS',completion:'COMPLETED',distanceMeters:f(3000),durationSeconds:f(1200),sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed']));assert.ok(saved.ok)
  const r=saved.record,before=JSON.stringify(r)
  assert.equal(loadImportRatings().length,0)
  assert.equal(confirmImportedSessionRpe(r.confirmedImportId,6).ok,true)
  assert.equal(confirmImportedSessionRpe(r.confirmedImportId,8).ok,false)
  assert.equal(JSON.stringify(r),before)
  const rating=loadImportRatings()[0],after=new Date(Date.parse(rating.recordedAt)+100).toISOString()
  assert.equal(importedFormalRows([r],r.athleteId!,after).filter(r=>r.metric==='SESSION_RPE').length,1)
  assert.equal(importedCoachParts(r,'训练负荷怎么算',[],after).sessionRpe,6)
  assert.equal(importedFormalRows([r],r.athleteId!,new Date(Date.parse(rating.recordedAt)-1).toISOString()).filter(r=>r.metric==='SESSION_RPE').length,0)
  assert.ok(listBoundTrainings().some(t=>t.trainingOccurrenceId===r.confirmedImportId))
 }finally{setStoreBackend(null)}
})
for(const withCitation of [false,true])test(`R11 revoked values never survive in any visible field; cited=${withCitation}`,()=>{
 const d=request([row('old','SPLIT_SECONDS',237,{status:'VOIDED'})],undefined,undefined,'分析这节课')
 const out=interpretCoachModelOutput(d,JSON.stringify({mode:'answer',text:'这一段237秒，可继续加量。',nextStep:'按237秒再跑',citations:withCitation?['old']:[]}))
 assert.doesNotMatch(JSON.stringify([out.turn.text,out.turn.nextStep,out.turn.citations]),/237|"old"/)
 assert.equal(out.turn.nextStep,null)
})
test('R11 provider output schema and explicit identifier redaction',()=>{
 assert.equal(validateCoachCompletion('{"text":"正常", "citations": [42]}').success,false)
 assert.equal(validateCoachCompletion('{"text":"待核对", "citations": []}').success,true)
 const input='姓名：测试运动员，生日：2001-01-02，详细地址：测试路12号。训练日期2026-03-01，整课50分钟，RPE6。'
 const out=redactCoachIdentifiers(input)
 assert.doesNotMatch(out,/测试运动员|2001-01-02|测试路12号/);assert.match(out,/2026-03-01/);assert.match(out,/50分钟/)
})
