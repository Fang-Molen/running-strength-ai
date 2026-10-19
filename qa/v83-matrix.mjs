// v83 矩阵（L3，Playwright Chrome 模拟手机宽度；不是真机）：整改包 P0/P1 端到端
// 同一天 V4 组合课只算一次、手表跑步只给候选需确认、记一笔不造时长、删除可撤回训练、首页只一张今日卡、待补反馈在日志顶部、
// 跑步视图无力量编辑器、组合课旧整课评价只读、宽度 375/390/393/414 无横向溢出。
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8796'
let fails=0;const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,700));if(!ok)fails++}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const seed={
 'fk-plan400-v4-log':{'2026-10-19':{done:'done',rpe:'7',savedAt:'2026-10-19T11:00:00Z'}},
 'fk-plan400-v4-components-v1':{schemaVersion:1,days:{'2026-10-19':{running:{status:'done',rpe:8,savedAt:'2026-10-19T11:05:00Z'}}}},
 'fk-garmin-acts-v1':{a:{id:51019,name:'操场跑',type:'track_running',start:'2026-10-19T10:00:00Z',dist:3200,dur:1500,avgHr:150}},
 'fk-schedule-v1':{entries:[{id:'q-legacy1',date:'2026-10-18',kind:'run',modality:'run',title:'跑步 6 公里',focus:[],minutes:30,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'done',unplanned:true,actual:{outcome:'as_planned',minutes:30,km:6,rpe:null,intensity:null,note:'记一笔',reasons:[],at:'2026-10-18T12:00:00.000Z'}}],acks:[]},
 'fk-notes-v1':[{id:'n-legacy',date:'2026-10-18',at:'2026-10-18T12:00:00.100Z',text:'跑了6公里',atts:[],parsed:'已记入训练日志'}],
}
async function page(width=390){
 const ctx=await b.newContext({viewport:{width,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
 await ctx.addInitScript(([s])=>{localStorage.setItem('fk-onboard-v1','1');if(!localStorage.getItem('seed83')){localStorage.setItem('seed83','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},[seed])
 await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}))
 const p=await ctx.newPage();p.setDefaultTimeout(8000);p.on('dialog',d=>d.accept())
 await p.clock.install({time:new Date('2026-10-19T12:30:00Z')});await p.clock.resume()
 await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2500)
 return {p,ctx}
}
const nav=async(p,n)=>{await p.getByRole('button',{name:'切换到'+n}).click();await p.waitForTimeout(1500)}
const store=(p,k)=>p.evaluate(k=>localStorage.getItem(k)||'',k)
{const {p,ctx}=await page()
 // 候选弹窗：同日唯一手表跑步只给“是这节吗”，不自动关联
 const pr=p.locator('[data-testid=run-import-prompt],[data-testid=run-candidate-prompt]').first()
 const prt=await pr.innerText().catch(()=>'')
 check('同日手表跑步 → 弹窗三选：关联到这节课 / 不是这节课 / 稍后',/关联到这节课/.test(prt)&&/不是这节课/.test(prt)&&/稍后/.test(prt),prt)
 check('没有自动写入关联（fk-run-links-v1 无 10-19 自动关联）',!/2026-10-19[^}]*auto/.test(await store(p,'fk-run-links-v1')),await store(p,'fk-run-links-v1'))
 await pr.getByRole('button',{name:/稍后/}).click().catch(()=>{});await p.waitForTimeout(600)
 const main=await p.getByTestId('today-main-card').innerText()
 check('首页主卡：跑步完成+力量未记录 → 进行中（不再“已完成”）',/进行中/.test(main)&&!/已完成/.test(main)&&/力量\s*尚未记录/.test(main),main)
 const board=await p.locator('[aria-label=本周训练]').innerText().catch(()=>'')
 check('首页今日训练列表不再重复显示今天的 V4 课（只在主卡一次）',!/速度耐力＋力量A/.test(board)&&!/同上方今日主卡/.test(board),board.slice(0,400))
 // 计划：跑步视图没有力量编辑器；力量视图课程库有“编辑”
 await nav(p,'计划')
 check('计划·跑步视图：不显示力量课程编辑器/新建力量课',!(await p.locator('#session-editor').count())&&!(await p.getByRole('button',{name:/新建力量课|课程编辑器/}).count()))
 await p.getByRole('button',{name:'力量',exact:true}).first().click();await p.waitForTimeout(800)
 const lib=await p.locator('[aria-label=力量课程库]').innerText().catch(()=>'')
 check('计划·力量视图：课程库每行有 编辑 / 加入训练',/编辑/.test(lib)&&/加入训练/.test(lib),lib.slice(0,300))
 // 日志：待补反馈在最上面，五维在评估前；旧记一笔 30 分钟显示为未知
 await nav(p,'日志')
 const pend=await p.getByTestId('pending-feedback').first().innerText().catch(()=>'')
 check('日志顶部有待补反馈：确认同日手表跑步（点过“稍后”也还在）',/待补/.test(pend)&&/确认是不是这节/.test(pend),pend)
 const order=await p.evaluate(()=>{const a=document.querySelector('[data-testid=pending-feedback]'),r=document.querySelector('[data-testid=log-radar]');const e=[...document.querySelectorAll('h2,h3')].find(h=>/本周评估与建议/.test(h.textContent||''));const pos=(x,y)=>!!(x&&y&&(x.compareDocumentPosition(y)&Node.DOCUMENT_POSITION_FOLLOWING));return {pr:pos(a,r),re:e?pos(r,e):null}})
 check('日志顺序：待补反馈 → 五维 → 本周评估与建议',order.pr&&order.re!==false,JSON.stringify(order))
 // 旧“记一笔”默认 30 分钟 → 未知：需要旧版本真实写入的导入格式，L1 覆盖（quick-log-v83.test.ts legacyQuickAudit），这里不伪造旧导入。
 // 组合课训练后：分项表单 + 旧整课评价只读
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'after'}})));await p.waitForTimeout(1200)
 const sh=await p.getByTestId('plan400-day-sheet').innerText().catch(()=>'')
 check('组合课训练后：跑步/力量分开评价，旧整课评价只读（无“保存训练后反馈”）',/保存跑步评价/.test(sh)&&/保存力量评价/.test(sh)&&/只读/.test(sh)&&!(await p.getByRole('button',{name:'保存训练后反馈'}).count()),sh.slice(0,500))
 await ctx.close()}
