// Actual app UI -> HTTP controller -> isolated SQL -> synthetic provider. No paid calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const api='http://127.0.0.1:8094',checks=[],errors=[],requests=[],responses=[],shots=[];
try {
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
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
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080/');
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
 assert.ok((await page.locator('body').innerText()).includes('常用CR10'));
 assert.ok((await page.locator('body').innerText()).includes('反复机械张力'));
 checks.push('Two normal questions automatically run concurrently and both answers remain; no per-question consent');
 await page.getByTestId('coach-status-row').locator(':scope > summary').click();
 await page.getByRole('checkbox',{name:'联网分析',exact:true}).uncheck();
 await until(async()=>(await status()).grantRows.some(r=>r.enabled===false),'durable OFF');
 const offCount=(await status()).providerCalls;
 await ask('请解释RIR和RPE的区别');
 assert.equal((await status()).providerCalls,offCount);
 await page.reload();
 await page.evaluate(async()=>{(await import('/src/lib/coach/r5/scope.ts')).bindR5Session('alice')});
 await page.getByRole('button',{name:'切换到方坤',exact:true}).click();
 await page.getByTestId('coach-status-row').locator(':scope > summary').click();
 assert.equal(await page.getByRole('checkbox',{name:'联网分析',exact:true}).isChecked(),false);
 checks.push('OFF persists across reload and account grant is revoked; offline question makes no provider call');
 await page.getByRole('checkbox',{name:'联网分析',exact:true}).check();
 await until(async()=>!(await page.getByRole('checkbox',{name:'联网分析',exact:true}).isDisabled()),'enable saved');
 await mode('normal');
 await ask('我的腘绳肌现在疼，解释一下RPE');
 await until(async()=>await page.locator('[data-testid="coach-online-request"]').count()===0,'mixed symptoms knowledge reply');
 await until(async()=>(await status()).providerCalls>offCount,'mixed symptoms online');
 assert.ok((await page.locator('body').innerText()).includes('常用CR10'));
 checks.push('Current personal pain does not swallow independent RPE education');
 const beforeCycle=(await status()).providerCalls;
 await ask('请生成未来八周训练计划');
 await until(async()=>(await status()).providerCalls>beforeCycle,'cycle explanation automatically online');
 await until(async()=>await page.locator('[data-testid="coach-online-request"]').count()===0,'cycle answer');
 const beforeWeekly=(await status()).providerCalls;
 await ask('本周总结');
 await until(async()=>(await status()).providerCalls>beforeWeekly,'weekly explanation automatically online');
 await until(async()=>await page.locator('[data-testid="coach-online-request"]').count()===0,'weekly answer');
 checks.push('Cycle and weekly draft explanations also automatically run online without executing formal plans');
 const ids=await page.evaluate(async()=>{
  const events=await import('/src/lib/core/events.ts'),occ=await import('/src/lib/core/occurrence.ts');
  const result=[];
  for(const [index,weight]of [40,50,90].entries()){
   const id='synthetic-lift-'+index,plan={id,name:'合成力量'+index,moves:[{id:'squat',catalogId:'back-squat',customName:'',sets:1,mode:'reps',amount:5,restSec:90,weightKg:weight}]};
   const start=events.dispatchEvent('TRAINING_STARTED',{sessionId:id});
   if(!start)throw Error('synthetic start failed');
   occ.bindTrainingStart({startEventId:start.event_id,startedAt:start.timestamp,sessionId:id,planSlotId:id,plan});
   events.dispatchEvent('TRAINING_SET_COMPLETED',{sessionId:id,trainingOccurrenceId:start.event_id,moveId:'squat',catalogId:'back-squat',setIndex:1,completed:true,skipped:false,actualAmount:5,actualWeight:weight});
   const end=events.dispatchEvent('TRAINING_COMPLETED',{sessionId:id,trainingOccurrenceId:start.event_id,setsCompleted:1});
   if(!end)throw Error('synthetic completion failed');occ.closeTrainingOccurrence(end);result.push(start.event_id);
  }
  window.dispatchEvent(new Event('fk-training-corrected'));return result;
 });
 await page.getByTestId('coach-record-binding').locator(':scope > summary').click();
 await page.getByLabel('比较第一节',{exact:true}).selectOption(ids[0]);
 await page.getByLabel('比较第二节',{exact:true}).selectOption(ids[1]);
 const compare='比较这两节力量训练，有什么变化？';
 await ask(compare);
 await until(async()=>responses.some(r=>r.path==='/api/coach-chat'&&r.method==='POST'&&r.status===200&&requests.some(q=>q.body?.question===compare))&&await page.getByTestId('coach-online-request').count()===0,'selected comparison answer');
 const selectedRequest=requests.find(r=>r.path==='/api/coach-snapshot'&&r.body?.question===compare);
 assert.ok(selectedRequest,'selected sessions reach the snapshot API');
 const loads=selectedRequest.body.context.records.flatMap(r=>r.fields).filter(f=>f.name==='load').map(f=>f.value);
 assert.ok(loads.includes(40)&&loads.includes(50),JSON.stringify(selectedRequest.body.context));assert.ok(!loads.includes(90));
 const staleBefore=await page.getByTestId('online-answer-stale').count();
 const corrected=await page.evaluate(async id=>{
  const m=await import('/src/lib/core/training-correction.ts');
  const result=m.appendCorrection({trainingOccurrenceId:id,kind:'FIELD',field:'weight',setKey:m.strengthSetKey('squat',1),originalValue:'40',newValue:'45',reason:'合成验收：修正记录重量'});
  window.dispatchEvent(new Event('fk-training-corrected'));return !!result;
 },ids[0]);
 assert.equal(corrected,true);
 await until(async()=>await page.getByTestId('online-answer-stale').count()>staleBefore,'dependent answer stale');
 const updated=await page.evaluate(async({question,ids})=>(await import('/src/lib/coach/online-session.ts')).prepareOnlineExplanation(question,ids).context,{question:compare,ids:ids.slice(0,2)});
 const updatedLoads=updated.records.flatMap(r=>r.fields).filter(f=>f.name==='load').map(f=>f.value);
 assert.ok(updatedLoads.includes(45)&&!updatedLoads.includes(40));
 checks.push('Actual selected training IDs reach the online facts (40/50 kg; unrelated 90 kg excluded); correction to 45 kg marks dependent answer stale and refreshes context');
 await page.screenshot({path:new URL('screenshots/desktop.png',import.meta.url).pathname,fullPage:true});shots.push('screenshots/desktop.png');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:new URL('screenshots/mobile.png',import.meta.url).pathname,fullPage:true});shots.push('screenshots/mobile.png');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 assert.equal(overflow,false,'mobile must not overflow');assert.deepEqual(errors,[]);
 checks.push('Desktop/mobile actual app renders without uncaught page errors or horizontal overflow');
 await writeFile(new URL('result.json',import.meta.url),JSON.stringify({status:'PASS',scope:'Synthetic identity/database/provider; actual app, HTTP and browser; no real model',checks,errors,requests,responses,shots,server:await status()},null,2));
 console.log(JSON.stringify({status:'PASS',checks}));
} catch(e){await writeFile(new URL('failure.json',import.meta.url),JSON.stringify({error:String(e),checks,errors,requests,responses},null,2));throw e}
finally {await browser.close()}
