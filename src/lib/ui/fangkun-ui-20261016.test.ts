import test,{beforeEach,afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend,type MemoryStore} from '../core/storage'
import {setEventContext,loadEvents} from '../core/events'
import {loadEntries,removeEntry} from '../nutrition/log'
import {catalogue,commitMeal,scaledFood,nutritionTotals,mealRevision,customFoods,saveCustomFood,type Food,type MealInput} from '../nutrition/ui-records'
import {todayDate,loadChecks} from '../nutrition/body'
import {readUIPreferences,saveUIPreferences,HOME_MODULES} from './fangkun-preferences'
import {saveFieldworkPreferences,readFieldworkState} from './fieldwork-host'
import {collectLocalBackup,restoreLocalBackup} from '../core/trial'
import {readFieldworkCoachSources} from '../core/coach-fieldwork-context'
import {fuelForTraining} from '../core/coach-fuel'
import {RUNNING_DRILLS,STRENGTH_DRILLS} from './fieldwork-catalogue'
import atlas from '../../components/fangkun-ui/atlas-catalog.json' with {type:'json'}
type Box=MemoryStore&{data:Map<string,string>;drop:boolean;length:number;key:(n:number)=>string|null;removeItem:(k:string)=>void}
let box:Box
const memory=():Box=>{const data=new Map<string,string>();return {data,drop:false,get length(){return data.size},key:n=>[...data.keys()][n]??null,removeItem:k=>{data.delete(k)},keys:()=>[...data.keys()],getItem:k=>data.get(k)??null,setItem(k,v){if(!this.drop)data.set(k,v)}}}
beforeEach(()=>{box=memory();setStoreBackend(box);setEventContext({athleteId:'synthetic-ui-A'});Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
const pending=()=>catalogue.find(f=>f.id==='mcd-cn-bigmac')!
const input=(food=pending()):MealInput=>({food,amount:1,meal:'早餐',date:todayDate(),time:'',note:'合成测试',acknowledged:true})
const record=(i=input())=>{const r=commitMeal(i);if(!r.ok)assert.fail(r.reason);assert.equal(r.ok,true);return r.row}
test('atlas keeps the exact existing 76 strength and 53 running IDs',()=>{assert.deepEqual(new Set(atlas.exercises.map(e=>e.id)),new Set([...RUNNING_DRILLS,...STRENGTH_DRILLS].map(e=>e.id)));assert.equal(atlas.exercises.length,129)})
test('pending regional product remains unknown and never borrows US calories',()=>{const row=record();assert.equal(row.kcal,null);assert.equal(row.foodSnapshot?.region,'中国大陆');assert.equal(nutritionTotals([row]).kcal.value,null);assert.equal(nutritionTotals([row]).kcal.missing,1);const us=catalogue.find(f=>f.id==='mcd-us-big-mac-2026')!;assert.equal(scaledFood(us,1.5).kcal,870)})
test('gram scaling is exact; unknown macros remain null; 0 remains a measured zero',()=>{const food={...pending(),per100g:true,nutrients:{kcal:120,protein:6,carbs:null,fat:0}};assert.deepEqual(scaledFood(food,250),{kcal:300,protein:15,carbs:null,fat:0,fiber:null});assert.throws(()=>scaledFood(food,0))})
test('mixed known and unknown entries show subtotal and missing count',()=>{const unknown=record();const known=record(input({...pending(),nutrients:{kcal:321,protein:20,carbs:null,fat:0}}));assert.deepEqual(nutritionTotals([unknown,known]).kcal,{value:321,missing:1});assert.deepEqual(nutritionTotals([unknown,known]).fat,{value:0,missing:1})})
test('source values require confirmation before becoming a meal',()=>{const f=catalogue.find(f=>f.id==='mcd-us-big-mac-2026')!;assert.equal(commitMeal({...input(f),acknowledged:false}).ok,false);assert.equal(loadEvents().length,0)})
test('correction retains original event bytes, changes reference, and blocks stale update',()=>{const row=record(),old=[...box.data];const result=commitMeal({...input({...pending(),nutrients:{kcal:400,protein:null,carbs:null,fat:null}}),id:row.id,expectedRevision:mealRevision(row)});assert.equal(result.ok,true);assert.equal(loadEntries()[0].kcal,400);assert.equal(loadEvents().length,2);for(const [k,v] of old)assert.equal(box.getItem(k),v);assert.notEqual(loadEntries()[0].revisionId,row.revisionId);assert.equal(commitMeal({...input(),id:row.id,expectedRevision:mealRevision(row)}).ok,false)})
test('retracting a meal retains journal history and cannot be resurrected by stale edit',()=>{const row=record(),old=[...box.data];assert.deepEqual(removeEntry(row.id),[]);assert.equal(commitMeal({...input(),id:row.id,expectedRevision:mealRevision(row)}).ok,false);for(const [k,v] of old)assert.equal(box.getItem(k),v)})
test('unknown actual eating time is absent, never save time',()=>{const row=record();assert.equal(row.eatenAt,undefined);assert.ok(row.recordedAt)})
for(const [name,patch] of Object.entries({invalidDate:{date:'2026-02-30'},future:{date:'2999-01-01'},negative:{amount:-1},nan:{amount:NaN},invalidTime:{time:'24:01'}}))test('invalid meal input fails: '+name,()=>{assert.equal(commitMeal({...input(),...patch}).ok,false);assert.equal(loadEvents().length,0)})
test('storage failure returns failure and does not claim a saved meal',()=>{box.drop=true;assert.equal(commitMeal(input()).ok,false);assert.equal(loadEntries().length,0);assert.equal(saveUIPreferences({homeOrder:[...HOME_MODULES].reverse()}).valueOf(),false)})
test('home order, favorites, scenario survive language changes; no facts or plans written',()=>{box.setItem('fr255-strength-plan-v3','formal baseline');assert.equal(saveUIPreferences({homeOrder:[...HOME_MODULES].reverse(),favorites:['back-squat']}),true);assert.equal(saveFieldworkPreferences({gender:'female',locale:'en-US'}),true);assert.deepEqual(readUIPreferences().homeOrder,[...HOME_MODULES].reverse());assert.deepEqual(readUIPreferences().favorites,['back-squat']);assert.equal(readFieldworkState().gender,'female');assert.equal(loadEvents().length,0);assert.equal(box.getItem('fr255-strength-plan-v3'),'formal baseline')})
test('body scenario stores only visual parameters and cannot create actual measurements',()=>{assert.equal(saveUIPreferences({bodyScenario:{sex:'female',left:{heightCm:165,massKg:65,bodyFatPct:22,frame:0},right:{heightCm:165,massKg:65,bodyFatPct:34,frame:0}}}),true);assert.equal(loadChecks().length,0);assert.equal(loadEvents().length,0);assert.equal(readFieldworkCoachSources('体型和身体测量').length,0)})
test('athletes cannot share food, custom labels, favorites, or home ordering',()=>{record();saveUIPreferences({favorites:['back-squat'],homeOrder:[...HOME_MODULES].reverse()});saveCustomFood({...pending(),name:'合成自填'});setEventContext({athleteId:'synthetic-ui-B'});assert.deepEqual(loadEntries(),[]);assert.deepEqual(customFoods(),[]);assert.deepEqual(readUIPreferences().favorites,[]);assert.deepEqual(readUIPreferences().homeOrder,[...HOME_MODULES])})
test('existing backup restore retains nutrition history and extended preferences',()=>{const row=record();saveUIPreferences({favorites:['back-squat'],homeOrder:[...HOME_MODULES].reverse()});const backup=collectLocalBackup(box),next=memory();assert.equal(restoreLocalBackup(backup,next).ok,true);setStoreBackend(next);assert.equal(loadEntries()[0].id,row.id);assert.deepEqual(readUIPreferences().favorites,['back-squat'])})
test('coach reports unknown calories and source status, never literal null kcal',()=>{record();const text=readFieldworkCoachSources('请核对我的饮食记录').map(s=>s.detail).join('\n');assert.match(text,/热量未知/);assert.match(text,/PENDING_LABEL/);assert.doesNotMatch(text,/null千卡|已记录0千卡/);const now=new Date().toISOString();assert.equal(fuelForTraining(now,now,loadEntries(),null).recordedKcal,null)})

test('five nutrient preview handles 150.5g and 0.5 portions from original basis, preserving missing fiber',()=>{
 const f={...pending(),per100g:true,nutrients:{kcal:100,protein:10,carbs:20,fat:5,fiber:2}};
 assert.deepEqual(scaledFood(f,150.5),{kcal:150.5,protein:15.05,carbs:30.1,fat:7.53,fiber:3.01});
 assert.deepEqual(scaledFood({...f,per100g:false},.5),{kcal:50,protein:5,carbs:10,fat:2.5,fiber:1});
 const saved=record({...input(f),amount:100});assert.equal(saved.fiber,2);assert.equal(saved.foodSnapshot?.nutrients.fiber,2);
});
