// Local-only R13 servers. Existing preview and released sources are untouched.
import {spawn} from 'node:child_process'
import {openSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs'
const dir='/workspace/fangkun/evidence/r13'
const env={...process.env,NODE_EXTRA_CA_CERTS:'/usr/local/share/ca-certificates/environment-proxy-ca.crt',PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:'/usr/bin/chromium',BROWSER_SMOKE_BLOCK_SW:'1',DATABASE_URL:'',XAI_API_KEY:'',GEMINI_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''}
const focusedOnly=process.argv.includes('--focused-only')
const results=focusedOnly?JSON.parse(readFileSync(`${dir}/browser-runs.json`,'utf8')).filter(r=>!r.name.endsWith('-focused')):[],servers=[]
mkdirSync('/workspace/screenshots/fangkun-r13',{recursive:true})
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return}catch{}await new Promise(r=>setTimeout(r,1000))}throw Error('server unavailable: '+url)}
async function server(name,args){const log=openSync(`${dir}/${name}.log`,'w'),p=spawn('npm',args,{stdio:['ignore',log,log],env,detached:true});servers.push(p);return p}
async function run(name,args){const log=openSync(`${dir}/${name}.log`,'w');const p=spawn(process.execPath,args,{stdio:['ignore',log,log],env});const code=await new Promise(resolve=>p.on('exit',resolve));results.push({name,exitCode:code});writeFileSync(`${dir}/browser-runs.json`,JSON.stringify(results,null,2));return code}
try {
 await server('dev',['run','dev','--','--host','127.0.0.1','--port','8084']);await ready('http://127.0.0.1:8084/')
 await server('preview',['run','preview','--','--host','127.0.0.1','--port','8085']);await ready('http://127.0.0.1:8085/')
 if(!focusedOnly){
  await run('dev-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8084/','/workspace/screenshots/fangkun-r13/dev.png'])
  await run('prod-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8085/','/workspace/screenshots/fangkun-r13/prod.png','--baseline','/workspace/screenshots/fangkun-r13/dev.json'])
 }
 await run('dev-focused',['evaluation/r13/browser-focused.mjs','http://127.0.0.1:8084/','dev'])
 await run('prod-focused',['evaluation/r13/browser-focused.mjs','http://127.0.0.1:8085/','prod'])
 if(!focusedOnly)await run('prod-offline-reload',['evaluation/r13/browser-offline-reload.mjs','http://127.0.0.1:8085/'])
 if(results.some(r=>r.exitCode!==0))process.exitCode=1
} catch(e){console.error(String(e));process.exitCode=1} finally{for(const p of servers)try{process.kill(-p.pid,'SIGTERM')}catch{}}
