import {chromium} from 'playwright'
import {writeFileSync} from 'node:fs'
const base=process.argv[2],out='/workspace/fangkun/evidence/fieldwork-v4/browser/model-diagnostic.json'
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const context=await browser.newContext({viewport:{width:820,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[]
await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort())
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,1200))});page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.url().includes('/demo3d/'))requests.push({path:new URL(r.url()).pathname,status:r.status(),type:r.headers()['content-type']})})
let result
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:90000});await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000})
 result=await page.evaluate(async()=>{
  const started=performance.now();try{
   const V=await import('/demo3d/viewer3d.js'),M=await import('/demo3d/motions.js')
   const panel=document.createElement('div');panel.style.cssText='position:fixed;inset:40px 20px;z-index:100;background:#171a1e';document.body.appendChild(panel)
   const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%';panel.appendChild(canvas)
   const stage=await V.createStage(canvas,M.default.pushup,{hi:V.muscleIndexFor(['chest','triceps'],['delt_front']),capture:true});stage.setView('three')
   window.__fieldworkDiagnosticStage=stage;return {ok:true,elapsedMs:performance.now()-started}
  }catch(e){return {ok:false,elapsedMs:performance.now()-started,error:String(e),stack:e?.stack}}
 })
 await page.waitForTimeout(800);await page.screenshot({path:'/workspace/screenshots/fangkun-fieldwork-v4/model-diagnostic.png'})
}catch(e){result={ok:false,error:String(e)}}
await context.close();await browser.close();writeFileSync(out,JSON.stringify({result,errors,requests},null,2));console.log(JSON.stringify({result,errors}));if(!result?.ok)process.exitCode=1
