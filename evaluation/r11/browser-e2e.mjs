import {chromium} from 'playwright'
import {browserProxyTrustArgs} from '../../scripts/browser-proxy-trust.mjs'
import {mkdirSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs'
const screenshots='/workspace/screenshots/fangkun-r11',out='/workspace/fangkun/evidence/r11/browser'
mkdirSync(screenshots,{recursive:true});mkdirSync(out,{recursive:true});mkdirSync('evaluation/r11/screenshots',{recursive:true})
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage',...browserProxyTrustArgs()]})
const all=[],errors=[];let modelRequests=0
const correctedSets = text => /第1个力量组\s*50kg\s*×\s*8次/.test(text) && /第2个力量组\s*60kg\s*×\s*8次/.test(text) && /第3个力量组\s*60kg\s*×\s*8次/.test(text)
const save=async(p,name)=>{const path=`${screenshots}/${name}.png`;await p.screenshot({path,fullPage:false});copyFileSync(path,`evaluation/r11/screenshots/${name}.png`)}
for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
 const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},serviceWorkers:'block',acceptDownloads:true}),p=await context.newPage();p.setDefaultTimeout(25000)
 p.on('pageerror',e=>errors.push({viewport:viewport.name,error:String(e)}))
 await context.route(/api\.x\.ai|generativelanguage\.googleapis|api\.openai/,route=>{modelRequests++;return route.abort()})
 const check=(name,ok,detail)=>{const row={viewport:viewport.name,name,ok,detail};all.push(row);console.log(JSON.stringify(row));if(!ok)throw Error(name)}
 const load=async()=>{await p.goto('http://127.0.0.1:8080/',{waitUntil:'domcontentloaded',timeout:120000});await p.getByRole('button',{name:'切换到日志',exact:true}).waitFor();await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor();console.log(viewport.name+' hydrated')}
 const ask=async(question)=>{
  const count=await p.getByTestId('coach-answer').count()
  await p.getByPlaceholder('输入你的问题').fill(question);await p.getByRole('button',{name:'发送',exact:true}).click()
  await p.waitForFunction(n=>document.querySelectorAll('[data-testid="coach-answer"]').length>n,count)
  return p.getByTestId('coach-answer').last()
 }
 try{
  await load();await p.getByRole('button',{name:'切换到日志',exact:true}).click();await p.getByTestId('training-import-open').click();await p.getByTestId('manual-training-import').click();console.log(viewport.name+' manual form open')
  await p.locator('#import-basic select').selectOption('MIXED')
  await p.locator('#import-basic label').filter({hasText:'训练时间'}).locator('input').fill('2026-05-01T10:00:00Z')
  await p.locator('#import-basic label').filter({hasText:'标题'}).locator('input').fill(`R11 ${viewport.name} 合成混合课`)
  await p.locator('#import-basic label').filter({hasText:'总时长'}).locator('input').fill('3000')
  for(let i=0;i<2;i++){
   await p.locator('#import-running').getByRole('button',{name:'添加',exact:true}).click()
   await p.getByLabel('轮',{exact:true}).nth(i).fill('1');await p.getByLabel('次',{exact:true}).nth(i).fill(String(i+1))
   await p.getByLabel('完成状态',{exact:true}).nth(i).selectOption('COMPLETED')
   await p.getByLabel('距离米',{exact:true}).nth(i).fill('400');await p.getByLabel('用时秒',{exact:true}).nth(i).fill(String(81+i))
  }
  for(let i=0;i<3;i++){
   await p.locator('#import-strength').getByRole('button',{name:'添加',exact:true}).click()
   await p.getByLabel('力量完成状态',{exact:true}).nth(i).selectOption('COMPLETED');await p.getByLabel('动作',{exact:true}).nth(i).fill('合成深蹲')
   await p.getByLabel('第几组',{exact:true}).nth(i).fill(String(i+1));await p.getByLabel('重量',{exact:true}).nth(i).fill('60');await p.getByLabel('次数',{exact:true}).nth(i).fill('8')
  }
  console.log(viewport.name+' synthetic inputs filled');await p.getByRole('button',{name:'确认这份实际记录并分析',exact:true}).click();await p.getByRole('heading',{name:'训练记录已确认',exact:true}).waitFor()
  check('manual_import_ui',true,{modelCalls:0,actualUI:true})
  const record=await p.evaluate(async()=>{const m=await import('/src/lib/core/training-import.ts');return m.loadConfirmedTrainingImports().at(-1)})
  await p.getByRole('button',{name:'关闭',exact:true}).click();await p.getByRole('button',{name:`R11 ${viewport.name} 合成混合课`,exact:false}).click()
  await p.getByRole('button',{name:'问教练',exact:true}).click()
  const answer=await ask('复盘这次实际分段和力量完成记录')
  let text=await answer.textContent();const details=p.getByTestId('coach-fact-details').last();await details.locator('summary').click();text+='\n'+await details.textContent()
  check('import_select_ask_answer',/400米/.test(text)&&/60kg/.test(text)&&/8次/.test(text),{actualText:text.slice(0,1600)})
  await save(p,viewport.name+'-answer')
  await ask('整课RPE 6，训练负荷怎么算？')
  const before=await p.evaluate(async()=>{const m=await import('/src/lib/core/coach-import-rating.ts');return m.loadImportRatings().length})
  check('chat_rating_not_auto_saved',before===0,{before})
  const binding=p.getByLabel('选择训练记录').locator('xpath=ancestor::details[1]');await binding.locator('summary').first().click();await p.getByRole('button',{name:'保存为整课RPE',exact:true}).click();await binding.locator('summary').first().click()
  const rating=await p.evaluate(async()=>{const m=await import('/src/lib/core/coach-import-rating.ts');return m.loadImportRatings()})
  check('explicit_session_rating_save',rating.length===1&&rating[0].value===6,{ratings:rating.length})
  await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
  const analysis=p.getByTestId('coach-analysis'),loadPanel=p.getByTestId('load-metrics-panel')
  await analysis.locator(':scope > summary').click();await p.getByTestId('load-metrics-summary').click()
  await p.getByTestId('load-metrics-end-day').fill('2026-05-01')
  await p.getByTestId('load-metrics-output').filter({hasText:'资料不足'}).waitFor()
  check('load_missing_days_not_zero',!await p.getByTestId('load-metrics-confirm').isChecked()&&await p.getByTestId('load-metrics-save').isDisabled(),{text:await p.getByTestId('load-metrics-output').textContent()})
  await p.getByTestId('load-metrics-confirm').check();await p.getByTestId('load-metrics-save').click()
  await p.getByTestId('load-metrics-output').filter({hasText:'比值 3.63'}).waitFor()
  const loadText=await p.getByTestId('load-metrics-output').textContent()
  check('saved_session_load_ewma',/75\.0 AU/.test(loadText)&&/20\.7 AU/.test(loadText)&&/3\.63/.test(loadText)&&!/受伤风险|概率|甜区/.test(loadText),{text:loadText,sessionRpe:6,wholeSessionMinutes:50,explicitDateCoverage:true})
  await p.getByTestId('load-metrics-output').scrollIntoViewIfNeeded();await save(p,viewport.name+'-load')
  await loadPanel.locator(':scope > summary').click();await analysis.locator(':scope > summary').click()
  await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'对话',exact:true}).click()
  await p.getByTestId('coach-disclaimer').locator('summary').click()
  check('disclaimer',await p.getByTestId('coach-disclaimer').innerText().then(t=>t.includes('不是医疗诊断')),{})
  // Instrument exactly the feedback transaction. Dynamic test module imports happen outside this window.
  await p.evaluate(()=>{window.__feedbackNetwork=0;const f=window.fetch;window.fetch=function(...args){window.__feedbackNetwork++;return f.apply(this,args)};const s=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(...args){window.__feedbackNetwork++;return s.apply(this,args)}})
  const feedback=p.getByTestId('coach-feedback').last();await feedback.locator('summary').click();await feedback.getByLabel('回答反馈内容').fill('R11 合成反馈：请明确整课与末组的区别')
  await feedback.getByTestId('coach-feedback-save').click();await feedback.getByRole('status').filter({hasText:'反馈已保存到本机'}).waitFor()
  const downloadPromise=p.waitForEvent('download');await feedback.getByRole('button',{name:'导出我的反馈'}).click();const download=await downloadPromise
  const file=`${out}/${viewport.name}-feedback.json`;await download.saveAs(file)
  const exported=JSON.parse(readFileSync(file,'utf8')),network=await p.evaluate(()=>window.__feedbackNetwork)
  const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('fr255-coach-answer-feedback-v1')).data)
  check('feedback_local_export_no_network',network===0&&exported.feedback.at(-1).note===stored.at(-1).note&&stored.at(-1).note==='R11 合成反馈：请明确整课与末组的区别',{fetchXHR:network,exported:exported.feedback.length})
  // Use the visible import correction UI: only the first set changes.
  await p.getByRole('button',{name:'切换到日志',exact:true}).click();await p.getByRole('button',{name:`R11 ${viewport.name} 合成混合课`,exact:false}).click()
  const edit=p.getByTestId('import-correction');await edit.locator('summary').click();await edit.getByLabel('更正导入力量组').selectOption(record.strengthSets[0].id)
  await edit.getByLabel('更正后重量').fill('50');await edit.getByLabel('导入更正原因').fill('合成验收：第一组误录');await edit.getByRole('button',{name:'确认导入更正'}).click()
  await p.getByRole('button',{name:'问教练',exact:true}).click();const corrected=await ask('复盘这次力量实际完成量')
  check('first_set_correction_visible',correctedSets(await corrected.textContent()),{text:await corrected.textContent()})
  await p.reload({waitUntil:'domcontentloaded'});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor();await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
  const select=p.getByLabel('选择训练记录');await select.locator('xpath=ancestor::details[1]').locator('summary').first().click();await select.selectOption(record.confirmedImportId);await select.locator('xpath=ancestor::details[1]').locator('summary').first().click()
  const reloaded=await ask('复盘这次力量实际完成量')
  check('correction_survives_refresh',correctedSets(await reloaded.textContent()),{})
  await save(p,viewport.name+'-corrected')
  await p.getByRole('button',{name:'切换到日志',exact:true}).click();await p.getByRole('button',{name:`R11 ${viewport.name} 合成混合课`,exact:false}).click();await p.getByTestId('import-void-toggle').click()
  await p.getByRole('button',{name:'切换到方坤',exact:true}).click();const withdrawn=await ask('这份刚作废的训练还可以分析吗？')
  check('voided_import_not_reused',!/(?:50|60)\s*kg|400米|81秒|82秒/.test(await withdrawn.textContent()),{text:await withdrawn.textContent()})
  const emergency=await ask('我的队友刚在34度操场跑完，皮肤干热、答非所问')
  const emergencyText=await emergency.textContent()
  check('emergency_override_no_candidate',/120/.test(emergencyText)&&/降温/.test(emergencyText)&&!/下一课|RPE|睡眠|候选/.test(emergencyText),{text:emergencyText})
  const bubble=emergency.locator('..');check('emergency_no_details_or_next_card',await bubble.getByTestId('coach-fact-details').count()===0&&await bubble.getByTestId('coach-next-session').count()===0,{})
  check('viewport_no_overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{viewport})
  await save(p,viewport.name+'-emergency')
 }catch(e){all.push({viewport:viewport.name,name:'ERROR',ok:false,detail:String(e)});console.log(String(e));await save(p,viewport.name+'-error').catch(()=>{})}
 finally{await context.close()}
}
await browser.close();const verdict={steps:all,pageErrors:errors,modelRequests,modelCalls:0,syntheticDataOnly:true,realDevices:false,pass:all.every(x=>x.ok)&&!errors.length&&modelRequests===0}
writeFileSync(`${out}/verdict.json`,JSON.stringify(verdict,null,2));writeFileSync('evaluation/r11/verdict.json',JSON.stringify(verdict,null,2));if(!verdict.pass)process.exitCode=1
