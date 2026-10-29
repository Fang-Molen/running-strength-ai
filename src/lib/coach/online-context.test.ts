import test from 'node:test';
import assert from 'node:assert/strict';
import { selectOnlineContext, onlineContextNeeds, quotedOnlineContextBytes, ONLINE_QUOTED_CONTEXT_BYTES, type OnlineContextInput } from './online-context';
import { contextRecordQuote } from './online-contract';
import type { AnalysisFact, TrainingFact } from '../health/analysis-contract';
import type { CycleGoal } from './cycle/types';
import { parseCoachContext } from '../../../server/coach-deepseek/lib/coach-declarations';
import { projectAnalysisEvidence } from '../health/analysis-evidence';
import { buildMuscleExposure } from '../health/muscle-exposure';
import { evaluateRecoveryEvidence } from '../health/recovery-assessment';
import { buildCoachAnalysisPacket } from '../health/analysis-packet';
import { contextualQuestion, dialogueRecords, localAnalysisRecords } from './online-handoff';

test('phased 1B personal recovery, prior-year history and self/other clauses select owned context',()=>{
 for(const q of ['我现在恢复得如何','我去年的训练变化','我没有腿疼但感觉累','我朋友腿疼，我自己的跑步怎么办','我明天呢'])assert.equal(onlineContextNeeds(q).personal,true,q);
 for(const q of ['我朋友现在恢复得如何','去年训练是什么意思','我没有腿疼，解释一下RPE'])assert.equal(onlineContextNeeds(q).personal,false,q);
 assert.match(contextualQuestion('我明天呢',[{role:'user',text:'复盘我去年的跑步训练'}]),/去年/);
});

test('phased 1B requested prior year is not displaced by fifteen recent workouts',()=>{
 const old=training({id:'last-year',occurredAt:'2025-11-15T09:00:00Z',knownAt:'2025-11-15T10:00:00Z',receivedAt:'2025-11-15T10:00:00Z'});
 const recent=Array.from({length:15},(_,i)=>{const at=`2026-10-${String(i+1).padStart(2,'0')}T09:00:00Z`;return training({id:'recent-'+i,occurredAt:at,startedAt:at,knownAt:at,receivedAt:at})});
 const r=selectOnlineContext(input('复盘我去年的训练',[...recent,old]));
 assert.deepEqual(r.selectedFacts.map(f=>f.id),['last-year']);
 assert.ok(r.context.coverage.unknowns.some(s=>/2025/.test(s)));
 const absent=selectOnlineContext(input('复盘我去年的训练',recent));
 assert.equal(absent.selectedFacts.length,0);
 assert.ok(absent.context.coverage.unknowns.some(s=>/没有|缺/.test(s)));
 const compare=selectOnlineContext(input('比较我去年与今年的训练变化',[...recent,old]));
 assert.ok(compare.selectedFacts.some(f=>f.id==='last-year'));
 assert.ok(compare.selectedFacts.some(f=>f.id.startsWith('recent-')));
});

test('phased 1B explicit calendar day and prior year honor the athlete timezone at New Year',()=>{
 const prior=training({id:'prior',occurredAt:'2025-12-31T15:30:00Z',knownAt:'2026-01-01T01:00:00Z',receivedAt:'2026-01-01T01:00:00Z'});
 const localNewYear=training({id:'new-year',occurredAt:'2025-12-31T16:30:00Z',knownAt:'2026-01-01T01:00:00Z',receivedAt:'2026-01-01T01:00:00Z'});
 const i={...input('复盘我去年的训练',[prior,localNewYear]),day:'2026-01-01',asOf:'2026-01-01T04:00:00Z',timeZone:'Asia/Shanghai'};
 assert.deepEqual(selectOnlineContext(i).selectedFacts.map(f=>f.id),['prior']);
 assert.deepEqual(selectOnlineContext({...i,question:'复盘我2026-01-01的训练'}).selectedFacts.map(f=>f.id),['new-year']);
});

