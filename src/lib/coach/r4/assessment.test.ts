import test from 'node:test'
import assert from 'node:assert/strict'
import type {MetricFact,Context} from '../../health/analysis-contract'
import {projectAnalysisEvidence} from '../../health/analysis-evidence'
import {buildR4Review} from './assessment'
import {setStoreBackend} from '../../core/storage'
import {setEventContext,currentAthleteId} from '../../core/events'
import {readAnalysis} from '../../health/analysis-host'

const context:Context={athleteId:'r4-a',asOf:'2026-10-24T12:00:00Z',timeZone:'UTC',planVersion:null,consentVersion:'test',analysisVersion:'test'}
function metric(id:string,day:string,value:number|null,device='watch-a'):MetricFact{return {id,revision:0,athleteId:'r4-a',provider:'MANUAL',accountRef:null,deviceId:device,protocolKey:'night-rmssd',sourceRecordId:id,occurredAt:day+'T06:00:00Z',knownAt:day+'T07:00:00Z',receivedAt:day+'T07:00:00Z',sourceTimeZone:'UTC',status:'CONFIRMED',quality:'AVAILABLE',ownershipReceiptId:null,kind:'METRIC',metric:'RMSSD',value,unit:'ms',statistic:'DAILY_MEAN',windowStart:null,windowEnd:null,providerDate:day,isFinal:true,energyKind:null}}
const review=(facts:MetricFact[],options={})=>buildR4Review(projectAnalysisEvidence({context,facts}),'同设备个人基线如何？',options)
test('R4 baseline excludes current day, foreign athletes and future knowledge, and splits devices',()=>{
 const facts=[metric('a1','2026-10-20',60),metric('a2','2026-10-21',62),metric('b1','2026-10-22',45,'watch-b'),metric('today','2026-10-24',40),{...metric('foreign','2026-10-20',999),athleteId:'r4-b'},{...metric('future','2026-10-22',100),knownAt:'2026-10-25T07:00:00Z'}]
 const r=review(facts)
 assert.equal(r.baselines.length,2)
 assert.deepEqual(r.baselines.map(s=>s.sampleDays).sort(),[1,2])
 assert.ok(r.baselines.every(s=>s.status==='DESCRIPTIVE_ONLY'&&s.provisional))
 assert.ok(r.baselines.every(s=>!s.values.includes(999)&&!s.values.includes(100)&&!s.values.includes(40)))
 assert.equal(r.capability.strength.status,'UNKNOWN');assert.equal(r.autoExecute,false)
})
test('same-day repeated samples are not independent days and conflicts remain excluded',()=>{
 const r=review([metric('a','2026-10-20',60),metric('b','2026-10-20',60),metric('c','2026-10-21',61),metric('d','2026-10-21',63),metric('null','2026-10-22',null)])
 assert.equal(r.baselines[0].sampleDays,1)
 assert.equal(r.baselines[0].conflictingDays,1)
 assert.equal(r.baselines[0].missingDays,1)
})
test('R4 correction recomputes a new projection without modifying original facts',()=>{
 const old=metric('same','2026-10-20',60),corrected={...old,id:'corrected',revision:1,value:50}
 const before=structuredClone(old)
 assert.equal(review([old]).baselines[0].mean,60)
 assert.equal(review([old,corrected]).baselines[0].mean,50)
 assert.deepEqual(old,before)
})
test('R4 explicit tasks override tentative question routing and preserve negated food-only scope',()=>{
 const s=projectAnalysisEvidence({context,facts:[]})
 const r=buildR4Review(s,'不谈跑步和HRV，只问饮食',{tasks:['nutrition'],population:'healthy_adult',foods:[{kcal:400,protein:null}]})
 assert.deepEqual(r.selection.tasks,['nutrition']);assert.equal(r.nutrition.kcal.knownSum,400)
 assert.equal(r.nutrition.energyDeficit,null)
 const corrected=buildR4Review(s,'不谈跑步和HRV，只问饮食',{tasks:['nutrition'],population:'healthy_adult',foods:[{kcal:400,protein:25}]})
 assert.notEqual(r.inputRevision,corrected.inputRevision)
})
test('existing analysis host reads R4 without writing records or activating plans',t=>{
 const prev=currentAthleteId(),old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),map=new Map<string,string>()
 const box={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},keys:()=>[...map.keys()]}
 setStoreBackend(box);setEventContext({athleteId:'r4-a'});Object.defineProperty(globalThis,'localStorage',{value:box,configurable:true})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:prev});if(old)Object.defineProperty(globalThis,'localStorage',old);else Reflect.deleteProperty(globalThis,'localStorage')})
 const before=[...map]
 assert.equal(readAnalysis('2026-10-24',context.asOf,'今天的饮食').professionalReference,null)
 const r=readAnalysis('2026-10-24',context.asOf,'今天的饮食',{r4ReferencePreview:true})
 assert.equal(r.professionalReference!.selection.version,'R4-20261024')
 assert.equal(r.professionalReference!.selection.population,'unknown')
 assert.deepEqual([...map],before);assert.equal(r.automaticPrescription,false)
})
