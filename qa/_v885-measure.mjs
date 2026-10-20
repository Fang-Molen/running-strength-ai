import {chromium} from 'playwright'
import {emulateSafeArea,overlayJs} from './_safe-emu.mjs'
const base=process.argv[2],tag=process.argv[3]||'x',dir=process.argv[4]||'/workspace/out/v88.5'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:2,timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true,serviceWorkers:'block'})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
await emulateSafeArea(ctx)
await ctx.addInitScript(()=>{localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1')});await ctx.addInitScript(overlayJs(59,34))
const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>console.log('PAGEERR',e.message))
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)
const m=()=>p.evaluate(()=>{const h=document.querySelector('.ui03-header');if(!h)return 'no header';const r=h.getBoundingClientRect(),cs=getComputedStyle(h);const t=h.querySelector('.ui03-title,h1,h2,b')?.getBoundingClientRect();const root=document.querySelector('[data-testid=training-app]');return JSON.stringify({headerTop:Math.round(r.top),headerH:Math.round(r.height),padTop:cs.paddingTop,bg:cs.backgroundColor,pos:cs.position,titleTop:t?Math.round(t.top):null,rootPadTop:getComputedStyle(root).paddingTop,bodyPadTop:getComputedStyle(document.body).paddingTop,scrollY:window.scrollY})})
for (const [tab,name] of [['今日','today'],['日志','log'],['健康','health'],['方坤','coach']]){
  await p.getByRole('button',{name:'切换到'+tab}).click();await p.waitForTimeout(1200)
  console.log(tab,await m())
  if(name==='log'||name==='today'){await p.evaluate(()=>window.scrollTo(0,500));await p.waitForTimeout(400)}
  if(name==='coach'){
    console.log('coach parts',await p.evaluate(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return [Math.round(b.top),Math.round(b.bottom)]};const m=document.querySelector('[data-testid=coach-messages]');return JSON.stringify({head:r('.ui03-header'),bar:r('.fk-coach-bar'),messages:r('[data-testid=coach-messages]'),msgPadTop:m&&getComputedStyle(m).paddingTop,firstChild:m&&m.firstElementChild?Math.round(m.firstElementChild.getBoundingClientRect().top):null,input:r('[data-testid=coach-messages] ~ * textarea, .fk-coach-sheet textarea, .fk-coach-sheet input[type=text]')})}))
    await p.screenshot({path:`${dir}/${tag}-coach-top-393.png`})
    await p.getByRole('button',{name:'学习'}).click().catch(()=>{});await p.waitForTimeout(800)
    await p.evaluate(()=>{const m=document.querySelector('[data-testid=coach-messages]');if(m)m.scrollTop=260});await p.waitForTimeout(400)}
  await p.screenshot({path:`${dir}/${tag}-${name}-393.png`})
  await p.evaluate(()=>window.scrollTo(0,0))
  if(name==='coach')await p.getByRole('button',{name:/关闭|返回/}).first().click().catch(()=>{})
}
await b.close()
