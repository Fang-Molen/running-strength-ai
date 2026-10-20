// v88.1 验证（种子数据，非用户数据；Playwright Chrome 390 宽，非真机）：10-19 组合课 跑步已关联无RPE + 力量RPE3补练10-20；A=24h恢复填“无”应无待补；B=未填应点名跑步并一键去评价；睡眠 5.7833h 显示成 5小时47分。
import {chromium} from 'playwright'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v88.1'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const garmin={a:{id:41019,name:'QA 操场',type:'track_running',start:'2026-10-19T10:00:00Z',dist:3200,dur:1500,avgHr:150}}
const comps=(rec)=>({schemaVersion:1,prompted:['2026-10-19|garmin:41019'],days:{'2026-10-19':{running:{device:{sourceIdentity:'garmin:41019',source:'garmin',linkedAt:'2026-10-19T11:00:00Z',linkedBy:'user'}},strength:{status:'done',rpe:3,doneOn:'2026-10-20'},...(rec?{recovery:{runLegs24:'无',strengthSoreness24:'无'}}:{})}}})
const sleep={schemaVersion:1,records:['2026-10-19','2026-10-20'].map(d=>({id:'qa-sleep-'+d,kind:'SLEEP',value:5.783333333333333,unit:'hours',observedOn:d,observedAt:null,source:'DEVICE_CONFIRMED',note:'',hrvMethod:null,createdAt:d+'T08:00:00Z',athleteId:'local',observation:{key:'garmin:sleep:'+d,sourceId:'garmin:qa',statistic:'佳明睡眠',syncedAt:d+'T08:00:00Z'}}))}
async function page(seed){const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
 await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
 await ctx.addInitScript(s=>{if(!sessionStorage.getItem('qa')){sessionStorage.setItem('qa','1');localStorage.setItem('fk-onboard-v1','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},seed)
 const p=await ctx.newPage();p.setDefaultTimeout(15000);await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2000);return p}
const txt=p=>p.evaluate(()=>document.body.innerText)
for (const rec of [true,false]){
 const p=await page({'fk-garmin-acts-v1':garmin,'fk-plan400-v4-components-v1':comps(rec),'fr255-vitals-v1':sleep})
 if(rec)console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
 const t=await txt(p);console.log(rec?'A(24h已填)':'B(未填)','首页:',(t.match(/待补反馈[^\n]*/)||['无待补反馈'])[0])
 await p.screenshot({path:`${dir}/v881-home-${rec?'filled':'unrated'}-390.png`})
 if(!rec){const btn=p.getByText(/待补反馈：/).first();if(await btn.count()){await btn.click();await p.waitForTimeout(1200);const t2=await txt(p);console.log('一键后:',/保存跑步评价/.test(t2)?'跑步评分表已打开':'未见跑步评分表');await p.screenshot({path:`${dir}/v881-oneclick-rate-390.png`})}}
 else{await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'later'}})));await p.waitForTimeout(1200)
  const s=p.getByTestId('shared-sleep').first();console.log('睡眠:',await s.count()?await s.innerText():'无（tab名可能不同）',(await txt(p)).match(/5\.78\d+/)?'仍有长小数':'无长小数')
  if(await s.count())await s.scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/v881-sleep-24-72h-390.png`})}
}
await b.close()
