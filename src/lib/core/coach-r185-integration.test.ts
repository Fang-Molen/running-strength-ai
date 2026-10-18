import assert from 'node:assert/strict'
import test from 'node:test'
import {parseChatTraining,saveChatTraining,chatEvolution} from './coach-chat-evidence.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {setStoreBackend} from './storage.ts'
import {importedFormalRows} from './coach-import-evidence.ts'
import {normalizeTrainingImportCandidate} from './training-import.ts'
test('G1 duration without confirmed sport must not become strength',()=>{setStoreBackend(firstWeekMemory());try{assert.equal(saveChatTraining(parseChatTraining('今天练了50分钟，整课RPE7'),'2026-10-10T08:00:00Z',true).ok,false)}finally{setStoreBackend(null)}})
test('G1 round-only rest does not become repetition rest',()=>{const c=parseChatTraining('今天200米×2×2，38/39/40/41秒，轮间休息8分钟');assert.equal(c.restSeconds,null);assert.equal(c.roundRestSeconds,480)})
test('G1 two-level rest persists and reaches formal evidence',()=>{setStoreBackend(firstWeekMemory());try{const c=parseChatTraining('今天200米×4×2，39/38/没记/36/40/41/42/43秒，组间2分钟，轮间8分钟');const saved=saveChatTraining(c,'2026-10-10T08:00:00Z',true);assert.ok(saved.ok);const rows=importedFormalRows([saved.record],saved.record.athleteId??'local',new Date().toISOString());assert.equal(rows.filter(r=>r.metric==='REST_SECONDS'&&r.value===480&&r.protocol.includes('AFTER_ROUND')).length,1);assert.equal(rows.filter(r=>r.metric==='REST_SECONDS'&&r.value===120).length,6);assert.equal(saved.record.runningSegments[7].recoverySeconds.value,null)}finally{setStoreBackend(null)}})
test('G1 actual zero RPE is retained instead of treated as absent',()=>assert.equal(normalizeTrainingImportCandidate({sessionRpe:{value:0,status:'RECORDED',sourceIds:['synthetic']}}).sessionRpe.value,0))
import {readOfflineWorkspace} from './coach-offline-workspace.ts'
import {blankPlan} from '../strength/model.ts'
import {currentAthleteId} from './events.ts'
import {appendCorrection} from './training-correction.ts'
import {saveOfflineReview,readOfflineHistory,offlineAthletePortrait,saveOfflineFeedback,buildOfflineReview,emptyOfflineProfile} from './coach-offline-loop.ts'
import {collectLocalBackup,restoreLocalBackup} from './trial.ts'
import {evaluateCoachEvolution,type EvolutionEvidence} from './coach-evolution-v4.ts'
import {observationProtocolKey,reviseHypotheses,type ApprovedCourse} from './coach-development-projection.ts'
import type {RunningPlanSnapshot} from './running-plan.ts'

test('G1-G4 live store: save, quantitative review, correction, void withdrawal and backup restore preserve old evidence',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-14T08:00:00Z')})
 const box=firstWeekMemory();setStoreBackend(box);box.setItem('fr255-original-plan','synthetic unchanged')
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden')}
 try{
  const saved=saveChatTraining(parseChatTraining('今天200米×2，30/35秒，组间2分钟，整课RPE6'),'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
  t.mock.timers.tick(1000)
  const plan=blankPlan(),id=saved.record.confirmedImportId,A=currentAthleteId()
  const first=readOfflineWorkspace(plan,A,id).review;assert.equal(first.metrics.points.length,2);assert.match(first.text,/30秒/);assert.match(first.text,/35秒/);assert.equal(first.purpose.purpose,'UNKNOWN');assert.equal(first.hypotheses.length,2)
  assert.ok(first.hypotheses.every(h=>h.sourceIds.length&&h.support.length&&h.against.length));assert.ok(first.development!.ability.axes.every(a=>a.score===null));assert.equal(first.development!.cycleCandidate.planWrite,false)
  const a=saveOfflineReview(first);assert.ok(a.ok);assert.equal(saveOfflineReview(first).id,a.id)
  t.mock.timers.tick(1000)
  assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'duration',setKey:'chat-1-2',originalValue:'35',newValue:'32',reason:'synthetic corrected timing'}))
  t.mock.timers.tick(1000)
  const corrected=readOfflineWorkspace(plan,A,id).review;assert.equal(corrected.metrics.points.at(-1)!.seconds,32);assert.ok(saveOfflineReview(corrected).ok)
  assert.equal(first.metrics.points.at(-1)!.seconds,35)
  const h=readOfflineHistory(A);const changes=h.flatMap(r=>r.kind==='ANALYSIS'?r.hypothesisRevisions??[]:[]);assert.ok(changes.some(r=>r.priorReviewId===a.id&&r.status==='WITHDRAWN'))
  t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:id,kind:'VOID',reason:'synthetic duplicate removal'}));t.mock.timers.tick(1000)
  const voided=readOfflineWorkspace(plan,A,id).review;assert.equal(voided.metrics.points.length,0);assert.ok(saveOfflineReview(voided).ok)
  const last=readOfflineHistory(A).at(-1)!;assert.equal(last.kind,'ANALYSIS');if(last.kind==='ANALYSIS')assert.ok(last.hypothesisRevisions!.some(r=>r.status==='WITHDRAWN'))
  const restored=firstWeekMemory();assert.ok(restoreLocalBackup(collectLocalBackup(box),restored).ok);setStoreBackend(restored)
  assert.equal(readOfflineHistory(A).length,3);assert.equal(readOfflineWorkspace(plan,A,id).review.metrics.points.length,0);assert.equal(restored.getItem('fr255-original-plan'),'synthetic unchanged')
 }finally{setStoreBackend(null);globalThis.fetch=originalFetch;t.mock.timers.reset()}
})

