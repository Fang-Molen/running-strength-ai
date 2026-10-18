import {spawn} from 'node:child_process'
import {mkdirSync,openSync,writeFileSync} from 'node:fs'
const output=process.env.R188_EVIDENCE_DIR??'/workspace/fangkun/evidence/r188'
mkdirSync(output,{recursive:true})
const env={...process.env}
for(const key of ['XAI_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','DATABASE_URL'])delete env[key]
env.PATH=process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+env.PATH
const receipt={node:process.version,startedAt:new Date().toISOString(),commands:[],externalModelsAuthorized:false,fullChainPassed:false}
const save=()=>writeFileSync(`${output}/full-checks-final.json`,JSON.stringify(receipt,null,2)+'\n')
save()
for(const args of [['test'],['run','test:domain'],['run','typecheck'],['run','build']]){
 const label=args.join('-'),log=`${output}/${label}-final.log`,startedAt=new Date().toISOString(),fd=openSync(log,'w')
 const child=spawn('npm',args,{env,stdio:['ignore',fd,fd]})
 const exitCode=await new Promise(resolve=>{child.on('error',()=>resolve(127));child.on('exit',resolve)})
 receipt.commands.push({command:'npm '+args.join(' '),log,startedAt,finishedAt:new Date().toISOString(),exitCode});save()
 console.log(JSON.stringify(receipt.commands.at(-1)))
 if(exitCode!==0){receipt.finishedAt=new Date().toISOString();save();process.exitCode=1;break}
}
if(receipt.commands.length===4&&receipt.commands.every(c=>c.exitCode===0)){receipt.fullChainPassed=true;receipt.finishedAt=new Date().toISOString();save()}