test('phased 1C long restriction tails and dialogue remain transmitted or explicitly incomplete',()=>{
 const text='背景说明。'.repeat(65)+'禁止冲刺，需复核腿部功能';
 const i=input('根据我的情况安排明天训练');
 i.trainingProfile={days:null,daysPerWeek:null,minutes:null,equipment:null,notes:null,restrictions:[{value:text,source:'ATHLETE_PROFILE',at:'2026-10-20T10:00:00Z',version:'r1'}],conflicts:[],version:'one',sourceRule:'synthetic'};
 const r=selectOnlineContext(i);
 assert.match(JSON.stringify(r.context),/禁止冲刺|限制资料.*未完整/);
 assert.deepEqual(parseCoachContext(r.context,Date.parse(now)),r.context);
 const dialogue=dialogueRecords('local','明天呢',[{role:'user',text}]);
 assert.match(JSON.stringify(dialogue),/禁止冲刺/);
 assert.ok(dialogue.every(r=>r.fields.every(f=>typeof f.value!=='string'||f.value.length<=256)));
});

test('phased 1C old baseline and counterevidence remain dependencies of transmitted analysis',()=>{
 const current=training({occurredAt:'2026-10-27T09:00:00Z',startedAt:'2026-10-27T09:00:00Z',knownAt:'2026-10-27T10:00:00Z',receivedAt:'2026-10-27T10:00:00Z'});
 const baseline:AnalysisFact={...training(),id:'baseline',kind:'METRIC',metric:'HRV_RMSSD',value:50,unit:'ms',statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:null,isFinal:null,energyKind:null};
 const snap=projectAnalysisEvidence({context:{athleteId:'local',asOf:now,timeZone:'UTC',planVersion:null,consentVersion:'TEST',analysisVersion:'TEST'},facts:[current,baseline]});
 const exposure=buildMuscleExposure(snap);
 const packet=buildCoachAnalysisPacket(snap,evaluateRecoveryEvidence(snap,exposure),exposure,{question:'我现在恢复得如何'});
 packet.assessment.hypotheses=[{id:'hypothesis',claim:'当前信号有相反依据',supportingRefs:[{id:current.id,revision:1}],weakeningRefs:[{id:baseline.id,revision:1}],certainty:'UNRESOLVED',discriminator:'复查同协议来源'}];
 const i={...input('我现在恢复得如何',[current,baseline]),packet};
 const r=selectOnlineContext(i);
 assert.ok(r.context.records.some(r=>r.category==='ANALYSIS'&&r.fields.some(f=>f.name==='counterevidence'&&f.value)));
 assert.ok(r.selectedFacts.some(f=>f.id==='baseline'),'a comparison baseline older than seven days must accompany the interpretation');
 assert.notEqual(selectOnlineContext({...i,facts:[current,{...baseline,revision:2,value:35}]}).sourceVersion,r.sourceVersion);
});

test('phased 1C candidate conditions and packet restrictions keep their decision boundaries',()=>{
 const f=training(),snap=projectAnalysisEvidence({context:{athleteId:'local',asOf:now,timeZone:'UTC',planVersion:null,consentVersion:'TEST',analysisVersion:'TEST'},facts:[f]});
 const exposure=buildMuscleExposure(snap),packet=buildCoachAnalysisPacket(snap,evaluateRecoveryEvidence(snap,exposure),exposure,{question:'明天怎么安排'});
 packet.assessment.candidates=[{id:'candidate',kind:'DEFER_AND_REVIEW',basisRefs:[{id:f.id,revision:1}],action:'SKIP',reason:'等待局部功能复核',observation:'日常步行反应',supportsWhen:'功能恢复后重新讨论',weakensWhen:'疼痛加重需复核',doNotExecute:['禁止冲刺'],conditions:['条件尚未确认'],planVersion:'p1',requiresConfirmation:true}];
 packet.safetyConstraints=[{id:'hold',version:'h1',scope:'医生要求暂停全部训练',evidenceRefs:[]}];
 const records=localAnalysisRecords(packet,'local','明天怎么安排',[f]);
 const candidate=records.find(r=>r.fields.some(f=>f.name==='kind'&&f.value==='CANDIDATE'));
 assert.ok(candidate);
 assert.ok(candidate.fields.some(f=>f.name==='action'&&f.value==='SKIP'));
 assert.ok(candidate.fields.some(f=>f.name==='doNotExecute'&&String(f.value).includes('禁止冲刺')));
 assert.ok(candidate.fields.some(f=>f.name==='weakensWhen'&&String(f.value).includes('疼痛')));
 assert.ok(records.some(r=>r.category==='RESTRICTION'&&r.fields.some(f=>String(f.value).includes('暂停全部训练'))));
});

