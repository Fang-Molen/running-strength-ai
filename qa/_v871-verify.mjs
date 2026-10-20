// v87.1 验证：种子数据（非用户数据）= 10-20 恢复课 + 已确认关联的手表跑步 + 点过稍后 + 课后整课反馈（RPE3）。Playwright Chrome 390 宽，非真机。
import {chromium} from 'playwright'
const base=process.argv[2], shotDir=process.argv[3]||'/workspace/out/v87.1', withFb=process.argv[4]!=='nofb'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await ctx.route('**/api/coach-chat**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"blocked-in-qa"}'}))
const F=(v)=>v==null?{value:null,status:'ABSENT',sourceIds:[]}:{value:v,status:'RECORDED',sourceIds:['text']}
const at='2026-10-20T00:30:00Z',id='garmin:51020'
const rec={sport:'RUNNING',occurredAt:F(at),title:F('QA 恢复跑'),durationSeconds:F(3602),totalDistanceMeters:F(5790),runningStructure:'CONTINUOUS',runningSegments:[],strengthSets:[],sessionRpe:F(null),subjectiveRecovery:F(null),sleepHours:F(null),pain:F(null),soreness:F(null),uncertainFields:[],conflicts:[],warnings:[],draftId:id,schemaVersion:1,createdAt:at,inputKind:'TEXT',inputSourceIds:['text'],userConfirmed:true,athleteId:'local',confirmedImportId:'confirmed:'+id,confirmedAt:at,recordMode:'ACTUAL_ONLY',canonicalOccurrenceId:null,sourceIds:[],sources:[]}
const seed={imp:JSON.stringify({a:{id:51020,name:'QA 恢复跑',type:'running',start:at,dist:5790,dur:3602,avgHr:130}}),links:JSON.stringify({'plan400:2026-10-20:running':{garminId:id,by:'user'}}),comps:JSON.stringify({schemaVersion:1,days:{'2026-10-20':{running:{device:{sourceIdentity:id,source:'garmin',linkedAt:at,linkedBy:'user'}}}},prompted:['2026-10-20|'+id]}),log:withFb?JSON.stringify({'2026-10-20':{rpe:'3',note:'QA 种子：轻松',savedAt:'2026-10-20T02:00:00Z'}}):'{}'}
await ctx.addInitScript(s=>{if(!sessionStorage.getItem('qa-seeded')){sessionStorage.setItem('qa-seeded','1');localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fk-garmin-acts-v1',s.imp);localStorage.setItem('fk-run-links-v1',s.links);localStorage.setItem('fk-plan400-v4-components-v1',s.comps);localStorage.setItem('fk-plan400-v4-log',s.log)}},seed)
const p=await ctx.newPage();p.setDefaultTimeout(15000)
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2000)
console.log('SW caches:',await p.evaluate(async()=>{await navigator.serviceWorker?.ready;return (await caches.keys()).join(',')}))
let t=await p.evaluate(()=>document.body.innerText)
console.log('今日 待补反馈:',/待补反馈/.test(t)?'SHOWN':'none','| 继续训练:',/继续训练/.test(t)?'SHOWN':'none','| 已完成:',/已完成/.test(t)?'yes':'no')
await p.screenshot({path:shotDir+`/v871-today-390${withFb?'':'-nofb'}.png`})
await p.getByRole('button',{name:'切换到日志'}).click();await p.waitForTimeout(2000)
t=await p.evaluate(()=>document.body.innerText)
console.log('日志 待补反馈:',/待补反馈/.test(t)?'SHOWN':'none','|',(t.match(/10月20日[^\n]*/)||[''])[0])
await p.screenshot({path:shotDir+`/v871-log-390${withFb?'':'-nofb'}.png`})
await b.close()
