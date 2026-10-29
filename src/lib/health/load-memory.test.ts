import test from 'node:test'
import assert from 'node:assert/strict'
import {appendJournal} from '../core/storage-journal'
import {loadOccurrences} from './load-evidence'
import {LOAD_MEMORY_COVERAGE,LOAD_MEASUREMENT,createLoadMemory} from './load-memory'
import {buildLoadSummary,calendarDayEnd} from './load-evidence'
import {projectAnalysisEvidence} from './analysis-evidence'
import {context,training} from './analysis-fixtures'
import {setStoreBackend} from '../core/storage'
import {notifyStorageChange} from '../core/storage-changes'
const a=training({id:'A',sourceRecordId:'A',canonicalActivityId:'A',occurrenceId:'A',startedAt:'2026-10-20T08:00:00Z',occurredAt:'2026-10-20T08:00:00Z',knownAt:'2026-10-20T09:00:00Z',receivedAt:'2026-10-20T09:00:00Z',endedAt:'2026-10-20T08:30:00Z',actualDurationSeconds:1800,sessionRpe:6,sessionRpeScale:'CR10'})
const input={athleteId:context.athleteId,timeZone:'UTC',startDay:'2026-10-19',endDay:'2026-10-22',asOf:context.asOf}
function fixture(t:test.TestContext){const data=new Map<string,string>();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()],removeItem:k=>{data.delete(k)}});t.after(()=>setStoreBackend(null));return data}
test('新增、更正、删除、重复和回放的增量日结果等于全量参考',t=>{
 fixture(t);let rows=[a],reads=0
 const source=(asOf:string,zone:string)=>{reads++;return projectAnalysisEvidence({context:{...context,asOf,timeZone:zone},facts:rows})},memory=createLoadMemory(source)
 const verify=()=>{const r=memory.read(input),full=buildLoadSummary(source(input.asOf,input.timeZone),input.startDay,input.endDay);assert.deepEqual(r.summary,full);return r}
 const first=verify();const readCount=reads;const cached=memory.read(input);assert.equal(reads,readCount);assert.equal(cached.diagnostics.cacheHit,true)
 rows=[{...a,revision:2,sessionRpe:7}];notifyStorageChange('TEST_CORRECTION');const revised=verify();assert.deepEqual(revised.diagnostics.changedDays,['2026-10-20']);assert.notEqual(revised.summary.sourceVersion,first.summary.sourceVersion)
 rows=[rows[0],{...a,id:'B',sourceRecordId:'B',canonicalActivityId:'B',occurrenceId:'B',startedAt:'2026-10-21T08:00:00Z',occurredAt:'2026-10-21T08:00:00Z',endedAt:'2026-10-21T08:30:00Z',knownAt:'2026-10-21T09:00:00Z',receivedAt:'2026-10-21T09:00:00Z'}];notifyStorageChange('TEST_ADD');assert.deepEqual(verify().diagnostics.changedDays,['2026-10-21'])
 rows=[rows[1]];notifyStorageChange('TEST_DELETE');assert.deepEqual(verify().diagnostics.changedDays,['2026-10-20'])
 rows=[rows[0],rows[0]];notifyStorageChange('TEST_REPLAY');assert.deepEqual(verify().diagnostics.changedDays,[])
})
test('失败后不返回旧成功缓存；恢复可重读且不依赖缓存持久化',t=>{
 fixture(t);let fail=false
 const memory=createLoadMemory((asOf,zone)=>{if(fail)throw Error('SOURCE_UNREADABLE');return projectAnalysisEvidence({context:{...context,asOf,timeZone:zone},facts:[a]})})
 memory.read(input);fail=true;notifyStorageChange('TEST_FAIL');assert.throws(()=>memory.read(input),/SOURCE_UNREADABLE/)
 fail=false;assert.equal(memory.read(input).summary.occurrences.length,1)
})
test('明确历史截止与晚录入隔离，缓存不跨人物和时区复用',t=>{
 fixture(t);const late={...a,knownAt:'2026-10-22T12:00:00Z',receivedAt:'2026-10-22T12:00:00Z'}
 const memory=createLoadMemory((asOf,zone)=>projectAnalysisEvidence({context:{...context,asOf,timeZone:zone},facts:[late]}))
 assert.equal(memory.read({...input,asOf:'2026-10-21T20:00:00Z'}).summary.occurrences.length,0)
 assert.equal(memory.read(input).summary.occurrences.length,1)
 assert.equal(memory.read({...input,asOf:'2026-10-21T20:00:00Z'}).summary.occurrences.length,0)
 assert.throws(()=>memory.read({...input,athleteId:'OTHER'}),/SCOPE_CHANGED/)
 assert.equal(memory.read({...input,timeZone:'Asia/Shanghai'}).summary.timeZone,'Asia/Shanghai')
})
test('日界按用户时区含夏令时，不用UTC午夜截掉当日晚训练',()=>{
 assert.equal(new Date(calendarDayEnd('2026-10-28','Asia/Shanghai')).toISOString(),'2026-10-28T15:59:59.999Z')
 assert.equal(new Date(calendarDayEnd('2026-03-08','America/New_York')).toISOString(),'2026-03-09T03:59:59.999Z')
})

