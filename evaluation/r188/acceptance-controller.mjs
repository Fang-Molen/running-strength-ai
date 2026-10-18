// Persistent local QA worker. Commands are restricted to the existing validation runners.
import {createInterface} from 'node:readline'
import {spawn} from 'node:child_process'
const env={...process.env,R185_EVIDENCE_DIR:'/workspace/fangkun/evidence/r188/browser-final',R185_SCREEN_DIR:'/workspace/screenshots/fangkun-r188-final',R185_BROWSER_TARGET:'both'}
for(const key of ['XAI_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','DATABASE_URL'])delete env[key]
env.PATH=process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+env.PATH
const allowed={FULL:['evaluation/r188/run-full-checks.mjs'],BROWSER:['evaluation/r188/run-browser-checks.mjs']}
const input=createInterface({input:process.stdin,output:process.stdout,terminal:false})
let queue=Promise.resolve()
console.log('READY: FULL / BROWSER / EXIT only; local validation, no model API credentials')
input.on('line',line=>{queue=queue.then(async()=>{
 const key=line.trim();if(key==='EXIT'){input.close();return}
 const args=allowed[key];if(!args){console.log('REJECTED_COMMAND');return}
 const child=spawn(process.execPath,args,{env,stdio:['ignore','inherit','inherit']})
 const code=await new Promise(resolve=>{child.on('error',()=>resolve(127));child.on('exit',resolve)})
 console.log(JSON.stringify({completed:key,exitCode:code}))
})})
