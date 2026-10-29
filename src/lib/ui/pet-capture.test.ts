import test, {beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend, type MemoryStore} from '../core/storage'
import {loadEvents, setEventContext} from '../core/events'
import {saveQuickTraining} from './quick-log-save'
import {parseQuickLog} from './quick-log'
import {loadTrainingActivities} from './training-read-model'
import {importedCoachParts, coachImports} from '../core/coach-import-evidence'
import * as capture from './pet-capture'
import {buildFormalEvidenceRows} from '../core/coach-v4-formal-rows'
let data:Map<string,string>, fail=false
beforeEach(()=>{data=new Map();fail=false;const store:MemoryStore={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('synthetic storage full');data.set(k,v)},keys:()=>[...data.keys()],removeItem:k=>{data.delete(k)}};setStoreBackend(store);setEventContext({athleteId:'pet-synthetic-A'});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store})})
function training(id:string){const r=saveQuickTraining(parseQuickLog('跑步 6公里 27分钟'),id,'2026-10-20T02:00:00Z',null);assert.ok(r.ok);return r.ref.confirmedImportId}
test('selected A feedback is durable, idempotent and visible to coach without making an activity',()=>{
 const a=training('A'),b=training('B'),before=loadTrainingActivities();const draft=capture.newCaptureDraft('feedback',a);draft.rpe='7';draft.soreness='3';draft.location='小腿';
 const saved=capture.saveCaptureDraft(draft);assert.ok(saved.ok);assert.equal(loadTrainingActivities().length,before.length);assert.equal(capture.saveCaptureDraft(draft).ok,true);assert.equal(capture.captureReceipts().length,1);
 assert.equal(loadEvents().filter(e=>e.payload.trainingOccurrenceId===b).length,0);const parts=importedCoachParts(coachImports().find(r=>r.confirmedImportId===a)!,'这节怎么样');assert.equal(parts.sessionRpe,7);assert.equal(parts.soreness,true);
 assert.equal(capture.captureReceipts()[0].id,draft.id);
})
test('failure preserves editable draft and switching athlete cannot submit or read it',()=>{
 const a=training('A'),draft=capture.newCaptureDraft('feedback',a);draft.rpe='6';assert.equal(capture.persistCaptureDraft(draft),true);fail=true;assert.equal(capture.saveCaptureDraft(draft).ok,false);fail=false;assert.equal(capture.readCaptureDraft('feedback')?.rpe,'6');
 setEventContext({athleteId:'pet-synthetic-B'});assert.equal(capture.readCaptureDraft('feedback'),null);assert.equal(capture.saveCaptureDraft(draft).ok,false);assert.equal(capture.captureReceipts().length,0);
})
test('unknown target, stale target and an existing RPE cannot be overwritten',()=>{
 const draft=capture.newCaptureDraft('feedback','foreign');draft.rpe='6';assert.equal(capture.saveCaptureDraft(draft).ok,false);
 const a=training('A'),first=capture.newCaptureDraft('feedback',a),stale=capture.newCaptureDraft('feedback',a);first.rpe='6';stale.rpe='8';assert.equal(capture.saveCaptureDraft(first).ok,true);assert.equal(capture.saveCaptureDraft(stale).ok,false);
 const second=capture.newCaptureDraft('feedback',a);second.rpe='8';assert.equal(capture.saveCaptureDraft(second).ok,false);
})
test('body feedback retains actual day and absence; parse does not claim third party or negated soreness',()=>{
 const draft=capture.newCaptureDraft('body');draft.date='2026-10-20';draft.recovery='4';const saved=capture.saveCaptureDraft(draft);assert.ok(saved.ok);const event=loadEvents().find(e=>e.payload.captureId===draft.id)!;assert.equal(event.payload.date,'2026-10-20');assert.equal(event.payload.evidenceType,'SUBJECTIVE_RECOVERY');assert.equal(event.payload.trainingOccurrenceId,undefined);
 assert.equal(capture.parseCaptureText('我朋友小腿酸痛3分，RPE7').rpe,'');assert.equal(capture.parseCaptureText('我没有酸痛，RPE7').soreness,'');assert.equal(capture.parseCaptureText('RPE7，小腿酸痛3分').soreness,'3');
})
test('conditional feedback undo refuses later edits and preserves original import',()=>{
 const a=training('A'),draft=capture.newCaptureDraft('feedback',a);draft.rpe='7';const saved=capture.saveCaptureDraft(draft);assert.ok(saved.ok);assert.equal(capture.undoCapture(saved.receipt.id).ok,true);assert.equal(coachImports().find(r=>r.confirmedImportId===a)?.sessionRpe.value,null);assert.equal(importedCoachParts(coachImports().find(r=>r.confirmedImportId===a)!,'复盘').sessionRpe,null);assert.equal(capture.undoCapture(saved.receipt.id).ok,false);
})
test('native standard soreness feedback reaches the formal evidence adapter',()=>{
 const rows=buildFormalEvidenceRows({athleteId:'pet-synthetic-A',asOf:'2026-10-21T03:00:00Z',corrections:[],committed:[{event:{event_id:'native-A',athlete_id:'pet-synthetic-A',event_type:'TRAINING_STARTED',timestamp:'2026-10-20T02:00:00Z',source:'MANUAL',payload:{}},recordedAt:'2026-10-20T02:00:00Z'},{event:{event_id:'sore-A',athlete_id:'pet-synthetic-A',event_type:'SUBJECTIVE_FEEDBACK',timestamp:'2026-10-20T03:00:00Z',source:'MANUAL',payload:{trainingOccurrenceId:'native-A',evidenceType:'SORENESS',intensity:3,location:'小腿'}},recordedAt:'2026-10-20T03:00:00Z'}]});assert.equal(rows.rows.find(r=>r.metric==='SORENESS')?.value,3)
})

test('saved body status reaches coach only on the actual day and owner, never as an activity',async()=>{
 const {readCoachData,assertCoachData}=await import('../health/coach-data');
 const draft=capture.newCaptureDraft('body');draft.date='2026-10-20';draft.recovery='4';draft.soreness='3';draft.location='小腿';assert.ok(capture.saveCaptureDraft(draft).ok);
 const context=readCoachData('2026-10-20');assert.match(context.subjective,/恢复感受 4\/10/);assert.match(context.subjective,/小腿酸痛 3\/10/);assertCoachData(context);assert.equal(loadTrainingActivities().length,0);
 assert.doesNotMatch(readCoachData('2026-10-21').subjective,/恢复感受 4\/10/);
 setEventContext({athleteId:'pet-synthetic-B'});assert.doesNotMatch(readCoachData('2026-10-20').subjective,/恢复感受 4\/10/);
})
