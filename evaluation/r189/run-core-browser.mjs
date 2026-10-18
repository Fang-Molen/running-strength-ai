import {spawnSync} from 'node:child_process'
import {openSync,closeSync,writeFileSync,mkdirSync} from 'node:fs'
const out='/workspace/fangkun/evidence/r189/browser',url=process.argv[2]??'http://127.0.0.1:8088/'
if(new URL(url).hostname!=='127.0.0.1')throw Error('local acceptance only')
mkdirSync(out,{recursive:true})
const results=[]
for(const [script,label] of [['browser-regression.mjs','prod-core-regression'],['browser-restart.mjs','prod-core-restart']]){
 const log=`${out}/${label}.log`,fd=openSync(log,'w'),startedAt=new Date().toISOString()
 const result=spawnSync(process.execPath,[`evaluation/r189/${script}`,url,'prod'],{stdio:['ignore',fd,fd],timeout:420000,env:{...process.env,R185_EVIDENCE_DIR:out,R185_SCREEN_DIR:'/workspace/screenshots/fangkun-r189'}})
 closeSync(fd)
 results.push({script,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message??null,log})
 writeFileSync(`${out}/core-browser-runs.json`,JSON.stringify(results,null,2)+'\n')
}
console.log(JSON.stringify(results));if(results.some(r=>r.exitCode!==0))process.exitCode=1
