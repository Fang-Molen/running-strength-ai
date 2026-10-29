// Actual app UI -> HTTP controller -> isolated SQL -> synthetic provider. No paid calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
let page;const hmrSuppressed=[];const head=readFileSync('.git/HEAD','utf8').trim(),candidateCommit=head.startsWith('ref: ')?readFileSync('.git/'+head.slice(5),'utf8').trim():head;
const api='http://127.0.0.1:8094',checks=[],errors=[],requests=[],responses=[],shots=[];
try {
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 await context.routeWebSocket('**/*',socket=>{const server=socket.connectToServer();server.onMessage(message=>{let payload;try{payload=JSON.parse(String(message))}catch{}if(payload?.type==='full-reload'){hmrSuppressed.push(payload);return;}socket.send(message)});socket.onMessage(message=>server.send(message));});
 const session=await (await context.request.post(api+'/__test/session',{data:{subject:'alice'}})).json();
 await context.request.post(api+'/api/coach-snapshot',{headers:{'x-grok-identity':session.token,origin:'http://127.0.0.1:8080'},data:{onlineConsent:{enabled:true,disclosureVersion:'coach-self-report-v1'}}});
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();
  if(['/api/coach-snapshot','/api/coach-chat'].includes(u.pathname)){
   requests.push({path:u.pathname,method:req.method(),body:req.postDataJSON()});
   // Emulate the gateway transport; the real server still verifies this locally signed identity.
   const res=await context.request.fetch(api+u.pathname,{method:req.method(),headers:{...req.headers(),origin:'http://127.0.0.1:8080','x-grok-identity':session.token},...(req.postData()?{data:req.postData()}:{}),timeout:45000});
   responses.push({path:u.pathname,method:req.method(),status:res.status(),body:await res.json()});
   return route.fulfill({response:res});
  }
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  return route.continue();
 });
 await context.addInitScript(token=>{localStorage.setItem('fk-onboard-skipped-v1','1');sessionStorage.setItem('grok-auth.bearer-token',token)},session.token);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080/',{waitUntil:'networkidle'});
 await page.evaluate(async()=>{(await import('/src/lib/coach/r5/scope.ts')).bindR5Session('alice')});
 await page.getByRole('button',{name:'切换到方坤',exact:true}).click();
 const ask=async question=>{await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(question);await page.getByRole('button',{name:'发送',exact:true}).click()};
 const status=async()=>await (await context.request.get(api+'/__test/status')).json();
 const mode=async mode=>{await context.request.post(api+'/__test/provider',{data:{mode}})};
 const until=async(check,label)=>{for(let n=0;n<100;n++){if(await check())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label)};
 await mode('delayed');
 const before=(await status()).providerCalls;
 await ask('我没有腿疼，解释一下RPE');
 await until(async()=>(await status()).pending===1,'first automatic call');
 await ask('一般力量训练为什么会引起肌肉适应？');
 await until(async()=>(await status()).pending===2,'independent second call');
 await context.request.post(api+'/__test/release',{data:{}});
 await until(async()=>(await page.locator('[data-testid="coach-online-request"]').count())===0,'both replies');
 assert.equal((await status()).providerCalls-before,2);
 assert.ok((await status()).maxActiveProvider>=2);
 await writeFile(new URL('dom-before-assert.txt',import.meta.url),await page.locator('body').innerText());
 assert.ok((await page.locator('body').innerText()).includes('常用CR10'));
 assert.ok((await page.locator('body').innerText()).includes('反复机械张力'));
 checks.push('Two normal questions automatically run concurrently and both answers remain; no per-question consent');
 await writeFile(new URL('before-status-geometry.json',import.meta.url),JSON.stringify(await page.evaluate(()=>{const e=document.querySelector('[data-testid=coach-status-row] summary');const r=e?.getBoundingClientRect();return {active:document.activeElement?.tagName,box:r?.toJSON(),hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML:null}}),null,2));
 await page.screenshot({path:'/workspace/screenshots/validation-v1/flow/before-status.png',fullPage:false});
 const viewportChecks=[];
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});
  for(const font of ['100%','200%']){
   await page.evaluate(font=>document.documentElement.style.fontSize=font,font);
   await page.getByTestId('coach-gated-answer').first().waitFor({state:'visible'});
   assert.ok(await page.getByTestId('coach-answer-validation').count()>0);
   assert.equal(await page.getByRole('button',{name:'打开快捷记录',exact:true}).count(),0,'floating quick entry must not obstruct coach input');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
   assert.equal(overflow,false,'viewport must not overflow');
   viewportChecks.push({width,font,horizontalOverflow:overflow,validatedMessages:await page.getByTestId('coach-answer-validation').count(),mainAnswerVisible:await page.getByTestId('coach-gated-answer').first().isVisible()});
   await page.screenshot({path:'/workspace/screenshots/validation-v1/flow/width-'+width+'-font-'+font.replace('%','')+'.png',fullPage:false});
  }
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='100%');
 await page.setViewportSize({width:390,height:844});
 const validatedBefore=await page.getByTestId('coach-gated-answer').count(),callsBefore=(await status()).providerCalls;
 await mode('delayed');const qa='解释一下RPE概念，取消这轮测试。',qb='一般力量适应需要什么条件？';
 await ask(qa);await until(async()=>(await status()).pending===1,'cancel A pending');
 await ask(qb);await until(async()=>(await status()).pending===2,'B independent pending');
 await page.getByTestId('coach-online-request').filter({hasText:qa}).getByRole('button',{name:'取消本轮联网',exact:true}).click();
 await context.request.post(api+'/__test/release',{data:{}});
 await until(async()=>await page.getByTestId('coach-gated-answer').count()===validatedBefore+1,'B delivered without cancelled A');
 assert.equal(await page.getByTestId('coach-online-request').count(),0);
 await context.setOffline(true);await context.setOffline(false);await page.waitForTimeout(500);
 assert.equal((await status()).providerCalls-callsBefore,2,'cancel/reconnect cannot auto-retry');
 assert.equal(await page.getByTestId('coach-gated-answer').count(),validatedBefore+1);
 checks.push('A and B dispatch independently; cancel A, release late replies, deliver B only; reconnect makes no retry or additional write');
 await writeFile(new URL('targeted-result.json',import.meta.url),JSON.stringify({candidate_commit:candidateCommit,scope:'actual App + synthetic HTTP/SQL/provider; no real model or remote search',checks,errors,hmrSuppressed,viewportChecks,api:await status(),limitations:['Virtual font/viewport checks; physical mobile keyboard, IME and real wearable acceptance not performed.']},null,2));
 console.log(JSON.stringify({checks,viewportChecks,errors}));
} catch(e){await page.screenshot({path:'/workspace/screenshots/validation-v1/flow/failure.png',fullPage:false}).catch(()=>{});await writeFile(new URL('geometry.json',import.meta.url),JSON.stringify(await page.evaluate(()=>{const e=document.querySelector('[data-testid=coach-status-row] summary');const r=e?.getBoundingClientRect();return {active:document.activeElement?.tagName,classes:document.documentElement.className,box:r?.toJSON(),hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML:null}}),null,2)).catch(()=>{});await writeFile(new URL('failure.json',import.meta.url),JSON.stringify({error:String(e),checks,errors,requests,responses},null,2));throw e}
finally {await browser.close()}
