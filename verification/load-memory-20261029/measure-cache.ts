import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
import {createLoadMemory} from '../../src/lib/health/load-memory'
import {buildLoadSummary} from '../../src/lib/health/load-evidence'
import {training,context} from '../../src/lib/health/analysis-fixtures'
import {projectAnalysisEvidence} from '../../src/lib/health/analysis-evidence'
import {setStoreBackend} from '../../src/lib/core/storage'
import {notifyStorageChange} from '../../src/lib/core/storage-changes'
const data=new Map<string,string>();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v)},keys:()=>[...data.keys()]})
const input={athleteId:context.athleteId,timeZone:'UTC',startDay:'2026-09-25',endDay:'2026-10-22',asOf:context.asOf}
let rows=Array.from({length:360},(_,i)=>{const at=new Date(Date.parse(context.asOf)-((359-i)*86400000+12*3600000)).toISOString(),end=new Date(Date.parse(at)+1800000).toISOString();return training({id:'s'+i,sourceRecordId:'s'+i,canonicalActivityId:'s'+i,occurrenceId:'s'+i,startedAt:at,occurredAt:at,knownAt:end,receivedAt:end,endedAt:end,actualDurationSeconds:1800,sessionRpe:6,sessionRpeScale:'CR10'})})
let reads=0
const source=()=>{reads++;return projectAnalysisEvidence({context,facts:rows})}
const memory=createLoadMemory(source),coldStart=performance.now(),first=memory.read(input),coldMs=performance.now()-coldStart,readAfterCold=reads,hotStart=performance.now()
for(let i=0;i<8;i++)assert.deepEqual(memory.read(input).summary,first.summary)
const hotMs=performance.now()-hotStart,hotReads=reads-readAfterCold,fullStart=performance.now(),fullBefore=reads
for(let i=0;i<8;i++)assert.deepEqual(buildLoadSummary(source(),input.startDay,input.endDay),first.summary)
const fullMs=performance.now()-fullStart,fullReads=reads-fullBefore
rows=rows.map((r,i)=>i===359?{...r,revision:r.revision+1,sessionRpe:7}:r);notifyStorageChange('SYNTHETIC_BENCHMARK_CORRECTION')
const changedStart=performance.now(),changed=memory.read(input),changedMs=performance.now()-changedStart
assert.deepEqual(changed.summary,buildLoadSummary(source(),input.startDay,input.endDay));assert.equal(hotReads,0);assert.equal(fullReads,8)
writeFileSync(new URL('./cache-measurement.json',import.meta.url),JSON.stringify({synthetic:true,rows:rows.length,repeatedQueries:8,cold:{milliseconds:coldMs,sourceReads:readAfterCold},cached:{milliseconds:hotMs,sourceReads:hotReads},fullReference:{milliseconds:fullMs,sourceReads:fullReads},afterCorrection:{milliseconds:changedMs,changedDays:changed.diagnostics.changedDays},scope:'Local cache/query measurement; no real model, no token or financial savings estimate. First source read and reads after mutation rebuild retained projection; stable repeated queries use indexed cached facts.'},null,2)+'\n')
console.log('CACHE_MEASUREMENT_PASS')
setStoreBackend(null)
