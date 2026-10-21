// v89.6 验证（合成种子；Playwright Chrome 393×852，非真机）：A=老用户（有记录、代码不再带计划）；B=全新设备。
import {chromium} from 'playwright'
import {readFileSync} from 'node:fs'
import {emulateSafeArea,overlayJs} from './_safe-emu.mjs'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v89.6', planFile='/workspace/out/方坤-我的400计划.json'
const seed=JSON.parse(readFileSync('/tmp/v89-seed.json','utf8'));const train=JSON.parse(readFileSync('/tmp/v892-train.json','utf8'))
train['fk-plan400-v4-log']=JSON.stringify({'2026-10-19':{done:'done',reps:'150m: 21.3/21.0/21.6',rpe:'7',athleteId:'local',savedAt:'2026-10-19T12:00:00Z'}})
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const PERSONAL=['V4','53秒','400米53秒多','速度耐力＋力量A','150m×3']
async function mk(seeded){
  const ctx=await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:2,timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true,serviceWorkers:process.env.QA_SW==='1'?'allow':'block'})
  await ctx.clock.install({time:new Date('2026-10-21T02:07:00+08:00')}); await emulateSafeArea(ctx,{top:59,bottom:34})
  await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
  if(seeded){await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}))
    await ctx.addInitScript(([s,tr])=>{if(localStorage.getItem('qa-seeded'))return;localStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1');localStorage.setItem('fk-garmin-intraday-v1:local',JSON.stringify(s.intraday));localStorage.setItem('fr255-vitals-v1',JSON.stringify(s.vitals));localStorage.setItem('fk-pain-log-v1',JSON.stringify(s.pain));for(const [k,v] of Object.entries(tr))localStorage.setItem(k,v)},[seed,train])}
  await ctx.addInitScript(overlayJs(59,34))
  const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>console.log('PAGEERR',e.message));await p.clock.resume();return [ctx,p]
}
const dismiss=async p=>{for(let i=0;i<4;i++){const l=p.getByRole('button',{name:'稍后（留在待补里）'});if(!await l.count())break;await l.first().click();await p.waitForTimeout(600)}}
const txt=async p=>(await p.locator('body').innerText())
// ---- A 老用户
{const [ctx,p]=await mk(true)
 await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500);await dismiss(p)
 const keysBefore=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>!/^fk-plan-doc|^fr255-profile/.test(k)).map(k=>[k,localStorage.getItem(k)])))
 await p.screenshot({path:dir+'/A-today-393.png'});console.log('A today has personal?',PERSONAL.filter(t=>false))
 await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1500)
 const np=p.getByTestId('no-plan');console.log('A no-plan card:',await np.count(), (await np.count())?(await np.innerText()).replace(/\n+/g,' | ').slice(0,260):'')
 await p.screenshot({path:dir+'/A-plan-noplan-393.png'})
 await p.getByRole('button',{name:'切换到日志'}).click();await p.waitForTimeout(1500);await p.screenshot({path:dir+'/A-log-393.png'})
 const lg=(await txt(p)).replace(/\n+/g,' | ');console.log('A log:',lg.slice(0,300));console.log('A log shows 10/19 row?',/10-19 周一/.test(lg))
 await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1000)
 await p.getByTestId('no-plan').getByLabel('导入计划/备份文件').setInputFiles(planFile);await p.waitForTimeout(800)
 const pv=p.getByTestId('plan-import-preview');await pv.scrollIntoViewIfNeeded();await p.screenshot({path:dir+'/A-import-preview-393.png'});console.log('A preview:',(await pv.innerText()).replace(/\n+/g,' | '))
 await pv.getByRole('button',{name:'确认导入'}).click();await p.waitForTimeout(1500);await p.evaluate(()=>scrollTo(0,0))
 await p.screenshot({path:dir+'/A-plan-imported-393.png'});const t=await txt(p);console.log('A after import: noplan=',await p.getByTestId('no-plan').count(),'has plan title=',t.includes('完整专项训练体系'))
 const keysAfter=await p.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>!/^fk-plan-doc|^fr255-profile/.test(k)).map(k=>[k,localStorage.getItem(k)])))
 const changed=Object.keys({...keysBefore,...keysAfter}).filter(k=>keysBefore[k]!==keysAfter[k]&&!/^fk-plan400-dates|cache|^fk-ui|seen|last|-at$/.test(k));console.log('A non-plan keys changed by import:',JSON.stringify(changed))
 await p.getByRole('button',{name:'切换到日志'}).click();await p.waitForTimeout(1200);await p.screenshot({path:dir+'/A-log-after-import-393.png'})
 await ctx.close()}
