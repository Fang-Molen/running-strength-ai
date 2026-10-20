// v88 验证（种子数据，非用户数据；Playwright Chrome 390 宽，非真机）：健康页 U09 统计、改期后的原日期、组合课分项状态。
import {chromium} from 'playwright'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v88'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const days=Array.from({length:14},(_,i)=>`2026-10-${String(7+i).padStart(2,'0')}`)
const vitals={schemaVersion:1,records:days.map((d,i)=>({id:'qa-rhr-'+d,kind:'RHR',value:52+(i%3),unit:'bpm',observedOn:d,observedAt:null,source:'DEVICE_CONFIRMED',note:'',hrvMethod:null,createdAt:d+'T08:00:00Z',athleteId:'local',observation:{key:'garmin:rhr:'+d,sourceId:'garmin:qa',statistic:'佳明每日静息心率',syncedAt:d+'T08:00:00Z'}}))}
const moved={entries:[{id:'plan400:2026-10-19:strength',date:'2026-10-21',movedFrom:'2026-10-19',title:'V4 速度耐力＋力量A',kind:'strength',modality:'strength',trainingType:'mixed',source:'custom',status:'planned',focus:[],minutes:60,intensity:'MODERATE',lowerHeavy:false,refId:null}],acks:[]}
const garmin={a:{id:41019,name:'QA 操场',type:'track_running',start:'2026-10-19T10:00:00Z',dist:3200,dur:1500,avgHr:150}}
const comps={schemaVersion:1,prompted:['2026-10-19|garmin:41019'],days:{'2026-10-19':{running:{device:{sourceIdentity:'garmin:41019',source:'garmin',linkedAt:'2026-10-19T11:00:00Z',linkedBy:'user'}}}}}
async function page(seed){const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
 await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
 await ctx.addInitScript(s=>{if(!sessionStorage.getItem('qa')){sessionStorage.setItem('qa','1');localStorage.setItem('fk-onboard-v1','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},seed)
 const p=await ctx.newPage();p.setDefaultTimeout(15000);await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2000);return p}
const txt=p=>p.evaluate(()=>document.body.innerText)
// 1 健康
let p=await page({'fr255-vitals-v1':vitals})
console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
await p.getByRole('button',{name:'切换到健康'}).click();await p.waitForTimeout(1500)
await p.evaluate(()=>{document.querySelectorAll('[data-testid=u09-stats]').forEach(d=>d.open=true)});await p.waitForTimeout(500)
const u=p.getByTestId('u09-stats');console.log('U09 卡:',await u.count()?'有':'无',(await txt(p)).match(/静息心率 · 个人趋势[\s\S]{0,160}/)?.[0]?.replace(/\n/g,' / ')??'')
if(await u.count()){await u.scrollIntoViewIfNeeded();}
await p.screenshot({path:dir+'/v88-health-u09-390.png'})
// 2 改期
p=await page({'fk-schedule-v1':moved})
await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1500)
const mv=p.getByTestId('v4-moved-row').first();console.log('改期行:',await mv.count()?await mv.innerText():'无')
if(await mv.count())await mv.scrollIntoViewIfNeeded()
await p.screenshot({path:dir+'/v88-moved-plan-390.png'})
await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'after'}})));await p.waitForTimeout(1200)
const t2=await txt(p);console.log('原日期详情:',(t2.match(/[^\n]*已调整至[^\n]*/)||['无'])[0],'| 原日评分表:',/保存跑步评价|保存力量评价/.test(t2)?'仍有':'无')
await p.screenshot({path:dir+'/v88-moved-day-390.png'})
// 3 组合课分项
p=await page({'fk-garmin-acts-v1':garmin,'fk-plan400-v4-components-v1':comps})
await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1500)
const cp=p.getByTestId('v4-combo-parts').first();console.log('组合课行:',await cp.count()?await cp.innerText():'无')
if(await cp.count())await cp.scrollIntoViewIfNeeded()
await p.screenshot({path:dir+'/v88-combo-parts-390.png'})
await b.close()
