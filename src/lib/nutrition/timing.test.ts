import test,{afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {currentSessionTimes,matchSessionMeals} from './timing'
import {eatenAtFromClock,type FoodEntry} from './log'
import {setStoreBackend} from '../core/storage'
import {dispatchEvent,setEventContext} from '../core/events'
import {bindTrainingStart} from '../core/occurrence'
import {saveRunningPlan} from '../core/running-plan'
import {appendCorrection} from '../core/training-correction'
const meal=(eatenAt?:string):FoodEntry=>({id:'1792054800000-created',date:'2026-10-15',meal:'午餐',name:'合成餐食',grams:100,kcal:200,...(eatenAt?{eatenAt}:{})})
test('R189 optional eating clock rejects blank/invalid and preserves local calendar date and clock time',()=>{
 assert.equal(eatenAtFromClock(''),undefined);assert.equal(eatenAtFromClock('25:00'),undefined)
 const day=new Date(2026,9,15,0,0,0,0),expected=new Date(2026,9,15,12,30,0,0).toISOString()
 assert.equal(eatenAtFromClock('12:30',day),expected)
 assert.equal(day.getHours(),0,'parsing must not mutate the supplied date')
})
test('R189 no end time means no invented post-session window',()=>{const r=matchSessionMeals([{id:'s',kind:'RUNNING',startAt:'2026-10-15T06:00:00Z',endAt:null}],[meal('2026-10-15T07:15:00Z'),meal()]);assert.equal(r.sessions[0].after.status,'UNKNOWN');assert.equal(r.untimed,1);assert.equal(r.sessions[0].adequacy,'UNKNOWN')})
test('R189 run and strength keep separate actual windows; a recorded meal is not adequacy',()=>{const r=matchSessionMeals([{id:'run',kind:'RUNNING',startAt:'2026-10-15T06:00:00Z',endAt:'2026-10-15T07:00:00Z'},{id:'strength',kind:'STRENGTH',startAt:'2026-10-15T18:00:00Z',endAt:'2026-10-15T19:00:00Z'}],[meal('2026-10-15T07:30:00Z')]);assert.equal(r.sessions[0].after.meals.length,1);assert.equal(r.sessions[1].after.meals.length,0);assert.equal(r.sessions[0].adequacy,'UNKNOWN')})
afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
test('R189 nutrition windows isolate athlete and preserve unknown type; void invalidates a window',()=>{
 const values=new Map<string,string>();setStoreBackend({keys:()=>[...values.keys()],getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)}})
 const add=(athleteId:string,sessionId:string)=>{setEventContext({athleteId});const e=dispatchEvent('TRAINING_STARTED',{sessionId})!;return bindTrainingStart({startEventId:e.event_id,startedAt:e.timestamp,sessionId,planSlotId:sessionId,plan:null})!}
 add('other','other-course');const own=add('local','own-course')
 assert.deepEqual(currentSessionTimes().map(s=>[s.id,s.kind]),[[own.trainingOccurrenceId,'UNKNOWN']])
 assert.equal(currentSessionTimes()[0].endAt,null)
 assert.ok(appendCorrection({trainingOccurrenceId:own.trainingOccurrenceId,kind:'VOID',reason:'synthetic void'}));assert.equal(currentSessionTimes().length,0)
})
test('R189 running windows use occurrence frozen snapshot, not plan ID lookup',()=>{
 const values=new Map<string,string>();setStoreBackend({keys:()=>[...values.keys()],getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)}});setEventContext({athleteId:'local'})
 assert.ok(saveRunningPlan({planId:'approved-plan',planSlotId:'slot',components:[{componentId:'run',modality:'RUNNING',purpose:'EASY_AEROBIC',structure:{kind:'CONTINUOUS',plannedDistanceMeters:1000,plannedDistanceMaxMeters:null,plannedDurationSeconds:null}}]}).ok)
 const e=dispatchEvent('TRAINING_STARTED',{sessionId:'slot'})!;bindTrainingStart({startEventId:e.event_id,startedAt:e.timestamp,sessionId:'slot',planSlotId:'slot',plan:null,runningPlanId:'approved-plan'})
 assert.equal(currentSessionTimes()[0].kind,'RUNNING');assert.equal(currentSessionTimes()[0].id,e.event_id)
})
