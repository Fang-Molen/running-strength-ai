// v86.1 复盘页人话版浏览器门禁：合成导入跑步课（不是用户数据），Playwright Chrome 390 宽，不是真机。
// 用法: node qa/review-view-ui.mjs <base>
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8861'; let fails=0
const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,400));if(!ok)fails++}
const F=(v)=>v==null?{value:null,status:'ABSENT',sourceIds:[]}:{value:v,status:'RECORDED',sourceIds:['text']}
const seg=(id,k,s)=>({id,kind:'REPETITION',round:F(1),repeat:F(k),distanceMeters:F(400),durationSeconds:F(s),recoverySeconds:F(120),recoveryScope:'AFTER_REPEAT',completion:'COMPLETED',sourceIds:['text']})
const rec=(id,at,o)=>({sport:'RUNNING',occurredAt:F(at),title:F(null),durationSeconds:F(o.dur??null),totalDistanceMeters:F(o.dist??null),runningStructure:o.segs?'REPEATED':'CONTINUOUS',runningSegments:o.segs??[],strengthSets:[],sessionRpe:F(o.rpe??null),subjectiveRecovery:F(null),sleepHours:F(null),pain:F(null),soreness:F(null),uncertainFields:[],conflicts:[],warnings:[],draftId:id,schemaVersion:1,createdAt:at,inputKind:'TEXT',inputSourceIds:['text'],userConfirmed:true,athleteId:'local',confirmedImportId:'confirmed:'+id,confirmedAt:at.replace(/T\d\d/,'T23'),recordMode:'ACTUAL_ONLY',canonicalOccurrenceId:null,sourceIds:[],sources:[]})
const seed=[rec('qa-easy','2026-06-21T09:43:00Z',{dist:8000,dur:2880}),rec('qa-400','2026-06-24T12:37:00Z',{rpe:8,segs:[seg('a',1,78),seg('b',2,80),seg('c',3,82),seg('d',4,85)]})]
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
let calls=0;await ctx.route('**/api/coach-chat',r=>{calls++;return r.fulfill({status:200,contentType:'application/json',body:'{"text":"mock"}'})})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}))
await ctx.addInitScript(s=>{localStorage.setItem('fk-onboard-v1','1');localStorage.setItem('fr255-confirmed-training-imports-v1',s)},JSON.stringify({schemaVersion:1,revision:1,updatedAt:'2026-06-26T00:00:00Z',data:seed}))
const p=await ctx.newPage();p.setDefaultTimeout(15000)
await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(1200)
await p.getByRole('button',{name:'打开方坤',exact:true}).first().click();await p.getByPlaceholder('输入你的问题').waitFor()
await p.getByRole('button',{name:'复盘',exact:true}).click();await p.waitForTimeout(1200)
const sel=p.getByLabel('离线复盘课次'),opts=await sel.locator('option').allInnerTexts()
check('选课：日期+类型+距离/用时/配速，新的在前',opts[0]==='06-24 20:37 · 间歇跑 · 4×400米 · 3:23/公里'&&opts[1]==='06-21 17:43 · 跑步 · 8公里 · 48:00 · 6:00/公里',JSON.stringify(opts))
check('不再出现“仅分析已确认背景”/“导入跑步课”；保留“不选课，只聊整体情况”',!opts.some(o=>/仅分析已确认背景|导入跑步课/.test(o))&&opts.at(-1)==='不选课，只聊整体情况',JSON.stringify(opts))
check('默认选中最近一次训练',(await sel.evaluate(e=>e.options[e.selectedIndex].text))===opts[0])
const plain=p.getByTestId('review-plain');await plain.waitFor()
const titles=await plain.locator(':scope > div > h4').allInnerTexts()
check('四段：这次练得怎么样/为什么/下次怎么练/还需要你补什么',JSON.stringify(titles)===JSON.stringify(['这次练得怎么样','为什么','下次怎么练','还需要你补什么']),JSON.stringify(titles))
const visible=await p.getByTestId('offline-coach-loop').evaluate(e=>{const c=e.cloneNode(true);c.querySelectorAll('details:not([open])').forEach(d=>[...d.children].forEach(ch=>{if(ch.tagName!=='SUMMARY')ch.remove()}));return c.innerText})
check('看得见的部分没有术语（本次事实/训练目的/可能解释/不确定性/生理短板/UNKNOWN）',!/本次事实|训练目的：|可能解释|不确定性|生理短板|UNKNOWN|为了补数据|离线教练|认识运动员/.test(visible),visible.slice(0,600))
check('关键数字来自记录：78 → 80 → 82 → 85、慢 7 秒、81 秒',/78 → 80 → 82 → 85 秒/.test(visible)&&/慢 7 秒/.test(visible)&&/81 秒/.test(visible))
const ev=p.getByTestId('review-evidence')
check('“查看依据”默认折叠',!(await ev.evaluate(e=>e.open)))
await ev.locator(':scope > summary').click();await p.waitForTimeout(300)
check('展开后能看到原始依据',/本次事实/.test(await ev.innerText()))
await sel.selectOption({index:opts.length-1});await p.waitForTimeout(800)
check('可选“不选课，只聊整体情况”且不报错',(await sel.inputValue())==='')
check('全程未调用 /api/coach-chat',calls===0,calls)
await b.close();console.log(fails?`review view ui: ${fails} FAIL`:'review view ui: ALL PASS');process.exit(fails?1:0)
