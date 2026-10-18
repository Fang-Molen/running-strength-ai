import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToString } from 'react-dom/server';
import { addDraftMove, appendSessionCompared, filterExercises, PLAN_KEY, previewSession, savePlanCompared, type DraftMove } from './session-builder';
import { exerciseInventory, exerciseContent } from './exercise-content';
import { runnerInput, nextRunnerCursor } from './runner-input';
import { SessionBuilder } from '../../components/session-builder';
import { ExerciseContent } from '../../components/exercise-content';
import { completeFromRunner, interruptFromRunner } from '../../components/training-runner';
import { bindTrainingStart, getTrainingOccurrence } from '../core/occurrence';
import { startTraining } from '../core/training-decision';
import { setStoreBackend } from '../core/storage';
import { loadEvents, EVENT_JOURNAL_PREFIX } from '../core/events';
import { collectLocalBackup, inspectLocalBackup } from '../core/trial';
import type { Plan, Session } from './model';
import { buildOriginalPlanSnapshot } from '../core/canonical';

const plan: Plan={name:'原计划',kind:'custom',sessions:[{id:'existing',name:'原课',moves:[]}]};
function row(id='hammer'):DraftMove{return {...addDraftMove([],id)[0]!,sets:'2',amount:'8',rest:'60',weight:'4',side:'both',equipment:'哑铃'};}
function session():Session {const result=previewSession('胸与手臂',['胸','手臂'],[row()]);if(!result.ok)throw Error(result.reason);return result.session;}
function store(fail?: (key:string,value:string)=>'throw'|'drop'|undefined){const box=new Map<string,string>();return {box,keys:()=>[...box.keys()],getItem:(key:string)=>box.get(key)??null,setItem:(key:string,value:string)=>{const mode=fail?.(key,value);if(mode==='throw')throw Error('quota');if(mode!=='drop')box.set(key,value);}};}

