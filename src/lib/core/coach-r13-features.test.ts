/** 自行生成 R13 focused data and UI-facing contract cases; no model or network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {chatLoadPreview,saveChatSessionLoad} from './coach-chat-load.ts'
import {calculateSessionLoad} from './coach-session-load.ts'
import {setStoreBackend} from './storage.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {readCoachReviewWorkspace} from './coach-review-workspace.ts'
import {readSavedSessionLoads} from './coach-load-metrics-store.ts'
import {loadConfirmedTrainingImports,CONFIRMED_TRAINING_IMPORTS_KEY} from './training-import.ts'
import {saveCoachContextMemory,readCoachMemory,withdrawCoachMemory} from './coach-context-memory.ts'
import {normalizeAskCoachInput} from '../strength/coach-pipeline.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {answerLocally} from './coach-local-first.ts'
import {projectPeriodVitals,type PeriodContext} from './coach-period-context.ts'
import {buildPeriodReview,formatPeriodReview} from './coach-period-review.ts'
import {evaluateCoachEvolution} from './coach-evolution-v4.ts'
import {calendarDay} from './coach-calendar.ts'
import {saveVital,type VitalRecord} from '../nutrition/vitals.ts'
import type {DeviceConfirmed} from './device-image-evidence.ts'
const asOf='2026-10-10T12:00:00Z'
const snapshot=()=>evaluateCoachEvolution({athleteId:'local',asOf,question:'复盘',evidence:[]})
const vital=(patch:Partial<VitalRecord>={}):VitalRecord=>({id:'v1',kind:'RHR',value:60,unit:'bpm',observedOn:'2026-10-08',observedAt:'08:00',source:'MANUAL',deviceLabel:'同一手表',measurementMethod:'静息测量',note:'',hrvMethod:null,createdAt:'2026-10-08T01:00:00Z',...patch})
const preview='今天训练45分钟，整课RPE 7'
for(const [question,au] of [[preview,315],['整课半小时，整课RPE6',180],['力量训练了50分钟，整课RPE8',400]] as const)test(`自行生成 direct report computes unsaved AU: ${question}`,()=>{
 const store=firstWeekMemory();setStoreBackend(store)
 try{
  const load=chatLoadPreview(question);assert.equal(load?.au,au);assert.equal(store.data.size,0)
  const brief=deriveCoachBrief(buildParts(question,{}));const answer=answerLocally(brief)
  assert.match(answer.text,new RegExp(`${au} AU`));assert.match(answer.text,/未保存/);assert.equal(store.data.size,0)
 }finally{setStoreBackend(null)}
})
for(const q of ['今天训练45分钟，末组RPE7','今天训练45分钟，RPE7','计划明天训练45分钟，整课RPE7','假设整课45分钟，整课RPE7','朋友今天训练45分钟，整课RPE7','今天训练45分钟，整课RPE7，整课RPE8','整课30分钟，整课60分钟，整课RPE7','我胸痛，整课30分钟，整课RPE7'])test(`自行生成 ambiguous/nonactual statement has no save preview: ${q}`,()=>assert.equal(chatLoadPreview(q),null))
test('recorded and stated full durations cannot silently choose the recorded value',()=>assert.equal(calculateSessionLoad('整课60分钟，整课RPE7',7,1800).status,'CONFLICT'))
const saveInput=()=>({question:preview,draftId:'r13-synthetic-chat',occurredAt:new Date(Date.now()-86400000).toISOString(),sport:'STRENGTH' as const,confirmedNewSession:true,selectedOccurrenceId:null})
test('explicit save reuses imports, is idempotent, and duration-only strength enters review without invented sets',()=>{
 const store=firstWeekMemory();setStoreBackend(store)
 try{
  const input=saveInput();assert.equal(saveChatSessionLoad({...input,confirmedNewSession:false}).ok,false);assert.equal(store.data.size,0)
  assert.equal(saveChatSessionLoad(input).ok,true);assert.equal(saveChatSessionLoad(input).ok,true)
  assert.equal(loadConfirmedTrainingImports().length,1)
  const r=loadConfirmedTrainingImports()[0];assert.equal(r.sessionRpe.value,7);assert.equal(r.durationSeconds.value,2700);assert.equal(r.strengthSets.length,0)
  const now=new Date().toISOString(),workspace=readCoachReviewWorkspace('local',calendarDay(now)!,7,now)
  assert.equal(workspace.period.sessions.length,1);assert.equal(workspace.period.sessions[0].durationOnly,true);assert.equal(workspace.period.sessions[0].strengthSets,0)
  assert.equal(workspace.period.execution.completionRate,null);assert.match(formatPeriodReview(workspace.period),/仅记录 45 分钟/)
  assert.equal(readSavedSessionLoads('local',now)[0].minutes,45)
  assert.equal(readCoachReviewWorkspace('other',calendarDay(now)!,7,now).period.sessions.length,0)
 }finally{setStoreBackend(null)}
})
test('selected or future workouts cannot be created as another chat load record',()=>{
 const store=firstWeekMemory();setStoreBackend(store)
 try{assert.equal(saveChatSessionLoad({...saveInput(),selectedOccurrenceId:'o1'}).ok,false);assert.equal(saveChatSessionLoad({...saveInput(),occurredAt:'2099-01-01T00:00:00Z'}).ok,false);assert.equal(store.data.size,0)}finally{setStoreBackend(null)}
})
test('save failures preserve existing training data',()=>{
 const store=firstWeekMemory();store.setItem('fr255-original-fact','original');setStoreBackend({...store,setItem:()=>{throw Error('quota')}})
 try{assert.equal(saveChatSessionLoad(saveInput()).ok,false);assert.equal(store.getItem('fr255-original-fact'),'original');assert.equal(store.getItem(CONFIRMED_TRAINING_IMPORTS_KEY),null)}finally{setStoreBackend(null)}
})
test('local planning preference is in visible answer before folded evidence, withdrawal affects next answer immediately',()=>{
 const store=firstWeekMemory();setStoreBackend(store)
 try{
  assert.equal(saveCoachContextMemory({athleteId:'local',kind:'PREFERENCE',text:'周三晚上不能训练',expiresOn:null,explicitlyConfirmed:true}).ok,true)
  const answer=()=>{const now=new Date().toISOString(),d=normalizeAskCoachInput({brief:deriveCoachBrief(buildParts('今天训练怎么安排？',{})),v4:{athleteId:'local',asOf:now,rows:[]}});assert.ok(d.v4);return answerLocally(d.brief,{frame:d.v4.reasoning,snapshot:d.v4.review.audit.snapshot},readCoachMemory('local',now).active).text}
  assert.match(answer().split('\n依据：')[0],/周三晚上不能训练/)
  const id=readCoachMemory('local').active[0].id;assert.equal(withdrawCoachMemory('local',id),true)
  assert.doesNotMatch(answer().split('\n依据：')[0],/周三晚上不能训练/)
 }finally{setStoreBackend(null)}
})
test('body observations stay distinct from completed sessions and retain sources',()=>{
 const clues=projectPeriodVitals('local',asOf,[vital(),vital({id:'sleep',kind:'SLEEP',value:7.5,unit:'hours'})])
 const review=buildPeriodReview(snapshot(),'2026-10-04','2026-10-10',0,{clues,durations:[],unknowns:[]})
 assert.equal(review.recoveryClues.length,2);assert.equal(review.sessions.length,0);assert.equal(review.outcome.status,'NOT_ASSESSED');assert.equal(review.decisionAuthorization,false)
 assert.deepEqual(review.sourceIds,['vital:sleep','vital:v1']);assert.match(formatPeriodReview(review),/仅作线索，不做诊断/)
})
test('future, wrong-athlete and outside-window body observations never enter the selected period',()=>{
 assert.equal(projectPeriodVitals('other',asOf,[vital()]).length,0)
 assert.equal(projectPeriodVitals('local',asOf,[vital({createdAt:'2026-10-11T00:00:00Z'})]).length,0)
 const clues=projectPeriodVitals('local',asOf,[vital({observedOn:'2026-09-01'})])
 assert.equal(buildPeriodReview(snapshot(),'2026-10-04','2026-10-10',0,{clues,durations:[],unknowns:[]}).recoveryClues.length,0)
})
test('confirmed device RHR and sleep enter as clues, unconfirmed or future readings do not',()=>{
 const device:DeviceConfirmed={id:'dev1',schemaVersion:1,deviceLabel:'设备',recordedAt:'2026-10-08T01:00:00Z',confirmedAt:'2026-10-08T02:00:00Z',imageName:null,imageSha256:null,textOrigin:'USER_TRANSCRIBED',rawText:'',consent:'USER_CONFIRMED',destination:'DEVICE_EVIDENCE_ONLY',readings:[{id:'rhr',metric:'RESTING_HR_BPM',value:62,unit:'bpm',rawLine:'',sourceLine:0,provenance:'USER_EDITED'},{id:'sleep',metric:'SLEEP_HOURS',value:8,unit:'h',rawLine:'',sourceLine:1,provenance:'USER_EDITED'}]}
 assert.equal(projectPeriodVitals('local',asOf,[],[device]).length,2)
 assert.equal(projectPeriodVitals('local',asOf,[],[{...device,consent:'UNCONFIRMED' as never}]).length,0)
 assert.equal(projectPeriodVitals('local',asOf,[],[{...device,confirmedAt:'2026-10-11T02:00:00Z'}]).length,0)
})
test('same-day conflicting body values are shown separately, not averaged or used as a diagnosis',()=>{
 const clues=projectPeriodVitals('local',asOf,[vital(),vital({id:'v2',value:95})])
 const r=buildPeriodReview(snapshot(),'2026-10-04','2026-10-10',0,{clues,durations:[],unknowns:[]})
 assert.deepEqual(r.recoveryClues.map(x=>x.value),[60,95]);assert.equal(r.trends.length,0);assert.equal(r.decisionAuthorization,false)
})
test('duration-only source respects period, athlete and known-at scope',()=>{
 const base:PeriodContext['durations'][number]={athleteId:'local',occurrenceId:'s1',day:'2026-10-08',minutes:40,sourceIds:['duration1'],knownAt:'2026-10-08T10:00:00Z',sport:'STRENGTH'}
 for(const d of [{...base,athleteId:'other'},{...base,knownAt:'2026-10-11T10:00:00Z'},{...base,day:'2026-09-01'}])assert.equal(buildPeriodReview(snapshot(),'2026-10-04','2026-10-10',0,{clues:[],durations:[d],unknowns:[]}).sessions.length,0)
})
test('workspace reads body RHR and sleep with no writes on review opening',()=>{
 const store=firstWeekMemory();setStoreBackend(store)
 try{
  assert.equal(saveVital({kind:'RHR',value:61,observedOn:'2026-10-08',source:'MANUAL'},'v1','2026-10-08T10:00:00Z').ok,true)
  assert.equal(saveVital({kind:'SLEEP',value:7,observedOn:'2026-10-08',source:'MANUAL'},'v2','2026-10-08T10:00:00Z').ok,true)
  const before=JSON.stringify([...store.data]);const r=readCoachReviewWorkspace('local','2026-10-10',7,asOf)
  assert.equal(r.period.recoveryClues.length,2);assert.equal(JSON.stringify([...store.data]),before)
 }finally{setStoreBackend(null)}
})
