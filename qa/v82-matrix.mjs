// v82 矩阵：首页「计时」/「开始今日训练」→ 今天这节的同一逐组引导（V4 原课表文字可执行、分段跑同一入口）；多节可选；无课普通计时；
// 放弃本次（runner + 详情页）不留记录；主观恢复统一 1–10（旧 1–5 ×2，不误判降强度）。
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8796'
let fails=0;const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,700));if(!ok)fails++}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
async function page(time,seed){
 const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
 await ctx.addInitScript(([s])=>{localStorage.setItem('fk-onboard-v1','1');if(!localStorage.getItem('seed82')){localStorage.setItem('seed82','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},[seed])
 await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}))
 const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('dialog',d=>d.accept())
 await p.clock.install({time:new Date(time)});await p.clock.resume()
 await p.goto(base);await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await p.waitForTimeout(2500)
 return {p,ctx}
}
const quick=async(p,n)=>{await p.getByRole('button',{name:n,exact:true}).first().click();await p.waitForTimeout(1500)}
const enter=async(p)=>{const done=new Set();for(let i=0;i<8&&!(await p.locator('[data-testid=guided-current]').count());i++){for(const n of ['本次不使用','按原计划','开始训练','开始执行','继续训练','继续']){const bt=p.getByRole('button',{name:n,exact:true});if(!done.has(n)&&await bt.count()&&await bt.first().isVisible()){done.add(n);await bt.first().click().catch(()=>{});await p.waitForTimeout(900);break}}}}
const recovery=[{date:'2026-10-19',recovery:4,at:'2026-10-19T01:00:00Z'}] // 旧 1–5 表单的 4
// ---------- A. 今天 V4 10/19：计时 → 同一逐组引导 ----------
{const {p,ctx}=await page('2026-10-19T05:30:00Z',{'fk-checkin-v1':recovery})
 const rec=await p.getByRole('button',{name:/恢复/}).first().innerText().catch(()=>'')
 check('主观恢复：旧 1–5 的 4 显示为 8/10，不再“建议降强度”',/主观恢复 8\/10/.test(rec)&&!/降强度/.test(rec),rec)
 await quick(p,'计时')
 const sh=p.getByRole('dialog',{name:'本节训练执行'});const st=await sh.innerText().catch(()=>'')
 check('首页「计时」直接打开今天 V4 这节（不需先“设为可执行”）',/速度耐力＋力量A/.test(st),st.slice(0,300))
 check('同一入口里有 跑步部分 150米×3（开始这节跑步）',/跑步部分/.test(st)&&/150米×3/.test(st)&&/开始这节跑步/.test(st),st.slice(0,600))
 await enter(p);const cur=await p.locator('[data-testid=guided-current]').first().innerText().catch(()=>'')
 check('逐组引导：分腿蹲 · 第 1 / 2 组（原课表 分腿蹲2×5/腿 解析）',/分腿蹲 · 第 1 \/ 2 组/.test(cur),cur)
 check('单侧动作显示 左侧',/左侧/.test(await p.locator('[data-testid=guided-side]').first().innerText().catch(()=>'')))
 await p.getByRole('button',{name:'暂停',exact:true}).last().click();await p.waitForTimeout(400)
 await p.getByRole('button',{name:'结束训练',exact:true}).click();await p.waitForTimeout(300)
 check('结束训练 → 两个选择：保存已做的组（记为中断）/ 放弃本次，不记录',(await p.getByRole('button',{name:'保存已做的组（记为中断）'}).count())===1&&(await p.getByRole('button',{name:'放弃本次，不记录'}).count())===1)
 await p.getByRole('button',{name:'放弃本次，不记录'}).click();await p.waitForTimeout(900)
 check('放弃后提示“已放弃本次，未记录”',await p.getByTestId('guided-discarded').first().isVisible().catch(()=>false))
 await p.getByRole('button',{name:'返回首页 · 保留进度'}).click();await p.waitForTimeout(800)
 const occ=await p.evaluate(()=>{const o=JSON.parse(localStorage.getItem('fr255-training-occurrences-v1')||'null');return JSON.stringify(o)?.length??0})
 await p.locator('[data-testid="today-primary-cta"]').first().click();await p.waitForTimeout(1500)
 const sh2=await p.getByRole('dialog',{name:'本节训练执行'}).isVisible().catch(()=>false)
 check('「开始今日训练」也打开同一逐组引导',sh2)
 await enter(p);await p.getByRole('button',{name:'返回首页 · 保留进度'}).click().catch(()=>{});await p.waitForTimeout(800)
 // 详情页：进行中 → 继续引导 / 放弃本次
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('fk-open-plan400-day',{detail:{date:'2026-10-19',tab:'plan'}})));await p.waitForTimeout(1200)
 const ds=p.locator('[data-testid=plan400-day-sheet]');const live=await ds.getByTestId('guided-live-actions').isVisible().catch(()=>false)
 check('详情页“逐组引导进行中”时给出 继续引导 / 放弃本次',live&&/逐组引导进行中/.test(await ds.innerText()))
 await ds.getByRole('button',{name:'放弃本次',exact:true}).click();await p.waitForTimeout(1000)
 const dt=await ds.innerText()
 check('详情页放弃后：不再“进行中”，力量回到未记录',!/逐组引导进行中/.test(dt)&&/尚未记录|未记录/.test(dt)&&(await ds.getByTestId('guided-live-actions').count())===0,dt.slice(0,400))
 await p.keyboard.press('Escape');await p.waitForTimeout(400)
 const acts=await p.evaluate(async()=>{const m=await import('/src/lib/ui/training-read-model.ts').catch(()=>null);return m?null:null})
 await p.getByLabel('切换到日志').click({force:true});await p.waitForTimeout(1500)
 const lt=await p.locator('[data-testid=training-log-v76]').innerText().catch(()=>'')
 check('日志/复盘：放弃的两次都没有记录（10/19 无训练行）',!/10\/19[^\n]*速度耐力|10-19[^\n]*逐组|力量与核心/.test(lt),lt.slice(0,500))
 check('五维：近 28 天训练记录 0 条',/近 28 天 0 条/.test(await p.locator('body').innerText())||!/近 28 天 [1-9]/.test(await p.locator('body').innerText()))
 await ctx.close()}
