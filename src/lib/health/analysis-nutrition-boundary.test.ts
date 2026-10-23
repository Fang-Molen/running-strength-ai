import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { readAnalysis, analysisText } from './analysis-host'

// Legacy unestimated rows carry kcal:0 as a storage sentinel. It is not an observed zero.
test('unknown energy remains unknown in the shared coach analysis, while explicitly recorded zero remains zero', t => {
 const owner=currentAthleteId(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
 setStoreBackend(store);setEventContext({athleteId:'nutrition-synthetic'});Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage')})
 const row={id:'unknown',athleteId:'nutrition-synthetic',date:'2026-10-22',recordedAt:'2026-10-22T01:00:00Z',meal:'早餐',name:'合成未估算餐',kcal:0,label:'未估算'}
 store.setItem('fr255-food-log-v1',JSON.stringify([row]));const unknown=readAnalysis('2026-10-22','2026-10-22T12:00:00Z')
 assert.equal(unknown.nutrition.loggedKcal,null);assert.equal(unknown.nutrition.unknownEnergyCount,1)
 assert.ok(!unknown.snapshot.facts.some(f=>f.kind==='METRIC'&&f.metric.includes('饮食已记录能量')))
 assert.match(analysisText(unknown),/热量未知/);assert.doesNotMatch(analysisText(unknown),/饮食已记 0 kcal/)
 store.setItem('fr255-food-log-v1',JSON.stringify([{...row,label:'手填',source:'MANUAL'}]));const zero=readAnalysis('2026-10-22','2026-10-22T12:00:00Z')
 assert.equal(zero.nutrition.loggedKcal,0);assert.equal(zero.nutrition.unknownEnergyCount,0)
 assert.match(analysisText(zero),/饮食已记 0 kcal/)
})
