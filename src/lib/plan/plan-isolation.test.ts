import test from 'node:test'
import assert from 'node:assert/strict'
import {setEventContext,currentAthleteId} from '../core/events'
import {activePlanDoc,savePlanDoc,PLAN_DOC_KEY,planDocumentKey} from './active-plan'

test('legacy local plan is preserved and never becomes another athlete plan; named athletes save independently',t=>{
 const previous=currentAthleteId();t.after(()=>setEventContext({athleteId:previous}))
 const data=new Map<string,string>(),box={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}
 const doc={schema:'fangkun-plan-v1' as const,plan:{name:'合成隔离测试计划',shiftDays:0,weeks:[],days:[{date:'2026-10-26',orig:'2026-10-26',weekday:'一',week:'W1',title:'合成课程',main:[],aux:[],strength:[]}]}}
 data.set(PLAN_DOC_KEY,JSON.stringify(doc));const original=data.get(PLAN_DOC_KEY)
 setEventContext({athleteId:'local'});assert.ok(activePlanDoc(box))
 setEventContext({athleteId:'athlete-a'});assert.equal(activePlanDoc(box),null);assert.equal(savePlanDoc(doc,box).ok,true);assert.ok(activePlanDoc(box));assert.ok(data.has(planDocumentKey()))
 setEventContext({athleteId:'athlete-b'});assert.equal(activePlanDoc(box),null);assert.equal(data.get(PLAN_DOC_KEY),original)
 setEventContext({athleteId:'athlete-a'});assert.equal(activePlanDoc(box)?.athleteId,'athlete-a')
})