// 记一笔：只写导入，不造时长；删除可撤回
{const {p,ctx}=await page()
 await p.getByRole('button',{name:/稍后/}).first().click().catch(()=>{})
 const sch0=await store(p,'fk-schedule-v1')
 await p.getByRole('button',{name:'记一笔'}).first().click();await p.waitForTimeout(600)
 await p.getByLabel('记录内容').fill('今天跑了5公里');await p.waitForTimeout(400)
 await p.getByRole('button',{name:'保存记录',exact:true}).click();await p.waitForTimeout(1500)
 const imp=await store(p,'fr255-confirmed-training-imports-v1')
 const mine=JSON.parse(imp||'{"data":[]}').data.filter(x=>String(x.draftId||'').startsWith('act-q-n-'))
 check('记一笔 5 公里：只写 1 条训练导入（不另写日程）',mine.length===1&&(await store(p,'fk-schedule-v1'))===sch0,JSON.stringify(mine).slice(0,400))
 const m=mine[0]||{};const js=JSON.stringify(m)
 check('记一笔 5 公里：距离 5000 m，时长未知（不默认 30 分钟）',/5000/.test(js)&&!/1800/.test(js),js.slice(0,500))
 // 重复点保存不重复记
 const notes=JSON.parse(await store(p,'fk-notes-v1')||'[]')
 check('笔记关联了这条训练（records）',notes.some(n=>/5公里/.test(n.text)&&n.records?.length===1),JSON.stringify(notes).slice(0,300))
 const del=p.getByRole('button',{name:'删除已保存记录'}).first();await del.click();await p.waitForTimeout(400)
 const dlg=await p.getByRole('dialog',{name:'删除这条记录'}).innerText().catch(()=>'')
 check('删除有关联训练的笔记 → 仅删除笔记 / 删除并撤回这条训练 / 取消',/仅删除笔记（训练保留）/.test(dlg)&&/删除并撤回这条训练/.test(dlg)&&/取消/.test(dlg),dlg)
 await p.getByRole('button',{name:'删除并撤回这条训练'}).click();await p.waitForTimeout(800)
 check('撤回 = 追加作废更正（原导入不删）',/VOID/.test(await store(p,'fr255-training-correction-v1'))&&(await store(p,'fr255-confirmed-training-imports-v1'))===imp)
 await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(400)
 await nav(p,'日志');const lg=await p.locator('main').innerText()
 check('撤回后日志不再有这条 5 公里',!/跑步 5 公里|5\.00 km/.test(lg),lg.slice(0,500))
 await ctx.close()}
// 宽度
for(const w of [375,390,393,414]){const {p,ctx}=await page(w);await p.getByRole('button',{name:/稍后/}).first().click().catch(()=>{})
 const ov=[];for(const t of ['今日','计划','日志']){if(t!=='今日')await nav(p,t);const o=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);if(o>1)ov.push(t+':'+o)}
 check(`宽度 ${w}：今日/计划/日志 无横向溢出（Playwright 模拟，不是真机）`,!ov.length,ov.join(','));await ctx.close()}
await b.close();console.log(fails?`v83 matrix: ${fails} FAIL`:'v83 matrix: ALL PASS');process.exit(fails?1:0)
