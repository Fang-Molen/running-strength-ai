import test,{type TestContext} from 'node:test'
import assert from 'node:assert/strict'
import {answerLocally} from './coach-local-first.ts'
import {deriveCoachBrief} from './coach-brief.ts'
import {buildParts} from '../../../evaluation/k12/fixtures.ts'
import {emptyDialogue} from './coach-dialogue.ts'
import {firstWeekMemory} from './coach-first-week.fixtures.ts'
import {setStoreBackend} from './storage.ts'
import {currentAthleteId} from './events.ts'
import {saveChatTraining,parseChatTraining} from './coach-chat-evidence.ts'
import {appendCorrection} from './training-correction.ts'
import {readOfflineWorkspace} from './coach-offline-workspace.ts'
import {saveOfflineReview,readOfflineHistory,offlineAthletePortrait} from './coach-offline-loop.ts'
import {readClaimRevisions,commitDisplayedCoachAdvice,registerReviewClaims} from './coach-p7-runtime.ts'
import {p7Read,p7Project,p7CommitLiveDecision,p7CommitOutcome,p7CommitSourceRevision} from './coach-p7-lifecycle.ts'
import {P7_EVIDENCE_VERSION} from './coach-p7-knowledge.ts'
import type {DecisionSnapshot} from './coach-decision-calibration.ts'
import {collectLocalBackup,inspectLocalBackup,restoreLocalBackup} from './trial.ts'
import {prepareDeviceActivity,type DecodedDeviceActivity} from './coach-device-preparation.ts'
const ask=(q:string,prior=emptyDialogue())=>answerLocally(deriveCoachBrief(buildParts(q,{})),undefined,[],undefined,prior)
const visible=(r:ReturnType<typeof ask>)=>r.text.split('\n依据：')[0]

for(const q of ['明天练什么','下周怎么练','下一课怎么安排'])test('R189 supersedes R188 REST default with non-dosed observation: '+q,()=>{
 const r=ask(q);assert.match(visible(r),/具体观察任务/);assert.match(visible(r),/不编造剂量/)
 assert.match(visible(r),/疼痛加重.*胸闷.*头晕/);assert.equal(r.candidate,null)
 assert.doesNotMatch(visible(r),/轻松跑\s*\d|减量\s*\d+%/)
})
test('R188 reported approval is remembered, never promoted to a verified prescription',()=>{
 let r=ask('我已经批准明天的课程：轻松跑20分钟，明天练什么，没有疼痛')
 assert.match(visible(r),/轻松跑20分钟/);assert.match(visible(r),/批准转述/)
 r=ask('明天怎么练',JSON.parse(JSON.stringify(r.dialogue)))
 assert.match(visible(r),/轻松跑20分钟/);assert.match(visible(r),/先把候选改动交给你确认/)
 assert.equal(r.candidate?.decision,'CONDITIONAL_REPEAT')
 r=ask('取消下一课批准，明天练什么',r.dialogue)
 assert.match(visible(r),/具体观察任务/)
})
for(const q of ['假设教练批准明天轻松跑30分钟，明天练什么','教练没有批准明天课程，明天练什么'])test('R188 uncertain approval does not become a real course: '+q,()=>assert.match(visible(ask(q)),/具体观察任务/))
for(const [intake,symptom] of [['我是15岁女生，主项400米','已经3个月没来月经了'],['我是15岁，主项800米','小腿骨点压痛']] as const)test('R188 medical restriction survives independent follow-ups: '+symptom,()=>{
 let r=ask(intake);r=ask(symptom,r.dialogue);assert.ok(r.dialogue?.medicalHold)
 for(const q of ['明天练什么','测试课怎么安排','今天感觉好了，没有疼痛，想加一组']){
  r=ask(q,JSON.parse(JSON.stringify(r.dialogue)));assert.equal(r.candidate,null)
  assert.match(visible(r),/评估/);assert.doesNotMatch(visible(r),/有条件可以做熟悉|建议按.*执行/)
 }
})
test('R188 bone tenderness alone is not cleared by absent worsening',()=>assert.match(visible(ask('骨点按压痛，能跑吗')),/停止跑跳/))
test('R188 a medical visit does not become exercise return clearance',()=>{
 let r=ask('我运动时胸痛和心悸');assert.ok(r.dialogue?.emergency)
 r=ask('我刚去医院，医生已经评估',r.dialogue);assert.match(visible(r),/已就医不等于已获运动许可/)
 r=ask('教练已经批准明天冲刺课，明天练什么',JSON.parse(JSON.stringify(r.dialogue)))
 assert.equal(r.candidate,null);assert.ok(r.dialogue?.medicalHold);assert.match(visible(r),/专业评估|医生|许可/)
 assert.doesNotMatch(visible(r),/建议按.*执行/)
})
for(const q of ['队友倒地无反应，呼吸异常','蜂蜇后荨麻疹，呼吸困难，嘴唇肿胀','感冒发烧后运动胸痛和心悸'])test('R188 emergency is concise and prioritized: '+q,()=>{
 const r=ask(q);assert.match(visible(r),/120/);assert.equal(r.candidate,null)
 if(q.includes('队友')){assert.match(visible(r),/胸外按压/);assert.match(visible(r),/AED/)}
 if(q.includes('蜂'))assert.match(visible(r),/肾上腺素/)
 assert.ok(visible(r).split('。').filter(Boolean).length<=4)
})