const now = '2026-10-28T04:00:00.000Z';
function training(patch: Partial<TrainingFact> = {}): TrainingFact {
  return {id:'run-1',revision:1,athleteId:'local',provider:'MANUAL',accountRef:null,deviceId:null,protocolKey:'TRACK_REPETITION',sourceRecordId:'run-1',occurredAt:'2026-09-15T09:00:00.000Z',knownAt:'2026-09-15T10:00:00.000Z',receivedAt:'2026-09-15T10:00:00.000Z',sourceTimeZone:'UTC',status:'CONFIRMED',quality:'AVAILABLE',ownershipReceiptId:null,kind:'TRAINING',canonicalActivityId:'run-1',occurrenceId:'run-1',componentId:'work',modality:'RUN',startedAt:'2026-09-15T09:00:00.000Z',endedAt:null,plannedPurpose:null,observedType:'INTERVAL',observedTypeBasis:[],sessionRpe:7,sessionRpeScale:'CR10',actualDurationSeconds:1800,runSegments:[{id:'s1',blockId:'b1',roundIndex:1,stepIndex:1,kind:'REPETITION',distanceM:400,durationSeconds:72,restAfterSeconds:180,restScope:'AFTER_REPEAT',rawResolutionSeconds:1,gradePercent:null,surface:'TRACK',completion:'COMPLETED'}],strengthSets:[],jumpContacts:null,...patch};
}
const input = (question:string, facts:AnalysisFact[] = [training()]):OnlineContextInput => ({owner:'local',question,day:'2026-10-28',asOf:now,facts});

test('X03 question handoff carries computed analysis and a bounded conversation, without claiming verified facts',()=>{
 const snapshot=projectAnalysisEvidence({context:{athleteId:'local',asOf:now,timeZone:'UTC',planVersion:null,consentVersion:'TEST',analysisVersion:'TEST'},facts:[training()]});
 const exposure=buildMuscleExposure(snapshot);
 const packet=buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure,{question:'复盘我的跑步配速'});
 const context=selectOnlineContext({...input('复盘我的跑步配速'),packet,conversation:[{role:'user',text:'这节怎么样？'},{role:'coach',text:'这是上轮解释，不能当新实测。'}]}).context;
 assert.ok(context.records.some(r=>r.category==='ANALYSIS'&&r.fields.some(f=>f.name==='metric'&&f.value==='RUN_WORK_SECONDS')));
 assert.ok(context.records.some(r=>r.category==='DIALOGUE'));
 assert.ok(context.records.some(r=>r.fields.some(f=>f.name==='restAfter'&&f.value===180)),'selected rest structure reaches the same handoff');
 assert.ok(context.records.filter(r=>['ANALYSIS','DIALOGUE'].includes(r.category)).every(r=>r.state==='UNKNOWN'&&r.source.startsWith('USER_DECLARED:')));
 assert.deepEqual(parseCoachContext(context,Date.parse(now)),context);
 const foreign=selectOnlineContext({...input('复盘我的跑步'),packet:{...packet,context:{...packet.context,athleteId:'foreign'}}}).context;
 assert.equal(foreign.records.some(r=>r.category==='ANALYSIS'),false);
});

