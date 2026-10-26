import test from 'node:test'
import assert from 'node:assert/strict'
import { readCoachResponse, coachServiceInfo, coachServiceStatusText } from './online-service.ts'
test('HTML fallback and 404 identify missing API instead of reporting HTTP 200 success', async () => {
  for (const status of [200,404]) {
    const value=await readCoachResponse(new Response('<html>App shell</html>',{status,headers:{'content-type':'text/html'}}))
    assert.ok('error' in value); assert.match(value.error,/接口|部署/)
  }
})
test('untrusted error payload never reaches rendering as an object', async () => {
  const value=await readCoachResponse(Response.json({error:{secret:'internal'}},{status:502}))
  assert.ok('error' in value); assert.equal(typeof value.error,'string'); assert.doesNotMatch(value.error,/secret/)
})
test('known provider errors yield actionable safe messages; arbitrary provider text is hidden', async () => {
  const value=await readCoachResponse(Response.json({code:'PROVIDER_BALANCE',error:'private diagnostic'},{status:502}))
  assert.ok('error' in value); assert.match(value.error,/余额/); assert.doesNotMatch(value.error,/private/)
})
test('configuration probe sends no personal data and does not claim connectivity', async t => {
  t.mock.method(globalThis,'fetch',async (url: RequestInfo | URL,init?: RequestInit)=>{
    assert.equal(url,'/api/coach-chat'); assert.equal(init?.method,'GET'); assert.equal(init?.body,undefined)
    return Response.json({service:'fangkun-coach',configured:true,connectionVerified:false,webSearch:false,model:'deepseek-flash'})
  })
  const status=await coachServiceInfo(); assert.equal(status.state,'configured')
  assert.match(coachServiceStatusText(status),/未验证/)
})
test('a static app response is not mistaken for configured DeepSeek',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>app</html>',{headers:{'content-type':'text/html'}}))
  assert.equal((await coachServiceInfo()).state,'missing-route')
})
test('success requires the trusted response contract and bounded text',async()=>{
 for(const body of [{text:'回答'},{ok:false,text:'回答',planChanged:false},{ok:true,text:'回答',planChanged:true},{ok:true,text:'a'.repeat(1001),planChanged:false}]) assert.ok('error' in await readCoachResponse(Response.json(body)))
 assert.deepEqual(await readCoachResponse(Response.json({ok:true,text:'回答',planChanged:false})),{text:'回答'})
})
test('trusted binding failure is configuration failure rather than network failure',async()=>{
 const value=await readCoachResponse(Response.json({ok:false,error:'TRUSTED_BINDINGS_MISSING'},{status:503}))
 assert.ok('error' in value); assert.match(value.error,/授权.*快照|快照.*授权/)
})

test('prototype property names cannot become rendered error objects',async()=>{
 for(const error of ['constructor','__proto__','toString']){const result=await readCoachResponse(Response.json({error},{status:503}));assert.ok('error' in result);assert.equal(typeof result.error,'string')}
})
test('successful rule processing is distinct from a provider-generated answer',async()=>{
 assert.deepEqual(await readCoachResponse(Response.json({ok:true,text:'规则分析',planChanged:false,route:'LOCAL',model:null})),{text:'规则分析',source:'LOCAL'})
 assert.deepEqual(await readCoachResponse(Response.json({ok:true,text:'模型解释',planChanged:false,route:'LOW',model:'synthetic-model'})),{text:'模型解释',source:'MODEL',model:'synthetic-model'})
})
