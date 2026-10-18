import {chromium} from 'playwright'
import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'

const url=process.argv[2]??'http://127.0.0.1:8087',label=process.argv[3]??'dev'
const out='/workspace/fangkun/evidence/r189/browser',screens='/workspace/screenshots/fangkun-r189'
mkdirSync(out,{recursive:true});mkdirSync(screens,{recursive:true})
// Synthetic fixture uses the same existing transaction APIs as the application.
// No fixture bypasses an assertion or writes to any real browser profile.
const fixtureProcess=spawnSync(process.execPath,['--import','./scripts/test-register.mjs','--input-type=module','-e',`
import {setStoreBackend} from './src/lib/core/storage.ts';
import {setEventContext,loadEvents} from './src/lib/core/events.ts';
import {saveCustomTrackPlan,startTrackSession,commitTrackSlot} from './src/lib/ui/running-workouts.ts';
import {projectRunningExecution} from './src/lib/core/running-execution.ts';
const data=new Map();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),keys:()=>[...data.keys()]});setEventContext({athleteId:'local'});
const plan=saveCustomTrackPlan('r189-synthetic-run',1,null,[{distanceMeters:200,repeatCount:2,targetSeconds:40,repRestSeconds:120,stepRestSeconds:null}]);if(!plan.ok)throw Error('fixture plan');
const start=startTrackSession('r189-synthetic-run');if(!start.ok)throw Error('fixture start');
const slot=projectRunningExecution(start.trainingOccurrenceId,loadEvents()).repetitions[0];if(!commitTrackSlot(slot,'complete','39','200').ok)throw Error('fixture actual');
console.log(JSON.stringify({storage:Object.fromEntries(data),occurrenceId:start.trainingOccurrenceId}));
`],{cwd:process.cwd(),encoding:'utf8',timeout:120000})
if(fixtureProcess.status!==0)throw Error(fixtureProcess.stderr||fixtureProcess.stdout||'fixture failed')
const fixture=JSON.parse(fixtureProcess.stdout.trim())
const results=[],errors=[],requests=[]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']})
for(const flow of ['segment-rpe','food-time']){
 const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'UTC',serviceWorkers:label==='prod'?'allow':'block'})
 let external=0
 await ctx.route('**/*',r=>{if(new URL(r.request().url()).origin!==new URL(url).origin){external++;return r.abort()}return r.continue()})
 await ctx.addInitScript(data=>{if(!localStorage.getItem('r189-ui-fixture-seeded')){for(const[k,v]of Object.entries(data))localStorage.setItem(k,v);localStorage.setItem('r189-ui-fixture-seeded','1')}},fixture.storage)
 const p=await ctx.newPage();p.setDefaultTimeout(20000)
 p.on('pageerror',e=>errors.push({flow,error:String(e)}))
 const ready=()=>p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000})
 const check=(name,ok,detail='')=>{results.push({flow,name,status:ok?'PASS':'FAIL',detail});if(!ok)throw Error(name+': '+detail)}
 const journal=()=>p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-event-journal-v2:')).map(([,v])=>JSON.parse(v).data))
 const openRun=async()=>{await p.getByRole('button',{name:'切换到日志',exact:true}).click();await p.getByRole('button').filter({hasText:/跑步 1\/2 段/}).click();await p.getByRole('textbox',{name:'本段RPE',exact:true}).waitFor()}
 const openFood=async()=>{await p.getByRole('button',{name:'切换到今日',exact:true}).click();await p.getByRole('button',{name:/记饮食/}).click();await p.getByLabel('实际进食时间',{exact:true}).waitFor()}
 const meals=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('fr255-food-log-v1')??'[]'))
 const addFood=async(text)=>{await p.locator('#food-query').fill(text);await p.getByRole('button',{name:'预览',exact:true}).click();await p.getByRole('button',{name:'确认记录',exact:true}).click()}
 const reload=async()=>{await p.reload({waitUntil:'domcontentloaded',timeout:90000});await ready()}
 try{
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await ready()
  if(label==='prod'){await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await reload()}
  const planBefore=await p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('plan')))))
  if(flow==='segment-rpe'){
   await openRun();check('only_completed_segment_has_optional_rpe',await p.getByRole('textbox',{name:'本段RPE',exact:true}).count()===1)
   const input=p.getByRole('textbox',{name:'本段RPE',exact:true});check('missing_segment_rpe_stays_blank',await input.inputValue()==='')
   await input.fill('6.5');await p.getByRole('button',{name:'保存本段评分',exact:true}).click();await p.getByRole('status').filter({hasText:'本段评分已保存'}).waitFor()
   let ratings=(await journal()).filter(e=>e.event_type==='RPE_RECORDED')
   check('segment_rating_saved_as_set_not_session_rpe',ratings.length===1&&ratings[0].payload.evidenceType==='SET_RPE'&&ratings[0].payload.value===6.5&&ratings[0].payload.trainingOccurrenceId===fixture.occurrenceId&&ratings[0].payload.unit==='RUNNING')
   await p.getByRole('button',{name:'保存本段评分',exact:true}).click();check('same_rating_retry_is_idempotent',(await journal()).filter(e=>e.payload.evidenceType==='SET_RPE').length===1)
   await reload();await openRun();check('segment_rating_survives_refresh',await p.getByRole('textbox',{name:'本段RPE',exact:true}).inputValue()==='6.5')
   await p.getByRole('textbox',{name:'本段RPE',exact:true}).fill('7');await p.getByRole('button',{name:'保存本段评分',exact:true}).click()
   ratings=(await journal()).filter(e=>e.payload.evidenceType==='SET_RPE');check('rating_revision_preserves_original_and_link',ratings.length===2&&ratings[0].payload.value===6.5&&ratings[1].payload.value===7&&ratings[1].payload.supersedes===ratings[0].event_id)
   await p.getByRole('textbox',{name:'本段RPE',exact:true}).fill('11');await p.getByRole('button',{name:'保存本段评分',exact:true}).click();await p.getByRole('status').filter({hasText:'评分无效'}).waitFor();check('invalid_rating_does_not_overwrite_completed_data',(await journal()).filter(e=>e.payload.evidenceType==='SET_RPE').length===2&&/实际 200 米 · 39 秒/.test(await p.locator('body').innerText()))
  }else{
   await openFood();await addFood('面条200克');let entries=await meals()
   check('omitted_eating_time_is_not_invented',entries.length===1&&entries[0].eatenAt===undefined)
   await p.getByLabel('实际进食时间',{exact:true}).fill('09:15');await addFood('鸡蛋100克');entries=await meals()
   check('explicit_eating_time_saved',entries.length===2&&entries[1].eatenAt===new Date(new Date().toISOString().slice(0,10)+'T09:15:00Z').toISOString(),JSON.stringify(entries.map(e=>({name:e.name,eatenAt:e.eatenAt}))))
   await reload();await openFood();entries=await meals();check('eating_times_survive_refresh_with_unknown_preserved',entries.length===2&&entries[0].eatenAt===undefined&&/T09:15:00.000Z$/.test(entries[1].eatenAt))
   const timing=p.locator('details').filter({has:p.locator('summary',{hasText:'训练前后进食记录'})});await timing.locator('summary').click();const timingText=await timing.innerText()
   check('run_window_uses_run_kind_and_unknown_actual_end',/跑步/.test(timingText)&&/实际结束时间未知，不估算窗口/.test(timingText),timingText)
   check('untimed_meal_not_used_as_timing_or_adequacy',/1条餐食未填写实际进食时间/.test(timingText)&&/有进食记录不代表摄入充足/.test(timingText))
   await p.getByLabel('实际进食时间',{exact:true}).fill('');await p.getByRole('region',{name:'最近吃过的食物'}).getByRole('button').filter({hasText:'鸡蛋'}).click();entries=await meals();check('repeat_food_does_not_reuse_previous_timestamp',entries.length===3&&entries[2].eatenAt===undefined)
   if(label==='prod'){await p.waitForFunction(async()=>{const c=await caches.open('fr255-shell-2');return !!await c.match('/')});await ctx.setOffline(true);await reload();await openFood();check('offline_reload_preserves_food_and_optional_time',(await meals()).length===3);await ctx.setOffline(false)}
  }
  check('new_data_ui_does_not_modify_plan',planBefore===await p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('plan'))))))
  check('no_external_requests',external===0,String(external))
  await p.screenshot({path:`${screens}/${label}-${flow}.png`,fullPage:true})
 }catch(e){errors.push({flow,error:String(e)});results.push({flow,name:'flow_completed',status:'FAIL',detail:String(e)});await p.screenshot({path:`${screens}/${label}-${flow}-failure.png`,fullPage:true}).catch(()=>{})}
 finally{requests.push({flow,external});await ctx.close()}
}
await browser.close();const report={label,results,errors,requests};writeFileSync(`${out}/${label}-data-ui.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({label,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors}));if(errors.length||results.some(r=>r.status==='FAIL'))process.exitCode=1