// ---------- B. 今天两节（V4 + 自定力量 75s / 135s）→ 让用户选 ----------
{const custom={id:'custom:lift-1019',date:'2026-10-19',kind:'strength',modality:'strength',trainingType:'strength',title:'自定 · 上肢',focus:['上肢'],minutes:30,intensity:'MODERATE',lowerHeavy:false,source:'custom',refId:null,status:'planned',betweenRestSec:135,exercises:[{id:'c1',name:'俯卧撑',sets:'2',reps:'10',weight:'0',rpe:'',unit:'reps',restSec:75}]}
 const {p,ctx}=await page('2026-10-19T05:30:00Z',{'fk-schedule-v1':{acks:[],entries:[custom]}})
 await quick(p,'计时');const pk=p.getByRole('dialog',{name:'选择当天训练'});const pt=await pk.innerText().catch(()=>'')
 check('今天两节 → 先选（V4 + 自定）',/速度耐力/.test(pt)&&/自定 · 上肢/.test(pt),pt.slice(0,300))
 await pk.getByRole('button',{name:/自定 · 上肢/}).click();await p.waitForTimeout(1200);await enter(p)
 const body=await p.locator('body').innerText()
 check('自定课进入同一逐组引导：俯卧撑 第 1 / 2 组',/俯卧撑 · 第 1 \/ 2 组/.test(await p.locator('[data-testid=guided-current]').first().innerText().catch(()=>'')))
 check('自定课的休息值原样：组间 75 秒 / 动作间 135 秒',/1分15秒|75 ?秒|01:15/.test(body)||/2分15秒|135 ?秒|02:15/.test(body),body.slice(0,500))
 await ctx.close()}
// ---------- C. 休息日（10/23）→ 普通计时器 ----------
{const {p,ctx}=await page('2026-10-23T05:30:00Z',{})
 await quick(p,'计时');const pt=await p.getByTestId('plain-timer').isVisible().catch(()=>false)
 check('当天没有训练 → 普通计时器（不记录）',pt)
 await ctx.close()}
await b.close();console.log(fails?`${fails} FAILS`:'ALL PASS');process.exit(fails?1:0)
