import test from 'node:test'
import assert from 'node:assert/strict'
import {currentAthleteId,setEventContext} from '../core/events'
import {setStoreBackend} from '../core/storage'
import {createTrainingImportDraft,confirmTrainingImport} from '../core/training-import'
import {readOnlineContext} from './online-context'

test('explicit calendar requests read retained history through the real storage entry',t=>{
 const now='2026-10-28T20:00:00.000Z',owner=currentAthleteId(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 t.mock.timers.enable({apis:['Date'],now:new Date(now)})
 const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},keys:()=>[...map.keys()]}
 Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});setStoreBackend(store);setEventContext({athleteId:'synthetic-calendar'})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage')})
 const f=<T>(value:T)=>({value,status:'RECORDED' as const,sourceIds:['user-confirmed']})
 for(const year of [2024,2025,2026]){
  const draft=createTrainingImportDraft({sport:'RUNNING',title:f('合成年份训练'),occurredAt:f(`${year}-01-15T09:00:00.000Z`),durationSeconds:f(1800),totalDistanceMeters:f(5000),runningSegments:[{id:'s',kind:'CONTINUOUS',distanceMeters:f(5000),durationSeconds:f(1800),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
  assert.ok(confirmTrainingImport(draft).ok)
 }
 for(const [phrase,years] of [['去年',[2025]],['2025年',[2025]],['前年',[2024]],['今年',[2026]],['2024年和2025年',[2024,2025]],['2025-01-15',[2025]],['2024-01-01到2026-01-31',[2024,2025,2026]]] as const){
  const result=readOnlineContext(`复盘我${phrase}的训练`,'2026-10-28',now)
  assert.deepEqual([...new Set(result.selectedFacts.filter(f=>f.kind==='TRAINING').map(f=>Number(f.occurredAt!.slice(0,4))))].sort(),[...years],phrase)
 }
})
