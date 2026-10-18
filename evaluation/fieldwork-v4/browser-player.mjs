import {chromium} from 'playwright'
import {writeFileSync,mkdirSync} from 'node:fs'
const base=process.argv[2],label=process.argv[3]||'dev',out='/workspace/fangkun/evidence/fieldwork-v4/browser',screens='/workspace/screenshots/fangkun-fieldwork-v4'
mkdirSync(out,{recursive:true});mkdirSync(screens,{recursive:true})
const results=[],errors=[],requests=[],diagnostics=[]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const check=(name,ok,detail='')=>{results.push({name,status:ok?'PASS':'FAIL',detail});console.log(JSON.stringify(results.at(-1)));if(!ok)throw Error(name+': '+detail)}
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:label==='prod'?'allow':'block'})
await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort())
context.on('request',r=>requests.push({path:new URL(r.url()).pathname,method:r.method()}))
const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.text().includes('[fangkun-demo-load]')){diagnostics.push(m.text());console.log(m.text())}})
page.on('console',m=>{if(m.type()==='error')diagnostics.push('console: '+m.text())})
page.on('requestfailed',r=>diagnostics.push('request failed: '+r.url()+' '+r.failure()?.errorText))
page.on('response',r=>{if(r.status()>=400)diagnostics.push('HTTP '+r.status()+': '+r.url())})
const ready=async()=>{await page.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000});await page.getByTestId('fieldwork-view').locator('.page-intro').waitFor({timeout:60000})}
const open=async()=>{await page.getByRole('button',{name:'切换到身体',exact:true}).click();const v=page.getByTestId('fieldwork-view');await v.locator('[data-library="strength"]').click();await v.locator('[data-field="search"]').fill('俯卧撑');await v.locator('[data-details="pushup"]').first().click();await v.locator('[data-play="pushup"]').click();await page.getByRole('dialog',{name:'原版动作演示',exact:true}).waitFor()}
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:90000});await ready();
 if(label==='prod'){await page.waitForFunction(()=>!!navigator.serviceWorker.controller);try{await page.reload({waitUntil:'domcontentloaded'})}catch(e){if(!String(e).includes('ERR_ABORTED'))throw e}await ready()}
 check('no_cold_boot_model_download',!requests.some(r=>/human\.glb/.test(r.path)))
 await open();const detail=page.getByRole('region',{name:'俯卧撑动作演示',exact:true})
 await detail.locator('.hint').filter({hasText:/拖动旋转|暂不可用/}).waitFor({timeout:60000});const hint=await detail.locator('.hint').innerText();check('app_player_actual_webgl_stage',hint.includes('拖动旋转'),hint)
 for(const direction of ['正面','侧面','背面','斜侧']){await detail.getByRole('button',{name:direction,exact:true}).click();check('view_'+direction,await detail.getByRole('button',{name:direction,exact:true}).getAttribute('aria-pressed')==='true')}
 await detail.getByRole('button',{name:'暂停',exact:true}).click();check('pause_and_resume',await detail.getByRole('button',{name:'播放',exact:true}).isVisible());await detail.getByRole('button',{name:'播放',exact:true}).click()
 for(const mode of ['慢放','鞋透明','赤脚','穿鞋'])await detail.getByRole('button',{name:mode,exact:true}).click()
 check('viewing_does_not_offer_direct_formal_plan_write',await detail.getByRole('button',{name:/加入今天训练/}).count()===0)
 for(const width of [390,820]){await page.setViewportSize({width,height:900});await detail.locator('.stage3').scrollIntoViewIfNeeded();await page.screenshot({path:`${screens}/${label}-player-${width}.png`});check('player_width_'+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
 await detail.getByText('离线资源与来源',{exact:true}).click();await detail.getByRole('button',{name:/下载动作资源/}).click();await detail.getByRole('status').filter({hasText:'动作资源已缓存'}).waitFor({timeout:90000})
 check('explicit_model_cache_completed',await page.evaluate(async()=>!!await(await caches.open('fk-demo3d-fieldwork-v4-v1')).match('/demo3d/models/human.glb')))
 if(label==='prod'){
  await page.getByRole('button',{name:'关闭原版动作演示',exact:true}).click();await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await ready();await open();await page.getByRole('region',{name:'俯卧撑动作演示',exact:true}).locator('.hint').filter({hasText:'拖动旋转'}).waitFor({timeout:30000});check('cached_player_reopens_after_offline_refresh',true);await page.screenshot({path:`${screens}/${label}-player-offline.png`})
 }
 check('no_mutation_or_model_api_requests',requests.every(r=>r.method==='GET'))
}catch(e){errors.push(String(e));results.push({name:'player_flow',status:'FAIL',detail:String(e)});await page.screenshot({path:`${screens}/${label}-player-failure.png`}).catch(()=>{})}
await context.close()
const fallback=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'}),p=await fallback.newPage();p.setDefaultTimeout(20000)
await fallback.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort())
await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).includes('webgl')?null:original.call(this,type,...args)}})
try{
 await p.goto(base,{waitUntil:'domcontentloaded',timeout:90000});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000});await p.getByTestId('fieldwork-view').locator('.page-intro').waitFor({timeout:60000});await p.getByRole('button',{name:'切换到身体',exact:true}).click();const v=p.getByTestId('fieldwork-view');await v.locator('[data-library="strength"]').click();await v.locator('[data-field="search"]').fill('俯卧撑');await v.locator('[data-details="pushup"]').first().click();await v.locator('[data-play="pushup"]').click();const d=p.getByRole('region',{name:'俯卧撑动作演示',exact:true});await d.locator('.hint').filter({hasText:'3D暂不可用'}).waitFor({timeout:60000});check('no_webgl_preserves_2d_and_text',await d.locator('.stage-fallback svg').isVisible()&&await d.getByText('准备',{exact:true}).isVisible());check('reduced_motion_does_not_autoplay',await d.getByRole('button',{name:'播放',exact:true}).isVisible());await p.screenshot({path:`${screens}/${label}-player-fallback.png`})
}catch(e){errors.push(String(e));results.push({name:'fallback_flow',status:'FAIL',detail:String(e)})}
await fallback.close();await browser.close();writeFileSync(`${out}/${label}-player.json`,JSON.stringify({results,errors,requests,diagnostics},null,2));console.log(JSON.stringify({label,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors}));if(errors.length||results.some(r=>r.status==='FAIL'))process.exitCode=1
