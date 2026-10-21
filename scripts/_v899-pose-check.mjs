// v89.9 prod check: R8 pose cards by exact exerciseId + gender. Fresh profile, no personal data, no model calls.
import { chromium } from 'playwright';
const S='/workspace/out/screenshots/v89.9', URL0=process.env.FK_QA_URL||'https://molen-fangkun.pages.dev';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'})).newPage();
const errs=[],imgs=[];p.on('pageerror',e=>errs.push(e.message));p.on('response',r=>{if(r.url().includes('/fangkun-pose-r8/'))imgs.push([new URL(r.url()).pathname,r.status()])});
await p.goto(URL0,{waitUntil:'domcontentloaded'});
await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
for(let i=0;i<6;i++){const s=p.getByRole('button',{name:'跳过，用默认',exact:true});if(await s.isVisible())await s.click();}
for(const n of ['逐个调整','暂不需要']){const x=p.getByRole('button',{name:n,exact:true});if(await x.isVisible())await x.click();}
if(await p.getByTestId('onboard-undo').isVisible())await p.getByTestId('onboard-undo').click();
await p.getByRole('button',{name:/添加训练/}).first().click();
await p.waitForTimeout(800);
const strength=p.getByRole('button',{name:/^力量$/});if(await strength.count())await strength.first().click();
const out=[];
for(const [name,file] of (process.env.FK_EX?JSON.parse(process.env.FK_EX):[['杠铃卧推','bench'],['杠铃深蹲','squat'],['引体向上','pullup']])){
  const search=p.getByRole('searchbox').first(); if(await search.count()){await search.fill(name);await p.waitForTimeout(400);}
  const view=p.getByRole('button',{name:`查看${name}说明`}).first();
  if(!await view.count()){out.push({name,error:'no 查看 button'});continue;}
  await view.click();
  const card=p.getByTestId('pose-card').first();await card.waitFor({timeout:20000});
  const read=async()=>card.evaluate(f=>{const i=f.querySelector('img');return {src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0,label:f.querySelector('figcaption')?.textContent}});
  await p.waitForTimeout(800);await card.scrollIntoViewIfNeeded();
  const female=await read();await p.screenshot({path:`${S}/390-${file}-female.png`});
  await p.getByRole('button',{name:'男性',exact:true}).first().click();await p.waitForTimeout(1000);
  const male=await read();await card.scrollIntoViewIfNeeded();await p.screenshot({path:`${S}/390-${file}-male.png`});
  out.push({name,female,male});
  await p.getByRole('button',{name:'完成查看'}).last().click();await p.waitForTimeout(400);
}
console.log(JSON.stringify({out,imgs,errs},null,1));
await b.close();
