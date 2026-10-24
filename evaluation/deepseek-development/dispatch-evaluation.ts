/** Sends references to the authenticated server. Never reads a provider key. */
import {readOperatorToken} from '../../server/coach-deepseek/evaluation-operator'
import {readFileSync,writeFileSync} from 'node:fs'
const arg=(name:string)=>process.argv[process.argv.indexOf(name)+1]
const order=arg('--order'),phase=arg('--phase'),out=arg('--output'),token=process.argv.includes('--operator-state')?readOperatorToken(arg('--operator-state')):process.env.FANGKUN_EVAL_BEARER
if(!order||!out||!['pilot','evaluation'].includes(phase)||!token)throw Error('ORDER_PHASE_OUTPUT_AND_TRUSTED_BEARER_REQUIRED')
const entries=JSON.parse(readFileSync(order,'utf8')).filter((s:any)=>s.phase===phase)
if(entries.length!==(phase==='pilot'?4:22))throw Error('FROZEN_PHASE_COUNT')
// Interleave order by pair; alternate which arm goes first to reduce ordering bias.
const cases=[...new Set(entries.map((s:any)=>s.caseId))],queue=cases.flatMap((id,i)=>entries.filter((s:any)=>s.caseId===id).sort((a:any,b:any)=>i%2?b.arm.localeCompare(a.arm):a.arm.localeCompare(b.arm)))
const results:any[]=[]
for(const sample of queue){const start=Date.now();try{const r=await fetch('http://127.0.0.1:8794/evaluation/dispatch',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sampleId:sample.sampleId}),redirect:'error',signal:AbortSignal.timeout(35000)});results.push({sampleId:sample.sampleId,status:r.status,response:await r.json(),elapsedMs:Date.now()-start});writeFileSync(out,JSON.stringify(results,null,2));if(!r.ok){process.exitCode=1;break}}catch{results.push({sampleId:sample.sampleId,status:'TRANSPORT_UNKNOWN',automaticRetry:false});writeFileSync(out,JSON.stringify(results,null,2));process.exitCode=1;break}}
