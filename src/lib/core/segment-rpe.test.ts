import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {setStoreBackend} from './storage.ts'
import {setEventContext,loadEvents,dispatchEvent,EVENT_JOURNAL_PREFIX} from './events.ts'
import {startTraining} from './training-decision.ts'
import {bindTrainingStart} from './occurrence.ts'
import {emptySets,recordSet} from './execution.ts'
import {projectOccurrenceEvidence} from './evidence.ts'
import {appendCorrection} from './training-correction.ts'
import {recordSegmentRpe,readSegmentRpe,strengthRpeId,type SegmentRpeIdentity} from './segment-rpe.ts'
import type {Session} from '../strength/model'
function fixture(){
 const values=new Map<string,string>();let failing=false
 setStoreBackend({keys:()=>[...values.keys()],getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(failing&&k.startsWith(EVENT_JOURNAL_PREFIX)&&v.includes('SET_RPE'))throw Error('quota');values.set(k,v)}})
 setEventContext({athleteId:'r189-synthetic'})
 const session:Session={id:'s',name:'合成力量',moves:[{id:'m',catalogId:'pushup',customName:'',sets:2,mode:'reps',amount:8,restSec:60,weightKg:0}]}
 const start=startTraining({decisionId:'d',sessionId:session.id,action:'ORIGINAL_PLAN'})!,occ=bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:session.id,planSlotId:session.id,plan:session})!
 const sets=emptySets(session);recordSet(session.id,'d',{...sets[0],completed:true,actualWeight:0,actualAmount:8,source:'user_entered',timestamp:new Date().toISOString()})
 const identity:SegmentRpeIdentity={occurrenceId:occ.trainingOccurrenceId,unit:'STRENGTH',segmentId:strengthRpeId('m',1)}
 return {identity,fail:()=>{failing=true},heal:()=>{failing=false}}
}
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
test('R189 set RPE zero is explicit and never becomes session RPE',()=>{const f=fixture();assert.equal(recordSegmentRpe(f.identity,0).ok,true);assert.equal(readSegmentRpe(f.identity)?.payload.value,0);assert.equal(projectOccurrenceEvidence(f.identity.occurrenceId,loadEvents()).sessionRpe.records.length,0)})
test('R189 segment rating idempotence and append-only revisions',()=>{const f=fixture();const first=recordSegmentRpe(f.identity,6);assert.ok(first.ok);const second=recordSegmentRpe(f.identity,6);assert.ok(second.ok);assert.equal(loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE').length,1);assert.ok(recordSegmentRpe(f.identity,7).ok);const rs=loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE');assert.equal(rs.length,2);assert.equal(rs[1].payload.supersedes,rs[0].event_id)})
test('R189 unknown segment, unit or athlete cannot accept rating',()=>{const f=fixture();assert.equal(recordSegmentRpe({...f.identity,segmentId:strengthRpeId('m',2)},7).ok,false);assert.equal(recordSegmentRpe({...f.identity,unit:'RUNNING'},7).ok,false);setEventContext({athleteId:'other'});assert.equal(recordSegmentRpe(f.identity,7).ok,false)})
test('R189 failed optional rating preserves completed set and retry succeeds once',()=>{const f=fixture();f.fail();assert.equal(recordSegmentRpe(f.identity,7).ok,false);assert.equal(loadEvents().filter(e=>e.event_type==='TRAINING_SET_COMPLETED').length,1);f.heal();assert.equal(recordSegmentRpe(f.identity,7).ok,true);assert.equal(loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE').length,1)})
test('R189 voided training hides and blocks segment RPE without deleting evidence; restore recovers it',()=>{
 const f=fixture();assert.ok(recordSegmentRpe(f.identity,7).ok)
 const before=loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE')
 assert.ok(appendCorrection({trainingOccurrenceId:f.identity.occurrenceId,kind:'VOID',reason:'synthetic mistaken course'}))
 assert.equal(readSegmentRpe(f.identity),null);assert.equal(recordSegmentRpe(f.identity,8).ok,false)
 assert.deepEqual(loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE'),before)
 assert.ok(appendCorrection({trainingOccurrenceId:f.identity.occurrenceId,kind:'RESTORE',reason:'synthetic confirmed restoration'}))
 assert.equal(readSegmentRpe(f.identity)?.payload.value,7)
})
test('R189 a corrected set keeps its stable RPE identity and original evidence',()=>{
 const f=fixture();assert.ok(recordSegmentRpe(f.identity,6).ok)
 const before=loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE')
 assert.ok(appendCorrection({trainingOccurrenceId:f.identity.occurrenceId,kind:'FIELD',field:'reps',setKey:'m:1',originalValue:'8',newValue:'7',reason:'synthetic repetition correction'}))
 assert.equal(readSegmentRpe(f.identity)?.payload.value,6)
 assert.deepEqual(loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE'),before)
 assert.equal(projectOccurrenceEvidence(f.identity.occurrenceId,loadEvents()).sessionRpe.records.length,0)
})
test('R189 duplicate strength attempts invalidate the group RPE instead of choosing the latest event',()=>{
 const f=fixture();assert.ok(recordSegmentRpe(f.identity,6).ok)
 const original=loadEvents().find(e=>e.event_type==='TRAINING_SET_COMPLETED')!
 assert.ok(dispatchEvent('TRAINING_SET_COMPLETED',{...original.payload,actualAmount:7}))
 assert.equal(readSegmentRpe(f.identity),null);assert.equal(recordSegmentRpe(f.identity,7).ok,false)
 assert.equal(loadEvents().filter(e=>e.payload.evidenceType==='SET_RPE').length,1)
})
test('R189 strength group must exist in its frozen plan even when a completion event claims it',()=>{
 const f=fixture(),original=loadEvents().find(e=>e.event_type==='TRAINING_SET_COMPLETED')!
 assert.ok(dispatchEvent('TRAINING_SET_COMPLETED',{...original.payload,setIndex:3}))
 const extra={...f.identity,segmentId:strengthRpeId('m',3)}
 assert.equal(recordSegmentRpe(extra,7).ok,false);assert.equal(readSegmentRpe(extra),null)
 assert.ok(recordSegmentRpe(f.identity,6).ok)
})
