// v88.4 验证（种子/合成数据；Playwright Chrome 390×844，非真机）。Chrome 里 env(safe-area-inset-*) 恒为 0，
// 这里用注入 CSS 模拟 iPhone 安全区（上 47px / 下 34px，同 iPhone 14/15 竖屏）并画出状态栏、灵动岛、Home 条示意。
import {chromium} from 'playwright'
import {readFileSync,existsSync} from 'node:fs'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v88.4', seed=existsSync('/tmp/v883-seed.json')?readFileSync('/tmp/v883-seed.json','utf8'):''
const T=47,B=34
const css=`.product-ui .ui03-header{padding-top:${T+4}px!important}.product-ui .ui03-dock{padding-bottom:${B}px!important}:root{--fk-nav-h:${64+B}px!important}.fk-coach-sheet{padding-bottom:${B}px!important}
#qa-sb{position:fixed;top:0;left:0;right:0;height:${T}px;z-index:9999;pointer-events:none;display:flex;align-items:center;justify-content:space-between;padding:0 30px;font:600 16px -apple-system,system-ui;color:#fff}
#qa-di{position:fixed;top:11px;left:50%;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000;z-index:10000;pointer-events:none}
#qa-hi{position:fixed;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:#fff;z-index:9999;pointer-events:none}`
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
await ctx.addInitScript(([s,c])=>{localStorage.setItem('fk-onboard-v1','1');if(s)localStorage.setItem('fk-garmin-intraday-v1:local',s)
 document.addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent=c;document.head.appendChild(st);document.body.insertAdjacentHTML('beforeend','<div id="qa-sb"><span>9:41</span><span>5G ▮▮▮</span></div><div id="qa-di"></div><div id="qa-hi"></div>')})},[seed,css])
const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>console.log('PAGEERR',e.message))
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)
console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
const chrome=()=>p.evaluate(()=>{const h=document.querySelector('.ui03-header'),d=document.querySelector('.ui03-dock');const s=e=>e?(({backgroundColor:a,backdropFilter:f,webkitBackdropFilter:w,position:pos})=>({a,f:f||w,pos}))(getComputedStyle(e)):null;return JSON.stringify({header:s(h),dock:s(d),html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor})})
console.log('chrome:',await chrome())
await p.screenshot({path:dir+'/v884-today-top-390.png'})
await p.mouse.wheel(0,420);await p.evaluate(()=>window.scrollBy(0,420));await p.waitForTimeout(600)
await p.screenshot({path:dir+'/v884-today-scrolled-390.png'})
await p.getByRole('button',{name:'切换到健康'}).click();await p.waitForTimeout(1200);await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(300)
await p.screenshot({path:dir+'/v884-health-390.png'})
await p.getByRole('button',{name:'切换到方坤'}).click();await p.waitForTimeout(1500)
const input=p.locator('textarea, input[type=text]').last()
const ib=await input.boundingBox().catch(()=>null);console.log('方坤输入框底边:',ib?Math.round(ib.y+ib.height):'无','（视口 844，Home 条区 810–844）')
await p.screenshot({path:dir+'/v884-coach-390.png'})
await b.close()
