// v79 矩阵：计划跑步课 ↔ 佳明跑步（自动/建议/取消，只算一次，计划 vs 实际）、t489 未反馈的课、饮食一页、联网默认开、健康设备状态。
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8795'
let fails=0;const SH=process.env.SHOTS;const shot=async(n)=>{if(SH)await p.screenshot({path:`${SH}/${n}.png`}).catch(()=>{})};const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,900));if(!ok)fails++}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const g=(id,name,type,gmt,local,dist,dur,hr)=>({activityId:id,activityName:name,activityType:{typeKey:type},startTimeGMT:gmt,startTimeLocal:local,distance:dist,duration:dur,averageHR:hr,maxHR:hr?hr+15:null})
// 用户形态：10-18 07:30 晨跑 6.01 km；10-17 18:30 6.37 km；10-15 两次跑（歧义）；10-13 一次（只有相邻日计划 → 建议）
const garmin=[g(31018,'晨跑','running','2026-10-17 23:30:00','2026-10-18 07:30:00',6010,1897.6,143.6),g(31017,'杭州市 跑步','running','2026-10-17 10:30:00','2026-10-17 18:30:00',6370,2050,144),
 g(31151,'早跑','running','2026-10-14 23:00:00','2026-10-15 07:00:00',4000,1500,138),g(31152,'夜跑','running','2026-10-15 12:00:00','2026-10-15 20:00:00',3000,1000,141),g(31013,'跑步13','running','2026-10-12 23:00:00','2026-10-13 07:00:00',5000,1800,140),
 g(41019,'操场 150m×3','track_running','2026-10-18 23:00:00','2026-10-19 07:00:00',3200,1500,150)]  // V4 10-19 速度耐力＋力量A 的跑步部分