test('P3-P4 distinct same-protocol observations support or weaken; unbound feedback and omitted evidence do not',()=>{
 const A='synthetic-r185',time='2026-10-11T10:00:00Z',later='2026-10-12T10:00:00Z'
 const rows=(occ:string,at:string):EvolutionEvidence[]=>[30,35,120].map((value,i)=>({id:occ+':'+i,athleteId:A,occurrenceId:occ,metric:i===2?'REST_SECONDS':'SPLIT_SECONDS',value,unit:'s',context:i===2?'running:main:rest:b:AFTER_REPEAT:step:1:1':`running:main:rep:b:step:1:${i+1}:200m`,eventAt:at,recordedAt:at,source:'TRAINING_FACT',sourceId:'source:'+occ+':'+i,confirmation:'CONFIRMED',measurement:{method:'synthetic-electronic-v1',segmentSourceId:'source:'+occ+':'+i}}))
 const plan=(occ:string):RunningPlanSnapshot=>({runningPlanSchemaVersion:1,runningSnapshotId:'plan:'+occ,capturedAt:'2026-10-10T09:00:00Z',trainingOccurrenceId:occ,sourcePlanId:'approved-course',components:[{componentId:'main',modality:'RUNNING',purpose:'INTERVAL',structure:{kind:'REPEATED',blocks:[{blockId:'b',roundCount:1,recoveryAfterRoundSeconds:null,steps:[{stepId:'step',repeatCount:2,plannedDistanceMeters:200,plannedDurationSeconds:30,recoveryAfterRepeatSeconds:120,recoveryBeforeNextStepSeconds:null}]}]}}]})
 const profile={id:'synthetic-profile',createdAt:'2026-10-10T09:00:00Z',confirmed:true as const,supersedes:null,profile:{...emptyOfflineProfile(A),event:'800米',stage:'专项准备期' as const}}
 const create=(occ:string,asOf:string,all:EvolutionEvidence[])=>buildOfflineReview({snapshot:evaluateCoachEvolution({athleteId:A,asOf,question:'复盘',evidence:all}),occurrenceId:occ,question:'复盘',profile,plan:plan(occ)})
 const prior=create('s1',time,rows('s1',time)),current=create('s2',later,[...rows('s1',time),...rows('s2',later)])
 assert.equal(current.data.level,'L3');assert.ok(current.comparableOccurrenceIds.includes('s1'));assert.ok(observationProtocolKey(current));assert.equal(observationProtocolKey(current),observationProtocolKey(prior))
 const observation={hypothesisId:prior.hypotheses[0].id,sourceReviewId:'old-review',observedReviewId:'new-review',outcome:'SUPPORT' as const,sourceIds:rows('s2',later).map(r=>r.sourceId),reviewedAt:later,reviewer:'synthetic-reviewer',reason:'同目的同计时并复核预先记录的观察条件',confirmed:true as const,protocolKey:observationProtocolKey(current)!}
 assert.equal(reviseHypotheses('old-review',prior,current,[observation],'new-review')[0].status,'SUPPORTED')
 assert.equal(reviseHypotheses('old-review',prior,current,[{...observation,outcome:'REFUTE'}],'new-review')[0].status,'WEAKENED')
 assert.equal(reviseHypotheses('old-review',prior,current,[{...observation,sourceIds:['unbound']}],'new-review')[0].status,'PENDING')
 const course:ApprovedCourse={id:'approved-course',athleteId:A,sport:'800米',purpose:current.purpose.purpose,stage:'专项准备期',protocolKey:observationProtocolKey(current)!,planVersion:'synthetic-plan-v1',approvedAt:time,recordedAt:time,approvalSourceId:'synthetic-user-approval',approvedBy:'USER',approvalStatus:'APPROVED',observationHypothesisIds:current.hypotheses.map(h=>h.id),snapshot:plan('s2')}
 const approved=buildOfflineReview({snapshot:evaluateCoachEvolution({athleteId:A,asOf:later,question:'复盘',evidence:rows('s2',later)}),occurrenceId:'s2',question:'复盘',profile,plan:plan('s2'),approvedCourses:[course]})
 assert.equal(approved.development!.cycleCandidate.decision,'CONDITIONAL_REPEAT');assert.equal(approved.development!.cycleCandidate.planWrite,false);assert.equal(approved.development!.prediction.seconds,null)
 const blocked=buildOfflineReview({snapshot:evaluateCoachEvolution({athleteId:A,asOf:later,question:'胸痛呼吸困难',evidence:rows('s2',later)}),occurrenceId:'s2',question:'胸痛呼吸困难',profile,plan:plan('s2'),approvedCourses:[course]})
 assert.equal(blocked.development!.cycleCandidate.decision,'HOLD');assert.equal(blocked.safetyRestricted,true)
})
import {answerDialogue,emptyDialogue} from './coach-dialogue.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {saveOfflineProfile} from './coach-offline-loop.ts'
test('G6 a fresh offline conversation reuses confirmed profile without asking again or using frozen date',()=>{
 setStoreBackend(firstWeekMemory())
 try{
  assert.ok(saveOfflineProfile({...emptyOfflineProfile('local'),event:'800米',pbSeconds:120},true))
  const r=answerDialogue(deriveCoachBrief(buildParts('今天200米×2，30/32秒，组间2分钟',{})),undefined,emptyDialogue('local'))!
  assert.equal(r.dialogue.profile.event,'800米');assert.doesNotMatch(r.text,/你的主项是什么/);assert.ok(r.offlineReview!.asOf.startsWith(new Date().toISOString().slice(0,10)))
 }finally{setStoreBackend(null)}
})
