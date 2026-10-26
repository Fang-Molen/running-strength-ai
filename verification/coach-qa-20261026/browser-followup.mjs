import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const control=async(p,b)=>{const r=await fetch('http://127.0.0.1:8092'+p,{...(b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{})});assert.ok(r.ok);return r.json()};
const {token}=await control('/__test/session',{subject:'alice'});await control('/__test/provider',{mode:'delayed'});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});let apiCalls=0;
 await context.route('**/api/garmin/status',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));
 await context.route('**/api/coach-*',async route=>{apiCalls++;const q=route.request(),headers={...q.headers(),origin:'http://127.0.0.1:8080','x-grok-identity':token};delete headers.host;const response=await context.request.fetch('http://127.0.0.1:8092'+new URL(q.url()).pathname,{method:q.method(),headers,...(q.postData()?{data:q.postData()}:{}),timeout:40000});await route.fulfill({response})});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8081/');await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor();await page.getByRole('button',{name:'先逛逛',exact:true}).click();await page.getByRole('button',{name:'切换到方坤',exact:true}).click();
 const update=async recovery=>page.evaluate(recovery=>{const now=new Date();localStorage.setItem('fk-checkin-v1',JSON.stringify([{athleteId:'local',date:now.toISOString().slice(0,10),at:new Date(now.valueOf()-1000).toISOString(),sleep:7,recovery,recoveryScale:10,pain:'none'}]));window.dispatchEvent(new Event('fk-health-changed'))},recovery);
 const send=async q=>{await page.getByRole('textbox',{name:'输入你的问题',exact:true}).fill(q);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForTimeout(300)};
 await update(6);await send('现在的训练反馈该如何理解？');await page.getByRole('button',{name:'核对资料并联网解释',exact:true}).click();await page.getByRole('button',{name:'同意发送这些资料',exact:true}).click();
 for(let i=0;i<40;i++){if((await control('/__test/status')).pending)break;await page.waitForTimeout(100)}assert.equal((await control('/__test/status')).pending,1);
 await update(5);await control('/__test/release',{});await page.waitForTimeout(1000);
 const afterCorrection=await page.getByTestId('coach-messages').innerText();assert.doesNotMatch(afterCorrection,/【联网模型解释】/);assert.match(await page.getByTestId('coach-request-notice').innerText(),/取消|变化/);
 const calls=apiCalls;await context.setOffline(true);await send('请给我解释轻松跑是什么。');const offline=await page.getByTestId('coach-messages').innerText();assert.match(offline,/轻松跑是以轻松活动为目的/);assert.equal(apiCalls,calls);assert.deepEqual(errors,[]);
 await writeFile('verification/coach-qa-20261026/browser-followup-results.json',JSON.stringify({synthetic:true,provider:'mocked; actual handler and signed identity',cases:['correction_while_pending','offline_general_answer'],afterCorrection,offline,additionalOfflineApiCalls:apiCalls-calls,errors},null,2));
 console.log(JSON.stringify({ok:true,cases:2,errors}));await context.close();
}finally{await browser.close()}
