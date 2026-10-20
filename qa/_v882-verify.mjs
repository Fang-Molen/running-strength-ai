// v88.2 验证（种子数据，非用户数据；Playwright Chrome 390 宽，非真机）：健康页 午睡/休息补录（保存、刷新仍在、更正追加版本）、U07 日内说明行、首页恢复判断新措辞。
import {chromium} from 'playwright'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v88.2'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const days=Array.from({length:14},(_,i)=>`2026-10-${String(7+i).padStart(2,'0')}`)
const vitals={schemaVersion:1,records:days.map((d,i)=>({id:'qa-rhr-'+d,kind:'RHR',value:52+(i%3),unit:'bpm',observedOn:d,observedAt:null,source:'DEVICE_CONFIRMED',note:'',hrvMethod:null,createdAt:d+'T08:00:00Z',athleteId:'local',observation:{key:'garmin:rhr:'+d,sourceId:'garmin:qa',statistic:'佳明每日静息心率',syncedAt:d+'T08:00:00Z'}}))}
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
await ctx.addInitScript(s=>{if(!localStorage.getItem('qa-seeded')){localStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fr255-vitals-v1',JSON.stringify(s))}},vitals)
const p=await ctx.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>console.log('PAGEERR',e.message));p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200))})
const ready=async()=>{await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)}
const press=async(l)=>{await l.evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForTimeout(300);await l.tap()}
const txt=()=>p.evaluate(()=>document.body.innerText)
await p.goto(base);await ready()
console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
console.log('首页恢复判断:',((await txt()).match(/恢复[^\n]*\n?[^\n]*/)||['?'])[0].replace(/\n/g,' / '))
await p.screenshot({path:dir+'/v882-home-verdict-390.png'})
const health=async()=>{await p.getByRole('button',{name:'切换到健康'}).click();await p.waitForTimeout(1500)
 await p.evaluate(()=>{document.querySelectorAll('[data-testid=u09-stats]').forEach(d=>d.open=true);[...document.querySelectorAll('details')].filter(d=>/补录睡眠或休息/.test(d.querySelector('summary')?.textContent||'')).forEach(d=>d.open=true)});await p.waitForTimeout(500)}
await health()
const u7=p.getByTestId('u07-intraday');console.log('U07 行:',await u7.count()?await u7.first().innerText():'无')
await p.getByLabel('休息最少分钟').fill('20');await p.getByLabel('休息最多分钟').fill('30');await press(p.getByRole('button',{name:'保存休息记录'}));await p.waitForTimeout(800)
console.log('status:',await p.locator('[role=status]').allInnerTexts(),'ls:',await p.evaluate(()=>Object.keys(localStorage).filter(k=>/rest/i.test(k))));let t=await txt();console.log('保存后:',(t.match(/已保存到本机[^\n]*|尚未保存[^\n]*/)||['无提示'])[0],'|',(t.match(/[^\n]*午睡[^\n]*/g)||[]).slice(0,3).join(' / '))
await p.getByLabel('休息最少分钟').evaluate(e=>e.scrollIntoView({block:'center'}));await p.waitForTimeout(300);await p.screenshot({path:dir+'/v882-rest-saved-390.png'})
await p.reload();await ready();await health()
t=await txt();const fix=p.getByRole('button',{name:/^更正 /});console.log('刷新后记录:',await fix.count()?await fix.first().innerText():'丢失')
if(await fix.count()){await press(fix.first());await p.getByLabel('休息最多分钟').fill('40');await press(p.getByRole('button',{name:'确认更正此条休息记录'}));await p.waitForTimeout(800)
 t=await txt();console.log('更正:',(t.match(/更正已保存[^\n]*|更正未保存[^\n]*/)||['无'])[0],'|',(await p.getByRole('button',{name:/^更正 /}).allInnerTexts()).join(' / '))}
await p.getByTestId('u07-intraday').first().scrollIntoViewIfNeeded().catch(()=>{});await p.screenshot({path:dir+'/v882-health-u07-390.png'})
await p.evaluate(()=>document.querySelectorAll('[data-testid=u09-stats]').forEach(d=>d.open=false));await p.waitForTimeout(300);await p.screenshot({path:dir+'/v882-rest-corrected-390.png'})
await b.close()
