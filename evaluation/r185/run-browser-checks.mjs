// Local-only R13 servers. Existing preview and released sources are untouched.
import {spawn} from 'node:child_process'
import {openSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs'
const dir=process.env.R185_EVIDENCE_DIR??'/workspace/fangkun/evidence/r185'
const screens=process.env.R185_SCREEN_DIR??'/workspace/screenshots/fangkun-r185'
const env={...process.env,NODE_EXTRA_CA_CERTS:'/usr/local/share/ca-certificates/environment-proxy-ca.crt',PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:'/usr/bin/chromium',BROWSER_SMOKE_BLOCK_SW:'1',DATABASE_URL:'',XAI_API_KEY:'',GEMINI_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''}
const focusedOnly=process.env.R185_FOCUSED_ONLY==='1'
const target=process.env.R185_BROWSER_TARGET??'both'
env.PATH=process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+env.PATH
const results=[],servers=[]
mkdirSync(screens,{recursive:true});mkdirSync(dir,{recursive:true})
async function ready(url){for(let i=0;i<60;i++){try{if((await fetch(url)).ok)return}catch{}await new Promise(r=>setTimeout(r,1000))}throw Error('server unavailable: '+url)}
async function server(name,args){const log=openSync(`${dir}/${name}.log`,'w'),p=spawn('npm',args,{stdio:['ignore',log,log],env,detached:true});servers.push(p);return p}
async function run(name,args){const log=openSync(`${dir}/${name}.log`,'w');const p=spawn(process.execPath,args,{stdio:['ignore',log,log],env});const code=await new Promise(resolve=>p.on('exit',resolve));results.push({name,exitCode:code});writeFileSync(`${dir}/browser-runs.json`,JSON.stringify(results,null,2));return code}
try {
 if(['both','dev','dev-restart'].includes(target)) {await server('dev',['run','dev','--','--host','127.0.0.1','--port','8086']);await ready('http://127.0.0.1:8086/')}
 if(['both','prod','restart','dev-restart'].includes(target)) {await server('preview',['run','preview','--','--host','127.0.0.1','--port','8087']);await ready('http://127.0.0.1:8087/')}
 if(!focusedOnly){
  await run('dev-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8086/',`${screens}/dev.png`])
  await run('prod-smoke',['scripts/browser-smoke.mjs','http://127.0.0.1:8087/',`${screens}/prod.png`,'--baseline',`${screens}/dev.json`])
 }
 if(['both','dev','dev-restart'].includes(target)) await run('dev-focused',['evaluation/r185/browser-acceptance.mjs','http://127.0.0.1:8086/','dev'])
 if(['both','prod'].includes(target)) await run('prod-focused',['evaluation/r185/browser-acceptance.mjs','http://127.0.0.1:8087/','prod'])

 if(['both','prod','restart','dev-restart'].includes(target)) await run('prod-restart',['evaluation/r185/browser-restart.mjs','http://127.0.0.1:8087/'])
 if(results.some(r=>r.exitCode!==0))process.exitCode=1
} catch(e){console.error(String(e));process.exitCode=1} finally{for(const p of servers)try{process.kill(-p.pid,'SIGTERM')}catch{}}
