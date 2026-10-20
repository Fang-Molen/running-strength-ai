// C03 复盘区 + 小字可见性（v85.1）：两个折叠面板 + 改课仍阻断 + 联网默认开；关键小字用 isVisible + 尺寸>0 + display 判定，不再只看 innerText。Playwright Chrome 390 宽，不是真机。
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8797'; let fails=0
const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,500));if(!ok)fails++}
// 真可见：Playwright isVisible + 包围盒宽高>0 + 自身及祖先都不是 display:none（不只看 innerText）
const seen=async(loc)=>{if(!(await loc.count()))return {ok:false,why:'不存在'};const l=loc.first();const v=await l.isVisible();const bb=await l.boundingBox();const disp=await l.evaluate(e=>getComputedStyle(e).display);return {ok:v&&!!bb&&bb.width>0&&bb.height>0&&disp!=='none',why:JSON.stringify({v,bb,disp})}}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true})
let coachCalls=0; await ctx.route('**/api/coach-chat',r=>{coachCalls++;return r.fulfill({status:200,contentType:'application/json',body:'{"text":"mock"}'})})
await ctx.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}))
await ctx.addInitScript(()=>{localStorage.setItem('fk-onboard-v1','1')})
const p=await ctx.newPage(); p.setDefaultTimeout(10000)
await p.goto(base); await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000}); await p.waitForTimeout(1500)
await p.getByRole('button',{name:'打开方坤',exact:true}).first().click(); await p.getByPlaceholder('输入你的问题').waitFor()
const online=await p.evaluate(()=>localStorage.getItem('fk-coach-online-v1'))
check('联网方坤默认开启（fk-coach-online-v1.on=true）',/"on":true/.test(online||''),online)
await p.getByRole('button',{name:'复盘',exact:true}).click(); await p.waitForTimeout(1500)
const plan=p.locator('summary',{hasText:'调整安排与回执（待核对）'})
check('复盘区有折叠的“调整安排与回执（待核对）”',await plan.count()===1)
await plan.click(); await p.waitForTimeout(800)
const txt=await p.locator('details',{has:plan}).first().innerText()
check('改课面板写明“尚未修改”且只核对差异',/尚未修改/.test(txt)&&/不代表已生成可执行提案|只核对一个未开始分项/.test(txt),txt)
check('“核对差异 / 生成待确认提案”在未选分项时不可点',await p.getByRole('button',{name:'核对差异 / 生成待确认提案'}).isDisabled())
{const r=await seen(p.getByText('仅使用当前本机档案的记录',{exact:false})); check('改课说明“仅使用当前本机档案的记录…不能解除医疗限制”真可见',r.ok,r.why)}
{const r=await seen(p.getByText(/读取截止：|尚无法核对当前本机档案/)); check('改课“读取截止/尚无法核对”说明真可见',r.ok,r.why)}
{const r=await seen(p.getByText('尚未修改',{exact:false})); check('“尚未修改”真可见',r.ok,r.why)}
{const fu=p.locator('[data-testid="c03-followups-empty"],[data-testid="c03-followups-unavailable"],[data-testid="c03-followups"] > summary'); const r=await seen(fu); const t=await fu.first().innerText().catch(()=>''); check('C03 长期跟进（无记录时的说明）真可见且写明“长期跟进”',r.ok&&/长期跟进/.test(t),r.why+' '+t)}
await p.screenshot({path:process.argv[3]||'/workspace/out/c03-review-390.png',fullPage:false})
const idb=await p.evaluate(async()=>{const dbs=await indexedDB.databases?.()||[];const has=dbs.some(d=>d.name==='fangkun-coach-plan-execution-v1');if(!has)return {has,proposals:0};return await new Promise(res=>{const r=indexedDB.open('fangkun-coach-plan-execution-v1');r.onsuccess=()=>{const db=r.result;const names=[...db.objectStoreNames];if(!names.length)return res({has,proposals:0,names});const tx=db.transaction(names,'readonly');let n=0,pending=names.length;for(const s of names){const q=tx.objectStore(s).getAll();q.onsuccess=()=>{for(const v of q.result)n+=Object.keys(v?.proposals||{}).length+Object.keys(v?.overlays||{}).length;if(--pending===0)res({has,proposals:n,names})}}};r.onerror=()=>res({has,err:true})})})
check('打开复盘不会写入任何提案/修订（IndexedDB 中 0 条）',!idb.proposals,JSON.stringify(idb))
// 规则本身：说明小字仍隐藏（用户 10-16 要求），状态提示 role=status / .keep 可见
const rule=await p.evaluate(()=>{const host=document.querySelector('.product-ui');if(!host)return {host:false};const mk=(attrs)=>{const e=document.createElement('p');e.className='text-xs text-muted';Object.entries(attrs).forEach(([k,v])=>k==='class'?e.classList.add(v):e.setAttribute(k,v));e.textContent='x';host.appendChild(e);const d=getComputedStyle(e).display;e.remove();return d};return {host:true,plain:mk({}),status:mk({role:'status'}),alert:mk({role:'alert'}),keep:mk({class:'keep'})}})
check('普通说明小字仍隐藏；role=status / role=alert / .keep 可见',rule.host&&rule.plain==='none'&&rule.status!=='none'&&rule.alert!=='none'&&rule.keep!=='none',JSON.stringify(rule))
const hiddenNow=await p.evaluate(()=>[...document.querySelectorAll('.product-ui p.text-xs.text-muted:not(.keep):not([role])')].filter(e=>getComputedStyle(e).display==='none').length)
check('本页仍有被有意隐藏的说明小字（没有整体放开）',hiddenNow>0,hiddenNow)
check('本检查未调用 /api/coach-chat',coachCalls===0,coachCalls)
// 其他页：休息日普通计时器的“正计时/倒计时”状态小字
{const c2=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true});await c2.route('**/api/coach-chat',r=>{coachCalls++;return r.fulfill({status:200,contentType:'application/json',body:'{"text":"mock"}'})});await c2.route('**/api/garmin/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"loggedIn":false}'}));await c2.addInitScript(()=>{localStorage.setItem('fk-onboard-v1','1')})
 const q=await c2.newPage();q.setDefaultTimeout(10000);await q.clock.install({time:new Date('2026-10-23T05:30:00Z')});await q.clock.resume()
 await q.goto(base);await q.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000});await q.waitForTimeout(2000)
 await q.getByRole('button',{name:'计时',exact:true}).first().click();await q.waitForTimeout(1200)
 const r=await seen(q.getByTestId('plain-timer').getByText(/正计时|倒计时/)); check('其他页：普通计时器“正计时/倒计时”状态小字真可见',r.ok,r.why)
 await q.getByRole('button',{name:'90秒',exact:true}).click();await q.waitForTimeout(300)
 const r2=await seen(q.getByTestId('plain-timer').getByText(/倒计时 01:30/)); check('其他页：选 90 秒后“倒计时 01:30”真可见',r2.ok,r2.why)
 await c2.close()}
check('全程未调用 /api/coach-chat',coachCalls===0,coachCalls)
await b.close(); console.log(fails?`c03 review ui: ${fails} FAIL`:'c03 review ui: ALL PASS'); process.exit(fails?1:0)
