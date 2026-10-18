import {spawn} from 'node:child_process'
import {openSync,closeSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs'
const base=process.argv[2],label=process.argv[3]||'prod',out=process.env.FK_EVIDENCE_DIR||'/workspace/fangkun/evidence/fieldwork-v4'
mkdirSync(out,{recursive:true});const runs=[]
for(const script of ['browser.mjs','browser-player.mjs']){
 const log=`${out}/${label}-${script.replace('.mjs','')}-final.log`,fd=openSync(log,'w'),startedAt=new Date().toISOString()
 const result=await new Promise(resolve=>{
  const child=spawn(process.execPath,[`evaluation/fieldwork-v4/${script}`,base,label],{stdio:['ignore',fd,fd]})
  const timer=setTimeout(()=>child.kill('SIGTERM'),300000)
  child.once('error',error=>{clearTimeout(timer);resolve({exitCode:null,error:String(error)})})
  child.once('exit',(exitCode,signal)=>{clearTimeout(timer);resolve({exitCode,signal})})
 });closeSync(fd)
 runs.push({script,startedAt,finishedAt:new Date().toISOString(),log,...result});writeFileSync(`${out}/${label}-browser-runs.json`,JSON.stringify(runs,null,2))
 console.log(JSON.stringify(runs.at(-1)))
}
const receipts=['browser/'+label+'.json','browser/'+label+'-player.json'].map(file=>{try{return JSON.parse(readFileSync(`${out}/${file}`,'utf8'))}catch{return null}})
const ok=runs.every(r=>r.exitCode===0)&&receipts.every(r=>r&&r.errors.length===0&&r.results.every(t=>t.status==='PASS'))
console.log(JSON.stringify({ok,runs:runs.length}));if(!ok)process.exitCode=1