test('审查回归：投影后的冲突不丢失，冲突空日不能确认成零',t=>{
 fixture(t)
 const source=()=>projectAnalysisEvidence({context,facts:[a,{...a,id:'peer',sourceRecordId:'peer',provider:'COROS',accountRef:'synthetic-account'}]})
 const original=source();assert.equal(original.conflicts.length,1)
 const memory=createLoadMemory(source),first=memory.read(input)
 assert.deepEqual(first.snapshot.conflicts,original.conflicts)
 const pure=buildLoadSummary(original,input.startDay,input.endDay)
 assert.ok(pure.gaps.length>0)
 for(const d of first.summary.days)appendJournal(LOAD_MEMORY_COVERAGE,d.day,{athleteId:context.athleteId,timeZone:'UTC',day:d.day,sourceVersion:d.sourceVersion,knownAt:'2026-10-22T18:00:00Z'})
 assert.ok(memory.read(input).summary.days.every(d=>d.sessionAU===null))
})
test('审查回归：不同本人核对产生不同事实版本',t=>{
 fixture(t);const source=()=>projectAnalysisEvidence({context,facts:[a]}),raw=loadOccurrences(source())[0],memory=createLoadMemory(source)
 const proof={athleteId:context.athleteId,occurrenceId:a.canonicalActivityId,sourceRevision:raw.revision,recordedAt:'2026-10-22T18:00:00Z',ratingCollectedAt:'2026-10-20T09:00:00Z',ratingScale:'CR10',fullSession:true,completed:true}
 appendJournal(LOAD_MEASUREMENT,'proof1',{...proof,id:'proof1'})
 const first=memory.read(input).snapshot.facts[0].revision
 appendJournal(LOAD_MEASUREMENT,'proof2',{...proof,id:'proof2',recordedAt:'2026-10-22T19:00:00Z',ratingCollectedAt:'2026-10-20T09:10:00Z'})
 assert.notEqual(memory.read(input).snapshot.facts[0].revision,first)
})
test('审查回归：消费方不能污染已缓存的事实和日结果',t=>{
 fixture(t);const memory=createLoadMemory(()=>projectAnalysisEvidence({context,facts:[a]})),first=memory.read(input),baseline=JSON.stringify(first.summary)
 try{first.summary.occurrences[0].knownDistanceM=999999}catch{}
 try{first.snapshot.facts.length=0}catch{}
 try{first.summary.days[0].sessionAU=999999}catch{}
 const next=memory.read(input);assert.equal(JSON.stringify(next.summary),baseline);assert.equal(next.snapshot.facts.length,1)
})