const R=(id,date,title,minutes,source,extra={})=>({id,date,kind:'run',modality:'run',trainingType:'run',title,focus:[],minutes,intensity:'EASY',lowerHeavy:false,source,refId:null,status:'planned',...extra})
const seed={
 'fk-schedule-v1':{acks:[],entries:[R('fk:easy-1018','2026-10-18','轻松跑',60,'fangkun'),R('custom:8k-1017','2026-10-17','跑步 8公里 ×1',40,'custom'),R('custom:easy-1015','2026-10-15','轻松跑 30',30,'custom'),R('custom:easy-1014','2026-10-14','恢复跑',30,'custom'),
  {id:'custom:calf-1018',date:'2026-10-18',kind:'strength',modality:'strength',trainingType:'strength',title:'力量·小腿',focus:[],minutes:40,intensity:'MODERATE',lowerHeavy:true,source:'custom',refId:null,status:'planned'},
  {id:'str:core:2026-10-17:z',date:'2026-10-17',kind:'strength',modality:'strength',trainingType:'strength',title:'力量课 · 核心+下肢',focus:[],minutes:40,intensity:'MODERATE',lowerHeavy:false,source:'fangkun',refId:'core',status:'planned'}]},
 // t489：10-17 00:09 只打开过今日清单（没勾组、没反馈）
 'fk-today-checklist-v1':{'2026-10-17|core':{date:'2026-10-17',sessionId:'core',moves:{sq:[{done:false},{done:false}]},run:null,rpe:null,state:null,startedAt:Date.parse('2026-10-16T16:09:00Z'),restEndsAt:null,updatedAt:Date.parse('2026-10-16T16:09:30Z')}},
 'fk-log-filter-v1':{range:'4w',kind:'all'},
}
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true});const chats=[],est=[]
await ctx.addInitScript(([s])=>{localStorage.setItem('fk-onboard-v1','1');if(!localStorage.getItem('seed79')){localStorage.setItem('seed79','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},[seed])
await ctx.route('**/api/garmin/**',r=>{const u=new URL(r.request().url());const j=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)})
 if(u.pathname.endsWith('/status'))return j({loggedIn:true,region:'cn',profile:{displayName:'tester'}});if(u.pathname.includes('activitylist'))return j(Number(u.searchParams.get('start')||0)>0?[]:garmin);if(u.pathname.includes('/splits'))return j({lapDTOs:[]})
 return r.fulfill({status:204,body:''})})
await ctx.route('**/api/coach-chat',async r=>{chats.push(JSON.parse(r.request().postData()));return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'MOCK'})})})
await ctx.route('**/api/food-estimate',async r=>{est.push(JSON.parse(r.request().postData()));return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({result:{name:'妈妈做的灌汤小笼包',unit:'笼',grams:240,kcal:520,protein:20,carb:55,fat:24,fiber:null,note:'按一笼8个估'}})})})
const p=await ctx.newPage();p.setDefaultTimeout(10000);const errs=[];p.on('pageerror',e=>errs.push(e.message))
await p.clock.install({time:new Date('2026-10-19T01:30:00Z')})
await p.addInitScript(()=>{const D=window.Date;if(D.__safari)return;const bad=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s);function SD(...a){if(!new.target)return D();return a.length===1&&bad(a[0])?new D(NaN):new D(...a)}SD.prototype=D.prototype;SD.now=()=>D.now();SD.UTC=(...a)=>D.UTC(...a);SD.parse=s=>bad(s)?NaN:D.parse(s);SD.__safari=true;window.Date=SD})
const ready=async()=>{await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(6000)}
await p.goto(base);await ready()
// ---------- 0. 导入后弹窗（V4 10-19 跑步部分 ↔ 佳明 07:00 操场跑）----------
const pr=p.getByTestId('run-import-prompt');await shot('01-import-prompt')
check('同步到 V4 当天的佳明跑步 → 弹一次：立即填跑步评价 / 力量另行记录 / 稍后',await pr.isVisible().catch(()=>false)&&/速度耐力＋力量A · 跑步部分/.test(await pr.innerText())&&(await pr.getByRole('button',{name:/立即填跑步评价|力量另行记录|稍后/}).count())===3,await pr.innerText().catch(()=>'none'))
await pr.getByRole('button',{name:'立即填跑步评价'}).click();await pr.getByLabel('跑步 RPE').fill('8');await pr.getByRole('button',{name:'保存跑步评价'}).click();await p.waitForTimeout(300);await pr.getByRole('button',{name:'完成',exact:true}).click().catch(()=>{});
await p.reload();await ready()
const tab=async n=>{await p.getByLabel('切换到'+n).click({force:true});await p.waitForTimeout(800)}
const toLog=async()=>{await tab('日志');await p.locator('[data-testid="training-log-v76"]').waitFor()}
const unmarked=async()=>p.getByTestId('unmarked-plans').innerText().catch(()=>'')
const list=async()=>p.getByLabel('训练记录列表').innerText()
const summary=async()=>p.getByLabel('当前周期摘要').innerText()
// ---------- A. 跑步课 ↔ 佳明 ----------
await toLog()
await p.getByTestId('unmarked-plans').scrollIntoViewIfNeeded().catch(()=>{});await shot('02-log-unmarked-suggest');let um=await unmarked(),ls=await list(),sm=await summary();console.log('---待标记\n'+um+'\n---摘要\n'+sm)
check('同一天 1 对 1 自动关联：轻松跑 10-18、跑步 8公里 10-17 不在待标记',!/轻松跑\s*10-18|跑步 8公里/.test(um),um)
check('力量·小腿 不会被手表跑步自动完成（仍待标记）',/力量·小腿/.test(um),um)
check('t489：10-17 核心+下肢（只打开过清单）= 待标记·未完成·未反馈，不是记录',/力量课 · 核心\+下肢[^\n]*\n?[^\n]*未完成·未反馈/.test(um)&&!/核心\+下肢/.test(ls),um+'\n'+ls)
check('佳明跑步行显示所关联计划',/晨跑[^\n]*计划「轻松跑」/.test(ls)&&/杭州市 跑步[^\n]*计划「跑步 8公里 ×1」/.test(ls),ls)
const runRows=(ls.match(/佳明/g)||[]).length
check('只算一次：摘要 6 条记录（全是佳明跑步，计划/V4 不另算），列表 6 行',/全部 6 条记录/.test(sm)&&/跑步 6/.test(sm)&&/27\.58 km/.test(sm)&&runRows===6,sm+'\n'+ls)
await p.getByLabel('训练记录列表').getByRole('button',{name:/杭州市 跑步/}).click();await p.waitForTimeout(500)
await p.getByTestId('run-link').first().scrollIntoViewIfNeeded().catch(()=>{});await shot('03-log-plan-vs-actual');let note=await p.getByTestId('run-link').first().innerText().catch(()=>'')
check('计划 vs 实际：8 km · 40 分钟 → 6.37 km · 34 分钟 · 配速 · 心率；距离少 1.6 km',/已关联佳明跑步/.test(note)&&/计划 8 km · 40 分钟/.test(note)&&/6\.37 km · 34 分钟 · 5'2\d"\/km · 心率 144/.test(note)&&/距离少 1\.6 km/.test(note),note)
// 歧义：10-15 两次跑；10-14 计划只有相邻日（10-13/10-15）跑步 → 建议，不自动
check('同一天两次跑：10-15 轻松跑 30 不自动，给“是这次吗？”×2',/轻松跑 30/.test(um)&&(await p.getByTestId('unmarked-plans').locator('li',{hasText:'轻松跑 30'}).getByTestId('run-suggest').count())===2,um)
check('相邻日：10-14 恢复跑 给“是这次吗？”建议',(await p.getByTestId('unmarked-plans').locator('li',{hasText:'恢复跑'}).getByTestId('run-suggest').count())>=1,um)
await p.getByTestId('unmarked-plans').locator('li',{hasText:'轻松跑 30'}).getByTestId('run-suggest').filter({hasText:'20:00'}).getByRole('button',{name:'是，关联'}).click();await p.waitForTimeout(800)
um=await unmarked();sm=await summary();ls=await list()
check('点“是，关联”后离开待标记，记录数不变（6）',!/轻松跑 30/.test(um)&&/全部 6 条记录/.test(sm)&&/夜跑[^\n]*计划「轻松跑 30」/.test(ls),um+'\n'+sm)
// 取消关联
await p.getByLabel('训练记录列表').getByRole('button',{name:/晨跑/}).click();await p.waitForTimeout(400)
await p.getByTestId('run-link').filter({hasText:'轻松跑'}).getByRole('button',{name:'取消关联'}).click();await p.waitForTimeout(800)
um=await unmarked();sm=await summary()
check('取消关联：轻松跑 10-18 回到待标记，佳明那条还在、只算一次',/轻松跑/.test(um)&&/全部 6 条记录/.test(sm),um+'\n'+sm)
await p.reload();await ready();await toLog();um=await unmarked()
check('取消关联刷新后保持（不会又自动关联）',/轻松跑\s*10-18/.test(um.replace(/\n/g,' ')),um)
// 方坤：事实包里同一次训练只出现一次 + 计划对比
await p.getByRole('button',{name:'打开方坤',exact:true}).click();await p.getByPlaceholder('输入你的问题').fill('看看我最近两周的训练');await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForTimeout(4000)
const facts=(chats.at(-1)||{}).facts||'';console.log('---事实包\n'+facts.slice(0,1800))
check('方坤事实包：计划跑步课已关联佳明（只算一次）+ 计划 vs 实际',chats.length>0&&/计划跑步课已关联佳明（同一次训练，只算一次）/.test(facts)&&/跑步 8公里 ×1[^；]*6\.37 km/.test(facts),facts.slice(0,600))
check('联网默认开：没手动开也会把问题发给方坤（1 次）',chats.length===1,chats.length)
check('方坤事实包：10-17 核心+下肢 不当作练过',!/2026-10-17 力量课 · 核心\+下肢/.test(facts)||/核心\+下肢[^；]*未反馈/.test(facts),facts.slice(0,400))
await p.reload();await ready()
// ---------- B. 健康：佳明已连接 ----------
await tab('健康');await p.waitForTimeout(1500);const ht=await p.locator('body').innerText();console.log('---健康keys',await p.evaluate(()=>Object.keys(localStorage).filter(k=>/garmin/i.test(k)).join(',')),'\n',(ht.match(/.{0,40}(尚未选择设备|佳明手表|当天可用).{0,40}/g)||[]).join(' || '))
await shot('09-health');check('健康：佳明已连接时不写“尚未选择设备”',!/尚未选择设备/.test(ht)&&/佳明手表（账号已连接）/.test(ht),ht.slice(0,300))
// ---------- C. 联网功能默认开 ----------
const of=await p.evaluate(()=>localStorage.getItem('fk-online-features-v1'))
check('联网功能默认开（方坤/关联训练/识字/估算）',!of||/"coach":true/.test(of)&&!/false/.test(of),of)
// ---------- D. 饮食一页 ----------
await tab('饮食');await p.getByRole('button',{name:'记录饮食',exact:true}).click();const d=p.getByRole('dialog',{name:'登记饮食',exact:true})
check('一个拍照入口、没有勾选框墙',(await d.getByRole('button',{name:/拍照 \/ 选图识别/}).count())===1&&(await d.getByRole('checkbox').count())===0)
check('菜品照片识别明确“未配置”（不假装）',await d.getByTestId('dish-photo-status').filter({hasText:'未配置视觉模型'}).waitFor({timeout:12000}).then(()=>true).catch(()=>false))
await d.getByLabel('吃了什么',{exact:true}).fill('灌汤小笼包');await p.waitForTimeout(1500)
check('边打字边出搜索结果',(await d.locator('[aria-label=搜索结果] li').count())>0)
await d.getByLabel('吃了什么',{exact:true}).fill('妈妈做的灌汤小笼包子');await p.waitForTimeout(1200)
await shot('07-food-notfound');const nf=await d.getByLabel('没找到').innerText().catch(()=>'')
check('没搜到：给“用相近食物估算”（灌汤小笼包）+ 联网估算',/灌汤小笼包/.test(nf)&&/联网估算/.test(nf),nf)
await d.getByLabel('没找到').getByRole('button',{name:/联网估算/}).click();await p.waitForTimeout(1200)
await shot('08-food-estimate');let pv=await d.getByLabel('本次营养预览').innerText().catch(()=>'')
check('联网估算：标“估算”，520 kcal，纤维未知显示“—”（不当 0）',est.length===1&&/估算/.test(pv)&&/520/.test(pv)&&/—/.test(pv),pv+' calls='+est.length)
const sb=d.getByRole('button',{name:'确认保存饮食',exact:true});console.log('---save disabled?',await sb.isDisabled());await sb.click();await p.waitForTimeout(800);console.log('---after save',await p.getByRole('dialog',{name:'登记饮食'}).count(),await p.locator('[role=alert],[role=status]').allTextContents(),await p.evaluate(()=>Object.keys(localStorage).filter(k=>/food|nutri/i.test(k)).map(k=>k+':'+localStorage.getItem(k).length).join(',')))
await p.screenshot({path:'/workspace/out/v79/food-after-save.png'});await p.getByRole('button',{name:/(早|午|晚|加)餐\s*已记录/}).first().click().catch(()=>{});await p.waitForTimeout(600);await p.getByText('识别依据 / 估算说明').first().click().catch(()=>{});await p.waitForTimeout(300);await p.screenshot({path:'/workspace/out/v79/food-meal.png'});const saved=await p.locator('body').innerText();await p.keyboard.press('Escape').catch(()=>{});await p.getByRole('button',{name:'关闭',exact:true}).first().click().catch(()=>{})
check('单一确认保存；记录标为估算、名称保留用户写的',/妈妈做的灌汤小笼包/.test(saved)&&/联网估算/.test(saved),(saved.match(/.{0,80}妈妈做的.{0,200}/s)||[''])[0])
// 份 单位
for(const [q,re,pick] of [['薯条',/份/,'薯条'],['可乐',/份/,'杯型未定'],['重庆火锅',/份/,'重庆火锅']]){
 await p.getByRole('button',{name:'记录饮食',exact:true}).click();const d2=p.getByRole('dialog',{name:'登记饮食',exact:true})
 await d2.getByLabel('吃了什么',{exact:true}).fill(q);await p.waitForTimeout(1200);await d2.locator('[aria-label=搜索结果] li button').filter({hasText:pick}).first().click();await p.waitForTimeout(500)
 const units=await d2.getByLabel('份量单位').innerText().catch(()=>'');const pv2=await d2.getByLabel('本次营养预览').innerText().catch(()=>'')
 check(`份 单位预览：${q} → ${units.replace(/\n/g,' ')}`,re.test(units)&&/kcal/.test(pv2),units+' | '+pv2)
 await d2.getByRole('button',{name:/关闭|取消/}).first().click().catch(()=>p.keyboard.press('Escape'));await p.waitForTimeout(400)
}
// ---------- E. V4 组合课分项（10-19 速度耐力＋力量A）----------
await p.keyboard.press('Escape').catch(()=>{});await p.reload();await ready()
await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'during'}})));const ds=p.getByTestId('plan400-day-sheet');await ds.waitFor()
await shot('04-v4-during-run-link');const rl=await ds.getByTestId('v4-run-link').innerText().catch(()=>'')
check('V4 跑步部分：已关联佳明跑步（同日唯一自动）+ 实际 3.20 km · 25 分钟 · 心率 150',/已关联佳明跑步/.test(rl)&&/自动关联/.test(rl)&&/3\.20 km · 25 分钟/.test(rl)&&/心率 150/.test(rl),rl)
const cs=await ds.getByTestId('combo-status').innerText().catch(()=>'')
check('分项状态：跑步有记录（RPE 8）、力量 尚未记录（手表跑步不完成力量）',/RPE 8|已关联佳明跑步/.test(cs)&&/力量\s*尚未记录/.test(cs),cs)
await ds.getByRole('tab',{name:'训练后'}).click()
const lf=ds.getByTestId('part-strength');await lf.getByRole('button',{name:'完成',exact:true}).click();await lf.getByLabel('力量 RPE').fill('6');await lf.getByLabel('力量疼痛部位').fill('膝');await lf.getByLabel('力量疼痛分数').fill('2');await lf.getByRole('button',{name:'保存力量评价'}).click();await p.waitForTimeout(300)
const rf=ds.getByTestId('part-running')
check('跑步 RPE 8 / 力量 RPE 6 分开保存',await rf.getByLabel('跑步 RPE').inputValue()==='8'&&await lf.getByLabel('力量 RPE').inputValue()==='6')
await rf.getByLabel('跑步 RPE').fill('7');await rf.getByRole('button',{name:'保存跑步评价'}).click();await p.waitForTimeout(300)
await rf.getByTestId('corrections-running').click().catch(()=>{});await rf.scrollIntoViewIfNeeded();await shot('05-v4-after-parts');const cr=await rf.getByTestId('corrections-running').innerText().catch(()=>'')
check('改跑步 RPE 8→7：留修改记录，力量不受影响',/修改记录 · 1 次/.test(cr)&&await lf.getByLabel('力量 RPE').inputValue()==='6',cr)
const comp=await p.evaluate(()=>JSON.parse(localStorage.getItem('fk-plan400-v4-components-v1')||'{}'))
check('附加 key fk-plan400-v4-components-v1：schemaVersion 1，跑步/力量分开；旧整课 key 不写',comp.schemaVersion===1&&comp.days['2026-10-19'].running.rpe===7&&comp.days['2026-10-19'].strength.rpe===6&&!(await p.evaluate(()=>localStorage.getItem('fk-plan400-v4-log')||'')).includes('2026-10-19'),JSON.stringify(comp).slice(0,300))
await ds.getByRole('button',{name:'关闭训练详情'}).click();await toLog();sm=await summary();ls=await list()
check('日志：V4 当天 + 佳明跑步 = 1 条（跑+力量同一课），总数仍 6，距离只算一次',/全部 6 条记录/.test(sm)&&/其中 1 条是跑\+力量同一课/.test(sm)&&/27\.58 km/.test(sm)&&/10-19 周一 · 1 条/.test(ls)&&!/操场 150m×3/.test(ls),sm+'\n'+ls)
await p.getByLabel('训练记录列表').getByRole('button',{name:/速度耐力＋力量A/}).click();await p.waitForTimeout(400)
await p.getByTestId('v4-parts-note').scrollIntoViewIfNeeded().catch(()=>{});await shot('06-log-v4-merged');const vn=await p.getByTestId('v4-parts-note').innerText().catch(()=>'')
check('日志详情：V4 分项评价 跑步 RPE 7（改过 1 次）/ 力量 完成 RPE 6 疼痛 膝 2/10',/跑步[^\n]*RPE 7[^\n]*改过 1 次/.test(vn)&&/力量 完成，RPE 6，疼痛 膝 2\/10/.test(vn),vn)
chats.length=0;await p.getByRole('button',{name:'打开方坤',exact:true}).click();await p.getByPlaceholder('输入你的问题').fill('今天这节课怎么样');await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForTimeout(4000)
const f2=(chats.at(-1)||{}).facts||''
check('方坤事实包：V4 分项反馈分开 + V4 跑步已关联佳明（只算一次）',/V4 分项反馈[^\n]*2026-10-19 跑步[^\n]*RPE 7[^\n]*力量 完成，RPE 6/.test(f2)&&/计划跑步课已关联佳明[^\n]*V4 速度耐力＋力量A · 跑步部分/.test(f2),f2.slice(0,900))
check('无页面错误',errs.length===0,errs.join(' | '))
console.log(fails?`FAILS ${fails}`:'ALL PASS');await b.close();process.exit(fails?1:0)