function storeTest(name:string,fn:(t:TestContext,box:ReturnType<typeof firstWeekMemory>)=>void){
 test(name,t=>{t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-14T08:00:00Z')});const box=firstWeekMemory();setStoreBackend(box);try{fn(t,box)}finally{setStoreBackend(null)}})
}
storeTest('R188 displayed advice commits LIVE journal but cannot fabricate forecast accuracy',(t,box)=>{
 // R189 no longer invents a REST candidate when no approved course is supplied.
 const question='教练已经批准明天的课程：轻松跑20分钟，明天练什么，没有疼痛'
 const r=ask(question,emptyDialogue(currentAthleteId()));box.setItem('fr255-original-plan','unchanged')
 assert.equal(r.candidate?.decision,'CONDITIONAL_REPEAT')
 const receipt=commitDisplayedCoachAdvice(r,question);assert.equal(receipt.ok,true)
 const reloaded=p7Read(currentAthleteId());assert.equal(reloaded.length,1)
 assert.equal(reloaded[0].event.kind,'DECISION');if(reloaded[0].event.kind==='DECISION'){assert.equal(reloaded[0].event.commitmentKind,'LIVE');assert.equal(reloaded[0].event.decision.forecastValue,null)}
 assert.equal(p7Project(currentAthleteId(),{}).calibration.eligibleCount,0)
 assert.equal(box.getItem('fr255-original-plan'),'unchanged')
})
storeTest('R188 real training correction immediately audits dependent claims without a new review',(t,box)=>{
 const saved=saveChatTraining(parseChatTraining('今天200米×4，30/30/31/35秒，组间3分钟，整课RPE6'),'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
 t.mock.timers.tick(1000)
 const {review}=readOfflineWorkspace(null,currentAthleteId(),saved.record.confirmedImportId,'复盘本课，原计划目的是均速')
 assert.ok(review.hypotheses.length);const receipt=saveOfflineReview(review);assert.equal(receipt.ok,true)
 const before=readOfflineHistory(currentAthleteId()).length
 t.mock.timers.tick(1000)
 const c=appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'chat-1-4',originalValue:'35',newValue:'32',reason:'synthetic correction'})
 assert.ok(c);assert.equal(readOfflineHistory(currentAthleteId()).length,before)
 const audits=readClaimRevisions(currentAthleteId());assert.ok(audits.some(r=>r.result.updateAction==='MARK_STALE'))
 assert.ok(audits.every(r=>r.result.planWriteAuthorized===false))
 const portrait=offlineAthletePortrait(null,readOfflineHistory(currentAthleteId()));assert.ok(portrait.judgments[0].hypothesisStates.some(h=>h.status==='WITHDRAWN'))
 const current=readOfflineWorkspace(null,currentAthleteId(),saved.record.confirmedImportId).review
 assert.ok(current.metrics.points.some(p=>p.seconds===32));assert.ok(!current.metrics.points.some(p=>p.seconds===35))
})
storeTest('R188 correction to an unrelated feedback field retains timing claims',(t,box)=>{
 const saved=saveChatTraining(parseChatTraining('今天200米×2，30/35秒，组间3分钟'),'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
 t.mock.timers.tick(1000);const review=readOfflineWorkspace(null,currentAthleteId(),saved.record.confirmedImportId).review;assert.ok(saveOfflineReview(review).ok)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'weight',setKey:'unrelated-strength-set',originalValue:'40',newValue:'42',reason:'synthetic unrelated change'}))
 assert.equal(readClaimRevisions(currentAthleteId()).filter(r=>r.result.updateAction==='MARK_STALE').length,0)
 assert.ok(offlineAthletePortrait(null,readOfflineHistory(currentAthleteId())).judgments[0].hypothesisStates.every(h=>h.status==='PENDING'))
})
storeTest('R188 unknown legacy source links remain REVIEW_REQUIRED',(t,box)=>{
 const saved=saveChatTraining(parseChatTraining('今天200米×2，30/35秒，组间3分钟'),'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
 t.mock.timers.tick(1000);const review=readOfflineWorkspace(null,currentAthleteId(),saved.record.confirmedImportId).review
 assert.ok(registerReviewClaims('unknown-old',{...review,development:undefined}))
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'chat-1-2',originalValue:'35',newValue:'32',reason:'synthetic correction'}))
 assert.ok(readClaimRevisions(currentAthleteId()).some(r=>r.result.updateAction==='REVIEW_REQUIRED'))
})
function decision(id:string,unit='s'):DecisionSnapshot{const now=new Date().toISOString();return {id,athleteId:currentAthleteId(),actor:'FANGKUN',caseId:id,createdAt:now,evidenceCutoff:now,sources:[{sourceId:'baseline',revision:'v2'}],hypothesis:'synthetic performance',alternative:'conditions',metricId:unit==='s'?'TIME':'LOAD',protocolKey:unit==='s'?'electronic':'strength-sets',unit,forecastValue:100,forecastDirection:'LOWER_BETTER',observationDueAt:new Date(Date.now()+86400000).toISOString(),uncertaintyNote:'synthetic only',safetyHold:false,planWrite:false,knowledgeEvidenceIds:['R187-E07'],knowledgeVersion:P7_EVIDENCE_VERSION}}
storeTest('R188 future observation cannot be committed as an actual outcome',(t,box)=>{
 const d=decision('future-outcome');assert.equal(p7CommitLiveDecision(d).ok,true)
 const future=new Date(Date.now()+30000).toISOString()
 assert.equal(p7CommitOutcome(d.id,{id:'future',athleteId:d.athleteId,caseId:d.caseId,observedAt:future,recordedAt:future,source:{sourceId:'future-source',revision:'v1'},metricId:d.metricId,protocolKey:d.protocolKey,unit:d.unit,value:100,measurementValid:true}).reason,'INVALID_OUTCOME')
 assert.equal(p7Read(d.athleteId).filter(r=>r.event.kind==='OUTCOME').length,0)
})
storeTest('R188 old source revision notices do not poison a new corrected decision',(t,box)=>{
 assert.ok(p7CommitSourceRevision(currentAthleteId(),'baseline','v1',new Date().toISOString()))
 t.mock.timers.tick(1000);assert.ok(p7CommitSourceRevision(currentAthleteId(),'baseline','v2',new Date().toISOString()))
 assert.equal(p7CommitLiveDecision(decision('corrected-new-decision')).ok,true)
 assert.equal(p7CommitLiveDecision({...decision('stale-new-decision'),sources:[{sourceId:'baseline',revision:'v1'}]}).reason,'KNOWN_SOURCE_CONFLICT')
})
storeTest('R188 calibration never combines seconds and kilograms',(t,box)=>{
 for(const unit of ['s','kg']){
  const d=decision('metric-'+unit,unit);assert.ok(p7CommitLiveDecision(d).ok);t.mock.timers.tick(1000)
  const now=new Date().toISOString();assert.ok(p7CommitOutcome(d.id,{id:'result-'+unit,athleteId:d.athleteId,caseId:d.caseId,observedAt:now,recordedAt:now,source:{sourceId:'result-'+unit,revision:'v1'},metricId:d.metricId,protocolKey:d.protocolKey,unit:d.unit,value:unit==='s'?101:104,measurementValid:true}).ok)
 }
 const r=p7Project(currentAthleteId(),{baseline:'v2','result-s':'v1','result-kg':'v1'})
 assert.equal(r.calibration.mae,null);assert.equal(r.calibration.eligibleCount,0)
 assert.equal(r.calibrationGroups.length,2);assert.deepEqual(r.calibrationGroups.map(g=>g.mae).sort(),[1,4])
})
storeTest('R188 full backup restores new P7 decision and dependent claim journals',(t,box)=>{
 const saved=saveChatTraining(parseChatTraining('今天200米×2，30/35秒，组间3分钟'),'2026-10-13T08:00:00Z',true);assert.ok(saved.ok)
 t.mock.timers.tick(1000);assert.ok(saveOfflineReview(readOfflineWorkspace(null,currentAthleteId(),saved.record.confirmedImportId).review).ok)
 t.mock.timers.tick(1000);assert.ok(appendCorrection({trainingOccurrenceId:saved.record.confirmedImportId,kind:'FIELD',field:'duration',setKey:'chat-1-2',originalValue:'35',newValue:'32',reason:'synthetic corrected timing'}))
 const question='教练已经批准明天的课程：轻松跑20分钟，明天练什么，没有疼痛'
 assert.ok(commitDisplayedCoachAdvice(ask(question,emptyDialogue(currentAthleteId())),question).ok)
 const p7Keys=[...box.data].filter(([k])=>k.startsWith('fr255-p7'));assert.ok(p7Keys.some(([k])=>k.length>80))
 const raw=collectLocalBackup(box),target=firstWeekMemory();assert.ok(inspectLocalBackup(raw,target).ok);assert.ok(restoreLocalBackup(raw,target).ok)
 for(const [k,v] of p7Keys)assert.equal(target.getItem(k),v)
 setStoreBackend(target);assert.ok(p7Read(currentAthleteId()).length);assert.ok(readClaimRevisions(currentAthleteId()).some(r=>r.result.updateAction==='MARK_STALE'))
})
storeTest('R188 backup does not broaden unknown long key namespaces',(t,box)=>{
 for(const key of ['fr255-unknown:'+('a'.repeat(180)), 'fr255-p7-unknown:'+('a'.repeat(180))]){
  const raw=JSON.stringify({kind:'fr255-local-backup',keys:{[key]:'synthetic'}})
  assert.equal(inspectLocalBackup(raw,box).ok,false)
 }
})
function deviceFixture():DecodedDeviceActivity{return {sourceFileHash:'synthetic-only',activityId:'synthetic-activity',sourceId:'synthetic:activity',athleteId:'synthetic-athlete',identityConfirmed:true,deviceId:'synthetic-device',protocolKey:'synthetic-track-protocol',sport:'RUNNING',startedAt:'2026-10-13T08:00:00Z',recordedAt:'2026-10-13T09:00:00Z',totalDistanceMeters:400,timerSeconds:80,elapsedSeconds:260,expectedLapOrdinals:[1,2],occurrenceBinding:{occurrenceId:'synthetic-occurrence',athleteId:'synthetic-athlete',confirmed:true,sourceId:'synthetic:binding'},reportedRests:[],laps:[1,2].map(n=>({id:'lap-'+n,ordinal:n,sourceId:'synthetic:lap-'+n,kind:'WORK',distance:{value:200,unit:'m'},timerSeconds:40,elapsedSeconds:40,averageHeartRateBpm:160,maximumHeartRateBpm:180,timingMethod:'device-timer',heartRateMethod:'synthetic-chest-strap',structure:{componentId:'run',blockId:'main',stepId:'rep',round:1,repeat:n,confirmed:true}}))}}
for(const [label,change] of [
 ['HR260',(d:DecodedDeviceActivity)=>{d.laps[0].averageHeartRateBpm=260;d.laps[0].maximumHeartRateBpm=260}],
 ['HR220',(d:DecodedDeviceActivity)=>{d.laps[0].averageHeartRateBpm=220;d.laps[0].maximumHeartRateBpm=225}],
 ['200m9s',(d:DecodedDeviceActivity)=>{d.laps[0].timerSeconds=9}],
 ['negative timing',(d:DecodedDeviceActivity)=>{d.laps[0].timerSeconds=-1}],
 ['elapsed shorter than timer',(d:DecodedDeviceActivity)=>{d.laps[0].elapsedSeconds=30}],
 ['activity elapsed shorter than timer',(d:DecodedDeviceActivity)=>{d.elapsedSeconds=70}],
 ['negative distance',(d:DecodedDeviceActivity)=>{d.laps[0].distance!.value=-200}],
 ['invalid distance unit',(d:DecodedDeviceActivity)=>{d.laps[0].distance!.unit='mi' as 'm'}],
 ['average exceeds maximum',(d:DecodedDeviceActivity)=>{d.laps[0].averageHeartRateBpm=190}],
 ['negative activity total',(d:DecodedDeviceActivity)=>{d.totalDistanceMeters=-400}],
] as const)test('R188 device quality gate retains raw and blocks suspect input: '+label,()=>{
 const d=deviceFixture();change(d);const before=structuredClone(d),r=prepareDeviceActivity(d,'2026-10-14T08:00:00Z')
 assert.equal(r.status,'BLOCKED');assert.ok(r.qualityIssues?.length);assert.deepEqual(d,before);assert.deepEqual(r.raw,before)
 assert.equal(r.comparisonKey,null);assert.equal(r.automaticImport,false);assert.equal(r.planWrite,false)
 if(label.startsWith('HR')){const hr=r.candidate.runningSegments[0].averageHeartRateBpm;assert.ok(hr);assert.equal(hr.status,'AMBIGUOUS');assert.equal(hr.value,null)}
 if(label==='200m9s')assert.equal(r.candidate.runningSegments[0].durationSeconds.status,'AMBIGUOUS')
})
test('R188 valid partial device data remain reviewable; no artificial RPE or automatic import',()=>{
 const d=deviceFixture();d.laps[0].averageHeartRateBpm=null
 const r=prepareDeviceActivity(d,'2026-10-14T08:00:00Z');assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.qualityIssues?.length,0)
 assert.ok(r.candidate.runningSegments[0].averageHeartRateBpm);assert.equal(r.candidate.runningSegments[0].averageHeartRateBpm.status,'ABSENT');assert.equal(r.candidate.sessionRpe.status,'ABSENT')
 assert.equal(r.candidate.runningSegments[1].durationSeconds.value,40);assert.equal(r.automaticImport,false)
})
