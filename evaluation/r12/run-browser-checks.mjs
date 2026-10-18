import {spawn} from 'node:child_process'
import {openSync,writeFileSync} from 'node:fs'
const dir='/workspace/fangkun/evidence/r12'
const env={...process.env,PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:'/usr/bin/chromium',BROWSER_SMOKE_BLOCK_SW:'1',DATABASE_URL:'',XAI_API_KEY:'',GEMINI_API_KEY:'',OPENAI_API_KEY:''}
const results=[]
async function run(name,args){const log=openSync(`${dir}/${name}.log`,'w');const p=spawn(process.execPath,args,{stdio:['ignore',log,log],env});const code=await new Promise(resolve=>p.on('exit',resolve));results.push({name,exitCode:code});writeFileSync(`${dir}/browser-runs.json`,JSON.stringify(results,null,2));if(code!==0)throw Error(name+' failed')}
const log=openSync(`${dir}/preview.log`,'w')
const preview=spawn('npm',['run','preview','--','--host','127.0.0.1','--port','8083'],{stdio:['ignore',log,log],env,detached:true})
try {
 for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:8083/')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}
 await run('dev-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8082/','/workspace/screenshots/fangkun-r12/dev.png'])
 await run('prod-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8083/','/workspace/screenshots/fangkun-r12/prod.png','--baseline','/workspace/screenshots/fangkun-r12/dev.json'])
 await run('dev-focused',['evaluation/r12/browser-focused.mjs','http://127.0.0.1:8082/','dev'])
 await run('prod-focused',['evaluation/r12/browser-focused.mjs','http://127.0.0.1:8083/','prod'])
} catch(e){console.error(String(e));process.exitCode=1} finally{try{process.kill(-preview.pid,'SIGTERM')}catch{}}
