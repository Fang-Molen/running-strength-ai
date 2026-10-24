import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext, loadEvents } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { garminHealthDay } from './garmin-health'
import { saveDeviceRows as saveImportedRows } from '../ui/device-store'
import { loadHealthSnapshot } from './snapshot'
import { loadVitals } from '../nutrition/vitals'
import { loadExtras } from './device-store'
import { readCoachData } from './coach-data'
import { readGlobalCoachSnapshot, subscribeGlobalCoach } from '../coach/global-coach-host-v89'
import { emptyPlanExecution } from '../coach/plan-execution/core'
import { loadEntries, saveEntries, removeEntry, updateEntry, aggregate, type FoodEntry } from '../nutrition/log'
import { commitFoodDraft, draftFromProduct, draftFromEntry, type FoodSaveInput } from '../nutrition/entry-workflow'
import { nutritionTotals } from '../nutrition/ui-records'
import { readFieldworkCoachSources } from '../core/coach-fieldwork-context'
import { fuelForTraining } from '../core/coach-fuel'
import type { FoodRow } from '../nutrition/food-db'

const day='2026-10-22', yesterday='2026-10-21'
const before='2026-10-22T04:00:00.000Z', after='2026-10-22T05:00:00.000Z'
const cereal:FoodRow={i:'qa-cereal',n:'合成谷物',a:[],br:'合成来源',rg:'测试地区',g:0,b:'g',p:[200,10,40,2,3],s:{g:100,u:'100g',v:null},pt:[],src:'U',st:'REFERENCE',uri:'https://example.invalid/synthetic'}
function fixture(t:test.TestContext){
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-22T12:00:00.000Z')})
  const fetch=globalThis.fetch;let networkCalls=0
  globalThis.fetch=()=>{networkCalls++;throw Error('Synthetic integration test forbids network calls')}
  t.after(()=>{globalThis.fetch=fetch;assert.equal(networkCalls,0)})
  const previous=currentAthleteId(),oldLocal=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window')
  const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},keys:()=>[...map.keys()]}
  Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true})
  setStoreBackend(store);setEventContext({athleteId:'qa-health-food-a'})
  t.after(()=>{setStoreBackend(null);setEventContext({athleteId:previous});for(const [key,old]of [['localStorage',oldLocal],['window',oldWindow]] as const){if(old)Object.defineProperty(globalThis,key,old);else Reflect.deleteProperty(globalThis,key)}})
  return{map,store,repository:{read:async(id:string)=>emptyPlanExecution(id)}}
}
function health(date=day,sleep=23400,at=before){return garminHealthDay(date,'qa-watch-account',{status:200,body:{calendarDate:date,restingHeartRate:55,bodyBatteryMostRecentValue:73,averageStressLevel:24,totalSteps:4567}},{status:200,body:{hrvSummary:{calendarDate:date,lastNightAvg:62}}},{status:200,body:{dailySleepDTO:{calendarDate:date,sleepTimeSeconds:sleep}}},at).rows}
const saveDeviceRows=(rows:ReturnType<typeof health>)=>saveImportedRows(rows,[])
function mealInput(meal:FoodSaveInput['meal']='早餐',date=day):FoodSaveInput{return{draft:{...draftFromProduct(cereal),amount:'100'},date,meal,acknowledged:true,athleteId:currentAthleteId()}}
function saveMeal(input=mealInput()){const r=commitFoodDraft(input);if(!r.ok)throw Error(r.reason);assert.equal(r.ok,true,JSON.stringify(r));return r.row}
const legacy=(patch:Partial<FoodEntry>={}):FoodEntry=>({id:'qa-unestimated',date:day,meal:'加餐',name:'合成未估算餐',kcal:0,label:'未估算',athleteId:currentAthleteId(),recordedAt:before,...patch})

