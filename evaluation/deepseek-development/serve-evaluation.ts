/** Local evaluation server: pinned Gate identity or explicit OS-owned synthetic capability. No App identity issuance, automatic dispatch or retries. */
import {createServer} from 'node:http'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createLocalJWKSet} from 'jose'
import {PGlite} from '@electric-sql/pglite'
import {createPgliteTransactionAdapter} from '../../src/lib/coach/deepseek-ledger.server'
import {createEvaluationStore,createEvaluationService,evaluationSchema,sha,type EvaluationApproval} from '../../server/coach-deepseek/evaluation-service'
import {prepareAB} from './prepare-chain-ab'
import {modelFixtures,PAID_SUBSET,PILOT_CASES} from './model-fixtures'
import {verifyGateIdentityToken} from '../../src/lib/auth/gate-identity.server'
import {operatorAuthenticator,loadOperator,readOperatorToken,markOperatorLedgerInitialized} from '../../server/coach-deepseek/evaluation-operator'
import {blindExport} from './blind-export'
const flag=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(name+' required');return process.argv[i+1]}
const path=resolve(flag('--state-dir')),approval=JSON.parse(readFileSync(flag('--approval'),'utf8')) as EvaluationApproval
if(!process.env.DEEPSEEK_API_KEY)throw Error('SERVER_DEEPSEEK_KEY_NOT_ATTACHED')
const localOperator=process.argv.includes('--local-synthetic-operator'),registry=localOperator?resolve(flag('--registry-dir')):null
let gate: {issuer:string;audience:string;getKey:ReturnType<typeof createLocalJWKSet>}|null=null
let operatorAuthenticate:ReturnType<typeof operatorAuthenticator>|undefined
if(localOperator){const grant=loadOperator(path,registry!);if(grant.ownerId!==approval.ownerId||grant.campaignId!==approval.campaignId||grant.manifestHash!==approval.manifestHash||grant.rubricHash!==approval.rubricHash)throw Error('OPERATOR_APPROVAL_SCOPE');operatorAuthenticate=operatorAuthenticator(path,registry!)}else{
 if(!process.env.FANGKUN_EVAL_ISSUER||!process.env.FANGKUN_EVAL_AUDIENCE)throw Error('TRUSTED_GATE_CONFIGURATION_REQUIRED')
 const jwks=JSON.parse(readFileSync(flag('--public-jwks'),'utf8'));if(!Array.isArray(jwks.keys)||!jwks.keys.length||jwks.keys.some((k:any)=>k.d||k.k||k.kty!=='OKP'||k.crv!=='Ed25519'||k.alg&&k.alg!=='EdDSA'))throw Error('PUBLIC_EDDSA_KEYS_ONLY')
 gate={issuer:process.env.FANGKUN_EVAL_ISSUER,audience:process.env.FANGKUN_EVAL_AUDIENCE,getKey:createLocalJWKSet(jwks)}
}
const rubricBytes=readFileSync(new URL('./scoring-frozen.json',import.meta.url)),rubric=JSON.parse(rubricBytes.toString())
// Digest file hashes bytes; approval binds the parsed rubric in addition to the specimen manifest.
const requests=prepareAB(modelFixtures(),approval.policy.model,{caseIds:PAID_SUBSET})
if(requests.blocked.length||approval.rubricHash!==sha(rubric))throw Error('FROZEN_RUBRIC_OR_REQUESTS_MISMATCH')
mkdirSync(path,{recursive:true,mode:0o700});const pg=new PGlite(path+'/ledger'),db=createPgliteTransactionAdapter(pg)
await pg.exec(readFileSync(new URL('../../migrations/coach/001_deepseek_budget.sql',import.meta.url),'utf8'));await pg.exec(evaluationSchema)
const store=createEvaluationStore(db);await store.install(approval,requests.requests,PILOT_CASES);if(localOperator)markOperatorLedgerInitialized(path)
const samples=await store.samples(approval.campaignId);writeFileSync(path+'/private-dispatch-order.json',JSON.stringify(samples.map(s=>({sampleId:s.sampleId,caseId:s.caseId,arm:s.arm,phase:s.phase})),null,2),{mode:0o600})
if(process.argv.includes('--export')){const receipts=await store.receipts(approval.campaignId),blind=blindExport(receipts,samples,rubric);writeFileSync(path+'/reviewer-only.json',JSON.stringify(blind.reviewerSheets,null,2));writeFileSync(path+'/private-unblinding.json',JSON.stringify(blind.privateMapping,null,2),{mode:0o600});writeFileSync(path+'/private-provider-receipts.json',JSON.stringify(receipts,null,2),{mode:0o600});await pg.close();process.exit(0)}
if(process.argv.includes('--review-pilot')){const digest=flag('--review-pilot');const identity=operatorAuthenticate?await operatorAuthenticate(new Request('http://127.0.0.1/evaluation/review',{headers:{authorization:'Bearer '+readOperatorToken(path)}})):await verifyGateIdentityToken(process.env.FANGKUN_EVAL_BEARER??'',gate!);if(identity?.sub!==approval.ownerId)throw Error('TRUSTED_OPERATOR_REVIEW_REQUIRED');await store.reviewPilot(approval.campaignId,approval.ownerId,digest);await pg.close();process.exit(0)}
const service=createEvaluationService({store,db,...(gate??{}),operatorAuthenticate,apiKey:process.env.DEEPSEEK_API_KEY})
const server=createServer(async(req,res)=>{if(req.url!=='/evaluation/dispatch'||req.method!=='POST'){res.writeHead(404);res.end();return}const parts:Buffer[]=[];let n=0;for await(const part of req){n+=part.length;if(n>1024){res.writeHead(413);res.end();return}parts.push(part)}const request=new Request('http://127.0.0.1:8794/evaluation/dispatch',{method:'POST',headers:{authorization:String(req.headers.authorization??''),'content-type':'application/json'},body:Buffer.concat(parts)});try{const reply=await service(request);res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text())}catch{res.writeHead(500);res.end('{"error":"SERVER_ERROR"}')}})
server.listen(8794,'127.0.0.1',()=>console.log('Authenticated evaluation server ready; no provider calls dispatched'))
process.on('SIGINT',()=>{server.close();void pg.close()})
