import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
const out='/workspace/screenshots/fangkun-r8-correction';mkdirSync(out,{recursive:true})
const b=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage']})
const c=await b.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'}),p=await c.newPage();p.setDefaultTimeout(90000)
const steps=[],errors=[];p.on('pageerror',e=>errors.push(String(e)))
const step=(name,ok,detail)=>{steps.push({name,ok,detail});console.log(JSON.stringify(steps.at(-1)))}
try{
 await p.goto('http://127.0.0.1:8080/',{waitUntil:'domcontentloaded',timeout:120000});await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 const id=await p.evaluate(async()=>{
  const e=await import('/src/lib/core/events.ts'),o=await import('/src/lib/core/occurrence.ts')
  const sessionId='qa-strength',move={id:'squat',catalogId:'squat',customName:'合成深蹲',sets:1,amount:8,weightKg:60,mode:'reps',restSec:60}
  const s=e.dispatchEvent('TRAINING_STARTED',{sessionId});if(!s)throw Error('start failed')
  o.bindTrainingStart({startEventId:s.event_id,startedAt:s.timestamp,sessionId,planSlotId:sessionId,plan:{id:sessionId,name:'浏览器合成力量课',moves:[move]}})
  e.dispatchEvent('TRAINING_SET_COMPLETED',{trainingOccurrenceId:s.event_id,sessionId,moveId:'squat',name:'合成深蹲',setIndex:1,mode:'reps',actualWeight:60,actualAmount:8,completed:true,skipped:false})
  const end=e.dispatchEvent('TRAINING_COMPLETED',{sessionId,trainingOccurrenceId:s.event_id});o.closeTrainingOccurrence(end)
  return s.event_id
 })
 await p.getByRole('button',{name:'看日志'}).click()
 await p.getByRole('button',{name:/浏览器合成力量课/}).click()
 await p.getByRole('button',{name:'纠正这组',exact:true}).click()
 const dialog=p.getByRole('dialog');await dialog.getByLabel('改成',{exact:true}).fill('50');await dialog.getByLabel('原因',{exact:true}).fill('浏览器验收：核对实际重量')
 await dialog.getByRole('button',{name:'下一步',exact:true}).click();await dialog.getByRole('button',{name:'确认纠正',exact:true}).click()
 const body=await p.locator('body').innerText();step('strength_correction_ui',body.includes('有效 50 kg')&&body.includes('原记录 60 kg'),{syntheticStartAndSetViaAPI:true,correctionViaUI:true})
 await p.screenshot({path:`${out}/corrected.png`})
 await p.getByRole('button',{name:'问教练',exact:true}).click()
 await p.getByPlaceholder('输入你的问题').fill('分析这次力量训练实际完成量')
 await p.getByRole('button',{name:'发送',exact:true}).click()
 await p.getByTestId('coach-answer').last().waitFor()
 const answer=await p.locator('body').innerText();step('corrected_strength_to_coach',answer.includes('50kg')&&answer.includes('8次'),{})
 await p.screenshot({path:`${out}/coach.png`})
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!document.body.innerText.includes('读取中'))
 const result=await p.evaluate(async id=>{const m=await import('/src/lib/core/coach-v4-formal-rows-store.ts'),a=await import('/src/lib/core/coach-v4-c11-adapter.ts');const f=m.readFormalEvidenceRows('local');return a.reviewFormalEvidence({athleteId:'local',asOf:new Date().toISOString(),rows:f.rows,question:'分析',scopeOccurrenceIds:[id]}).audit.snapshot.active.filter(r=>r.metric==='STRENGTH_KG')},id)
 step('correction_reload',result.length===1&&result[0].value===50,{activeRows:result})
}catch(e){step('ERROR',false,String(e));await p.screenshot({path:`${out}/error.png`}).catch(()=>{})}
finally{writeFileSync(`${out}/verdict.json`,JSON.stringify({steps,pageErrors:errors,modelCalls:0},null,2));await b.close()}
if(steps.some(s=>!s.ok)||errors.length)process.exitCode=1