test('confirmed watch health is idempotent and the newest revision reaches both health and coach',async t=>{
  const f=fixture(t),rows=health();assert.equal(rows.length,6)
  const first=saveDeviceRows(rows);assert.equal(first.saved,6);assert.deepEqual(first.errors,[])
  const duplicate=saveDeviceRows(rows);assert.equal(duplicate.saved,0);assert.equal(duplicate.skipped,6);assert.deepEqual(duplicate.errors,[])
  assert.equal(loadVitals().records.length+loadExtras().length,6)
  const firstCoach=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(firstCoach.evidence.find(e=>e.metric==='SLEEP')?.value,6.5)
  assert.equal(firstCoach.evidence.find(e=>e.metric==='BODY_BATTERY')?.value,73)
  const corrected=saveDeviceRows(health(day,21600,after));assert.equal(corrected.saved,1);assert.deepEqual(corrected.errors,[])
  assert.equal(loadHealthSnapshot(day).metrics.find(m=>m.metric==='SLEEP')?.current?.value,6)
  assert.equal(loadVitals().records.length+loadExtras().length,6)
  const latest=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(latest.evidence.find(e=>e.metric==='SLEEP')?.value,6);assert.notEqual(latest.revision,firstCoach.revision)
  assert.match(readCoachData(day).health.find(m=>m.metric==='SLEEP')!.detail,/6小时/)
  const stored=JSON.stringify([...f.map]);await readGlobalCoachSnapshot(day,f.repository);assert.equal(JSON.stringify([...f.map]),stored)
})

test('health daily facts and athlete scopes stay separate across confirmed import and coach reads',async t=>{
  const f=fixture(t);saveDeviceRows(health());saveDeviceRows(health(yesterday,28800,after))
  assert.equal(loadHealthSnapshot(yesterday).metrics.find(m=>m.metric==='SLEEP')?.current?.value,8)
  assert.equal(loadHealthSnapshot(day).metrics.find(m=>m.metric==='SLEEP')?.current?.value,6.5)
  setEventContext({athleteId:'qa-health-food-b'});const empty=await readGlobalCoachSnapshot(day,f.repository)
  assert.equal(empty.evidence.find(e=>e.metric==='SLEEP')?.value,null)
  assert.equal(saveDeviceRows(health(day,25200,after)).saved,6)
  assert.equal((await readGlobalCoachSnapshot(day,f.repository)).evidence.find(e=>e.metric==='SLEEP')?.value,7)
  setEventContext({athleteId:'qa-health-food-a'});assert.equal((await readGlobalCoachSnapshot(day,f.repository)).evidence.find(e=>e.metric==='SLEEP')?.value,6.5)
})

test('same food in separate meals stays separate while re-saving the same IDs is not counted twice',async t=>{
  const f=fixture(t),breakfast=saveMeal(),lunch=saveMeal(mealInput('午餐'));saveMeal(mealInput('晚餐',yesterday))
  assert.notEqual(breakfast.id,lunch.id);assert.equal(loadEntries().length,3)
  assert.ok(saveEntries(loadEntries()));assert.ok(saveEntries(loadEntries()));assert.equal(loadEntries().length,3)
  assert.equal(nutritionTotals(loadEntries().filter(e=>e.date===day)).kcal.value,400)
  assert.deepEqual(readCoachData(day).nutrition,{count:2,knownKcal:400,pending:0})
  const draft=draftFromEntry(breakfast);draft.amount='150'
  const corrected=saveMeal({...mealInput(),draft,entryId:breakfast.id,expectedRevision:breakfast.revisionId})
  assert.equal(corrected.kcal,300);assert.equal(loadEntries().length,3)
  assert.equal(commitFoodDraft({...mealInput(),draft,entryId:breakfast.id,expectedRevision:breakfast.revisionId}).ok,false)
  assert.equal(readCoachData(day).nutrition.knownKcal,500)
  assert.ok(removeEntry(lunch.id));assert.equal(readCoachData(day).nutrition.knownKcal,300)
  assert.equal((await readGlobalCoachSnapshot(day,f.repository)).evidence.filter(e=>e.domain==='NUTRITION').length,1)
  assert.ok(loadEvents().some(e=>(e.payload.foodEntry as FoodEntry)?.id===lunch.id))
  assert.deepEqual(readCoachData(yesterday).nutrition,{count:1,knownKcal:200,pending:0})
  const oldDraft=mealInput();setEventContext({athleteId:'qa-health-food-b'})
  assert.equal(commitFoodDraft(oldDraft).ok,false);assert.equal(loadEntries().length,0);assert.equal(readCoachData(day).nutrition.count,0)
  saveMeal();assert.equal(readCoachData(day).nutrition.knownKcal,200)
  setEventContext({athleteId:'qa-health-food-a'});assert.equal(readCoachData(day).nutrition.knownKcal,300)
})

