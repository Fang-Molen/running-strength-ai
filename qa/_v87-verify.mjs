// v87 验证：本地方坤 1536秒、预览知识卡R03、复盘选课。/api/coach-chat 被拦截（不产生付费调用）。Playwright Chrome 390 宽，非真机。
import {chromium} from 'playwright'
const base=process.argv[2], shotDir=process.argv[3]||'/workspace/out/v87'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
let calls=0;await ctx.route('**/api/coach-chat**',r=>{calls++;return r.fulfill({status:503,contentType:'application/json',body:'{"error":"blocked-in-qa"}'})})
const F=(v)=>v==null?{value:null,status:'ABSENT',sourceIds:[]}:{value:v,status:'RECORDED',sourceIds:['text']}
const rec=(id,at,o)=>({sport:'RUNNING',occurredAt:F(at),title:F(null),durationSeconds:F(o.dur),totalDistanceMeters:F(o.dist),runningStructure:'CONTINUOUS',runningSegments:[],strengthSets:[],sessionRpe:F(null),subjectiveRecovery:F(null),sleepHours:F(null),pain:F(null),soreness:F(null),uncertainFields:[],conflicts:[],warnings:[],draftId:id,schemaVersion:1,createdAt:at,inputKind:'TEXT',inputSourceIds:['text'],userConfirmed:true,athleteId:'local',confirmedImportId:'confirmed:'+id,confirmedAt:at,recordMode:'ACTUAL_ONLY',canonicalOccurrenceId:null,sourceIds:[],sources:[]})
const seed=[rec('qa-jun','2026-06-10T10:00:00Z',{dist:5000,dur:1800}),rec('qa-oct','2026-10-18T10:00:00Z',{dist:10000,dur:3300}),rec('qa-sep','2026-09-20T10:00:00Z',{dist:6000,dur:2100})]
await ctx.addInitScript(s=>{if(!sessionStorage.getItem('qa-seeded')){sessionStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fr255-confirmed-training-imports-v1',s)}},JSON.stringify({schemaVersion:1,revision:1,updatedAt:'2026-10-19T00:00:00Z',data:seed}))
const p=await ctx.newPage();p.setDefaultTimeout(15000)
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1500)
const sw=await p.evaluate(async()=>{const r=await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')+' | '+(r?.active?.scriptURL||'')})
console.log('SW caches:',sw)
await p.getByRole('button',{name:'打开方坤',exact:true}).first().click();const box=p.getByPlaceholder('输入你的问题');await box.waitFor()
const ask=async q=>{await box.fill(q);await box.press('Enter');await p.waitForTimeout(3500);return await p.evaluate(()=>document.body.innerText)}
let t=await ask('1536秒是多少分钟？')
console.log('1536秒 → 25分36秒:',/25\s*分\s*36\s*秒/.test(t)?'PASS':'FAIL')
await p.screenshot({path:shotDir+'/v87-coach-390.png'})
t=await ask('预览知识卡R03')
await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));t=await p.evaluate(()=>document.body.innerText);const m=t.split('预览知识卡R03').at(-1).slice(0,400).replace(/\n+/g,' / ')
console.log('预览知识卡R03:',/R03/.test(m)&&!/出错|失败/.test(m)?'PASS':'CHECK',m)
await p.getByRole('button',{name:'复盘',exact:true}).click();await p.waitForTimeout(1500)
const opts=await p.getByLabel('离线复盘课次').locator('option').allInnerTexts()
console.log('复盘选课:',JSON.stringify(opts), opts[0]?.startsWith('10-18')?'PASS':'FAIL')
const plain=await p.getByTestId('review-plain').count()
console.log('复盘摘要卡片:',plain?'PASS':'FAIL')
await p.screenshot({path:shotDir+'/v87-review-390.png'})
console.log('coach-chat 调用（已拦截）:',calls)
await b.close()
