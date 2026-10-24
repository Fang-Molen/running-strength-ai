import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
test('standalone bootstrap works without external App identity, makes GET models only and preserves unknown-history hold',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fk-bootstrap-'))
 try{
  const mock=join(dir,'transport.mjs'),trace=join(dir,'trace.jsonl');writeFileSync(mock,`import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,init)=>{appendFileSync(${JSON.stringify(trace)},JSON.stringify({url,method:init?.method??'GET'})+'\\n');if(url!=='https://api.deepseek.com/models'||(init?.method??'GET')!=='GET')throw Error('NO_GENERATION_ALLOWED');return Response.json({data:[{id:'deepseek-flash'}]})}`)
  const auth=join(dir,'authorization.json'),history=join(dir,'history.json'),state=join(dir,'state'),registry=join(dir,'registry');writeFileSync(auth,JSON.stringify({currency:'USD',pilotCallsMax:4,pilotCostMax:'0.02',campaignCallsMax:26,campaignCostMax:'0.10',automaticRetries:0,pilotIncludedIn26:true}));writeFileSync(history,JSON.stringify({priorGenerationCalls:0,unknownPriorCalls:true,source:'Unresolved synthetic test history'}))
  const args=['--state-dir',state,'--registry-dir',registry,'--authorization',auth,'--history-evidence',history,'--confirm-current-price','--confirm-first-run']
  const invoke=(extra:string[]=[])=>spawnSync(process.execPath,['--import',mock,'--import','./scripts/test-register.mjs','evaluation/deepseek-development/bootstrap-evaluation.ts',...args,...extra],{encoding:'utf8',timeout:120000,env:{...process.env,DEEPSEEK_API_KEY:'synthetic-test-only',FANGKUN_EVAL_ISSUER:'',FANGKUN_EVAL_AUDIENCE:'',FANGKUN_EVAL_BEARER:''}})
  const rejected=invoke();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/HISTORY_ZERO_ATTESTATION_REQUIRED/);assert.ok(!existsSync(join(state,'approved.json')))
  writeFileSync(history,JSON.stringify({priorGenerationCalls:0,unknownPriorCalls:false,source:'Confirmed first-ever generation for synthetic test campaign'}));const accepted=invoke();assert.equal(accepted.status,0,accepted.stderr);const approved=JSON.parse(readFileSync(join(state,'approved.json'),'utf8'));assert.equal(approved.ownerId,'local-synthetic-operator-uid-'+process.getuid!());assert.equal(approved.policy.caps.campaignCostMicros,'100000');assert.equal(approved.pilotCostMicros,'20000');assert.ok(!accepted.stdout.includes(readFileSync(join(state,'operator-token'),'utf8')));assert.ok(!accepted.stdout.includes('synthetic-test-only'))
  const resumed=invoke(['--resume']);assert.equal(resumed.status,0,resumed.stderr);assert.equal(readFileSync(join(state,'approved.json'),'utf8'),JSON.stringify(approved,null,2));assert.equal(readFileSync(trace,'utf8').trim().split('\n').length,3)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
