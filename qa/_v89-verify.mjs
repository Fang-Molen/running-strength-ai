// v89 验证（合成种子；Playwright Chrome 393×852，非真机）。安全区用 _safe-emu 注入（上 59 / 下 34）。
import {chromium} from 'playwright'
import {readFileSync} from 'node:fs'
import {emulateSafeArea,overlayJs} from './_safe-emu.mjs'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v89', seeded=process.argv[4]!=='noseed'
const seed=seeded?JSON.parse(readFileSync('/tmp/v89-seed.json','utf8')):null
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:2,timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true,serviceWorkers:process.env.QA_SW==='1'?'allow':'block'})
if(seeded){await ctx.clock.install({time:new Date('2026-10-20T15:30:00+08:00')})}
await emulateSafeArea(ctx,{top:59,bottom:34})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
await ctx.addInitScript(([s])=>{localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1');if(s){localStorage.setItem('fk-garmin-intraday-v1:local',JSON.stringify(s.intraday));localStorage.setItem('fr255-vitals-v1',JSON.stringify(s.vitals));localStorage.setItem('fk-pain-log-v1',JSON.stringify(s.pain))}},[seed])
await ctx.addInitScript(overlayJs(59,34))
const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>console.log('PAGEERR',e.message))
if(seeded)await p.clock.resume()
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)
await p.screenshot({path:dir+'/today-393.png'})
await p.getByRole('button',{name:'切换到健康'}).click();await p.waitForTimeout(1500);await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(300)
const hdr=await p.evaluate(()=>{const h=document.querySelector('.ui03-header');const r=h?.getBoundingClientRect();return r?{top:r.top,h:r.height,pos:getComputedStyle(h).position}:null});console.log('header',JSON.stringify(hdr))
await p.screenshot({path:dir+'/health-recovery-393.png'})
console.log('tiles:',(await p.getByTestId('h89-tiles').innerText()).replace(/\n/g,' | '))
console.log('reference band:',await p.getByTestId('h89-reference').count())
await p.evaluate(()=>{const e=document.querySelector('[data-testid=h89-trend]');window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-118)});await p.waitForTimeout(400)
await p.screenshot({path:dir+'/health-trend-393.png'})
await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await p.waitForTimeout(400)
await p.screenshot({path:dir+'/health-events-393.png'})
// 页面不应有第二个 header 漂在中间
console.log('headers:',await p.locator('.ui03-header').count())
await p.getByTestId('h89-muscle-entry').click();await p.waitForTimeout(1000)
await p.locator('canvas[data-ready=true]').waitFor({timeout:60000}).catch(()=>console.log('3D not ready'))
await p.waitForTimeout(1500)
await p.screenshot({path:dir+'/health-muscle-393.png'})
await p.getByRole('button',{name:'背面'}).click().catch(()=>{});await p.waitForTimeout(1200)
await p.screenshot({path:dir+'/health-muscle-back-393.png'})
const sc=p.locator('[data-testid="m89-cards"]');if(await sc.count()){await sc.evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(400);await p.screenshot({path:dir+'/health-muscle-cards-393.png'})}
await p.keyboard.press('Escape');await p.waitForTimeout(500)
for(const [n,f] of [['身体指标','body'],['睡眠','sleep'],['HRV','hrv'],['压力','stress']]){await p.locator('.fk-h89-tabs button',{hasText:n}).first().click();await p.waitForTimeout(700);await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(200);await p.screenshot({path:`${dir}/health-${f}-393.png`})}
await p.getByRole('button',{name:'切换到方坤'}).click();await p.waitForTimeout(1500)
await p.screenshot({path:dir+'/coach-393.png'})
await b.close()
