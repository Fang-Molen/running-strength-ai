// Run every package test group once, retaining later failures even if an earlier group fails.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const out=process.env.R8_REGRESSION_DIR??resolve('..','r8-regression');mkdirSync(out,{recursive:true});
const commands=JSON.parse(readFileSync('package.json','utf8')).scripts.test.split(' && '),results=[];
for(const [group,command] of commands.entries()){
 const started=Date.now(),r=spawnSync('bash',['-c',command],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,env:{...process.env,NODE_OPTIONS:'--import '+resolve('evaluation/deepseek-development/no-network.mjs')}});
 const log=(r.stdout??'')+(r.stderr??'');writeFileSync(resolve(out,`group-${group}.log`),log);
 const count=kind=>[...log.matchAll(new RegExp('(?:ℹ |# )'+kind+' (\\d+)','g'))].reduce((n,m)=>n+Number(m[1]),0);
 results.push({group,command,exit:r.status,pass:count('pass'),fail:count('fail'),ms:Date.now()-started,error:r.error?.message??null});writeFileSync(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(results.at(-1));
}
process.exitCode=results.some(r=>r.exit!==0)?1:0;
