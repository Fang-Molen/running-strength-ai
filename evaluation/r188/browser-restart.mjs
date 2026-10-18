// Synthetic UI data only. Close Chromium entirely, then reopen the same profile offline.
import {chromium} from 'playwright'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const url=process.argv[2],dir=process.env.R185_EVIDENCE_DIR??'/workspace/fangkun/evidence/r188/browser-final'
const screens=process.env.R185_SCREEN_DIR??'/workspace/screenshots/fangkun-r188-final'
mkdirSync(dir,{recursive:true});mkdirSync(screens,{recursive:true})
const profile=mkdtempSync(join(tmpdir(),'fangkun-r188-browser-'))
const results=[],errors=[],requests=[],phases=[]
let ctx,phase='online',persisted=null
const check=(name,ok,detail='')=>{results.push({name,status:ok?'PASS':'FAIL',detail});if(!ok)throw Error(name+': '+detail)}
const launch=async()=>{
 const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking'],viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'allow'})
 context.on('request',r=>{const u=new URL(r.url());if(u.origin!==new URL(url).origin||/api\.x\.ai|generativelanguage|api\.openai|api\.anthropic|\/_server/.test(r.url()))requests.push({phase,method:r.method(),origin:u.origin,path:u.pathname})})
 context.on('page',p=>p.on('pageerror',e=>errors.push({phase,error:String(e)})))
 return context
}
const ready=p=>p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:90000})
const section=async(p,name)=>{await p.getByRole('button',{name:'切换到方坤',exact:true}).click();await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name,exact:true}).click()}
const ask=async(p,q)=>{const n=await p.getByTestId('coach-answer').count();await p.getByPlaceholder('输入你的问题').fill(q);await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForFunction(n=>document.querySelectorAll('[data-testid="coach-answer"]').length>n,n);return p.getByTestId('coach-answer').last().innerText()}
const plans=p=>p.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>/strength-plan|running-plan/.test(k)))))
try{
 ctx=await launch();let p=await ctx.newPage();p.setDefaultTimeout(20000)
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await ready(p)
 await p.waitForFunction(()=>!!navigator.serviceWorker.controller)
 try{await p.reload({waitUntil:'domcontentloaded'})}catch(e){if(!String(e).includes('ERR_ABORTED'))throw e}
 await ready(p);await p.waitForFunction(()=>!!navigator.serviceWorker.controller)
 const formalBefore=await plans(p)
 await section(p,'复盘');const bg=p.getByTestId('offline-profile');await bg.locator('summary').click();await bg.getByLabel('离线教练主项',{exact:true}).selectOption('400米');await bg.getByLabel('离线教练PB秒',{exact:true}).fill('56');await bg.getByRole('button',{name:'确认保存教练背景',exact:true}).click()
 await section(p,'对话')
 const answer=await ask(p,'今天200米×4，30/30/31/33秒，组间3分钟，整课40分钟整课RPE6，原计划是均速，复盘。本周负荷2400AU，上周负荷2000AU')
 check('mixed_review_before_weekly_context',/首段30秒、末段33秒/.test(answer)&&/平均31秒/.test(answer)&&/20%/.test(answer)&&answer.indexOf('首段30秒')<answer.indexOf('本周2400 AU'))
 const panel=p.getByTestId('chat-training-save');await panel.locator('summary').click();await panel.getByLabel('自报训练实际时间').fill('2026-10-13T09:00');await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'确认保存为训练',exact:true}).click();await panel.getByRole('status').filter({hasText:'已保存'}).waitFor()
 const durability=panel.getByTestId('storage-durability');await durability.waitFor();const request=durability.getByRole('button',{name:'申请保留本机数据',exact:true});if(await request.count())await request.click()
 await p.waitForFunction(()=>!document.querySelector('[data-testid="storage-durability"]')?.textContent.includes('正在检查'))
 persisted=await p.evaluate(()=>navigator.storage.persisted());check('persistence_status_truthful',/浏览器|持久存储/.test(await durability.innerText()),`browserGranted=${persisted}`)
 await durability.getByRole('button',{name:'迁移本机存储（保留原记录）',exact:true}).click();await durability.getByTestId('storage-migration-state').filter({hasText:'已迁移并核对'}).waitFor()
 const advice=await ask(p,'明天练什么');check('R188_default_before_restart',/建议休息/.test(advice))
 check('R188_p7_exists_before_restart',await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('fr255-p7:'))))
 const id=await p.evaluate(()=>JSON.parse(localStorage.getItem('fr255-confirmed-training-imports-v1')).data[0].confirmedImportId)
 await section(p,'复盘');await p.getByLabel('离线复盘课次').selectOption(id);await p.getByRole('button',{name:'保存本次判断与观察目标',exact:true}).click()
 await p.waitForFunction(async()=>!!await (await caches.open('fr255-shell-2')).match('/'))
 const stored=await p.evaluate(()=>({imports:localStorage.getItem('fr255-confirmed-training-imports-v1'),history:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-coach-review-r13:')))}))
 check('judgment_exists_before_restart',Object.keys(stored.history).length>0)
 phases.push('closed-first-browser');await ctx.close();ctx=null
 phase='offline-restart';ctx=await launch();await ctx.setOffline(true);p=await ctx.newPage();p.setDefaultTimeout(20000)
 await p.goto(url,{waitUntil:'domcontentloaded',timeout:90000});await ready(p)
 await p.waitForFunction(()=>localStorage.getItem('fangkun-core-storage-mode-v1')==='INDEXED_DB_MIRROR')
 check('R188_p7_persists_in_new_offline_browser',await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-p7:')).some(([,v])=>JSON.parse(v).data.commitmentKind==='LIVE')))
 check('R188_indexeddb_migration_survives_restart',await p.evaluate(async()=>{const r=indexedDB.open('fangkun-core-storage-v1');const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readonly'),q=tx.objectStore('kv').get('fr255-confirmed-training-imports-v1');q.onsuccess=()=>{db.close();resolve(q.result===localStorage.getItem('fr255-confirmed-training-imports-v1'))};q.onerror=()=>reject(q.error)})}))
 check('new_browser_process_opens_offline',await p.evaluate(()=>navigator.onLine===false&&!!navigator.serviceWorker.controller))
 const after=await p.evaluate(()=>({imports:localStorage.getItem('fr255-confirmed-training-imports-v1'),history:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('fr255-coach-review-r13:')))}))
 check('raw_training_and_judgments_survive_process_restart',JSON.stringify(stored)===JSON.stringify(after))
 await section(p,'复盘');await p.getByLabel('离线复盘课次').selectOption(id);await p.getByTestId('offline-loop-answer').filter({hasText:'33秒'}).waitFor()
 check('offline_review_computes_saved_numbers',/平均31秒/.test(await p.getByTestId('offline-loop-answer').innerText()))
 check('ability_has_no_invented_scores',/当前没有核准/.test(await p.getByTestId('r184-ability-profile').innerText())&&!/82分|93分/.test(await p.getByTestId('r184-ability-profile').innerText()))
 await section(p,'对话');const follow=await ask(p,'复盘刚才保存的训练');check('dialogue_receipt_and_state_survive_restart',/33秒/.test(follow)&&!/聊天自报、未保存/.test(follow))
 const emergency=await ask(p,'同学倒地怎么喊也不应，只有喘息');check('offline_emergency_actions',/120/.test(emergency)&&/AED/.test(emergency)&&/胸外按压/.test(emergency))
 check('formal_plans_unchanged_after_restart',await plans(p)===formalBefore)
 check('no_external_or_model_requests',requests.length===0,JSON.stringify(requests))
 check('no_uncaught_browser_errors',errors.length===0,JSON.stringify(errors))
 await p.screenshot({path:join(screens,'prod-restart-mobile.png')})
 phases.push('completed-offline-restart')
}catch(e){errors.push({phase,error:String(e)});results.push({name:'restart_flow_completed',status:'FAIL',detail:String(e)})}
finally{if(ctx)await ctx.close();writeFileSync(join(dir,'prod-restart-browser.json'),JSON.stringify({results,errors,requests,phases,persisted},null,2))}
console.log(JSON.stringify({pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length,persisted,errors}));if(errors.length||results.some(r=>r.status==='FAIL'))process.exitCode=1
