import test, {beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setStoreBackend} from '../core/storage';
import {setEventContext, loadEvents} from '../core/events';
import {commitFoodDraft, emptyFoodDraft, type FoodSaveInput} from './entry-workflow';
import {loadEntries, removeEntry, updateEntry} from './log';
import * as capture from './food-capture';

let values: Map<string, string>;
let backend: {keys:()=>string[];getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;removeItem:(key:string)=>void};
beforeEach(() => {
 values = new Map();
 backend = {keys:()=>[...values.keys()],getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value)},removeItem:key=>{values.delete(key)}};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:backend});
 setStoreBackend(backend);setEventContext({athleteId:'synthetic-food-owner'});
});
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'});Reflect.deleteProperty(globalThis,'localStorage')});
const input=():FoodSaveInput & {requestId:string}=>({draft:{...emptyFoodDraft(),name:'合成午餐',amount:'150',values:{kcal:'210',protein:'',carb:'',fat:'',fiber:''}},date:'2026-10-20',meal:'午餐',athleteId:'synthetic-food-owner',acknowledged:true,requestId:'synthetic-food-request'});
const save=(value=input())=>{const result=commitFoodDraft(value);if(!result.ok)assert.fail(result.reason);return result.row};

test('a repeated request reuses the durable food entry without another nutrition event',()=>{
 const a=save(), b=save();
 assert.equal(b.id,a.id);assert.equal(loadEntries().length,1);
 assert.equal(loadEvents().filter(e=>e.event_type==='NUTRITION_RECORDED').length,1);
 setStoreBackend({...backend});
 assert.equal(save().id,a.id);
});
test('one request cannot be reused for a changed date, meal, or nutrition draft',()=>{
 save();
 for(const patch of [{date:'2026-10-19'},{meal:'晚餐' as const},{draft:{...input().draft,amount:'200'}}])assert.equal(commitFoodDraft({...input(),...patch}).ok,false);
 assert.equal(loadEntries().length,1);
});
test('retry after removal never recreates a withdrawn food entry',()=>{
 const row=save();assert.ok(removeEntry(row.id));
 assert.equal(commitFoodDraft(input()).ok,false);assert.equal(loadEntries().length,0);
});
test('retry after correction cannot overwrite newer food values',()=>{
 const row=save();assert.ok(updateEntry(row.id,{name:'合成更正后食物'},row.revisionId));
 assert.equal(commitFoodDraft(input()).ok,false);assert.equal(loadEntries()[0].name,'合成更正后食物');
});

test('capture receipt survives a restarted reader and undo appends history only',()=>{
 const result=capture.saveFoodCapture(input());assert.ok(result.ok);if(!result.ok)return;
 assert.equal(result.receipt.athleteId,'synthetic-food-owner');assert.equal(result.receipt.date,'2026-10-20');
 setStoreBackend({...backend});
 assert.equal(capture.loadFoodCaptureReceipts()[0].eventId,result.receipt.eventId);
 const undo=capture.undoFoodCapture(result.receipt);assert.equal(undo.ok,true);
 assert.equal(loadEntries().length,0);assert.equal(capture.loadFoodCaptureReceipts()[0].status,'undone');
 assert.equal(loadEvents().filter(e=>e.event_type==='NUTRITION_RECORDED').length,2);
 assert.equal(capture.undoFoodCapture(result.receipt).ok,true);
 assert.equal(loadEvents().length,2);
});
test('conditional undo refuses corrected entries and wrong athlete without touching history',()=>{
 const result=capture.saveFoodCapture(input());assert.ok(result.ok);if(!result.ok)return;
 updateEntry(result.row.id,{kcal:240},result.row.revisionId);
 assert.equal(capture.undoFoodCapture(result.receipt).ok,false);assert.equal(loadEntries()[0].kcal,240);
 setEventContext({athleteId:'synthetic-other'});
 assert.equal(capture.undoFoodCapture(result.receipt).ok,false);assert.equal(capture.loadFoodCaptureReceipts().length,0);
 assert.equal(loadEvents().length,2);
});
test('storage failure retains request, date, meal, and owner in a reloadable draft',()=>{
 const data={version:1 as const,...input(),meal:'晚餐' as const};
 assert.equal(capture.storeFoodCaptureDraft(data),true);
 const before=JSON.stringify(data);
 setStoreBackend({...backend,setItem:()=>{throw Error('synthetic quota')}});
 assert.equal(capture.saveFoodCapture(data).ok,false);
 assert.equal(JSON.stringify(data),before);
 const restored=capture.loadFoodCaptureDraft(data.athleteId);
 assert.equal(restored?.date,'2026-10-20');assert.equal(restored?.meal,'晚餐');assert.equal(restored?.requestId,data.requestId);
 assert.equal(restored?.athleteId,'synthetic-food-owner');assert.equal(restored?.draft.amount,'150');
 assert.equal(loadEvents().length,0);
 setEventContext({athleteId:'synthetic-other'});assert.equal(capture.loadFoodCaptureDraft(data.athleteId),null);
});
test('clearing a completed request cannot discard a newer draft',()=>{
 const data={version:1 as const,...input()};capture.storeFoodCaptureDraft(data);
 capture.storeFoodCaptureDraft({...data,requestId:'synthetic-newer'});
 capture.clearFoodCaptureDraft(data.athleteId,data.requestId);
 assert.equal(capture.loadFoodCaptureDraft(data.athleteId)?.requestId,'synthetic-newer');
});
