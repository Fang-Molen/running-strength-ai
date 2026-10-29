import test from 'node:test'
import assert from 'node:assert/strict'
import {currentAthleteId,setEventContext} from '../core/events'
import {setStoreBackend} from '../core/storage'
import {createTrainingImportDraft,confirmTrainingImport} from '../core/training-import'
import {confirmImportLogCorrection,importCorrectionTargets} from '../core/import-log-correction'
import {readLoadMemory,confirmSummaryCoverage,confirmLoadMeasurement,invalidateLoadMemory} from './load-memory'
import {readOnlineContext} from '../coach/online-context'
import {loadSummaryRecord} from '../coach/online-load-context'
import {loadOccurrences,buildLoadSummary} from './load-evidence'
import {context,training} from './analysis-fixtures'
import {projectAnalysisEvidence} from './analysis-evidence'
const fv=(r:{fields:{name:string;value:unknown}[]},key:string)=>r.fields.find(f=>f.name===key)?.value
test('实际保存→口径核对→完整性→问答同源→更正撤回总量→重新读取→切换人物',t=>{
 const now='2026-10-29T10:00:00.000Z',owner=currentAthleteId(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 t.mock.timers.enable({apis:['Date'],now:new Date(now)})
 const map=new Map<string,string>(),store={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},keys:()=>[...map.keys()]}
 Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});setStoreBackend(store);setEventContext({athleteId:'synthetic-load'})
 t.after(()=>{setStoreBackend(null);setEventContext({athleteId:owner});if(previous)Object.defineProperty(globalThis,'localStorage',previous);else Reflect.deleteProperty(globalThis,'localStorage')})
 const f=<T>(value:T)=>({value,status:'RECORDED' as const,sourceIds:['user-confirmed']})
 const draft=createTrainingImportDraft({sport:'RUNNING',title:f('合成负荷训练'),occurredAt:f('2026-10-20T08:00:00.000Z'),durationSeconds:f(1800),sessionRpe:f(6),totalDistanceMeters:f(5000),runningSegments:[{id:'s',kind:'CONTINUOUS',distanceMeters:f(5000),durationSeconds:f(1800),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
 const saved=confirmTrainingImport(draft);assert.ok(saved.ok);if(!saved.ok)return
 const range={startDay:'2026-10-01',endDay:'2026-10-28'}
 const a=readLoadMemory(range),row=a.summary.occurrences[0];assert.equal(row.knownDistanceM,5000);assert.equal(row.candidateAU,180);assert.equal(row.sessionAU,null)
 assert.equal(confirmLoadMeasurement({occurrenceId:row.id,day:row.day,expectedRevision:a.rawRevisions[row.id],ratingCollectedAt:'2026-10-20T09:00:00Z',ratingScale:'0-10_SESSION_RPE',athleteId:'synthetic-load',fullSession:true,completed:true}).ok,true)
 const b=readLoadMemory(range);assert.equal(b.summary.occurrences[0].sessionAU,180);assert.equal(confirmSummaryCoverage(b.summary).ok,true)
 const c=readLoadMemory(range);assert.equal(c.summary.days.find(d=>d.day===row.day)!.sessionAU,180);assert.equal(c.summary.days[0].sessionAU,0)
 const q='汇总我2026-10-01到2026-10-28的训练负荷'
 const online=readOnlineContext(q,'2026-10-29',now,undefined,[],[],{currentLoadCache:true})
 const record=online.context.records.find(r=>r.source==='USER_DECLARED:CANONICAL_LOAD_SUMMARY');assert.ok(record,'summary survived real context budget')
 assert.equal(fv(record,'qualifiedSessionLoad'),180);assert.equal(fv(record,'knownDistance'),5000);assert.equal(fv(record,'sourceVersion'),c.summary.sourceVersion)
 const target=importCorrectionTargets(saved.record).find(r=>r.field==='distance');assert.ok(target)
 assert.equal(confirmImportLogCorrection({occurrenceId:saved.record.confirmedImportId,targetId:target.id,expectedSourceId:target.sourceId,value:'4000',reason:'合成更正测试',confirmed:true}).ok,true)
 const corrected=readLoadMemory(range);assert.equal(corrected.summary.occurrences[0].knownDistanceM,4000);assert.equal(corrected.summary.days.find(d=>d.day===row.day)!.sessionAU,null)
 assert.notEqual(readOnlineContext(q,'2026-10-29',now,undefined,[],[],{currentLoadCache:true}).sourceVersion,online.sourceVersion)
 invalidateLoadMemory();assert.deepEqual(readLoadMemory(range).summary,corrected.summary)
 setEventContext({athleteId:'synthetic-other'});assert.equal(readLoadMemory(range).summary.occurrences.length,0)
})
test('离散日期汇总不包含中间记录，区间包含；混合组件仍只一整课',()=>{
 const rows=[20,21,22].map(d=>training({id:'r'+d,sourceRecordId:'r'+d,canonicalActivityId:'r'+d,occurrenceId:'r'+d,startedAt:'2026-10-'+d+'T08:00:00Z',occurredAt:'2026-10-'+d+'T08:00:00Z',knownAt:'2026-10-'+d+'T09:00:00Z',receivedAt:'2026-10-'+d+'T09:00:00Z',endedAt:'2026-10-'+d+'T08:30:00Z',actualDurationSeconds:1800,sessionRpe:6,sessionRpeScale:'CR10'}))
 const s=buildLoadSummary(projectAnalysisEvidence({context,facts:rows}),'2026-10-20','2026-10-22')
 assert.equal(loadOccurrences(projectAnalysisEvidence({context,facts:rows})).length,3)
 assert.equal(fv(loadSummaryRecord(s,'我的2026-10-20和2026-10-22负荷','2026-10-22'),'sessions'),2)
 assert.equal(fv(loadSummaryRecord(s,'我的2026-10-20到2026-10-22负荷','2026-10-22'),'sessions'),3)
})