test('multi-part filtering keeps stable variants and selecting the same action does not add volume',()=>{
  assert.deepEqual(filterExercises([]),[]);
  const matches=filterExercises(['胸','手臂']);assert.ok(matches.some(x=>x.id==='hammer'));assert.ok(matches.some(x=>x.id==='knee-pushup'));assert.ok(!matches.some(x=>x.id==='goblet'));
  const xs=addDraftMove([], 'pushup');assert.equal(addDraftMove(xs,'pushup').length,1);assert.equal(addDraftMove(xs,'knee-pushup').length,2);
  const repeated=addDraftMove(xs,'pushup','明确分段安排');assert.equal(repeated.length,2);assert.equal(repeated[1]!.sets,'');
});
test('empty, unknown, blank and malformed parameters never become a zero-dose or normal candidate',()=>{
  const invalid:DraftMove[][]=[[],[{...row(),weight:''}],[{...row(),sets:'1.5'}],[{...row(),amount:'0'}],[{...row(),side:''}],[{...row(),catalogId:'unrecognized'}],[{...row(),rest:'-1'}],[{...row(),equipment:'无'}]];
  for(const rows of invalid)assert.equal(previewSession('课',['手臂'],rows).ok,false);
  const xs=[row(),{...row(),key:'different'}];assert.equal(previewSession('课',['手臂'],xs).ok,false);
});
test('explicit repetition retains independent parameters, order and side convention without doubling volume',()=>{
  const xs=[row('knee-pushup'),{...row(),key:'second'},{...row(),key:'third',sets:'1',amount:'5',repeatReason:'技术复习',side:'each' as const}];
  const result=previewSession('组合',['胸','手臂'],xs);assert.equal(result.ok,true);if(!result.ok)return;
  assert.deepEqual(result.session.moves.map(x=>[x.catalogId,x.sets,x.amount]),[['knee-pushup',2,8],['hammer',2,8],['hammer',1,5]]);
  assert.match(result.session.moves[2]!.executionNote!,/左右合计/);
  const snapshot=buildOriginalPlanSnapshot(result.session,'2026-10-11');assert.equal(snapshot.exercises[2]!.executionNote,result.session.moves[2]!.executionNote);
});
test('preview and initial builder view do not write the plan or claim personal suitability',()=>{
  let calls=0;const html=renderToString(<SessionBuilder onCancel={()=>{calls++}} onConfirm={async()=>{calls++;return {ok:true}}}/>);
  assert.equal(calls,0);assert.match(html,/多选训练部位/);assert.match(html,/预览、清空和取消均不保存/);
  const before=JSON.stringify(plan);session();assert.equal(JSON.stringify(plan),before);
});
test('confirmed append preserves old course identities and is verified in one value',()=>{
  const s=store();const expected=JSON.stringify(plan);s.setItem(PLAN_KEY,expected);const course=session();const result=appendSessionCompared(s,expected,plan,course);assert.equal(result.ok,true);
  const saved=JSON.parse(s.getItem(PLAN_KEY)!);assert.deepEqual(saved.sessions[0],plan.sessions[0]);assert.equal(saved.sessions.length,2);assert.notEqual(saved.sessions[1].id,saved.sessions[0].id);
  assert.equal(appendSessionCompared(s,s.getItem(PLAN_KEY),saved,course).ok,false);
});
test('quota failure and dropped writes cannot report successful course creation; draft can retry',()=>{
  let failing=true;const s=store(key=>failing&&key===PLAN_KEY?'throw':undefined);s.box.set(PLAN_KEY,JSON.stringify(plan));const course=session();const expected=s.getItem(PLAN_KEY);
  assert.equal(appendSessionCompared(s,expected,plan,course).ok,false);assert.equal(s.getItem(PLAN_KEY),expected);
  failing=false;assert.equal(appendSessionCompared(s,expected,plan,course).ok,true);
  const dropped=store(()=>'drop');dropped.box.set(PLAN_KEY,expected!);assert.equal(appendSessionCompared(dropped,expected,plan,course).ok,false);
});
test('two stale tabs cannot lose the first confirmed course; refreshed tab appends both',()=>{
  const s=store();const expected=JSON.stringify(plan);s.setItem(PLAN_KEY,expected);const a=session(),b=session();assert.equal(appendSessionCompared(s,expected,plan,a).ok,true);assert.equal(appendSessionCompared(s,expected,plan,b).ok,false);
  const raw=s.getItem(PLAN_KEY)!;const latest=JSON.parse(raw);assert.equal(appendSessionCompared(s,raw,latest,b).ok,true);assert.deepEqual(JSON.parse(s.getItem(PLAN_KEY)!).sessions.map((x:Session)=>x.id),['existing',a.id,b.id]);
  assert.equal(savePlanCompared(s,expected,{...plan,name:'过期修改'}).ok,false);
});
test('content inventory distinguishes unavailable variants, legacy licenses and sourced new schematics',()=>{
  const all=exerciseInventory();assert.equal(all.length,76);assert.equal(new Set(all.map(x=>x.id)).size,76);
  assert.equal(exerciseContent('single-hip')!.imageAvailable,false);assert.equal(exerciseContent('db-rdl')!.imageAvailable,false);
  assert.equal(exerciseContent('hammer')!.provenance.review,'UNREVIEWED');assert.ok(exerciseContent('hammer')!.source);assert.equal(exerciseContent('bb-bench')!.steps.length,0);
  assert.equal(exerciseContent('goblet')!.provenance.license,'历史许可未核清');
});
test('shared exercise view exposes local 3D and readable cues without remote embeds or plan mutation controls',()=>{
  const html=renderToString(<ExerciseContent catalogId="hammer"/>);assert.match(html,/怎么做/);assert.match(html,/准备/);assert.match(html,/动作要领尚待逐条专业审校/);assert.match(html,/新版动作演示区域/);assert.match(html,/未验收时显示今晚角色外观参考/);assert.doesNotMatch(html,/<iframe|(?:src|href)="https?:|加入今天训练|保存训练/);
  assert.match(renderToString(<ExerciseContent catalogId="bb-bench"/>),/常见错误/);assert.equal(exerciseContent(null),null);
});
test('blank input, zero repetitions and invalid count never confirm a set; zero weight remains explicit',()=>{
  for(const [w,a] of [['','8'],['0',''],['0','0'],['-1','8'],['0','2.5']])assert.equal(runnerInput(w!,a!,'reps'),null);
  assert.deepEqual(runnerInput('0','8','reps'),{weight:0,amount:8});assert.deepEqual(runnerInput('0','2.5','seconds'),{weight:0,amount:2.5});
});
test('after refresh rest target advances to that same unrecorded group, not the following group',()=>{
  const rows=[{key:'a:1',handled:true},{key:'a:2',handled:false},{key:'b:1',handled:false}];
  assert.equal(nextRunnerCursor(rows,0,'a:2'),1);assert.equal(nextRunnerCursor(rows,1,'a:2'),1);assert.equal(nextRunnerCursor(rows,1,null),2);
});
function started(s:ReturnType<typeof store>){setStoreBackend(s);const course=session();const event=startTraining({decisionId:'d',sessionId:course.id,action:'ORIGINAL_PLAN'})!;const occ=bindTrainingStart({startEventId:event.event_id,startedAt:event.timestamp,sessionId:course.id,planSlotId:course.id,plan:course})!;return {course,occ};}
function finish(id:string){return completeFromRunner({decisionId:'d',sessionId:id,planned:null,actualSets:1,actualAmount:8,actualWeightKg:4,rpe:null,pain:false,modified:false,interrupted:false});}
test('close event failure leaves the occurrence open and can retry without a false success',()=>{
  let fail=false;const s=store((key,value)=>fail&&key.startsWith(EVENT_JOURNAL_PREFIX)&&value.includes('TRAINING_COMPLETED')?'throw':undefined);const {course,occ}=started(s);fail=true;assert.equal(finish(course.id),null);assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'IN_PROGRESS');fail=false;assert.ok(finish(course.id));assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'COMPLETED');setStoreBackend(null);
});
test('partial write on closing cannot report success, retry reuses the saved close event',()=>{
  let fail=false;const s=store(key=>fail&&key==='fr255-training-occurrence-v1'?'drop':undefined);const {course,occ}=started(s);fail=true;assert.equal(finish(course.id),null);assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'IN_PROGRESS');fail=false;assert.ok(finish(course.id));assert.equal(loadEvents().filter(x=>x.event_type==='TRAINING_COMPLETED').length,1);setStoreBackend(null);
});
test('interruption storage failure retains open identity and does not announce a completed course',()=>{
  let fail=false;const s=store((key,value)=>fail&&key.startsWith(EVENT_JOURNAL_PREFIX)&&value.includes('"event_type":"TRAINING_INTERRUPTED"')?'throw':undefined);const {course,occ}=started(s);fail=true;assert.equal(interruptFromRunner('d',course.id),null);assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'IN_PROGRESS');fail=false;assert.ok(interruptFromRunner('d',course.id));assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'INTERRUPTED');setStoreBackend(null);
});

