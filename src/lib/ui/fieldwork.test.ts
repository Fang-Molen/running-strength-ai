import test,{beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend,type MemoryStore} from '../core/storage'
import {currentAthleteId,loadEvents,setEventContext} from '../core/events'
import {collectLocalBackup,restoreLocalBackup} from '../core/trial'
import {trackComponents} from './running-workouts'
import {RUNNING_DRILLS,STRENGTH_DRILLS} from './fieldwork-catalogue'
import {DRAFT_PREFIX,loadPlanDrafts,savePlanDraft,removePlanDraft,type DraftInput} from './fieldwork-plan-drafts'
import {commitFieldworkDraft,commitFieldworkMeal,commitFieldworkMeasurement,readFieldworkState,describeFieldworkCourse,readFieldworkPreferences,saveFieldworkPreferences} from './fieldwork-host'
import {loadEntries,removeEntry,recordManualFood} from '../nutrition/log'
import {loadChecks,upsertCheck,removeCheck,todayDate} from '../nutrition/body'
type Box=MemoryStore&{values:Map<string,string>;drop:boolean;length:number;key:(n:number)=>string|null}
let box:Box
function memory():Box{const values=new Map<string,string>();return {values,drop:false,keys:()=>[...values.keys()],getItem:k=>values.get(k)??null,setItem(k,v){if(!this.drop)values.set(k,v)},key:n=>[...values.keys()][n]??null,get length(){return values.size}}}
beforeEach(()=>{
  box=memory();setStoreBackend(box);setEventContext({athleteId:'synthetic-fieldwork-A'})
  Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})
  let queue=Promise.resolve<unknown>(null)
  Object.defineProperty(globalThis,'navigator',{value:{locks:{request:(_name:string,fn:()=>unknown)=>{const next=queue.then(fn);queue=next.catch(()=>null);return next}}},configurable:true})
})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
const input=(patch:Partial<DraftInput>={}):DraftInput=>({id:'fk-run-tech-007',date:todayDate(),slot:'technique',sets:null,amount:null,unit:'m',restSec:null,intent:'create',plannedOnly:true,...patch})
function saved(patch:Partial<DraftInput>={}){const r=savePlanDraft(input(patch));if(!r.ok)throw Error(r.reason);return r.draft}
const formal=()=>JSON.stringify(Object.fromEntries([...box.values].filter(([k])=>/strength-plan|running-plan|fr255-events|fr255-event-journal/.test(k))))

