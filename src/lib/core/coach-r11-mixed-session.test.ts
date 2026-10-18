import test from 'node:test'
import assert from 'node:assert/strict'
import {createTrainingImportDraft,confirmTrainingImport} from './training-import.ts'
import {importedFormalRows,importedCoachParts} from './coach-import-evidence.ts'
import {normalizeAskCoachInput} from '../strength/coach-pipeline'
import {deriveCoachBrief} from './coach-brief.ts'
import {answerLocally} from './coach-local-first.ts'
import {setStoreBackend} from './storage.ts'
import {coachingSuggestionIssues} from './coach-playbook.ts'
const f=<T>(value:T)=>({value,status:'RECORDED',sourceIds:['user-confirmed']})
for(const variant of ['standard','gps-offset','missing-distance','independent-recovery','unequal-rest'])test(`R11 mixed session ${variant}`,()=>{
 const map=new Map<string,string>();setStoreBackend({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)}})
 try{
  const parts=[['warm','CONTINUOUS',1200,420],['main1','REPETITION',400,89],['rest1','RECOVERY',100,120],['main2','REPETITION',variant==='gps-offset'?391:400,87],['rest2','RECOVERY',100,variant==='unequal-rest'?135:120],['main3','REPETITION',variant==='missing-distance'?null:400,88],['fast1','REPETITION',100,18],['fast2','REPETITION',100,19]] as const
  const draft=createTrainingImportDraft({sport:'RUNNING',occurredAt:f('2026-05-01T10:00:00Z'),runningStructure:'MIXED',sessionRpe:f(6),sleepHours:f(8),runningSegments:parts.map(([id,kind,meters,seconds],i)=>({id,kind,round:f(1),repeat:f(i+1),completion:'COMPLETED',distanceMeters:meters===null?{value:null,status:'NOT_RECORDED',sourceIds:[]}:f(meters),durationSeconds:f(seconds),sourceIds:['user-confirmed']}))},'TEXT',['user-confirmed'])
  const saved=confirmTrainingImport(draft);assert.ok(saved.ok)
  const r=saved.record,asOf=new Date(Date.parse(r.confirmedAt)+1000).toISOString(),question='复盘这节混合结构课'
  const d=normalizeAskCoachInput({brief:deriveCoachBrief(importedCoachParts(r,question)),v4:{athleteId:r.athleteId!,asOf,rows:importedFormalRows([r],r.athleteId!,asOf)}})
  const local=answerLocally(d.brief,{frame:d.v4!.reasoning,snapshot:d.v4!.review.audit.snapshot})
  assert.match(local.text,/结构：.*主课.*恢复.*加速跑/);assert.match(local.text,/可能解释1/);assert.match(local.text,/可能解释2/);assert.match(local.text,/支持：/)
  assert.ok(local.text.split('\n').length<=12);assert.doesNotMatch(local.text,/\d+\.\d{6,}/)
  assert.ok(local.candidate);assert.deepEqual(Object.keys(local.candidate).sort(),['decision','changed_variable','from','to','unchanged','stop_conditions','preconditions','rule_ids'].sort())
  assert.ok(local.candidate.stop_conditions.length);assert.ok(local.candidate.preconditions.length)
  if(variant==='missing-distance')assert.match(local.text,/不能计算配速/)
 }finally{setStoreBackend(null)}
})
test('R11 empty suggestion variable with numeric changes fails structural review',()=>assert.ok(coachingSuggestionIssues('','从60kg加到70kg').length))
