import test from 'node:test'
import assert from 'node:assert/strict'
import { screenLocalSafety, localSafetyAction } from './coach-local-safety.ts'
import { reportedSessionRpes, sessionLoadAnswer } from './coach-claim-scope.ts'
import { selectPlaybookLessons } from './coach-playbook.ts'
import { importedFormalRows, importedCoachParts } from './coach-import-evidence.ts'
import { reviewFormalEvidence } from './coach-v4-c11-adapter.ts'
import { computeReasoningFacts } from './coach-reasoning.ts'
import { createTrainingImportDraft, confirmTrainingImport } from './training-import.ts'
import { setStoreBackend } from './storage.ts'
import type { TrainingCorrection } from './training-correction.ts'
import { composeScaffold, v4FactDigest } from '../strength/coach-pipeline'

test('R10 heat neurological symptoms use immediate action; negation and education do not trigger emergency',()=>{
 for(const q of ['高温天跑完意识不清','热天跑完人迷糊说话不清','刚在大太阳下跑完，现在人有点迷糊、说话不太利索，好像也不出汗了，歇一会儿再跑行吗？']){
  assert.equal(screenLocalSafety(q).level,'EMERGENCY')
  // User's 2026-10-13 product update supersedes detailed first-aid steps with short scene-specific reminders.
  const answer=localSafetyAction(q)!;assert.match(answer,/立即.*120/);assert.match(answer,/停止活动|停止运动/)
  assert.match(answer,/陪同|陪着|家人或室友/);assert.doesNotMatch(answer,/湿毛巾|强行喂水|保护头部/)
  const sentences=answer.split(/[。！？]/).filter(Boolean);assert.ok(sentences.length>=2&&sentences.length<=4)
 }
 for(const q of ['热天跑完没有意识不清，也没有说话不清','科普：如果高温跑完意识不清怎么办'])assert.notEqual(screenLocalSafety(q).level,'EMERGENCY')
})
test('R10 whole-session ratings remain distinct from last-set ratings and segment duration',()=>{
 const q='这节课最后一组我觉得RPE 9，整节课大概6，训练负荷到底怎么算？'
 assert.deepEqual(reportedSessionRpes(q),[6])
 assert.match(sessionLoadAnswer(q,6,3000)!,/整课RPE 6 × 50 分钟 = 300 AU/)
 assert.match(sessionLoadAnswer(q,6,null,3000)!,/若该段覆盖完整训练课/)
 assert.match(sessionLoadAnswer(q,6,null)!,/总时长各是多少/)
 assert.equal(sessionLoadAnswer('整课RPE 8，AU怎么算',6,3000),null)
})
test('R10 playbook covers colloquial symptoms, age, weather, energy and load questions',()=>{
 for(const [q,id] of [['跑完膝盖外侧刺痛','PB-PAIN'],['我儿子14岁想测深蹲极限','PB-YOUTH'],['今天35度还按计划跑吗','PB-HEAT'],['每天只吃1200卡还训练','PB-ENERGY'],['训练负荷AU怎么算','PB-RPE'],['手表距离总比实际多','PB-GPS']])
  assert.ok(selectPlaybookLessons(q).some(l=>l.id===id),q)
})
test('R10 structural suggestion gaps warn while retaining conditional or nonnumeric advice',()=>{
 const result=composeScaffold(JSON.stringify({mode:'answer',text:'',citations:[],sections:{facts:[],explanations:[],uncertainty:[],suggestion:{variable:'',change:'若当前无不适，可先改到凉爽时段，出现异常就停止并记录次日反馈'}}}))
 assert.match(JSON.parse(result.raw).text,/改到凉爽时段/)
 assert.ok(result.scaffold.flags.includes('SUGGESTION_VARIABLE_MISSING'))
})
const f=<T>(value:T)=>({value,status:'RECORDED',sourceIds:['text']})
test('R10 import corrections reach facts and brief without changing other sets; as-of and void retained',()=>{
 const store=new Map<string,string>();setStoreBackend({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v)}})
 try{
  const saved=confirmTrainingImport(createTrainingImportDraft({sport:'STRENGTH',occurredAt:f('2026-03-01T10:00:00Z'),strengthSets:[1,2,3].map(n=>({id:`s${n}`,completion:'COMPLETED',sourceIds:['text'],exerciseName:f('深蹲'),setOrdinal:f(n),weightKg:f(60),repetitions:f(8)}))},'TEXT',['text']))
  assert.ok(saved.ok);const r=saved.record,at=new Date(Date.parse(r.confirmedAt)+1000).toISOString(),later=new Date(Date.parse(at)+1000).toISOString()
  const correction:TrainingCorrection={correctionId:'r10-fix',schemaVersion:1,trainingOccurrenceId:r.confirmedImportId,kind:'FIELD',field:'weight',setKey:'深蹲:1',originalValue:'60',newValue:'50',reason:'第一组误录',at,recordedAt:at}
  const snapshot=(asOf:string,cs:TrainingCorrection[])=>reviewFormalEvidence({athleteId:r.athleteId!,asOf,question:'分析力量',scopeOccurrenceIds:[r.confirmedImportId],rows:importedFormalRows([r],r.athleteId!,asOf,cs)}).audit.snapshot
  assert.deepEqual(computeReasoningFacts(snapshot(later,[correction]),[r.confirmedImportId]).strength.map(s=>s.kg),[50,60,60])
  assert.deepEqual(computeReasoningFacts(snapshot(r.confirmedAt,[correction]),[r.confirmedImportId]).strength.map(s=>s.kg),[60,60,60])
  const brief=importedCoachParts(r,'分析力量',[correction],later)
  assert.ok(brief.sources!.some(s=>s.id.startsWith('correction:')&&/50 kg/.test(s.detail)))
  assert.equal(snapshot(later,[correction,{...correction,correctionId:'void',kind:'VOID',field:null,recordedAt:later}]).active.length,0)
 }finally{setStoreBackend(null)}
})
test('R10 continuous distances, numerical lap order, recovery segments and unknown HR method survive import',()=>{
 const store=new Map<string,string>();setStoreBackend({getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v)}})
 try{
  const saved=confirmTrainingImport(createTrainingImportDraft({sport:'RUNNING',occurredAt:f('2026-03-01T10:00:00Z'),runningStructure:'MIXED',runningSegments:Array.from({length:12},(_,i)=>({id:`lap${i+1}`,kind:i===3?'RECOVERY':i<3?'CONTINUOUS':'REPETITION',round:f(1),repeat:f(i+1),distanceMeters:f(i===1?970:i===3?200:990),durationSeconds:f(211.67000000000002+i),averageHeartRateBpm:f(150),completion:'COMPLETED',sourceIds:['text']}))},'TEXT',['text']))
  assert.ok(saved.ok);const r=saved.record,asOf=new Date(Date.parse(r.confirmedAt)+1000).toISOString()
  const rows=importedFormalRows([r],r.athleteId!,asOf)
  const s=reviewFormalEvidence({athleteId:r.athleteId!,asOf,question:'分析配速',scopeOccurrenceIds:[r.confirmedImportId],rows}).audit.snapshot
  const c=computeReasoningFacts(s,[r.confirmedImportId])
  assert.equal(c.points[1].distanceMeters,970);assert.equal(c.points[0].seconds,211.67)
  assert.deepEqual(c.points.map(p=>Number(p.sourceId.match(/run-(\d+)$/)![1])),[1,2,3,5,6,7,8,9,10,11,12])
  assert.equal(c.rests.length,1);assert.equal(c.heartRates.length,0);assert.equal(c.unverifiedHeartRates.length,11);assert.ok(c.unverifiedHeartRates.every(h=>h.method==='UNKNOWN'&&c.points.some(p=>p.sourceId===h.segmentSourceId)));assert.equal(rows.filter(row=>row.metric==='HR_AVG_BPM').length,0)
  assert.match(v4FactDigest(s),/CONTINUOUS_NO_RECOVERY/)
 }finally{setStoreBackend(null)}
})
