import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const out='/workspace/screenshots/fangkun-r8-linkage';mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']})
const steps=[],errors=[],requests=[]
const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),p=await ctx.newPage();p.setDefaultTimeout(60000)
p.on('pageerror',e=>errors.push(String(e)));p.on('requestfailed',r=>requests.push({url:r.url(),error:r.failure()?.errorText}))
const step=(name,ok,detail)=>{steps.push({name,ok,detail});console.log(JSON.stringify(steps.at(-1)))}
try{
 await p.goto('http://127.0.0.1:8080/',{waitUntil:'domcontentloaded',timeout:120000})
 await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 const seed=await p.evaluate(async()=>{
  const m=await import('/src/lib/core/training-import.ts'),f=v=>({value:v,status:'RECORDED',sourceIds:['user-confirmed']})
  const d=m.createTrainingImportDraft({sport:'MIXED',occurredAt:f('2026-03-01T10:00:00Z'),title:f('浏览器合成验收课'),runningStructure:'REPEATED',sessionRpe:f(6),subjectiveRecovery:f(7),runningSegments:[1,2].map(n=>({id:`r${n}`,kind:'REPETITION',round:f(1),repeat:f(n),distanceMeters:f(400),durationSeconds:f(60+n),completion:'COMPLETED',sourceIds:['user-confirmed']})),strengthSets:[{id:'sq',exerciseName:f('深蹲'),setOrdinal:f(1),weightKg:f(50),repetitions:f(8),completion:'COMPLETED',sourceIds:['user-confirmed']}]},'TEXT',['user-confirmed'])
  const saved=m.confirmTrainingImport(d);if(!saved.ok)throw Error(saved.reason)
  return saved.record.confirmedImportId
 })
 await p.getByRole('button',{name:'方坤'}).click()
 const selector=p.getByLabel('选择训练记录');await selector.locator('..').evaluate(el=>{const d=el.closest('details');if(d)d.open=true})
 await selector.selectOption(seed)
 await p.getByPlaceholder('输入你的问题').fill('分析这次实际配速和力量记录')
 await p.getByRole('button',{name:'发送',exact:true}).click()
 await p.getByTestId('coach-answer').last().waitFor()
 const body=await p.locator('body').innerText();step('import_to_coach_ui',body.includes('400米')&&body.includes('50kg')&&body.includes('8次'),{syntheticFixture:true,via:'confirmed import public API, real selector and send UI'})
 await p.screenshot({path:`${out}/desktop-coach.png`,fullPage:false})
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 const saved=await p.evaluate(async id=>{const m=await import('/src/lib/core/coach-v4-formal-rows-store.ts');return m.readFormalEvidenceRows('local').rows.filter(r=>r.trainingOccurrenceId===id)},seed)
 step('reload_preserves_formal_rows',saved.some(r=>r.metric==='STRENGTH_KG'&&r.value===50)&&saved.filter(r=>r.metric==='SPLIT_SECONDS').length===2,{rows:saved.length})
 const deleted=await p.evaluate(async id=>{const m=await import('/src/lib/core/training-import.ts'),v=await import('/src/lib/core/coach-v4-formal-rows-store.ts');return m.permanentlyDeleteConfirmedTrainingImport(id)&&!v.readFormalEvidenceRows('local').rows.some(r=>r.trainingOccurrenceId===id)},seed)
 step('delete_withdraws_import',deleted,{via:'real delete and formal reader APIs'})
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:`${out}/mobile-home.png`})
 step('mobile_layout',(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)),{viewport:'390x844',physicalPhone:false})
 await ctx.storageState({path:`${out}/synthetic-storage.json`})
}catch(e){step('ERROR',false,String(e));await p.screenshot({path:`${out}/error.png`}).catch(()=>{})}
finally{writeFileSync(`${out}/verdict.json`,JSON.stringify({steps,pageErrors:errors,failedRequests:requests,modelCalls:0,syntheticFixtures:true},null,2));await browser.close()}
if(steps.some(s=>!s.ok)||errors.length)process.exitCode=1