test('host reads exactly the existing 53 technique and 76 strength IDs without default training doses',()=>{
  assert.equal(RUNNING_DRILLS.length,53);assert.equal(STRENGTH_DRILLS.length,76);assert.equal(new Set([...RUNNING_DRILLS,...STRENGTH_DRILLS].map(d=>d.id)).size,129)
  assert.ok(RUNNING_DRILLS.every(d=>d.review==='draft_needs_coach_review'&&!('sets' in d)))
  assert.ok(STRENGTH_DRILLS.every(d=>d.review==='UNREVIEWED'&&!('amount' in d)))
})
test('empty host has no sample plans meals measurements calorie targets or scenario',()=>{const s=readFieldworkState();assert.deepEqual(s.plans,[]);assert.deepEqual(s.food,[]);assert.deepEqual(s.measurements,[]);assert.equal(s.calTarget,null);assert.equal(s.scenario,null);assert.deepEqual(s.macroTargets,{protein:null,carbs:null,fat:null});assert.equal(box.length,0)})
test('name-only draft preserves null doses, canonical identity and source version; creates no training fact',()=>{
  box.setItem('fr255-strength-plan-v3','original formal plan');const before=formal(),d=saved({uid:'untrusted-preview-id'})
  assert.notEqual(d.uid,'untrusted-preview-id');assert.ok(d.uid.startsWith('draft-'));assert.equal(d.sets,null);assert.equal(d.amount,null);assert.equal(d.restSec,null);assert.equal(d.contentVersion,'1.0.0');assert.equal(d.reviewStatus,'draft_needs_coach_review');assert.equal(d.athleteId,currentAthleteId());assert.equal(d.plannedOnly,true);assert.equal(formal(),before);assert.equal(loadEvents().length,0)
})
test('same date section and source ID are deduplicated; other dates and sections are independent',()=>{saved();assert.equal(savePlanDraft(input()).ok,false);assert.equal(savePlanDraft(input({slot:'warmup'})).ok,true);assert.equal(savePlanDraft(input({date:'2026-01-02'})).ok,true);assert.equal(loadPlanDrafts().drafts.length,3)})
test('editing retains draft ID and original revision bytes while appending a new source-linked revision',()=>{
  const first=saved(),original=[...box.values],r=savePlanDraft(input({intent:'update',uid:first.uid,expectedRevision:first.revisionId,sets:2,amount:15,restSec:30}))
  assert.equal(r.ok,true);if(!r.ok)return;assert.equal(r.draft.uid,first.uid);assert.notEqual(r.draft.revisionId,first.revisionId);assert.equal(r.draft.createdAt,first.createdAt);assert.equal(r.draft.sets,2)
  for(const [k,v] of original)assert.equal(box.getItem(k),v)
  assert.equal(loadPlanDrafts().drafts.length,1);const journal=[...box.values.values()].map(v=>JSON.parse(v));assert.equal(journal.at(-1).data.previousRevision,first.revisionId)
})
test('stale edits cannot overwrite an updated draft',()=>{const first=saved();assert.equal(savePlanDraft(input({intent:'update',uid:first.uid,expectedRevision:first.revisionId,sets:2})).ok,true);const before=[...box.values];assert.equal(savePlanDraft(input({intent:'update',uid:first.uid,expectedRevision:first.revisionId,sets:5})).ok,false);assert.deepEqual([...box.values],before)})
test('remove appends a tombstone without erasing history, and stale remove is refused',()=>{const d=saved(),old=[...box.values];assert.equal(removePlanDraft(d.uid,'stale').ok,false);assert.equal(removePlanDraft(d.uid,d.revisionId).ok,true);assert.equal(loadPlanDrafts().drafts.length,0);for(const [k,v] of old)assert.equal(box.getItem(k),v);assert.equal(box.length,2)})
test('different athletes never share draft views or mutation identities',()=>{const a=saved();setEventContext({athleteId:'synthetic-B'});assert.equal(loadPlanDrafts().drafts.length,0);assert.equal(removePlanDraft(a.uid,a.revisionId).ok,false);const b=saved();assert.notEqual(a.uid,b.uid);setEventContext({athleteId:'synthetic-fieldwork-A'});assert.deepEqual(loadPlanDrafts().drafts.map(d=>d.uid),[a.uid])})
for(const [name,patch] of Object.entries({nan:{amount:NaN},negative:{restSec:-1},fractionalSets:{sets:1.5},invalidDate:{date:'2026-02-30'},wrongSlot:{slot:'anything'},unknownSource:{id:'not-provided'},zeroAmount:{amount:0},notPlanned:{plannedOnly:false}})){
  test('invalid draft fails closed: '+name,()=>{const before=[...box.values];assert.equal(savePlanDraft({...input(),...patch} as DraftInput).ok,false);assert.deepEqual([...box.values],before)})
}
test('dropped writes never report a saved draft',()=>{box.drop=true;assert.equal(savePlanDraft(input()).ok,false);assert.equal(box.length,0)})
test('unknown draft envelope blocks new writes and retains malformed original',()=>{const key=DRAFT_PREFIX+encodeURIComponent(currentAthleteId())+':broken';box.setItem(key,'{"schemaVersion":99}');assert.equal(loadPlanDrafts().ok,false);assert.equal(savePlanDraft(input()).ok,false);assert.equal(box.getItem(key),'{"schemaVersion":99}')})
test('serialized concurrent creates save one draft and report the duplicate',async()=>{const r=await Promise.all([commitFieldworkDraft(input()),commitFieldworkDraft(input())]);assert.equal(r.filter(x=>x.ok).length,1);assert.equal(loadPlanDrafts().drafts.length,1)})
test('unsupported write lock retains inputs and does not write',async()=>{Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});assert.equal((await commitFieldworkDraft(input())).ok,false);assert.equal(box.length,0)})
test('new draft journal and view preferences survive existing backup/restore validation',()=>{const d=saved();assert.equal(saveFieldworkPreferences({locale:'ja-JP'}),true);const backup=collectLocalBackup(box),restored=memory();const r=restoreLocalBackup(backup,restored);assert.equal(r.ok,true);setStoreBackend(restored);assert.equal(loadPlanDrafts().drafts[0]?.uid,d.uid);assert.equal(readFieldworkPreferences().locale,'ja-JP')})
test('manual meal preserves actual clock and unknown macros/grams in a single existing event',async()=>{
  const r=await commitFieldworkMeal({date:todayDate(),name:'合成餐',kcal:321,protein:20,carbs:null,fat:null,time:'08:17'});assert.equal(r.ok,true)
  const row=loadEntries()[0];assert.equal(row.kcal,321);assert.equal(row.grams,undefined);assert.equal(row.carbs,undefined);assert.equal(row.fat,undefined);assert.equal(new Date(row.eatenAt!).getHours(),8);assert.equal(new Date(row.eatenAt!).getMinutes(),17)
  const event=loadEvents()[0];assert.equal(event.event_type,'NUTRITION_RECORDED');assert.deepEqual(event.payload.foodEntry,row);assert.equal(event.athlete_id,row.athleteId);assert.equal(readFieldworkState().food[0].carbs,null)
})
test('actual meal can be recorded for a selected historical date, not logged today',async()=>{const r=await commitFieldworkMeal({date:'2026-01-02',name:'合成历史餐',kcal:100,protein:null,carbs:12,fat:2,time:'23:41'});assert.equal(r.ok,true);assert.equal(loadEntries()[0].date,'2026-01-02');assert.equal(new Date(loadEntries()[0].eatenAt!).getDate(),2)})
for(const time of ['', '25:90'])test('missing or invalid actual meal clock is rejected: '+JSON.stringify(time),async()=>{assert.equal((await commitFieldworkMeal({date:todayDate(),name:'合成餐',kcal:10,protein:null,carbs:null,fat:null,time})).ok,false);assert.equal(loadEntries().length,0);assert.equal(loadEvents().length,0)})
test('invalid meal numeric values and dropped event writes never claim success',async()=>{const base={date:todayDate(),name:'合成餐',kcal:10,protein:null,carbs:null,fat:null,time:'12:00'};assert.equal((await commitFieldworkMeal({...base,kcal:NaN})).ok,false);assert.equal((await commitFieldworkMeal({...base,protein:-1})).ok,false);box.drop=true;assert.equal((await commitFieldworkMeal(base)).ok,false);assert.equal(loadEntries().length,0)})
test('legacy meal missing macros/time is preserved without assigning zero or using save time',()=>{setEventContext({athleteId:'local'});box.setItem('fr255-food-log-v1',JSON.stringify([{id:'legacy',date:todayDate(),meal:'午餐',name:'合成旧餐',kcal:400,grams:200}]));const s=readFieldworkState();assert.equal(s.food[0].time,null);assert.equal(s.food[0].protein,null);assert.equal(s.food[0].carbs,null);assert.equal(s.food[0].source,undefined)})
test('meal removal is append-only and cannot revive from legacy copies',()=>{const row=recordManualFood({date:todayDate(),meal:'加餐',name:'合成餐',kcal:1})!;assert.ok(row);const before=[...box.values];assert.deepEqual(removeEntry(row.id),[]);for(const [k,v] of before)assert.equal(box.getItem(k),v);assert.equal(loadEntries().length,0)})
test('meal and measurement journals remain scoped across athlete changes',async()=>{await commitFieldworkMeal({date:todayDate(),name:'A合成餐',kcal:200,protein:null,carbs:null,fat:null,time:'12:00'});await commitFieldworkMeasurement({date:todayDate(),weight:65,waist:null});setEventContext({athleteId:'synthetic-B'});assert.deepEqual(loadEntries(),[]);assert.deepEqual(loadChecks(),[]);setEventContext({athleteId:'synthetic-fieldwork-A'});assert.equal(loadEntries().length,1);assert.equal(loadChecks().length,1)})
test('measurement uses observed date and source; missing waist stays unknown and scenario starts at actual weight',async()=>{const r=await commitFieldworkMeasurement({date:todayDate(),weight:65.4,waist:null});assert.equal(r.ok,true);const row=loadChecks()[0];assert.equal(row.waist,undefined);assert.equal(row.source,'MANUAL');assert.equal(row.athleteId,currentAthleteId());assert.equal(readFieldworkState().measurements[0].waist,null);assert.equal(readFieldworkPreferences().scenario,null)})
test('new measurement retains prior fields and original event while weight is corrected',()=>{const a=upsertCheck({date:todayDate(),weight:65,fat:12,waist:75})![0];const original=[...box.values];assert.ok(upsertCheck({date:todayDate(),weight:64.8}));const b=loadChecks()[0];assert.equal(b.id,a.id);assert.equal(b.fat,12);assert.equal(b.waist,75);assert.equal(b.weight,64.8);for(const [k,v] of original)assert.equal(box.getItem(k),v);assert.equal(loadEvents().length,2)})
test('measurement removal retains immutable source history',()=>{const a=upsertCheck({date:todayDate(),weight:65})![0],before=[...box.values];assert.deepEqual(removeCheck(a.id),[]);for(const [k,v] of before)assert.equal(box.getItem(k),v)})
test('missing or invalid measured weight is rejected and storage failure is truthful',async()=>{assert.equal((await commitFieldworkMeasurement({date:todayDate(),weight:null,waist:70})).ok,false);assert.equal((await commitFieldworkMeasurement({date:todayDate(),weight:NaN,waist:null})).ok,false);box.drop=true;assert.equal((await commitFieldworkMeasurement({date:todayDate(),weight:65,waist:null})).ok,false);assert.deepEqual(loadChecks(),[])})
test('goal and appearance preferences never prescribe calories, add measurements, or alter formal plans',()=>{box.setItem('fr255-strength-plan-v3','unchanged');const before=formal();assert.equal(saveFieldworkPreferences({goal:'cut',gender:'female',scenario:60}),true);const s=readFieldworkState();assert.equal(s.calTarget,null);assert.deepEqual(s.measurements,[]);assert.equal(s.goal,'cut');assert.equal(formal(),before);assert.equal(loadEvents().length,0)})
test('two rounds of four 200m repeats retain both recovery levels in display',()=>{const result=describeFieldworkCourse({runningPlanSchemaVersion:1,planId:'synthetic-protocol',planSlotId:'slot',components:trackComponents('200x4x2',{targetSeconds:[32],repRestSeconds:120,roundRestSeconds:480,stepRestSeconds:null})});assert.equal(result.title,'2 × (4 × 200m)');assert.match(result.structureText,/2个大组/);assert.match(result.structureText,/4 × 200米/);assert.match(result.structureText,/组间休息120秒/);assert.match(result.structureText,/大组休息480秒/);assert.doesNotMatch(result.structureText,/8 ×/);assert.equal(result.purpose,'REPETITION_SPEED')})
test('unknown course duration and recovery remain unknown in display',()=>{const r=describeFieldworkCourse({runningPlanSchemaVersion:1,planId:'p',planSlotId:'s',components:[{componentId:'c',modality:'RUNNING',purpose:'UNSPECIFIED',structure:{kind:'CONTINUOUS',plannedDistanceMeters:null,plannedDistanceMaxMeters:null,plannedDurationSeconds:null}}]});assert.equal(r.purpose,'UNKNOWN');assert.match(r.structureText,/距离未知/);assert.match(r.structureText,/时长未知/);assert.doesNotMatch(r.structureText,/0秒|0米/)})