// ---- B 全新设备
{const [ctx,p]=await mk(false)
 await p.goto(base);await p.waitForTimeout(4000)
 const wel=p.getByRole('dialog',{name:'欢迎'});console.log('B welcome dialog:',await wel.count());if(await wel.count()){await p.screenshot({path:dir+'/B-welcome-393.png'});await wel.getByRole('button',{name:'跳过，从头开始'}).click();await p.waitForTimeout(800)}
 const ob=p.getByRole('dialog',{name:'首次引导'});console.log('B onboarding shown:',await ob.count())
 await p.screenshot({path:dir+'/B-onboard-1-393.png'})
 await p.getByLabel('名字或昵称').fill('小林');await p.getByRole('button',{name:'女',exact:true}).click();await p.getByLabel('出生年份').fill('2001');await p.getByRole('button',{name:'800',exact:false}).first().click();await p.getByLabel('PB').fill('2分28');await p.screenshot({path:dir+'/B-onboard-about-filled-393.png'})
 for(let i=0;i<6;i++){await p.getByRole('button',{name:'下一步'}).click();await p.waitForTimeout(400);if(i===0)await p.screenshot({path:dir+'/B-onboard-garmin-393.png'})}
 await p.screenshot({path:dir+'/B-onboard-preview-393.png'});console.log('B preview:',(await ob.innerText()).replace(/\n+/g,' | ').slice(0,400))
 await p.getByRole('button',{name:'接受'}).click();await p.waitForTimeout(800);await p.screenshot({path:dir+'/B-onboard-accepted-393.png'})
 const sch1=await p.evaluate(()=>JSON.parse(localStorage.getItem('fk-schedule-v1')||'{"entries":[]}').entries.length);console.log('B schedule entries after accept:',sch1)
 await p.getByTestId('onboard-undo').click();await p.waitForTimeout(500);const sch2=await p.evaluate(()=>JSON.parse(localStorage.getItem('fk-schedule-v1')||'{"entries":[]}').entries.length);console.log('B after undo:',sch2)
 await p.getByRole('button',{name:'暂不需要'}).click();await p.waitForTimeout(1500);await dismiss(p)
 await p.screenshot({path:dir+'/B-today-393.png'})
 await p.getByRole('button',{name:'切换到计划'}).click();await p.waitForTimeout(1500);await p.screenshot({path:dir+'/B-plan-393.png'})
 console.log('B plan:',(await txt(p)).replace(/\n+/g,' | ').slice(0,300))
 const all=[];for(const tb of ['今日','计划','日志','健康']){await p.getByRole('button',{name:'切换到'+tb}).click();await p.waitForTimeout(1200);all.push(await txt(p))}
 console.log('B personal literals visible:',JSON.stringify(PERSONAL.filter(t=>all.some(x=>x.includes(t)))))
 const ls=await p.evaluate(()=>({doc:localStorage.getItem('fk-plan-doc-v1'),card:localStorage.getItem('fk-athlete-card-v1'),prof:localStorage.getItem('fr255-profile-v1')}));console.log('B storage:',JSON.stringify(ls).slice(0,400))
 await ctx.close()}
await b.close()
