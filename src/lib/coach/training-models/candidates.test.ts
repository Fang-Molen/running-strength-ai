import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildTrainingCandidates} from './candidates'
import {createTrainingConfirmation, type ConfirmationDocument, type ConfirmationRepository} from './confirmation'
import {validateRunningComponents} from '../../core/running-plan'
import {fixture,threshold} from './test-fixtures'
function input(){const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)];return i}
function repository():ConfirmationRepository{
 const docs=new Map<string,ConfirmationDocument>()
 return {async transact(a,fn){const d=structuredClone(docs.get(a)??{athleteId:a,proposals:{},receipts:{}});const r=fn(d);docs.set(a,d);return structuredClone(r)}}
}
test('candidate keeps two rounds and changes only a single step repeat count; never raises dose',()=>{
 const i=input(),before=structuredClone(i.sessions[0].plan),r=buildTrainingCandidates(i)
 const reduce=r.candidates.find(c=>c.action==='REDUCE')!
 assert.ok(reduce);assert.deepEqual(i.sessions[0].plan,before)
 const run=reduce.after!.components[0];assert.equal(run.modality,'RUNNING');if(run.modality!=='RUNNING'||run.structure.kind!=='REPEATED')return assert.fail()
 assert.equal(run.structure.blocks[0].roundCount,2);assert.equal(run.structure.blocks[0].steps[0].repeatCount,3)
 assert.equal(run.structure.blocks[0].steps[0].plannedDistanceMeters,400);assert.equal(run.structure.blocks[0].steps[0].recoveryAfterRepeatSeconds,60)
 assert.equal(validateRunningComponents(reduce.after!.components).ok,true)
})
test('pain and unknown safety only permit rest/skip descriptions, never a training export',()=>{
 const i=input();i.snapshot.safetyConstraints=[{id:'pain',version:'p1',scope:'PAIN',evidenceRefs:[]}]
 let r=buildTrainingCandidates(i);assert.ok(r.candidates.every(c=>c.after===null));assert.ok(r.missing.length)
 i.snapshot.safetyConstraints=[];i.recovery=null;r=buildTrainingCandidates(i);assert.ok(r.candidates.every(c=>c.after===null))
})
test('threshold work without measured threshold does not become executable from a VDOT number',()=>{
 const i=input();i.thresholds=[];const r=buildTrainingCandidates(i)
 assert.ok(r.candidates.every(c=>c.after===null));assert.ok(r.missing.some(m=>m.includes('阈值')))
})
test('confirmation binds complete before/after, requires explicit intent and returns an export not a scheduled receipt',async()=>{
 const i=input(),repo=repository(),c=createTrainingConfirmation({repository:repo,loadInput:async()=>i,now:()=>new Date(i.context.asOf)})
 const id=buildTrainingCandidates(i).candidates.find(c=>c.action==='REDUCE')!.id
 const p=await c.prepare(id);assert.ok(p.ok);if(!p.ok)return
 const no=await c.confirm({proposalId:p.value.id,hash:p.value.hash,confirmation:'YES' as never});assert.equal(no.ok,false)
 const r=await c.confirm({proposalId:p.value.id,hash:p.value.hash,confirmation:'CONFIRM_TRAINING_EXPORT'})
 assert.ok(r.ok);if(!r.ok)return;assert.equal(r.value.scheduleWritten,false);assert.equal(r.value.kind,'CONFIRMED_EXPORT');assert.ok(r.value.plan)
 const replay=await c.confirm({proposalId:p.value.id,hash:p.value.hash,confirmation:'CONFIRM_TRAINING_EXPORT'});assert.equal(replay.ok,false)
})
test('fresh pain, changed plan or athlete invalidates a pending confirmation',async()=>{
 for(const change of ['pain','plan','athlete']){
  const i=input(),repo=repository(),c=createTrainingConfirmation({repository:repo,loadInput:async()=>i,now:()=>new Date(i.context.asOf)})
  const p=await c.prepare(buildTrainingCandidates(i).candidates[0].id);assert.ok(p.ok);if(!p.ok)continue
  if(change==='pain')i.snapshot.safetyConstraints.push({id:'new-pain',version:'1',scope:'PAIN',evidenceRefs:[]})
  if(change==='plan')i.sessions[0].plan.components=[]
  if(change==='athlete')i.context.athleteId='other'
  const r=await c.confirm({proposalId:p.value.id,hash:p.value.hash,confirmation:'CONFIRM_TRAINING_EXPORT'});assert.equal(r.ok,false)
 }
})
test('tampered proposal and expiry fail closed without receipt',async()=>{
 const i=input();let now=new Date(i.context.asOf)
 const c=createTrainingConfirmation({repository:repository(),loadInput:async()=>i,now:()=>now})
 const p=await c.prepare(buildTrainingCandidates(i).candidates[0].id);assert.ok(p.ok);if(!p.ok)return
 assert.equal((await c.confirm({proposalId:p.value.id,hash:'bad',confirmation:'CONFIRM_TRAINING_EXPORT'})).ok,false)
 now=new Date(now.getTime()+16*60000)
 assert.equal((await c.confirm({proposalId:p.value.id,hash:p.value.hash,confirmation:'CONFIRM_TRAINING_EXPORT'})).ok,false)
})


test('reducing two repeats never produces an invalid one-repeat rest structure',()=>{
 const i=input(),run=i.sessions[0].plan.components[0]
 if(run.modality!=='RUNNING'||run.structure.kind!=='REPEATED')return assert.fail()
 run.structure.blocks[0].steps[0].repeatCount=2
 const r=buildTrainingCandidates(i)
 for(const c of r.candidates)if(c.after)assert.equal(validateRunningComponents(c.after.components).ok,true)
})
test('past, started, completed and unknown-state sessions never generate training candidates',()=>{
 for(const state of ['STARTED','COMPLETED','UNKNOWN'] as const){
  const i=input();i.sessions[0].executionState=state;assert.equal(buildTrainingCandidates(i).candidates.length,0)
 }
 const i=input();i.sessions[0].date='2026-10-20';assert.equal(buildTrainingCandidates(i).candidates.length,0)
})