test('partial execution closes the occurrence but never claims every planned set completed',()=>{
  const s=store();const {course,occ}=started(s);
  const saved=completeFromRunner({decisionId:'d',sessionId:course.id,planned:null,actualSets:1,actualAmount:8,actualWeightKg:4,rpe:null,pain:false,modified:false,interrupted:false,partial:true});
  assert.ok(saved);assert.equal(saved.payload.completion,false);assert.equal(saved.payload.completionStatus,'PARTIAL');assert.equal(getTrainingOccurrence(occ.trainingOccurrenceId)!.lifecycle,'COMPLETED');setStoreBackend(null);
});

test('long execution-draft identities remain restorable through the existing backup validator',()=>{
  const s=store();const key=`fr255-runner-draft-v1:decision-${'a'.repeat(36)}:session-${'b'.repeat(36)}:move-${'c'.repeat(36)}:2`;
  s.setItem(key,JSON.stringify({weight:'',amount:'8'}));const backup={...s,key:(i:number)=>[...s.box.keys()][i]??null,length:s.box.size};
  assert.equal(inspectLocalBackup(collectLocalBackup(backup),s).ok,true);
  s.setItem('fr255-runner-draft-v1:'+':'.repeat(100),'{}');assert.equal(inspectLocalBackup(collectLocalBackup({...backup,length:s.box.size}),s).ok,false);
});
