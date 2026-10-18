import {chromium} from 'playwright'
import {mkdirSync,writeFileSync} from 'node:fs'
import {browserProxyTrustArgs} from '../../scripts/browser-proxy-trust.mjs'
const url=process.argv[2] || 'http://127.0.0.1:8082/'
const label=process.argv[3] || 'dev'
const output='/workspace/fangkun/evidence/r12',screens='/workspace/screenshots/fangkun-r12'
mkdirSync(output,{recursive:true});mkdirSync(screens,{recursive:true})
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage',...browserProxyTrustArgs()]})
const results=[],errors=[];let modelRequests=0
try {
 for(const size of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]) {
  const ctx=await browser.newContext({viewport:{width:size.width,height:size.height},serviceWorkers:'block'})
  await ctx.route(/api\.x\.ai|generativelanguage\.googleapis|api\.openai|api\.anthropic/,r=>{modelRequests++;return r.abort()})
  const p=await ctx.newPage();p.setDefaultTimeout(20000)
  p.on('pageerror',e=>errors.push(String(e)))
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  const check=(name,ok,detail='')=>{results.push({viewport:size.name,name,ok,detail});if(!ok)throw Error(`${size.name}: ${name}: ${detail}`)}
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000})
  await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000})
  await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
  await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
  const panel=p.getByTestId('coach-integration')
  await panel.getByTestId('period-review').waitFor()
  check('period_empty_is_not_complete',/有执行记录的训练共 0 次/.test(await panel.innerText()) && /暂不计算整周完成率/.test(await panel.innerText()))
  const before=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-')&&!k.includes('coach'))))
  await panel.getByLabel('复盘范围').selectOption('28')
  check('window_28',await panel.getByLabel('复盘范围').inputValue()==='28')
  const prefs=panel.getByTestId('coach-preferences');await prefs.locator('summary').click()
  await prefs.getByLabel('安排偏好内容').fill('周三晚上不能训练')
  await prefs.getByRole('button',{name:'确认保存偏好',exact:true}).click()
  await prefs.getByRole('button',{name:'撤回偏好：周三晚上不能训练',exact:true}).waitFor()
  check('explicit_preference_save',/本人明确保存/.test(await prefs.innerText()))
  await panel.locator('summary').filter({hasText:/^预览模型请求依据$/}).click()
  await panel.getByRole('button',{name:'生成依据预览',exact:true}).click()
  check('request_preview_no_send',/1 条安排偏好/.test(await panel.getByTestId('coach-input-summary').innerText()))
  const after=await p.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-')&&!k.includes('coach'))))
  check('preference_does_not_write_training_or_plan',JSON.stringify(before)===JSON.stringify(after))
  check('no_horizontal_overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
  await panel.scrollIntoViewIfNeeded();await p.screenshot({path:`${screens}/${label}-${size.name}-review.png`})
  await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'对话',exact:true}).click()
  await p.getByPlaceholder('输入你的问题').fill('下一课怎么安排？');await p.getByRole('button',{name:'发送',exact:true}).click()
  await p.getByTestId('coach-answer').last().filter({hasText:'周三晚上不能训练'}).waitFor()
  check('local_coach_uses_preference',true)
  await p.reload({waitUntil:'domcontentloaded'});await p.locator('[data-testid="training-app"][data-ready="true"]').waitFor()
  await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
  await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
  const reloaded=p.getByTestId('coach-preferences');await reloaded.locator('summary').click()
  await reloaded.getByRole('button',{name:'撤回偏好：周三晚上不能训练',exact:true}).click()
  await p.getByTestId('coach-integration').getByRole('status').filter({hasText:'已撤回'}).waitFor()
  check('withdraw_survives_reload',await reloaded.getByRole('button',{name:'撤回偏好：周三晚上不能训练',exact:true}).count()===0)
  const notes=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('fr255-coach-context-memory-r12:')).length)
  check('withdraw_keeps_append_only_history',notes===2)
  await reloaded.getByLabel('偏好类型').selectOption('TEMPORARY_LIMIT')
  await reloaded.getByLabel('安排偏好内容').fill('本周仅周末训练')
  await reloaded.getByLabel('偏好结束日期').fill('2000-01-01')
  await reloaded.getByRole('button',{name:'确认保存偏好',exact:true}).click()
  check('past_expiry_rejected',/不早于今天/.test(await p.getByTestId('coach-integration').innerText()))
  await ctx.close()
 }
 if(errors.length || modelRequests)throw Error(JSON.stringify({errors,modelRequests}))
} catch(e) {errors.push(String(e));process.exitCode=1}
finally {await browser.close();writeFileSync(`${output}/${label}-focused.json`,JSON.stringify({ok:errors.length===0&&modelRequests===0,results,errors,modelRequests},null,2));console.log(JSON.stringify({label,checks:results.length,errors,modelRequests}))}
