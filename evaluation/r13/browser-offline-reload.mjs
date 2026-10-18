// Synthetic-only production PWA acceptance: warm cache, disconnect, reload, save and review.
import {chromium} from 'playwright'
import {writeFileSync} from 'node:fs'
import {browserProxyTrustArgs} from '../../scripts/browser-proxy-trust.mjs'
const url=process.argv[2]??'http://127.0.0.1:8085/'
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage',...browserProxyTrustArgs()]})
const result={ok:false,checks:[],errors:[],transportErrors:[],modelRequests:0}
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'allow'})
 ctx.on('request',r=>{if(/api\.x\.ai|generativelanguage\.googleapis|api\.openai|api\.anthropic|\/_server|serverFn|server-fn/.test(r.url()))result.modelRequests++})
 const p=await ctx.newPage();p.setDefaultTimeout(30000)
 p.on('pageerror',e=>result.errors.push(String(e)))
 p.on('console',m=>{if(m.type()==='error')result.transportErrors.push(m.text())})
 const ready=()=>p.locator('[data-testid="training-app"][data-ready="true"]').waitFor({timeout:60000})
 await p.goto(url,{waitUntil:'domcontentloaded'});await ready()
 await p.waitForFunction(()=>!!navigator.serviceWorker.controller)
 await p.reload({waitUntil:'domcontentloaded'});await ready()
 await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
 await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
 const background=p.getByTestId('offline-profile');await background.locator('summary').click()
 await background.getByLabel('离线教练主项',{exact:true}).selectOption('800米')
 await background.getByRole('button',{name:'确认保存教练背景',exact:true}).click()
 await p.getByTestId('offline-loop-answer').filter({hasText:'800米'}).waitFor()
 await p.waitForFunction(async()=>{const c=await caches.open('fr255-shell-2');return !!(await c.match('/'))})
 await ctx.setOffline(true)
 await p.reload({waitUntil:'domcontentloaded'});await ready();result.checks.push('cached_shell_reload_offline')
 await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
 await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
 await p.getByTestId('offline-loop-answer').filter({hasText:'800米'}).waitFor();result.checks.push('profile_persisted_offline_reload')
 await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'对话',exact:true}).click()
 await p.getByPlaceholder('输入你的问题').fill('今天训练20分钟，整课RPE3')
 await p.getByRole('button',{name:'发送',exact:true}).click()
 await p.getByTestId('coach-answer').last().filter({hasText:'60 AU'}).waitFor();result.checks.push('arithmetic_chat_offline')
 const load=p.getByTestId('chat-load-save');await load.locator('summary').click()
 await load.getByLabel('聊天负荷训练类型').selectOption('STRENGTH')
 const when=await p.evaluate(()=>{const d=new Date(Date.now()-86400000),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`})
 await load.getByLabel('聊天负荷训练时间').fill(when);await load.getByRole('checkbox').check()
 await load.getByRole('button',{name:'确认保存这次负荷',exact:true}).click()
 await load.getByTestId('saved-offline-review').filter({hasText:'60 AU'}).waitFor()
 result.checks.push('saved_training_generates_local_review_offline')
 await p.screenshot({path:'/workspace/screenshots/fangkun-r13/prod-offline-reload.png'})
 await p.reload({waitUntil:'domcontentloaded'});await ready()
 await p.getByRole('button',{name:'切换到方坤',exact:true}).click()
 await p.getByRole('navigation',{name:'方坤工作区'}).getByRole('button',{name:'复盘',exact:true}).click()
 await p.getByTestId('offline-history').locator('summary').click()
 await p.getByTestId('offline-history').getByText(/保留待核实/).waitFor()
 result.checks.push('automatic_judgment_persisted_offline_reload')
 if(result.errors.length||result.modelRequests)throw Error('unexpected runtime error or model request')
 result.ok=true
}catch(e){result.errors.push(String(e));process.exitCode=1}
finally{await browser.close();writeFileSync('/workspace/fangkun/evidence/r13/prod-offline-reload.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))}
