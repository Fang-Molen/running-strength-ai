// 方坤对话：输入区上方的状态块折叠成一行。390px iPhone 视口，截图 + 测消息区高度。
import {chromium} from 'playwright'
const base=process.argv[2]||'http://127.0.0.1:8795', tag=process.argv[3]||'after'
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,timezoneId:'Asia/Shanghai',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'})
await ctx.addInitScript(()=>localStorage.setItem('fk-onboard-v1','1'))
await ctx.route('**/api/coach-chat',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'结论：今天改为休息或轻松跑20分钟，RPE 2—3，不做150m×3。\n原因：睡眠只有4小时，身体电量31。\n下一课处方：明天按计划轻松跑20—30分钟；速度课等睡眠恢复到6小时以上再做。'})}))
const p=await ctx.newPage();let fails=0;const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':d);if(!ok)fails++}
await p.goto(base);await p.locator('[data-ready=true]').first().waitFor({timeout:60000});await p.waitForTimeout(3000)
await p.getByRole('button',{name:'打开方坤',exact:true}).first().click();await p.getByPlaceholder('输入你的问题').waitFor()
await p.getByPlaceholder('输入你的问题').fill('我今天能练吗');await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForTimeout(3000)
await p.screenshot({path:`/workspace/out/coach-${tag}.png`})
const m=await p.evaluate(()=>{const inp=document.querySelector('[placeholder="输入你的问题"]');let bar=inp;for(let i=0;i<8&&bar;i++){bar=bar.parentElement;if(bar&&/overflow-y-auto/.test(bar.className)&&bar.className.includes('shrink-0'))break}
 const bottomH=bar?bar.getBoundingClientRect().height:null;const ans=[...document.querySelectorAll('[data-testid=coach-answer]')].at(-1);return {bottomH,ansVisible:ans?ans.getBoundingClientRect().top:null}})
console.log(tag,'输入区+上方块高度',m.bottomH,'px')
if(tag==='after'){
 check('输入区上方（含状态行+快捷问题+输入框）≤ 170px',m.bottomH!=null&&m.bottomH<=170,JSON.stringify(m))
 const row=p.getByTestId('coach-status-row');check('一行状态：联网分析 开 · 未关联训练',/联网分析 开 · 未关联训练/.test(await row.locator(':scope > summary').innerText()))
 check('联网仍默认开启',await p.getByLabel('联网分析').isChecked())
 check('收起时联网说明/隐私权限/关联训练不占位',!(await p.getByText('联网与隐私权限（按需展开）').isVisible()))
 await row.locator(':scope > summary').click();await p.waitForTimeout(300);check('点开后可见：联网开关 + 隐私权限 + 关联训练',await p.getByLabel('联网分析').isVisible()&&await p.getByText('联网与隐私权限（按需展开）').isVisible()&&await p.getByTestId('coach-record-binding').isVisible())
 await p.screenshot({path:`/workspace/out/coach-after-expanded.png`})}
await b.close();process.exit(fails?1:0)
