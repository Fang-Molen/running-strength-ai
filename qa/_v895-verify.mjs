// v89.5 验证（合成种子；Playwright Chrome 393×852，非真机）：肌肉恢复读日志同一份记录。
import {chromium} from 'playwright'
import {readFileSync} from 'node:fs'
import {emulateSafeArea,overlayJs} from './_safe-emu.mjs'
const base=process.argv[2], dir=process.argv[3]||'/workspace/out/v89.5'
const seed=JSON.parse(readFileSync('/tmp/v89-seed.json','utf8'));seed.pain=[...seed.pain,{id:'qa-old',date:'2026-10-17',part:'腘绳肌',score:4,note:'QA 合成：4 天前，未复核',athleteId:'local',occurredAt:'2026-10-17T02:00:00.000Z',recordedAt:'2026-10-17T02:05:00.000Z'}];const train=JSON.parse(readFileSync('/tmp/v892-train.json','utf8'))
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:393,height:852},deviceScaleFactor:2,timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true,serviceWorkers:process.env.QA_SW==='1'?'allow':'block'})
await ctx.clock.install({time:new Date('2026-10-21T02:07:00+08:00')})
await emulateSafeArea(ctx,{top:59,bottom:34})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,body:'{}'}))
await ctx.addInitScript(([s,tr])=>{if(localStorage.getItem('qa-seeded'))return;localStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-welcome-standalone-v1','1');localStorage.setItem('fk-garmin-intraday-v1:local',JSON.stringify(s.intraday));localStorage.setItem('fr255-vitals-v1',JSON.stringify(s.vitals));localStorage.setItem('fk-pain-log-v1',JSON.stringify(s.pain));for(const [k,v] of Object.entries(tr))localStorage.setItem(k,v)},[seed,train])
await ctx.addInitScript(overlayJs(59,34))
const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>console.log('PAGEERR',e.message));const W=[];p.on('response',async r=>{try{const b=await r.body();W.push([r.url(),b.length,r.headers()['content-encoding']||''])}catch{}})
await p.clock.resume()
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)
for(let i=0;i<4;i++){const later=p.getByRole('button',{name:'稍后（留在待补里）'});if(!await later.count())break;if(!i)await p.screenshot({path:dir+'/run-import-prompt-393.png'});await later.first().click();await p.waitForTimeout(700)}
await p.getByRole('button',{name:'切换到日志'}).click();await p.waitForTimeout(1500)
await p.screenshot({path:dir+'/log-393.png'})
console.log('log:',(await p.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,400))
await p.getByRole('button',{name:'切换到健康'}).click();await p.waitForTimeout(1500);await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:dir+'/health-recovery-393.png'});console.log('tiles:',(await p.getByTestId('h89-tiles').innerText()).replace(/\n/g,' | '))
await p.getByTestId('h89-muscle-entry').click();await p.waitForTimeout(1000)
await p.locator('canvas[data-ready=true]').waitFor({timeout:60000}).catch(()=>console.log('3D not ready'))
await p.waitForTimeout(1500)
await p.screenshot({path:dir+'/muscle-status-393.png'})
const glb=W.filter(w=>/\.glb/.test(w[0])).map(w=>[w[0].split('/').pop(),w[1],w[2]]);console.log('model:',JSON.stringify(glb),'canvasReady:',await p.locator('canvas[data-ready=true]').count(),'asset:',await p.locator('canvas[data-ready=true]').first().getAttribute('data-asset'))
console.log('page weight (decoded) KB:',Math.round(W.reduce((n,w)=>n+w[1],0)/1024),'of which non-glb KB:',Math.round(W.filter(w=>!/\.glb/.test(w[0])).reduce((n,w)=>n+w[1],0)/1024),'requests',W.length)
const st=p.getByTestId('muscle-stimulus-v90');if(await st.count()){await st.evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(400);await p.screenshot({path:dir+'/muscle-stimulus-393.png'});console.log('stimulus:',(await st.innerText()).replace(/\n+/g,' | ').slice(0,300))}else console.log('stimulus: none')
await p.evaluate(()=>document.querySelector('canvas')?.scrollIntoView({block:'center'}));await p.waitForTimeout(300);await p.getByRole('button',{name:'背面',exact:true}).first().click().catch(e=>console.log('back click fail',e.message.slice(0,80)));await p.waitForTimeout(2500);await p.screenshot({path:dir+'/muscle-back-393.png'})
await p.getByRole('button',{name:'正面',exact:true}).first().click().catch(()=>{});await p.waitForTimeout(1200)
{const c=p.locator('canvas[data-ready=true]').first();const bb=await c.boundingBox();if(bb){await c.click({position:{x:bb.width*0.455,y:bb.height*0.58}});await p.waitForTimeout(1200);const ev=p.getByTestId('u11-muscle-evidence');console.log('tap thigh ->',(await ev.count())?(await ev.innerText()).split('\n')[0]:'no evidence');const ch=p.getByTestId('muscle-stimulus-v90');console.log('chart region ->',(await ch.count())?(await ch.innerText()).split('\n')[0]:'none');await c.scrollIntoViewIfNeeded();await p.screenshot({path:dir+'/muscle-tap-393.png'})}}
const sc=p.locator('[data-testid="m89-cards"]');if(await sc.count()){await sc.evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(400);await p.screenshot({path:dir+'/muscle-cards-393.png'});console.log('cards:',(await sc.innerText()).replace(/\n+/g,' | ').slice(0,300))}
for(const [n,f] of [['力量负荷','strength'],['跑步影响','run']]){await p.locator('.fk-m89 .fk-h89-tabs button',{hasText:n}).click();await p.waitForTimeout(600)
  const sec=p.locator(`[aria-label="${n}"]`);await sec.evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(300)
  await p.locator('details.fk-m89-limits').first().evaluate(e=>e.open=true).catch(()=>{})
  await p.screenshot({path:`${dir}/muscle-${f}-393.png`});console.log(n+':',(await sec.innerText()).replace(/\n+/g,' | '))}
console.log('advice:',(await p.locator('[aria-label="方坤分析与建议"]').innerText()).replace(/\n+/g,' | '))
const adv=p.locator('[aria-label="方坤分析与建议"]');await adv.evaluate(e=>e.scrollIntoView({block:'start'}));await p.waitForTimeout(300);await p.screenshot({path:dir+'/muscle-advice-393.png'})
await p.keyboard.press('Escape');await p.waitForTimeout(500)
await p.getByRole('button',{name:'切换到方坤'}).click();await p.waitForTimeout(1500)
const g=p.getByTestId('global-muscle-u11');if(await g.count()){console.log('coach summary count:',((await g.innerText()).match(/不能据此估算恢复百分比/g)||[]).length);await g.evaluate(e=>{e.open=true;e.scrollIntoView({block:'center'})});await p.waitForTimeout(400);console.log('coach muscle:',(await g.innerText()).replace(/\n+/g,' | '))}else console.log('coach muscle: (no global-muscle-u11 on coach page)')
await p.screenshot({path:dir+'/coach-393.png'})
await b.close()
