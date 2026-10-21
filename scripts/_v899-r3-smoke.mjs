// v89.9 prod smoke for R3 (health timeline + knowledge reader). Fresh profile, synthetic-free, no model calls.
import { chromium } from 'playwright';
const S='/workspace/out/screenshots/v89.9';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'zh-CN'})).newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));const posts=[];p.on('request',r=>{if(r.method()==='POST'&&/deepseek|\/api\/coach|\/api\/ai/.test(r.url()))posts.push(r.url())});
await p.goto('https://molen-fangkun.pages.dev',{waitUntil:'domcontentloaded'});
await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
for(let i=0;i<6;i++){const s=p.getByRole('button',{name:'跳过，用默认',exact:true});if(await s.isVisible())await s.click();}
for(const n of ['逐个调整','暂不需要']){const x=p.getByRole('button',{name:n,exact:true});if(await x.isVisible())await x.click();}
if(await p.getByTestId('onboard-undo').isVisible())await p.getByTestId('onboard-undo').click();
await p.getByRole('button',{name:'打开方坤',exact:true}).click();
await p.locator('.fk-coach-tabs').getByRole('button',{name:'学习',exact:true}).click();
const lib=p.getByRole('region',{name:/知识/}).first();await lib.waitFor();
await p.waitForTimeout(500);await p.screenshot({path:`${S}/390-knowledge-reader.png`});
const text=await lib.innerText();
const search=lib.getByRole('searchbox');await search.fill('800米');await p.waitForTimeout(500);
const afterSearch=(await lib.innerText()).match(/找到\s*\d+\s*[条篇]/g);
await p.screenshot({path:`${S}/390-knowledge-search.png`});
const hasWarmup=await p.getByTestId('warmup-drafts').count();
await p.goto('https://molen-fangkun.pages.dev',{waitUntil:'domcontentloaded'});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000});
await p.locator('nav').last().getByText('健康',{exact:true}).click();await p.waitForTimeout(2500);const healthText=await p.locator('body').innerText();
await p.screenshot({path:`${S}/390-health.png`,fullPage:false});
console.log(JSON.stringify({healthHasTabs:['恢复','睡眠','HRV','压力'].filter(t=>healthText.includes(t)),healthEvents:/时段|事件|未同步|暂无/.test(healthText),tabs:text.match(/读知识|查资料/g),counts:text.match(/\d+\s*[条篇]/g)?.slice(0,6),afterSearch,hasWarmup,posts,errs}));
await b.close();