test('X02 colloquial personal reviews and mixed subjects retrieve owned facts without treating friends as the athlete',()=>{
 for(const q of ['这次训练怎么样','刚才那节呢？','我想知道训练能力','跑的长距离，均速4:46，平均心率157','朋友跑了5公里，我跑了10公里，该怎么安排？']){
  const selected=selectOnlineContext(input(q,[training(),training({id:'friend-run',athleteId:'friend'})]));
  assert.equal(selected.personal,true,q);
  assert.deepEqual(selected.selectedFacts.map(f=>f.id),['run-1'],q);
 }
 for(const q of ['我的朋友跑了5公里，该怎么安排？','长距离训练是什么？','我想知道训练能力的定义','比如跑的长距离，均速4:46，说明什么？'])
  assert.equal(selectOnlineContext(input(q)).personal,false,q);
});

test('explicit comparison selects the requested owned sessions rather than unrelated latest activity',()=>{
 const i={...input('比较这两节，有什么变化？',[training(),training({id:'newest',occurrenceId:'newest',occurredAt:'2026-10-27T09:00:00Z'}),training({id:'run-2',occurrenceId:'run-2',runSegments:[]}),training({id:'foreign',occurrenceId:'foreign',athleteId:'friend'})]),selectedTrainingIds:['run-2','run-1','foreign']};
 const r=selectOnlineContext(i);
 assert.equal(r.personal,true);
 assert.deepEqual(r.selectedFacts.map(f=>f.id),['run-2','run-1']);
 assert.ok(r.context.coverage.unknowns.some(s=>/所选.*无法/.test(s)));
 const original=r.sourceVersion;
 assert.equal(selectOnlineContext({...i,facts:i.facts.map(f=>f.id==='newest'?{...f,revision:2}:f)}).sourceVersion,original);
 assert.notEqual(selectOnlineContext({...i,selectedTrainingIds:['run-1']}).sourceVersion,original);
});

