// v87.2 验证：种子数据（非用户数据）= 10-19 速度耐力＋力量A：跑步当天手表已关联；力量在分项评价里记“10-20 补练”。Playwright Chrome 390 宽，非真机。
import {chromium} from 'playwright'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v87.2'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
const id='garmin:41019',at='2026-10-19T10:00:00Z'
const seed={'fk-onboard-v1':'1','fk-garmin-acts-v1':JSON.stringify({a:{id:41019,name:'QA 操场',type:'track_running',start:at,dist:3200,dur:1500,avgHr:150}}),
 'fk-plan400-v4-components-v1':JSON.stringify({schemaVersion:1,prompted:['2026-10-19|'+id],days:{'2026-10-19':{running:{device:{sourceIdentity:id,source:'garmin',linkedAt:at,linkedBy:'user'},status:'done',rpe:7},strength:{status:'done',rpe:6,doneOn:'2026-10-20',savedAt:'2026-10-20T03:00:00Z'}}}})}
await ctx.addInitScript(s=>{if(!sessionStorage.getItem('qa')){sessionStorage.setItem('qa','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,v)}},seed)
const p=await ctx.newPage();p.setDefaultTimeout(15000)
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2000)
console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
await p.getByRole('button',{name:'切换到日志'}).click();await p.waitForTimeout(1500)
await p.getByRole('button',{name:/本周/}).first().click().catch(()=>{});await p.waitForTimeout(1200)
const t=await p.evaluate(()=>document.body.innerText)
console.log('摘要:',(t.match(/全部 \d+ 条记录[^\n]*/)||[''])[0])
console.log('10-20 行:',(t.match(/[^\n]*补练·原定[^\n]*/)||['无'])[0]); console.log('10-19 行:',(t.match(/[^\n]*力量补练于[^\n]*/)||['无'])[0])
await p.screenshot({path:dir+'/v872-log-390.png',fullPage:false})
await p.evaluate(()=>{const el=[...document.querySelectorAll('*')].find(e=>/补练·原定/.test(e.textContent||'')&&e.children.length<3);el?.scrollIntoView({block:'center'})});await p.waitForTimeout(500)
await p.screenshot({path:dir+'/v872-log-rows-390.png'})
await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1500)
const t2=await p.evaluate(()=>document.body.innerText)
console.log('计划页 10-19:',(t2.match(/[^\n]*补练于 10月20日[^\n]*/)||['无'])[0])
await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'after'}})));await p.waitForTimeout(1500)
const t3=await p.evaluate(()=>document.body.innerText)
console.log('10-19 详情:',(t3.match(/[^\n]*补练于[^\n]*/g)||['无']).join(' | '),'| 状态:',(t3.match(/已完成|进行中|需补录/)||[''])[0])
await p.screenshot({path:dir+'/v872-plan-390.png'})
await b.close()
