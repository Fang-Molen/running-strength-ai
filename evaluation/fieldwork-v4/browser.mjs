import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
const base=process.argv[2],label=process.argv[3]||'dev',out='/workspace/fangkun/evidence/fieldwork-v4/browser',screens='/workspace/screenshots/fangkun-fieldwork-v4'
mkdirSync(out,{recursive:true});mkdirSync(screens,{recursive:true})
const results=[],errors=[],requests=[]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']})
const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:label==='prod'?'allow':'block'})
await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort())
ctx.on('request',r=>requests.push({path:new URL(r.url()).pathname,origin:new URL(r.url()).origin,method:r.method(),type:r.resourceType()}))
const p=await ctx.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(String(e)))
const check=(name,ok,detail='')=>{const row={name,status:ok?'PASS':'FAIL',detail};results.push(row);console.log(JSON.stringify(row));if(!ok)throw Error(name+': '+detail)}
const ready=async()=>{await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000});await p.locator('[data-testid="fieldwork-view"] .page-intro').waitFor({timeout:60000})}
const view=()=>p.getByTestId('fieldwork-view')
const formal=()=>p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>/strength-plan|running-plan|fr255-events|fr255-event-journal/.test(k)).sort(([a],[b])=>a.localeCompare(b)))))
const plans=()=>p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-fieldwork-plan-draft-v1:')).map(([key,value])=>({key,raw:value,order:JSON.parse(value).order,row:JSON.parse(value).data})).sort((a,b)=>a.order-b.order))
const day=()=>p.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})
const nav=async name=>p.getByRole('button',{name:'切换到'+name,exact:true}).click()
const library=async()=>{await nav('身体');await view().locator('.catalog-grid').waitFor()}
const search=async query=>view().locator('input[data-field="search"]').fill(query)
const dialog=()=>view().getByRole('dialog')
const savePlan=async({date,sets='',amount='',rest='',unit='m',slot='technique'}={})=>{const d=dialog();if(date)await d.locator('[name="date"]').fill(date);await d.locator('[name="slot"]').selectOption(slot);await d.locator('[name="sets"]').fill(sets);await d.locator('[name="amount"]').fill(amount);await d.locator('[name="rest"]').fill(rest);await d.locator('[name="unit"]').selectOption(unit);await d.locator('button[type="submit"]').click()}
const snapshot=async name=>{for(const width of [390,820]){await p.setViewportSize({width,height:900});await p.screenshot({path:`${screens}/${label}-${name}-${width}.png`});check(name+'_width_'+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}await p.setViewportSize({width:390,height:844})}
try{
 await p.addInitScript(()=>{
  if(localStorage.getItem('fw-synthetic-seeded'))return
  localStorage.setItem('fw-synthetic-seeded','1')
  localStorage.setItem('fr255-strength-plan-v3',JSON.stringify({name:'V4合成原课表',kind:'custom',sessions:[{id:'v4-synthetic-strength',name:'合成力量原课',moves:[]}]}))
  localStorage.setItem('fr255-running-plan-v1',JSON.stringify({schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),data:{plans:[{runningPlanSchemaVersion:1,planId:'v4-synthetic-200',planSlotId:'v4-synthetic-200',components:[{componentId:'run',modality:'RUNNING',purpose:'REPETITION_SPEED',structure:{kind:'REPEATED',blocks:[{blockId:'main',roundCount:2,recoveryAfterRoundSeconds:480,steps:[{stepId:'rep200',plannedDistanceMeters:200,plannedDurationSeconds:32,repeatCount:4,recoveryAfterRepeatSeconds:120,recoveryBeforeNextStepSeconds:null}]}]}}]}],snapshots:[]}}))
 })
 await p.goto(base,{waitUntil:'domcontentloaded',timeout:90000});await ready()
 if(label==='prod'){await p.waitForFunction(()=>!!navigator.serviceWorker.controller);try{await p.reload({waitUntil:'domcontentloaded'})}catch(e){if(!String(e).includes('ERR_ABORTED'))throw e}await ready()}
 const before=await formal(),today=await day(),draftDate=await p.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})
 check('five_original_navigation_entries',await p.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button').count()===5)
 check('host_not_design_demo_seed',!await p.evaluate(()=>localStorage.getItem('fk-fieldwork-v4-design-preview-only')))
 check('structured_course_2_rounds_4_repeats_both_rests',/2 × \(4 × 200m\)/.test(await view().innerText())&&/2个大组/.test(await view().innerText())&&/组间休息120秒/.test(await view().innerText())&&/大组休息480秒/.test(await view().innerText()))
 check('empty_drafts_and_actuals_are_distinct',await view().locator('.plan-entry').count()===0&&/尚未执行/.test(await view().innerText()))
 check('model_not_downloaded_on_boot',!requests.some(r=>/human\.glb|viewer3d\.js/.test(r.path)))
 await snapshot('today')
 await library();check('body_library_running_count_and_pagination',/53/.test(await view().innerText())&&await view().locator('.action-card').count()===12)
 while(await view().locator('[data-more]').count())await view().locator('[data-more]').click()
 check('all_53_running_drills_available',await view().locator('.action-card').count()===53)
 check('all_nine_categories_reachable',await view().locator('[data-filter]').count()===10)
 await search('A式行进');check('original_drill_id_search',await view().locator('[data-add="fk-run-tech-007"]').count()===1)
 await snapshot('library')
 await view().locator('[data-add="fk-run-tech-007"]').click();check('draft_form_dose_starts_unknown',await dialog().locator('[name="sets"]').inputValue()===''&&await dialog().locator('[name="amount"]').inputValue()===''&&await dialog().locator('[name="rest"]').inputValue()==='')
 await savePlan({date:draftDate,slot:'warmup',sets:'2',amount:'15',rest:'30',unit:'m'})
 await view().locator('.plan-entry').waitFor();const first=(await plans())[0]
 check('canonical_draft_saved_and_returned_to_selected_date',first.row.draft.uid.startsWith('draft-')&&first.row.draft.plannedOnly===true&&first.row.draft.date===draftDate&&await view().locator('input[data-field="date"]').inputValue()===draftDate)
 check('drill_content_version_and_review_state_retained',first.row.draft.id==='fk-run-tech-007'&&first.row.draft.contentVersion==='1.0.0'&&first.row.draft.reviewStatus==='draft_needs_coach_review')
 check('adding_draft_does_not_change_formal_plan_or_training_facts',await formal()===before)
 await view().locator('[data-edit]').click();await savePlan({date:draftDate,slot:'warmup',sets:'3',amount:'20',rest:'45',unit:'m'});await dialog().waitFor({state:'detached'})
 const edited=(await plans()).at(-1);check('edit_retains_id_appends_history_and_new_dose',edited.row.draft.uid===first.row.draft.uid&&edited.row.previousRevision===first.row.revisionId&&edited.row.draft.amount===20&&(await plans()).find(r=>r.key===first.key).raw===first.raw,JSON.stringify({first:first.row,edited:edited.row}))
 await library();await search('A式行进');await view().locator('[data-add="fk-run-tech-007"]').click();const countBeforeDuplicate=(await plans()).length;await savePlan({date:draftDate,slot:'warmup',sets:'2',amount:'15',rest:'30',unit:'m'});await view().locator('.toast').filter({hasText:'已包含这个动作'}).waitFor()
 check('duplicate_same_date_section_action_rejected',await dialog().isVisible()&&(await plans()).length===countBeforeDuplicate)
 await dialog().getByRole('button',{name:'取消',exact:true}).click();await nav('今日');await view().locator('.plan-entry [data-details]').first().click()
 check('today_drill_opens_its_own_details',/A式行进/.test(await dialog().innerText())&&/待教练审核/.test(await dialog().innerText()))
 await dialog().getByRole('button',{name:'关闭',exact:true}).first().click();await view().locator('[data-remove]').click();await view().locator('.plan-entry').waitFor({state:'detached'})
 check('remove_retains_original_history', (await plans()).length===3&&(await plans()).at(-1).row.action==='REMOVE'&&(await plans()).find(r=>r.key===first.key).raw===first.raw)
 await library();await view().locator('[data-library="strength"]').click();await search('俯卧撑');await view().locator('[data-add="pushup"]').click();await savePlan({date:draftDate,slot:'strength',sets:'2',amount:'8',rest:'60',unit:'次'});await view().locator('.plan-entry').waitFor()
 check('strength_draft_is_separate_from_formal_strength_course',(await plans()).at(-1).row.draft.kind==='strength'&&await formal()===before)
 await view().locator('.plan-entry [data-details]').first().click();check('male_strength_detail_offers_existing_player',await dialog().locator('[data-play="pushup"]').isVisible());await dialog().getByRole('button',{name:'关闭',exact:true}).first().click()
 await library();await view().locator('[data-gender="female"]').click();await view().locator('[data-library="strength"]').click();await search('俯卧撑');await view().locator('[data-details="pushup"]').first().click()
 check('female_detail_is_explicit_2d_placeholder_without_male_player',/女性3D/.test(await dialog().innerText())&&await dialog().locator('svg').count()>0&&await dialog().locator('[data-play]').count()===0)
 await dialog().getByRole('button',{name:'关闭',exact:true}).first().click()
 for(const locale of ['zh-TW','zh-HK','en-US','ja-JP','ko-KR','zh-CN']){await p.getByLabel('界面语言 / Language',{exact:true}).selectOption(locale);check('locale_'+locale,await p.locator('html').getAttribute('lang')===locale&&!!(await view().locator('.page-intro h1').innerText()))}
 await p.locator('header.ui03-header').getByRole('button',{name:'饮食健康',exact:true}).click();await view().locator('.nutrition-layout').waitFor();await view().getByLabel('记录日期',{exact:true}).fill(today)
 check('nutrition_is_independent_page_without_action_library',await view().locator('.catalog-grid').count()===0&&await view().locator('.nutrition-layout').count()===1)
 check('missing_nutrition_and_body_data_are_not_sample_values',await view().locator('.nut-num').innerText()==='—千卡'&&!/2,250|72\.4|79\.5/.test(await view().innerText()))
 const emptyActual=await formal();await view().locator('[data-goal="cut"]').click();check('goal_mode_never_invents_calorie_prescription',await formal()===emptyActual&&/— kcal/.test(await view().locator('.nutrition-hero').innerText()))
 await view().locator('[data-dialog="meal"]').click();check('meal_clock_and_unknown_macros_not_prefilled',await dialog().locator('[name="time"]').inputValue()===''&&await dialog().locator('[name="protein"]').inputValue()==='')
 await dialog().getByLabel('食物',{exact:true}).fill('V4合成餐');await dialog().getByLabel('千卡',{exact:true}).fill('321');await dialog().getByLabel('实际进食时间',{exact:true}).fill('08:17');await dialog().getByLabel('蛋白质 (g)',{exact:true}).fill('20');await dialog().getByRole('button',{name:'保存',exact:true}).click();await view().locator('.food-row').waitFor()
 check('meal_saved_with_actual_clock_and_missing_macros',/V4合成餐/.test(await view().locator('.food-row').innerText())&&/08:17/.test(await view().locator('.food-row').innerText())&&/—g C/.test(await view().locator('.food-row').innerText())&&/321/.test(await view().locator('.nut-num').innerText()))
 await view().locator('[data-dialog="measure"]').click();await dialog().getByLabel('体重 (kg)',{exact:true}).fill('65.4');await dialog().getByLabel('腰围 (cm)',{exact:true}).fill('');await dialog().getByRole('button',{name:'保存',exact:true}).click();await view().locator('#scenario-slider').waitFor()
 check('measured_weight_and_unknown_waist_have_source',/65\.4 kg \/ — cm/i.test(await view().innerText())&&/手动实测记录/.test(await view().innerText()),await view().locator('.body-card').innerText())
 const actualBeforeScenario=await formal();await view().locator('#scenario-slider').fill('64.4');check('body_scenario_changes_only_view_not_measured_facts',await formal()===actualBeforeScenario&&/不预测体脂|不預測|does not forecast/.test(await view().innerText()))
 await snapshot('nutrition')
 await p.reload({waitUntil:'domcontentloaded'});await ready();await p.locator('header.ui03-header').getByRole('button',{name:'饮食健康',exact:true}).click();await view().locator('.food-row').waitFor()
 check('refresh_restores_meal_measurement_and_view_preferences',/V4合成餐/.test(await view().innerText())&&/65\.4/.test(await view().innerText())&&await view().locator('[data-gender="female"]').getAttribute('class')==='active')
 if(label==='prod'){
  await nav('身体');await view().locator('.catalog-grid').waitFor();await p.locator('header.ui03-header').getByRole('button',{name:'饮食健康',exact:true}).click();await view().locator('.food-row').waitFor()
  await ctx.setOffline(true);await p.reload({waitUntil:'domcontentloaded'});await ready();await p.locator('header.ui03-header').getByRole('button',{name:'饮食健康',exact:true}).click();await view().locator('.food-row').waitFor();check('offline_refresh_restores_real_local_meal_and_measurement',/V4合成餐/.test(await view().innerText())&&/65\.4/.test(await view().innerText()))
  await nav('身体');await view().locator('.catalog-grid').waitFor();check('visited_library_opens_offline',await view().locator('.action-card').count()>0)
  await p.screenshot({path:`${screens}/${label}-offline-library.png`})
 }
 await p.locator('header.ui03-header').getByRole('button',{name:'饮食健康',exact:true}).click();await view().locator('[data-go="coach"]').click()
 await p.getByPlaceholder('输入你的问题').waitFor();check('nutrition_to_coach_prefills_only_user_confirmed_question',/本地饮食和体重实测记录/.test(await p.getByPlaceholder('输入你的问题').inputValue()))
 const prior=await p.getByTestId('coach-answer').count();await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForFunction(n=>document.querySelectorAll('[data-testid="coach-answer"]').length>n,prior)
 const answer=await p.getByTestId('coach-answer').last().innerText();check('coach_uses_recorded_meal_and_measured_weight_numbers',answer.includes('321')&&answer.includes('65.4'),answer)
 await p.getByRole('navigation',{name:'方坤工作区',exact:true}).getByRole('button',{name:'复盘',exact:true}).click()
 const organ=p.getByRole('button',{name:/^前往身体：/});await organ.click();check('coach_health_link_opens_recovery_tools',await p.getByRole('navigation',{name:'身体工作区',exact:true}).isVisible())
 await nav('今日');await view().locator('[data-go="coach"]').click();await p.getByPlaceholder('输入你的问题').waitFor();check('today_to_coach_prefills_draft_question_not_actual_training',/待练草稿/.test(await p.getByPlaceholder('输入你的问题').inputValue())&&/不要当作已完成训练/.test(await p.getByPlaceholder('输入你的问题').inputValue()))
 await library();await view().locator('[data-library="running"]').click();await search('原地跑步摆臂');await view().locator('[data-add="fk-run-tech-002"]').click()
 const beforeFailure=(await plans()).length
 await p.evaluate(()=>{window.__fwOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('fr255-fieldwork-plan-draft-v1:'))throw new DOMException('synthetic quota','QuotaExceededError');return window.__fwOriginalSetItem.call(this,key,value)}})
 await savePlan({date:draftDate,sets:'2',amount:'15',unit:'s',rest:'30'});await view().locator('.toast').filter({hasText:'未保存'}).waitFor()
 check('storage_failure_keeps_form_and_never_claims_saved',await dialog().isVisible()&&await dialog().locator('[name="sets"]').inputValue()==='2'&&(await plans()).length===beforeFailure)
 await p.evaluate(()=>{Storage.prototype.setItem=window.__fwOriginalSetItem;delete window.__fwOriginalSetItem});await dialog().getByRole('button',{name:'取消',exact:true}).click()
 check('no_model_or_mutation_network_calls',!requests.some(r=>r.method!=='GET'||/api\.openai|api\.x\.ai|generativelanguage|api\.anthropic/.test(r.origin)))
 check('no_uncaught_page_errors',errors.length===0,JSON.stringify(errors))
}catch(e){errors.push(String(e));results.push({name:'flow',status:'FAIL',detail:String(e)});await p.screenshot({path:`${screens}/${label}-failure.png`}).catch(()=>{})}
finally{await ctx.close();await browser.close();writeFileSync(`${out}/${label}.json`,JSON.stringify({results,errors,requests},null,2));console.log(JSON.stringify({label,pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,errors}));if(errors.length||results.some(r=>r.status==='FAIL'))process.exitCode=1}
