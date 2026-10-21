// v89.9.2 prod smoke: COROS login UI renders; bad credentials → clear error. Fake account only; no real login.
import { chromium } from 'playwright';
const S='/workspace/out/screenshots/v89.9.2';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN',serviceWorkers:'block'});
await ctx.addInitScript(()=>{if(!localStorage.getItem('qa')){localStorage.setItem('qa','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1')}});
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('https://molen-fangkun.pages.dev',{waitUntil:'domcontentloaded'});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
for(let i=0;i<4;i++){const l=p.getByRole('button',{name:'稍后（留在待补里）'});if(!await l.count())break;await l.first().click();await p.waitForTimeout(400)}
await p.getByRole('button',{name:'导入',exact:true}).first().click();await p.waitForTimeout(1500);
let c=p.locator('[data-testid="coros-account"]:visible');
await p.getByRole('button',{name:'身体与记录',exact:true}).click();await p.waitForTimeout(1000);
const ids=await p.evaluate(()=>[...document.querySelectorAll('[data-testid=coros-account]')].map(e=>{let x=e,h=[];while(x){if(x.hidden||getComputedStyle(x).display==='none')h.push(x.id||x.className?.toString().slice(0,30)||x.tagName);x=x.parentElement}return h}));console.log(JSON.stringify(ids));
await p.evaluate(()=>{document.querySelectorAll('details').forEach(d=>{if(d.querySelector('[data-testid=coros-account]'))d.open=true});const d=document.getElementById('body-device-records');if(d)d.open=true});await p.waitForTimeout(800);
for(const n of []){if(await c.count())break;const t=p.getByRole('button',{name:n,exact:true});if(await t.count()&&await t.first().isVisible()){await t.first().click();await p.waitForTimeout(1200);}}
const btns=await p.getByRole('button').allInnerTexts();
const found=await c.count();
let msg=null,summary=null;
if(found){await c.first().scrollIntoViewIfNeeded();await c.first().locator('summary').click();summary=await c.first().locator('summary').innerText();
 await p.getByLabel('高驰账号').fill('nobody-fk-test@example.com');await p.getByLabel('高驰密码').fill('wrong-password');
 await p.getByRole('button',{name:'登录高驰'}).click();await p.waitForTimeout(6000);msg=await c.first().locator('[role=status]').innerText().catch(()=>null);
 await c.first().scrollIntoViewIfNeeded();await p.screenshot({path:`${S}/390-coros-login-bad-credentials.png`});}
const garmin=(await p.locator('body').innerText()).includes('佳明');
console.log(JSON.stringify({btns:btns.slice(0,60).join('|'),found,summary,msg,garminTextPresent:garmin,errs}));await b.close();