test('coach daily nutrition preserves unestimated energy as pending instead of known zero',t=>{
  const f=fixture(t);f.store.setItem('fr255-food-log-v1',JSON.stringify([legacy(),legacy({id:'qa-zero',name:'合成明确零值',source:'MANUAL',label:'手填'}),legacy({id:'qa-known',name:'合成已知餐',kcal:300,source:'MANUAL',label:'手填'})]))
  assert.deepEqual(aggregate(loadEntries()).kcal,{sum:300,known:2,pending:1})
  assert.deepEqual(readCoachData(day).nutrition,{count:3,knownKcal:300,pending:1})
})

test('global coach evidence does not present unestimated energy as an available measured zero',async t=>{
  const f=fixture(t);f.store.setItem('fr255-food-log-v1',JSON.stringify([legacy()]))
  const e=(await readGlobalCoachSnapshot(day,f.repository)).evidence.find(e=>e.domain==='NUTRITION')!
  assert.equal(e.availability,'MISSING');assert.equal(e.value,null);assert.match(e.summary,/未记录|未知/)
})

test('training fuel excludes unknown legacy energy while preserving an explicit confirmed zero',t=>{
  fixture(t);const unknown=fuelForTraining(before,after,[legacy()],null)
  assert.equal(unknown.status,'NO_RECORD');assert.equal(unknown.recordedKcal,null);assert.deepEqual(unknown.entries,[])
  const known=fuelForTraining(before,after,[legacy({label:'手填',source:'MANUAL'})],null)
  assert.equal(known.status,'SAME_DAY_RECORDED');assert.equal(known.recordedKcal,0)
})

test('the actual confirmed food draft sends new carb fields and unknown energy accurately to coach context',t=>{
  const f=fixture(t);saveMeal();f.store.setItem('fr255-food-log-v1',JSON.stringify([legacy()]))
  const sources=readFieldworkCoachSources('查看我的饮食记录',new Date(Date.now()+1000).toISOString())
  assert.match(sources.find(s=>s.detail.includes('合成谷物'))!.detail,/碳水40克/)
  assert.match(sources.find(s=>s.detail.includes('合成未估算餐'))!.detail,/热量未知/)
})

test('coach meal context preserves the confirmed nutrition snapshot source and region',t=>{
  fixture(t)
  const branded:FoodRow={...cereal,src:'B',st:'BRAND_REPORTED',lbl:'合成品牌标签（仅测试）',rg:'合成地区乙'}
  const row=saveMeal({...mealInput(),draft:{...draftFromProduct(branded),amount:'100'}})
  assert.equal(row.nutritionSnapshot?.source.label,'合成品牌标签（仅测试）')
  const detail=readFieldworkCoachSources('查看我的饮食记录',new Date(Date.now()+1000).toISOString())[0].detail
  assert.match(detail,/来源合成品牌标签（仅测试）／合成地区乙/)
  assert.doesNotMatch(detail,/来源用户手填/)
})

test('editing an older meal makes its new version available in the latest coach source selection',t=>{
  fixture(t);const rows=[0,1,2,3].map(i=>legacy({id:'qa-meal-'+i,name:'合成餐'+i,kcal:100+i,label:'手填',source:'MANUAL',recordedAt:`2026-10-20T0${i}:00:00.000Z`}))
  assert.ok(saveEntries(rows));assert.ok(updateEntry(rows[0].id,{kcal:999}))
  const sources=readFieldworkCoachSources('查看我的饮食记录',new Date(Date.now()+1000).toISOString())
  assert.ok(sources.some(s=>s.detail.includes('合成餐0')&&s.detail.includes('999千卡')))
})

test('health and nutrition commits notify coach readers with committed current values',async t=>{
  fixture(t);let calls=0,lastKcal:number|undefined,lastSleep:number|undefined
  const off=subscribeGlobalCoach(()=>{calls++;lastKcal=readCoachData(day).nutrition.knownKcal;lastSleep=loadHealthSnapshot(day).metrics.find(m=>m.metric==='SLEEP')?.current?.value});t.after(off)
  saveDeviceRows(health());saveMeal();await Promise.resolve()
  assert.equal(calls,1);assert.equal(lastKcal,200);assert.equal(lastSleep,6.5)
})
