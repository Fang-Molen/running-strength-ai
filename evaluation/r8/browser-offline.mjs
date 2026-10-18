import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
const out='/workspace/screenshots/fangkun-r8-offline';mkdirSync(out,{recursive:true})
const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage']})
const c=await b.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'}),p=await c.newPage();p.setDefaultTimeout(90000)
const steps=[],errors=[];p.on('pageerror',e=>errors.push(String(e)))
const step=(name,ok,detail)=>{steps.push({name,ok,detail});console.log(JSON.stringify(steps.at(-1)))}
try{
 await p.goto('http://127.0.0.1:8081/',{waitUntil:'networkidle',timeout:120000})
 await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 await p.evaluate(()=>navigator.serviceWorker.ready)
 await p.waitForFunction(()=>!!navigator.serviceWorker.controller)
 await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 await p.getByRole('button',{name:'方坤'}).click();await p.getByPlaceholder('输入你的问题').waitFor()
 await p.screenshot({path:`${out}/online-mobile.png`})
 const cache=await p.evaluate(async()=>{const names=await caches.keys();return Promise.all(names.map(async name=>({name,urls:(await (await caches.open(name)).keys()).map(r=>r.url)})))})
 step('production_service_worker_controlled',true,{cache})
 await c.setOffline(true)
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.body.innerText.includes('今日训练')&&!document.body.innerText.includes('读取中'))
 step('offline_reload',true,{physicalPhone:false})
 await p.getByRole('button',{name:'方坤'}).click()
 await p.getByPlaceholder('输入你的问题').fill('我的目标是8周后400米跑进80秒')
 await p.getByRole('button',{name:'发送',exact:true}).click()
 await p.waitForFunction(()=>document.body.innerText.includes('400米本地认知分析'))
 const body=await p.locator('body').innerText();writeFileSync(`${out}/offline-body.txt`,body)
 step('offline_local_coach',body.includes('400米本地认知分析')&&body.includes('目标不当作完成事实'),{modelCalls:0})
 step('mobile_layout',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{viewport:'390x844'})
 await p.screenshot({path:`${out}/offline-mobile.png`})
}catch(e){step('ERROR',false,String(e));await p.screenshot({path:`${out}/error.png`}).catch(()=>{})}
finally{writeFileSync(`${out}/verdict.json`,JSON.stringify({steps,pageErrors:errors},null,2));await b.close()}
if(steps.some(s=>!s.ok)||errors.length)process.exitCode=1