test('general education and third-person cases do not select personal records',()=>{
  for(const q of ['解释一下RPE','我没有腿疼，解释一下RPE','为什么力量训练能帮助跑步？','我朋友腿疼，什么是RPE？']){
    const result=selectOnlineContext(input(q));
    assert.equal(result.personal,false,q);assert.deepEqual(result.context.records,[],q);assert.deepEqual(result.context.dependencyVersions,[],q);
    assert.equal(result.sourceVersion,selectOnlineContext(input(q,[training({revision:2,actualDurationSeconds:4000})])).sourceVersion);
  }
});
test('an old UI selection does not attach private facts to a fresh general definition',()=>{
 const selected=selectOnlineContext({...input('解释一下RPE'),selectedTrainingIds:['run-1']});
 assert.equal(selected.personal,false);
 assert.deepEqual(selected.context.records,[]);
});
test('relevant older history preserves actual run split and rest structure without claiming a recent window',()=>{
  const result=selectOnlineContext(input('复盘我上个月的400米间歇训练'));
  assert.equal(result.personal,true);assert.equal(result.selectedFacts.length,1);
  const fields=result.context.records.flatMap(r=>r.fields);
  assert.ok(fields.some(f=>f.name==='distance'&&f.value===400&&f.unit==='m'));
  assert.ok(fields.some(f=>f.name==='restAfter'&&f.value===180&&f.unit==='s'));
  assert.ok(fields.some(f=>f.name==='restScope'&&f.value==='AFTER_REPEAT'));
  assert.ok(result.context.records.every(r=>r.state==='ACTUAL'));
});
test('strength dose preserves actual load basis, repetitions, completion and RIR',()=>{
  const result=selectOnlineContext(input('复盘我的力量训练',[training({modality:'STRENGTH',runSegments:[],strengthSets:[{id:'set1',catalogId:'squat',catalogVersion:'1',side:'BILATERAL',loadKg:60,loadBasis:'TOTAL_EXTERNAL',reps:5,holdSeconds:null,setRpe:8,rir:2,effortScale:'CR10',eccentricSeconds:null,rangeProtocol:null,completion:'COMPLETED'}]})]));
  const fields=result.context.records.flatMap(r=>r.fields);
  for(const [name,value] of [['load',60],['loadBasis','TOTAL_EXTERNAL'],['reps',5],['rir',2],['completion','COMPLETED']])assert.ok(fields.some(f=>f.name===name&&f.value===value));
});
test('foreign, future, planned and conflicting training facts cannot become actual context',()=>{
  const facts=[training(),training({id:'foreign',athleteId:'friend'}),training({id:'future',knownAt:'2027-01-01T00:00:00Z'}),training({id:'planned',status:'PLANNED'}),training({id:'conflict',quality:'CONFLICT'})];
  const result=selectOnlineContext(input('复盘我的间歇训练',facts));
  assert.deepEqual(result.selectedFacts.map(f=>f.id),['run-1']);
  assert.doesNotMatch(JSON.stringify(result.context),/foreign|friend/);
});
test('target and saved schedule remain distinct from measured performance',()=>{
  const i=input('根据我的比赛目标和课表安排训练');
  i.goal={schema:1,athleteId:'local',revision:3,savedAt:'2026-10-20T09:00:00Z',eventMeters:800,raceDate:'2026-11-20',targetSeconds:130,experience:'TRAINED',priority:'SPEED',horizonWeeks:4,taperDays:7,proposeExtraMinutes:null,source:'USER_CONFIRMED_GOAL'} satisfies CycleGoal;
  i.schedule=[{athleteId:'local',id:'slot1',date:'2026-10-29',kind:'run',modality:'run',title:'速度课',focus:['speed'],minutes:30,intensity:'HARD',lowerHeavy:false,source:'custom',refId:null,status:'planned'}];
  const r=selectOnlineContext(i).context.records;
  assert.equal(r.find(r=>r.category==='GOAL')?.state,'TARGET');assert.equal(r.find(r=>r.category==='PLAN')?.state,'PLANNED');
  assert.ok(r.find(r=>r.category==='PLAN')?.fields.some(f=>f.name==='executionState'&&f.value==='planned'));
});
test('dependency fingerprint follows selected evidence, not clock, unrelated nutrition or foreign rows',()=>{
  const original=input('复盘我上个月的400米间歇训练'),a=selectOnlineContext(original);
  const changed={...original,asOf:'2026-10-28T04:05:00Z',foods:[{id:'food',athleteId:'local',date:'2026-10-28',meal:'早餐' as const,name:'饭',kcal:500,recordedAt:'2026-10-28T01:00:00Z'}],facts:[...original.facts,training({id:'other',athleteId:'other'})]};
  assert.equal(selectOnlineContext(changed).sourceVersion,a.sourceVersion);
  assert.notEqual(selectOnlineContext({...original,facts:[training({revision:2,runSegments:[{...training().runSegments[0],durationSeconds:70}]})]}).sourceVersion,a.sourceVersion);
});
test('context is bounded and truncated workout structure is explicitly unknown',()=>{
  const t=training();t.runSegments=Array.from({length:80},(_,i)=>({...t.runSegments[0],id:`s${i}`,stepIndex:i+1}));
  const result=selectOnlineContext(input('复盘我的间歇跑', [t]));
  assert.ok(result.context.records.length<=32);assert.ok(result.context.records.every(r=>r.fields.length<=24));
  assert.ok(new TextEncoder().encode(JSON.stringify(result.context)).length<=48*1024);
  assert.ok(result.context.coverage.omitted>0);assert.ok(result.context.coverage.unknowns.some(s=>/结构|预算/.test(s)));
});
test('nutrition entries retain completeness unknown, actual eating time unknown and no account/device identifiers',()=>{
  const i=input('帮我看今天吃得怎么样');i.foods=[{id:'meal',athleteId:'local',date:'2026-10-28',meal:'午餐',name:'米饭',grams:200,kcal:232,recordedAt:'2026-10-28T03:00:00Z'}];
  const result=selectOnlineContext(i), meal=result.context.records.find(r=>r.category==='NUTRITION');
  assert.ok(meal);assert.equal(meal.occurredAt,null);assert.ok(result.context.coverage.unknowns.some(s=>/全天完整/.test(s)));
  const raw=JSON.stringify(selectOnlineContext(input('复盘我的间歇训练',[training({provider:'GARMIN',accountRef:'secret-account-abc',deviceId:'device-private-xyz'})])).context);
  assert.doesNotMatch(raw,/secret-account-abc|device-private-xyz/);
});
test('personal data requests and broad generic exercise questions are separated',()=>{
  assert.equal(onlineContextNeeds('根据我的训练记录解释为何掉速').personal,true);
  assert.equal(onlineContextNeeds('力量训练会引起肌肉适应吗').personal,false);
  assert.equal(onlineContextNeeds('我朋友的记录，你能解释吗').personal,false);
  assert.equal(onlineContextNeeds('今天HRV怎么样').personal,true);
  assert.equal(onlineContextNeeds('给我安排双阈值').personal,true);
  assert.equal(onlineContextNeeds('给我解释一下双阈值是什么').personal,false);
});
test('different questions sharing unchanged records do not share a conflicting selection version key',()=>{
  const a=selectOnlineContext(input('复盘我的间歇训练'));
  const b=selectOnlineContext(input('复盘我上个月的400米间歇训练'));
  const bKeys=new Map(b.context.dependencyVersions.map(d=>[d.key,d.revision]));
  for(const d of a.context.dependencyVersions)if(bKeys.has(d.key))assert.equal(bKeys.get(d.key),d.revision);
});
test('date-only body measurement does not fabricate a measurement instant',()=>{
  const i=input('根据我的体重看看饮食');i.profile={weightKg:{value:60,source:'BODY_MEASUREMENT',at:'2026-10-20',version:'body-1'},heightCm:null,age:null,sex:null,goal:null,conflicts:[],missing:['age','heightCm','sex','goal'],version:'v1'};
  const r=selectOnlineContext(i).context.records.find(r=>r.category==='CAPABILITY');
  assert.ok(r);assert.equal(r.occurredAt,null);assert.equal(r.knownAt,null);assert.ok(r.fields.some(f=>f.name==='sourceDate'&&f.value==='2026-10-20'));
});
test('real frontend contexts pass the shared server boundary, including response protocols and maximum coverage',()=>{
  const t=training();
  const response:AnalysisFact={...t,kind:'RESPONSE',id:'response',occurredAt:'2026-10-27T09:00:00Z',knownAt:'2026-10-27T10:00:00Z',receivedAt:'2026-10-27T10:00:00Z',relatedTrainingRefs:[],region:'hamstrings',side:'LEFT',measure:'PAIN',value:3,scale:'0-10_HIGH_WORSE',observationProtocol:'SELF_REPORT',elapsedHours:null,functionTaskId:null,notes:null};
  const i=input('看我今天的恢复和训练', [t,response]);
  i.unknowns=Array.from({length:24},(_,n)=>`${n}:`+'未知'.repeat(100));
  t.runSegments=Array.from({length:50},(_,n)=>({...t.runSegments[0],id:`s${n}`,stepIndex:n+1,surface:'场'.repeat(256)}));
  const context=selectOnlineContext(i).context;
  assert.deepEqual(parseCoachContext(context,Date.parse(now)),context);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).length<=48*1024);
  assert.ok(context.coverage.unknowns.some(s=>/预算/.test(s)));
});
test('unrelated profile edit does not change a selected goal field revision',()=>{
  const i=input('根据我的比赛目标复盘训练');i.profile={weightKg:null,heightCm:null,age:null,sex:null,goal:{value:'RUN_PERFORMANCE',source:'ATHLETE_PROFILE',at:'2026-10-10T10:00:00Z',version:'profile:r1'},conflicts:[],missing:['age','heightCm','sex','weightKg'],version:'r1'};
  const before=selectOnlineContext(i).sourceVersion;
  i.profile={...i.profile,heightCm:{value:180,source:'ATHLETE_PROFILE',at:'2026-10-20T10:00:00Z',version:'profile:r2'},goal:{...i.profile.goal!,version:'profile:r2'},version:'r2'};
  assert.equal(selectOnlineContext(i).sourceVersion,before);
});
test('large structured context fits real quoted provider-input budget, not only snapshot-body budget',()=>{
  const t=training();t.runSegments=Array.from({length:80},(_,n)=>({...t.runSegments[0],id:`long-${n}`,stepIndex:n+1,surface:'合成场地'.repeat(60)}));
  const i=input('复盘我的间歇训练，并比较实际分段和休息结构。'.repeat(25),[t]);
  i.unknowns=Array.from({length:24},(_,n)=>`${n}项：`+'源资料缺失或冲突'.repeat(20));
  const context=selectOnlineContext(i).context;
  assert.ok(quotedOnlineContextBytes(i.question,context)<=ONLINE_QUOTED_CONTEXT_BYTES);
  assert.ok(context.coverage.omitted>0);
  assert.ok(context.coverage.unknowns.some(s=>/预算|未全部列出/.test(s)));
  // JSON quoting adds bytes. The check includes exact formatter output and the
  // nested serialized user message, not a cheap count of raw record fields.
  const actualSources=context.records.map(r=>({id:r.recordId,kind:'FACT',detail:contextRecordQuote(r)}));
  const actualBytes=new TextEncoder().encode(JSON.stringify([{role:'user',content:JSON.stringify({question:i.question,facts:actualSources,coverage:context.coverage})}])).length;
  assert.equal(quotedOnlineContextBytes(i.question,context),actualBytes);
  for(const r of context.records){const parent=r.fields.find(f=>f.name==='parent')?.value;if(parent)assert.ok(context.records.some(p=>p.recordId===parent));}
});
test('budget cannot erase omitted safety restrictions as implicit training permission',()=>{
  const i=input('根据我的情况安排今天训练');i.trainingProfile={days:null,daysPerWeek:null,minutes:null,equipment:null,notes:null,restrictions:Array.from({length:30},(_,n)=>({value:`第${n}项医生限制：不能冲刺；`+'需要核对原记录。'.repeat(20),source:'ATHLETE_PROFILE' as const,at:'2026-10-20T10:00:00Z',version:`r${n}`})),conflicts:[],version:'many',sourceRule:'synthetic'};
  const context=selectOnlineContext(i).context;
  assert.ok(context.coverage.omitted>0);
  const summary=context.records.find(r=>r.fields.some(f=>f.name==='omittedRestrictionCount'));
  assert.equal(summary?.category,'RESTRICTION');assert.equal(summary?.state,'UNKNOWN');
  assert.ok(summary?.fields.some(f=>f.name==='restriction'&&String(f.value).includes('不能据此恢复')));
  assert.ok(quotedOnlineContextBytes(i.question,context)<=ONLINE_QUOTED_CONTEXT_BYTES);
  assert.deepEqual(parseCoachContext(context,Date.parse(now)),context);
});

// A provider request must not cancel itself merely because local calculations are reread later.
test('clock-only packet regeneration keeps online context stable; corrected dose still invalidates',()=>{
 const select=(asOf:string,f:TrainingFact)=>{
  const snapshot=projectAnalysisEvidence({context:{athleteId:'local',asOf,timeZone:'UTC',planVersion:null,consentVersion:'TEST',analysisVersion:'TEST'},facts:[f]});
  const exposure=buildMuscleExposure(snapshot);
  const packet=buildCoachAnalysisPacket(snapshot,evaluateRecoveryEvidence(snapshot,exposure),exposure,{question:'这次训练怎么样，明天如何安排'});
  return selectOnlineContext({...input('这次训练怎么样，明天如何安排',[f]),asOf,packet,selectedTrainingIds:['run-1']});
 };
 const first=select(now,training()),later=select('2026-10-28T04:00:02.000Z',training());
 assert.equal(first.sourceVersion,later.sourceVersion);
 assert.notEqual(first.sourceVersion,select('2026-10-28T04:00:02.000Z',training({revision:2,runSegments:[{...training().runSegments[0],durationSeconds:70}]})).sourceVersion);
});
