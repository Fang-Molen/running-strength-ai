import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
const base=process.argv[2]??'http://127.0.0.1:8087/',label=process.argv[3]??'dev'
const out='/workspace/fangkun/evidence/r190/browser',screens='/workspace/screenshots/fangkun-r190'
mkdirSync(out,{recursive:true});mkdirSync(screens,{recursive:true})
const results=[],errors=[],requested=[]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const check=(name,ok,detail='')=>{results.push({name,status:ok?'PASS':'FAIL',detail});console.log(JSON.stringify(results.at(-1)));if(!ok)throw Error(name+': '+detail)}
const seed={name:'R189合成课程',kind:'custom',sessions:[{id:'today-synthetic',name:'合成今日力量',moves:[]}]}
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:label==='prod'?'allow':'block',timezoneId:'Asia/Shanghai'})
await ctx.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort())
ctx.on('request',r=>{const u=new URL(r.url());requested.push({path:u.pathname,method:r.method(),origin:u.origin})})
const p=await ctx.newPage();p.setDefaultTimeout(30000)
p.on('pageerror',e=>errors.push(String(e)))
const ready=()=>p.getByTestId('training-app').filter({has:p.locator(':scope[data-ready="true"]')}).waitFor().catch(()=>p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000}))
const plan=()=>p.evaluate(()=>localStorage.getItem('fr255-strength-plan-v3'))
const openLibrary=async()=>{await p.getByRole('button',{name:'切换到计划',exact:true}).click();await p.getByRole('button',{name:'动作库 · 力量动作与跑步技术',exact:true}).click();await p.getByRole('region',{name:'动作库',exact:true}).waitFor()}
const openAction=async name=>{const list=p.getByRole('region',{name:'动作库',exact:true});await list.getByPlaceholder('搜索动作',{exact:true}).fill(name);await list.getByRole('button').filter({has:p.locator('b').filter({hasText:new RegExp('^'+name+'3D$')})}).first().click();await p.getByRole('region',{name:name+'动作演示',exact:true}).waitFor()}
try{
 await p.addInitScript(seed=>{if(!localStorage.getItem('r189-synthetic-seeded')){localStorage.setItem('fr255-strength-plan-v3',JSON.stringify(seed));localStorage.setItem('r189-synthetic-seeded','1')}},seed)
 await p.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await ready()
 check('model_not_requested_on_cold_start',!requested.some(r=>/human\.glb|viewer3d\.js|three\.module/.test(r.path)))
 const before=await plan();await openLibrary();check('library_76_actions',/76\s*个/.test(await p.getByRole('region',{name:'动作库',exact:true}).innerText()))
 check('library_does_not_fetch_3d_model',!requested.some(r=>/human\.glb/.test(r.path)))
 await openAction('俯卧撑');const detail=p.getByRole('region',{name:'俯卧撑动作演示',exact:true})
 await p.waitForFunction(()=>document.querySelector('section[aria-label="俯卧撑动作演示"] .hint')?.textContent?.includes('拖动旋转')||document.querySelector('section[aria-label="俯卧撑动作演示"] .hint')?.textContent?.includes('暂不可用'),{},{timeout:30000})
 const loaded=await detail.locator('.hint').innerText();check('actual_webgl_stage_loaded',/拖动旋转/.test(loaded),loaded)
 for(const name of ['正面','侧面','背面','斜侧']){await detail.getByRole('button',{name,exact:true}).click();check('view_'+name,await detail.getByRole('button',{name,exact:true}).getAttribute('aria-pressed')==='true')}
 await detail.getByRole('button',{name:'暂停',exact:true}).click();check('pause_toggle',await detail.getByRole('button',{name:'播放',exact:true}).isVisible());await detail.getByRole('button',{name:'播放',exact:true}).click()
 for(const name of ['慢放','鞋透明','赤脚','穿鞋'])await detail.getByRole('button',{name,exact:true}).click()
 await detail.locator('.anat').waitFor({state:'visible'});check('barefoot_anatomy_sole_labels',/足底/.test(await detail.locator('.anat').innerText()))
 for(const width of [375,390,393,414,768,1280]){await p.setViewportSize({width,height:900});await p.waitForTimeout(100);check('detail_width_'+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:`${screens}/${label}-motion-${width}.png`})}
 check('viewing_preserves_plan',await plan()===before)
 p.on('dialog',d=>d.accept());await detail.getByRole('button',{name:/加入今天训练/}).click();await p.getByRole('button',{name:'撤销本次加入',exact:true}).waitFor()
 check('real_add_saved_default_dose',await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fr255-strength-plan-v3')).sessions[0];return s.id==='today-synthetic'&&s.moves.length===1&&s.moves[0].catalogId==='pushup'&&s.moves[0].sets>0&&s.moves[0].weightKg===0}))
 await p.getByRole('button',{name:'撤销本次加入',exact:true}).click();check('undo_restores_original_course',await plan()===before)
 await openLibrary();await openAction('俯卧撑')
 const again=p.getByRole('region',{name:'俯卧撑动作演示',exact:true});await again.getByText('离线资源与来源',{exact:true}).click();await again.getByRole('button',{name:/下载动作资源/}).click();await again.getByRole('status').filter({hasText:'动作资源已缓存'}).waitFor({timeout:90000})
 check('explicit_download_cached_glb',await p.evaluate(async()=>!!await(await caches.open('fk-demo3d-r190-v1')).match('/demo3d/models/human.glb')))
 if(label==='prod'){
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await ctx.setOffline(true);await p.reload({waitUntil:'domcontentloaded'});await ready();await openLibrary();await openAction('俯卧撑');await p.getByRole('region',{name:'俯卧撑动作演示',exact:true}).locator('.hint').filter({hasText:'拖动旋转'}).waitFor({timeout:30000});check('offline_reload_reopens_cached_3d',true)
 }
 check('no_model_api_or_server_function_requests',!requested.some(r=>r.method==='POST'||/api\.deepseek|api\.x\.ai|api\.openai|generativelanguage/.test(r.origin)))
}catch(e){errors.push(String(e));results.push({name:'motion_flow',status:'FAIL',detail:String(e)});await p.screenshot({path:`${screens}/${label}-motion-failure.png`}).catch(()=>{})}
await ctx.close()
// Independent no-WebGL run, no cached model: instructions and animated 2D must remain.
const fallback=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})
const f=await fallback.newPage();f.setDefaultTimeout(30000)
await fallback.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort())
await f.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).includes('webgl'))return null;return original.call(this,type,...args)}})
try{
 await f.goto(base,{waitUntil:'domcontentloaded',timeout:120000});await f.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000});await f.getByRole('button',{name:'切换到计划',exact:true}).click();await f.getByRole('button',{name:'动作库 · 力量动作与跑步技术',exact:true}).click();const lib=f.getByRole('region',{name:'动作库',exact:true});await lib.getByPlaceholder('搜索动作',{exact:true}).fill('杠铃卧推');await lib.getByRole('button').filter({has:f.locator('b').filter({hasText:/^杠铃卧推3D$/})}).first().click();const d=f.getByRole('region',{name:'杠铃卧推动作演示',exact:true});await d.locator('.hint').filter({hasText:'3D暂不可用'}).waitFor({timeout:30000});check('no_webgl_keeps_2d_and_cues',await d.locator('.stage-fallback svg').isVisible()&&await d.getByText('准备',{exact:true}).isVisible());await f.screenshot({path:`${screens}/${label}-2d-fallback.png`})
}catch(e){errors.push(String(e));results.push({name:'fallback_flow',status:'FAIL',detail:String(e)})}
await fallback.close();await browser.close()
writeFileSync(`${out}/${label}-motion.json`,JSON.stringify({results,errors,requests:requested},null,2));console.log(JSON.stringify({label,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors}));if(errors.length||results.some(r=>r.status==='FAIL'))process.exitCode=1
