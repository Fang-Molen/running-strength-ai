// v89.9.1 prod smoke, synthetic data only (fake plan + fake watch run; Garmin API mocked). No real account, no model calls.
import { chromium } from 'playwright';
const S='/workspace/out/screenshots/v89.9.1', URL0=process.env.FK_QA_URL||'https://molen-fangkun.pages.dev';
const plan={schema:'fangkun-plan-v1',label:'合成测试',tag:'QA',plan:{name:'合成测试计划',shiftDays:0,weeks:[],days:[
 {date:'2026-10-21',title:'200m重复专项',main:['正式主课：','200m×3，组间8—10分钟，RPE7—8'],aux:[],strength:[],week:'W1'}]}};
const acts={a:{id:99001,start:'2026-10-21T09:30:00.000Z',type:'running',dist:1410,dur:959,athleteId:'local',name:'跑步'}};
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
await ctx.clock.install({time:new Date('2026-10-21T20:00:00+08:00')});
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));
await ctx.route('**/api/coach**',r=>r.fulfill({status:503,body:'{}'}));
await ctx.addInitScript(([plan,acts])=>{if(localStorage.getItem('qa-seeded'))return;localStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1');localStorage.setItem('fk-plan-doc-v1',JSON.stringify(plan));localStorage.setItem('fk-garmin-acts-v1',JSON.stringify(acts));},[plan,acts]);
const p=await ctx.newPage();await p.clock.resume();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(URL0,{waitUntil:'domcontentloaded'});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});await p.waitForTimeout(1500);
for(let i=0;i<4;i++){const l=p.getByRole('button',{name:'稍后（留在待补里）'});if(!await l.count())break;await l.first().click();await p.waitForTimeout(500)}
const compact=p.getByTestId('pending-feedback-compact');const full=p.getByTestId('pending-feedback');
const res={compact:await compact.count()?await compact.first().innerText():null,full:await full.count()?(await full.first().innerText()).replace(/\n/g,' | '):null};
await p.screenshot({path:`${S}/390-today-pending.png`});
const go=(await compact.count())?compact.first():full.locator('button').first();
await go.click();await p.waitForTimeout(1500);
const sug=p.getByTestId('v4-run-suggest');res.panel=await sug.count();
if(res.panel){await sug.first().scrollIntoViewIfNeeded();res.panelText=(await sug.first().innerText()).replace(/\n/g,' | ');}
res.splitsSaveBtn=await p.getByRole('button',{name:'保存本段记录'}).count();
await p.screenshot({path:`${S}/390-run-link-panel.png`});
if(res.panel){await p.getByTestId('confirm-device-run-link').first().click();await p.waitForTimeout(1200);
 res.linksStored=await p.evaluate(()=>Object.keys(localStorage).filter(k=>/run-link|components/.test(k)).map(k=>k+'='+localStorage.getItem(k).slice(0,200)));
 res.logUnchanged=await p.evaluate(()=>localStorage.getItem('fk-plan400-v4-log'));
 await p.screenshot({path:`${S}/390-run-linked.png`});}
res.errs=errs;console.log(JSON.stringify(res,null,1));await b.close();
