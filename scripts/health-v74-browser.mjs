import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const base=process.argv[2]||'http://127.0.0.1:8096',mode=process.argv[3]||'dev'
const out=resolve('../evidence'),screens='/workspace/screenshots/fangkun-v74-ui-20261017';mkdirSync(out,{recursive:true});mkdirSync(screens,{recursive:true})
const results=[],errors=[],posts=[];let browser,page
function check(name,ok,detail=''){results.push({name,status:ok?'PASS':'FAIL',detail});console.log(ok?'PASS':'FAIL',name);if(!ok)throw Error(name+': '+detail)}
const shot=name=>page.screenshot({path:resolve(screens,`${mode}-${name}.png`),fullPage:true,animations:'disabled'})
try{
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'})
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 await context.addInitScript(()=>{
  localStorage.setItem('fk-onboard-v1','1'); if(localStorage.getItem('v74-synthetic-seeded'))return
  const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const observation={key:'synthetic-sleep',sourceId:'synthetic-watch',statistic:'夜间总时长',syncedAt:now.toISOString()}
  localStorage.setItem('fr255-vitals-v1',JSON.stringify({schemaVersion:1,records:[{id:'synthetic-vital',kind:'SLEEP',value:7.25,unit:'hours',observedOn:day,observedAt:null,source:'DEVICE_CONFIRMED',note:'合成测试手表',hrvMethod:null,createdAt:now.toISOString(),observation}]}))
  localStorage.setItem('v74-synthetic-seeded','yes')
 })
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())})
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await page.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:120000});await page.locator('[data-testid="training-app"]').waitFor({timeout:120000})
 if(mode==='prod'){
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:60000})
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:120000});await page.locator('[data-testid="training-app"]').waitFor()
 }
 check('mobile home renders',await page.locator('body').innerText().then(t=>t.length>100));check('mobile no overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('home-mobile')
 const plan=await page.evaluate(()=>localStorage.getItem('fr255-strength-plan-v3'))
 await page.getByRole('button',{name:'打开方坤',exact:true}).click();await page.getByPlaceholder('输入你的问题').waitFor()
 const ask=async(q,pattern)=>{const bubbles=page.locator('[aria-label="方坤对话区"] .stat-run');const before=await bubbles.count();await page.getByPlaceholder('输入你的问题').fill(q);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(({p,n})=>{const a=document.querySelectorAll('[aria-label="方坤对话区"] .stat-run');return a.length>n&&new RegExp(p).test(a[a.length-1]?.innerText??'')},{p:pattern.source,n:before})}
 await ask('今天健康睡眠数据怎么样',/7小时15分/);check('UI answer uses actual sleep minutes',await page.getByLabel('方坤对话区').innerText().then(t=>/合成测试手表/.test(t)&&/研究候选/.test(t)));await shot('coach-health')
 await page.evaluate(()=>{const k='fr255-vitals-v1',v=JSON.parse(localStorage.getItem(k));v.records[0].value=6.75;v.records[0].observation.previous=[{value:7.25,syncedAt:v.records[0].observation.syncedAt}];v.records[0].observation.syncedAt=new Date().toISOString();localStorage.setItem(k,JSON.stringify(v))})
 await ask('今天睡眠更正后是多少',/6小时45分/);check('next question rereads corrected value',true)
 await context.setOffline(true);check('browser is offline',await page.evaluate(()=>navigator.onLine===false));await ask('今天健康数据再核对',/6小时45分/)
 check('offline answer completes',await page.getByRole('button',{name:'发送',exact:true}).isEnabled())
 if(mode==='prod'){
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});await page.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:120000});
  await page.getByRole('button',{name:'打开方坤',exact:true}).click();await page.getByPlaceholder('输入你的问题').waitFor();
  check('offline reload preserves corrected health and chat history',await page.getByLabel('方坤对话区').innerText().then(t=>/6小时45分/.test(t))&&await page.evaluate(()=>JSON.parse(localStorage.getItem('fr255-vitals-v1')).records[0].value===6.75));
  await ask('离线重新打开，今天健康睡眠怎么样',/6小时45分/)
 }else{await context.setOffline(false);await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:120000});await page.getByRole('button',{name:'打开方坤',exact:true}).click();check('reload retains health records',await page.evaluate(()=>JSON.parse(localStorage.getItem('fr255-vitals-v1')).records[0].value===6.75))}
 await ask('我现在胸痛喘不上气，还能训练吗',/急救|急诊/);check('emergency overrides daily health interpretation',true);await shot('coach-emergency')
 check('formal plan unchanged',await page.evaluate(()=>localStorage.getItem('fr255-strength-plan-v3'))===plan)
 check('no model or other POST requests',posts.length===0,JSON.stringify(posts));check('no browser runtime errors',errors.length===0,JSON.stringify(errors))
 await context.setOffline(false);await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'关闭方坤',exact:true}).click();await page.getByRole('button',{name:'切换到今日',exact:true}).click();check('desktop renders without overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('home-desktop')
}catch(e){if(!results.some(r=>r.status==='FAIL'))results.push({name:'execution',status:'FAIL',detail:String(e.stack||e)});try{await shot('failure')}catch{}process.exitCode=1}
finally{writeFileSync(resolve(out,`browser-${mode}.json`),JSON.stringify({mode,results,errors,posts,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length},scope:'Synthetic fresh browser context; not real Garmin, iPhone or all v74 UI acceptance'},null,2));await browser?.close()}
