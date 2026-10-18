import test from 'node:test';import assert from 'node:assert/strict';
import {readTrainingDraft,saveTrainingDraft,clearSavedTrainingDraft} from './training-draft-store';
import {newTrainingDraft,TRAINING_DRAFT_KEY} from './training-editor';
const storage=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)},removeItem:(k:string)=>{m.delete(k)}}};
test('two dates and a course template keep separate drafts through reopening',()=>{
 const s=storage(),a={...newTrainingDraft('2026-10-17','a'),distance:'6.5'},b={...newTrainingDraft('2026-10-18','b'),distance:'2.5'};
 assert.ok(saveTrainingDraft(s,a.date,a));assert.ok(saveTrainingDraft(s,b.date,b));assert.ok(saveTrainingDraft(s,a.date,{...a,id:'template'},'course-1'));
 assert.equal(readTrainingDraft(s,a.date)?.distance,'6.5');assert.equal(readTrainingDraft(s,b.date)?.id,'b');assert.equal(readTrainingDraft(s,a.date,'course-1')?.id,'template');
 clearSavedTrainingDraft(s,a.date,'a');assert.equal(readTrainingDraft(s,a.date),null);assert.equal(readTrainingDraft(s,b.date)?.id,'b');assert.equal(readTrainingDraft(s,a.date,'course-1')?.id,'template');
});
test('legacy draft is preserved and never attached to a different date',()=>{
 const s=storage(),a=newTrainingDraft('2026-10-17','legacy');s.setItem(TRAINING_DRAFT_KEY,JSON.stringify(a));
 assert.equal(readTrainingDraft(s,'2026-10-18'),null);assert.equal(readTrainingDraft(s,a.date)?.id,'legacy');assert.equal(readTrainingDraft(s,a.date,'template'),null);
 clearSavedTrainingDraft(s,'2026-10-18','different');assert.ok(s.getItem(TRAINING_DRAFT_KEY));clearSavedTrainingDraft(s,a.date,'legacy');assert.equal(s.getItem(TRAINING_DRAFT_KEY),null);
});
test('explicit date edit remains in its original draft context; failed write is not saved',()=>{
 const s=storage(),a=newTrainingDraft('2026-10-19','a');saveTrainingDraft(s,'2026-10-17',a);assert.equal(readTrainingDraft(s,'2026-10-17')?.date,'2026-10-19');assert.equal(readTrainingDraft(s,'2026-10-19'),null);
 assert.equal(saveTrainingDraft({...s,setItem:()=>{throw Error('quota')}},'2026-10-17',{...a,name:'new'}),false);assert.equal(readTrainingDraft(s,'2026-10-17')?.name,'');
});
