// v78 端到端记录矩阵：每种记录方式 × 每个页面。Asia/Shanghai + Safari 日期解析（"YYYY-MM-DD HH:MM:SS" → NaN）。
import {chromium} from 'playwright'; import fs from 'node:fs'
const base=process.argv[2]||'http://127.0.0.1:8795'
let fails=0;const M=[];const check=(n,ok,d='')=>{console.log(ok?'PASS':'FAIL',n,ok?'':String(d).slice(0,900));M.push(`${ok?'PASS':'FAIL'} ${n}`);if(!ok)fails++}
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']})
const g=(id,name,type,gmt,local,dist,dur,hr)=>({activityId:id,activityName:name,activityType:{typeKey:type},startTimeGMT:gmt,startTimeLocal:local,distance:dist,duration:dur,averageHR:hr,maxHR:hr?hr+15:null})
// 7 次佳明跑步 10-12..10-18（10-18 那次 = 用户截图里缺的 6.01 km），2 次佳明力量 10-05/10-08
const garmin=[g(31018,'晨跑','running','2026-10-17 23:30:00','2026-10-18 07:30:00',6010,1897.6,143.6)]
for(const d of [12,13,14,15,16,17])garmin.push(g(31000+d,`跑步${d}`,'running',`2026-10-${d-1} 23:00:00`,`2026-10-${d} 07:00:00`,5000,1800,140))
garmin.push(g(31008,'佳明力量08','strength_training','2026-10-08 11:00:00','2026-10-08 19:00:00',null,2400,110),g(31005,'佳明力量05','strength_training','2026-10-05 11:00:00','2026-10-05 19:00:00',null,2700,112))
const ex=(name,sets,reps,weight='')=>({id:name,name,sets:String(sets),reps:String(reps),weight,rpe:'',restSec:75})
const seed={
 'fk-coach-online-v1':{on:false,consentAt:'2026-10-19T00:00:00Z',by:'test'},
 'fk-log-filter-v1':{range:'4w',kind:'lift'},   // v76/v77 存下的“力量”筛选（用户截图现场）
 'fk-plan400-v4-overrides':{'2026-10-19':{parts:['腿'],betweenRestSec:120,savedAt:'2026-10-18T00:00:00Z',exercises:[{name:'分腿蹲',sets:'2',reps:'5',weight:'20',rpe:'',perSide:true,restSec:75,sideRestSec:15},{name:'RDL',sets:'2',reps:'5',weight:'40',rpe:'',restSec:75}]}},
 'fk-schedule-v1':{acks:[],entries:[
  // 自己加一节（自定）力量·小腿 10-18，没标记 → 待标记，不是记录
  {id:'custom:calf-1018',date:'2026-10-18',kind:'strength',modality:'strength',trainingType:'strength',title:'力量·小腿',focus:[],minutes:40,intensity:'MODERATE',lowerHeavy:true,source:'custom',refId:null,status:'planned',betweenRest:135,exercises:[ex('杠铃深蹲',3,8,'80'),ex('卷腹',3,10),ex('侧桥',3,30),ex('保加利亚分腿蹲',3,12,'10'),ex('死虫',3,10),ex('台阶上步',3,8,'15')]},
  // v72 形态（无 trainingType）自定，按计划完成
  {id:'custom:low-1016',date:'2026-10-16',kind:'strength',modality:'strength',title:'力量·下肢',focus:['下肢'],minutes:40,intensity:'MODERATE',lowerHeavy:true,source:'custom',refId:null,status:'done',actual:{outcome:'as_planned',minutes:40,intensity:'MODERATE',note:'',reasons:[],at:'2026-10-16T12:00:00Z'}},
  // 方坤排的课，实际不同 25 分钟
  {id:'str:up:2026-10-15:a',date:'2026-10-15',kind:'strength',modality:'strength',trainingType:'strength',title:'力量课 · 上肢',focus:[],minutes:45,intensity:'MODERATE',lowerHeavy:false,source:'fangkun',refId:'up',status:'done',actual:{outcome:'different',minutes:25,rpe:6,intensity:'EASY',note:'',reasons:['short'],at:'2026-10-15T12:00:00Z'}},
  // 没练 → 哪里都不算
  {id:'custom:run-1014',date:'2026-10-14',kind:'run',modality:'run',trainingType:'run',title:'轻松跑（没练）',focus:[],minutes:30,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'planned',actual:{outcome:'missed',minutes:null,intensity:null,note:'',reasons:['tired'],at:'2026-10-14T12:00:00Z'}},
  {id:'str:nomark:2026-10-13:x',date:'2026-10-13',kind:'strength',modality:'strength',trainingType:'strength',title:'力量课 · 没练',focus:[],minutes:30,intensity:'EASY',lowerHeavy:false,source:'fangkun',refId:'up',status:'planned',actual:{outcome:'missed',minutes:null,intensity:null,note:'',reasons:[],at:'2026-10-13T12:00:00Z'}},
  // 今日清单动过（10-17 00:09 上海 = 10-16 16:09Z），没点完成
  {id:'str:core:2026-10-17:z',date:'2026-10-17',kind:'strength',modality:'strength',trainingType:'strength',title:'力量课 · 核心+下肢',focus:[],minutes:40,intensity:'MODERATE',lowerHeavy:false,source:'fangkun',refId:'core',status:'planned'},
  {id:'custom:future',date:'2026-10-21',kind:'strength',modality:'strength',trainingType:'strength',title:'未来的课',focus:[],minutes:30,intensity:'EASY',lowerHeavy:false,source:'custom',refId:null,status:'planned'}]},
 'fk-today-checklist-v1':{'2026-10-17|core':{date:'2026-10-17',sessionId:'core',moves:{sq:[{done:true,reps:8,kg:20},{done:false}]},run:null,rpe:null,state:null,startedAt:Date.parse('2026-10-16T16:09:00Z'),restEndsAt:null,updatedAt:Date.parse('2026-10-16T16:30:00Z')},
  // v53–v72 旧形态：按日期为键
  '2026-10-10':{date:'2026-10-10',sessionId:'full',moves:{sq:[{done:true}]},run:null,rpe:6,state:'normal',startedAt:Date.parse('2026-10-10T11:00:00Z'),restEndsAt:null,updatedAt:Date.parse('2026-10-10T11:30:00Z')}},
 'fk-health-tiles-v1':['SLEEP','RHR','HRV','BODY_BATTERY','recovery','pain'],
 'fk-checkin-v1':[{date:'2026-10-18',at:'2026-10-18T12:00:00Z',recovery:4}],
 'fk-plan400-v4-log':{'2026-10-12':{done:'done',strength:'分腿蹲 2×20kg×5/腿',rpe:'7',savedAt:'2026-10-12T13:00:00Z'}},
}
const healthAsked=new Set()
const ctx=await b.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true});const chats=[]
await ctx.addInitScript(([s])=>{localStorage.setItem('fk-onboard-v1','1');if(!localStorage.getItem('seed78')){localStorage.setItem('seed78','1');for(const [k,v] of Object.entries(s))localStorage.setItem(k,JSON.stringify(v))}},[seed])
await ctx.route('**/api/garmin/**',r=>{const u=new URL(r.request().url());const j=o=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(o)})
 if(u.pathname.endsWith('/status'))return j({loggedIn:true,region:'cn',profile:{displayName:'tester'}});if(u.pathname.includes('activitylist'))return j(Number(u.searchParams.get('start')||0)>0?[]:garmin);if(u.pathname.includes('/splits'))return j({lapDTOs:[]})
 const d=(u.pathname+u.search).match(/(\d{4}-\d\d-\d\d)/)?.[1];if(d)healthAsked.add(d)
 const has=d&&d>='2026-10-06'&&d<='2026-10-19'&&d!=='2026-10-10',n=d?Number(d.slice(8)):0
 if(has&&u.pathname.includes('usersummary'))return j({calendarDate:d,restingHeartRate:48+(n%7),averageStressLevel:30,bodyBatteryMostRecentValue:31})
 if(has&&u.pathname.includes('hrv-service'))return j({hrvSummary:{calendarDate:d,lastNightAvg:50+(n%9)}})
 if(has&&u.pathname.includes('dailySleepData'))return j({dailySleepDTO:{calendarDate:d,sleepTimeSeconds:6*3600+n*60}})
 return r.fulfill({status:204,body:''})})
await ctx.route('**/api/coach-chat',async r=>{chats.push(JSON.parse(r.request().postData()));return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({text:'MOCK 联网回答'})})})
const p=await ctx.newPage();p.setDefaultTimeout(10000);const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push(m.text().slice(0,300))})
await p.clock.install({time:new Date('2026-10-19T00:20:00Z')})
await p.addInitScript(()=>{const D=window.Date;if(D.__safari)return;const bad=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s);function SD(...a){if(!new.target)return D();return a.length===1&&bad(a[0])?new D(NaN):new D(...a)}SD.prototype=D.prototype;SD.now=()=>D.now();SD.UTC=(...a)=>D.UTC(...a);SD.parse=s=>bad(s)?NaN:D.parse(s);SD.__safari=true;window.Date=SD})
// Safari：不认 "YYYY-MM-DD HH:MM:SS"（空格分隔）→ Invalid Date。装在假时钟之后，包住它。
const ready=async()=>{try{await p.locator('[data-testid="training-app"][data-ready=true]').waitFor({timeout:60000})}catch(e){console.log("NOT READY",errs.join(" | "),(await p.locator("body").innerText()).slice(0,500));throw e};await p.waitForTimeout(6000)}
await p.goto(base);await ready()
check('Safari 日期解析模拟生效',await p.evaluate(()=>isNaN(new Date('2026-10-18 07:30:00').getTime())&&!isNaN(new Date('2026-10-18T07:30:00').getTime())))
const tab=async n=>{await p.getByLabel('切换到'+n).click({force:true});await p.waitForTimeout(700)}
const toLog=async()=>{await tab('日志');await p.locator('[data-testid="training-log-v76"]').waitFor()}
// ---------- 0. 用户截图现场：旧“力量”筛选 ----------
await toLog()
let sum=await p.getByLabel('当前周期摘要').innerText()
check('升级后旧“力量”筛选不再沿用：类型=全部，摘要写明“全部”',await p.getByRole('button',{name:'全部',exact:true}).getAttribute('aria-pressed')==='true'&&/全部 \d+ 条记录/.test(sum),sum)
await p.getByRole('button',{name:'力量',exact:true}).click();sum=await p.getByLabel('当前周期摘要').innerText()
check('选了力量：摘要顶部写“只看力量 · 另有 N 条跑步没显示”+看全部',/只看力量 · 另有 \d+ 条跑步没显示/.test(sum)&&await p.getByTestId('active-filter').getByRole('button',{name:'看全部'}).isVisible(),sum)
await p.getByTestId('active-filter').getByRole('button',{name:'看全部'}).click()
// ---------- 1. 待标记：自定 力量·小腿 10-18 ----------
let um=await p.getByTestId('unmarked-plans').innerText().catch(()=>'');console.log('---待标记\n'+um)
check('10-18 自定 力量·小腿（没标记）列在“还没标记的课”，不算记录',/力量·小腿/.test(um)&&/10-18/.test(um)&&!/力量·小腿/.test(await p.getByLabel('训练记录列表').innerText()),um)
check('没练 / 未来的课 不在待标记',!/轻松跑（没练）|力量课 · 没练|未来的课/.test(um),um)
await p.getByTestId('unmarked-plans').locator('li',{hasText:'力量·小腿'}).getByRole('button',{name:'按计划完成'}).click();await p.waitForTimeout(800)
// ---------- 2. 记一笔（力量 + 跑步）----------
await tab('今日')
for(const t of ['深蹲 3×8 60kg','跑步 5公里 30分钟']){await p.getByLabel('记一笔',{exact:true}).first().click();await p.getByLabel('记录内容').fill(t);await p.waitForTimeout(300);const rec=await p.getByLabel('识别结果').innerText().catch(()=>'');console.log('记一笔识别',t,'→',rec.slice(0,80));await p.getByRole('dialog',{name:'记一笔'}).getByRole('button',{name:'保存记录'}).click().catch(()=>p.getByRole('button',{name:'保存记录',exact:true}).last().click());await p.waitForTimeout(800);if(await p.getByRole('button',{name:'取消'}).isVisible().catch(()=>false))await p.getByRole('button',{name:'取消'}).click()}
// ---------- 3. 聊天确认的训练（离线）----------
await p.getByRole('button',{name:'打开方坤',exact:true}).click();await p.getByPlaceholder('输入你的问题').fill('今天实际完成200m×4，39/38/37/36秒，组间3分钟，练了50分钟，整课RPE7，练得怎么样？');await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForTimeout(3500)
try{const draft=p.getByTestId('chat-training-save');await draft.locator('summary').click();await p.getByLabel('自报训练实际时间',{exact:true}).fill('2026-10-17T18:30');await draft.getByRole('checkbox').check();await p.getByRole('button',{name:'确认保存为训练',exact:true}).click();await p.waitForTimeout(1200);check('聊天确认的训练：已保存',true)}catch(e){check('聊天确认的训练：已保存',false,e.message)}
await p.getByRole('button',{name:'关闭方坤',exact:true}).click().catch(()=>p.keyboard.press('Escape'))
// ---------- 4. 首页 V4 训练详情（训练中 / 训练后）10-19 ----------
const fill=(l,v)=>p.locator('label',{hasText:l}).first().locator('input').fill(v)
try{await p.locator('[data-testid="today-primary-cta"]').first().click();await p.locator('[data-testid="plan400-day-sheet"]').waitFor();await p.getByRole('tab',{name:'训练后'}).click();await fill('整课 RPE','7');await p.getByRole('button',{name:'保存训练后反馈'}).click();await p.waitForTimeout(500)
 // ---------- 5. 逐组引导力量（同一天 V4 力量部分），完成 1 组后离开 ----------
 await p.getByRole('tab',{name:'课表'}).click();await p.waitForTimeout(400);const st=p.getByRole('button',{name:/开始力量部分|开始力量训练/});await st.first().click();await p.waitForTimeout(1200)
 {const done=new Set();for(let i=0;i<6&&!(await p.locator('[data-testid=guided-current]').count());i++){for(const n of ['本次不使用','按原计划','开始训练','开始执行','继续训练','继续']){const bt=p.getByRole('button',{name:n,exact:true});if(!done.has(n)&&await bt.count()&&await bt.first().isVisible()){done.add(n);await bt.first().click();await p.waitForTimeout(900);break}}}}
 await p.getByRole('button',{name:'完成左侧',exact:true}).click();await p.waitForTimeout(300);await p.getByRole('button',{name:'跳过休息'}).click().catch(()=>{});await p.getByRole('button',{name:'完成本组',exact:true}).click();await p.waitForTimeout(500)
 check('逐组引导：完成 1 组',true)
 await p.getByRole('button',{name:'返回首页 · 保留进度'}).click().catch(()=>{});await p.waitForTimeout(500);await p.keyboard.press('Escape');await p.getByRole('button',{name:'关闭训练详情'}).click().catch(()=>{})
}catch(e){check('首页 V4 / 逐组引导 流程可走通',false,e.message);await p.screenshot({path:'/workspace/out/v78-flow-fail.png'})}
await p.waitForTimeout(800)
// ---------- 矩阵 ----------
// 期望：标题片段 → [日期, 类型]
const EXP=[['晨跑','10-18','run'],...[12,13,14,15,16,17].map(d=>[`跑步${d}`,`10-${d}`,'run']),['佳明力量08','10-08','lift'],['佳明力量05','10-05','lift'],
 ['力量·小腿','10-18','lift'],['力量·下肢','10-16','lift'],['力量课 · 上肢','10-15','lift'],['力量课 · 核心+下肢','10-17','lift'],['10-10旧清单','10-10','lift'],
 ['深蹲 3×8 60kg','10-19','lift'],['跑步 5','10-19','run'],['V4 ','10-12','*'],['速度耐力＋力量A','10-19','*']]
const NEVER=['轻松跑（没练）','力量课 · 没练','未来的课']
const parse=t=>{const out={};let cur=null;for(const line of t.split('\n')){const m=line.match(/^(\d\d-\d\d) 周.? · (\d+) 条/);if(m){cur=m[1];out[cur]=out[cur]||'';continue}if(cur)out[cur]+=line+'\n'}return out}
const dump={}
const surface=async(kind,range)=>{await toLog();await p.getByRole('button',{name:range==='week'?'本周（按天）':'近4周（按周）'}).click();await p.getByRole('button',{name:{all:'全部',run:'跑步',lift:'力量'}[kind],exact:true}).click();await p.waitForTimeout(400)
 const list=await p.getByLabel('训练记录列表').innerText(),s=await p.getByLabel('当前周期摘要').innerText();dump[`${kind}/${range}`]=s+'\n'+list;return {list,s,days:parse(list)}}
const verify=async(tag)=>{
 for(const kind of ['all','run','lift'])for(const range of ['week','4w']){const {list,s,days}=await surface(kind,range);const lo=range==='week'?'10-19':'09-28',hi=range==='week'?'10-25':'10-25'
  let n=0;const bad=[]
  for(const [t,d,k] of EXP){if(t==='10-10旧清单'){continue}
   const inRange=d>=lo&&d<=hi,want=inRange&&(kind==='all'||k==='*'||k===kind)
   const hit=l=>l.includes(t)&&!/^\d/.test(l)
   const cnt=(days[d]||'').split('\n').filter(hit).length
   const elsewhere=Object.entries(days).filter(([dd,txt])=>!EXP.some(x=>x[0]===t&&x[1]===dd)&&txt.split('\n').some(hit)).map(([dd])=>dd)
   if(k==='*'&&kind!=='all'){continue} // V4 跑+力量混合课：类型由计划决定，单独核对
   if(want&&cnt!==1)bad.push(`缺 ${t}@${d}`);if(!want&&cnt)bad.push(`多 ${t}@${d}`);if(elsewhere.length)bad.push(`${t} 出现在错误日期 ${elsewhere}`);if(want)n++}
  for(const t of NEVER)if(list.includes(t))bad.push('不该出现 '+t)
  const total=Number((s.match(/(\d+) 条记录/)||[])[1]),headSum=Object.keys(days).length?Object.values(days).length:0
  const dayCounts=[...list.matchAll(/^\d\d-\d\d 周.? · (\d+) 条/gm)].reduce((a,m)=>a+Number(m[1]),0)
  check(`${tag} 日志 ${kind}/${range}：每条恰好一次、日期正确`,!bad.length,bad.join('；')+'\n'+list.slice(0,1500))
  // v79（t489）：没完成也没反馈的课照样列出，但不计入条数
  const notCounted=(list.match(/未完成(·未反馈)?（不计入）/g)||[]).length
  check(`${tag} 日志 ${kind}/${range}：摘要条数 + 未计入 = 列表条数 (${total}+${notCounted}=${dayCounts})`,total+notCounted===dayCounts,s)
 }
 // 10-10 旧版清单（近4周 全部里）
 const all=dump['all/4w'];check(`${tag} v53–v72 旧清单 10-10 → 日志 10-10`,/10-10 周六 · 1 条/.test(all),all.slice(0,200))
 const s4=all.split('\n')[0]+all.split('\n')[1];console.log('---近4周 全部 摘要\n'+all.split('\n').slice(0,4).join('\n'))
}
await verify('首次')
// 状态
const st=dump['all/4w'];check('10-18 力量·小腿 标记后 = 已完成（不是已记录未完成），日期 10-18',/力量·小腿\n[^\n]*10-18[^\n]*手机记录/.test(st)&&!/力量·小腿\n[^\n]*已记录未完成/.test(st),st)
check('10-17 核心+下肢（勾过 1 组、没完成没反馈）= 10-17 00:09 未完成·未反馈（不计入）',/力量课 · 核心\+下肢\n[^\n]*10-17 00:09[^\n]*未完成·未反馈（不计入）/.test(st),st)
check('10-15 实际不同 → 25:00',/力量课 · 上肢[\s\S]{0,80}25:00/.test(st),st)
um=await p.getByTestId('unmarked-plans').innerText().catch(()=>'');check('标记后待标记清空',!/力量·小腿/.test(um),um)
// 复盘
await toLog();await p.getByRole('button',{name:'全部',exact:true}).click();await p.getByRole('button',{name:'最近一课'}).click().catch(()=>{});const rv=await p.getByLabel('单课复盘').innerText().catch(()=>'');console.log('---复盘\n'+rv.slice(0,300))
check('复盘“最近一课”= 10-19 的记录',/训练日期 10-19/.test(rv),rv)
// 五维
const ab=await p.locator('[data-testid="training-log-v76"] > *').first().innerText();console.log('---五维\n'+ab.slice(0,500));check('五维能力图在日志顶部渲染',await p.getByRole('img',{name:'五维能力图'}).first().isVisible())
// 今日 / 计划
await tab('今日');const td=await p.locator('body').innerText();console.log('---今日\n'+td.slice(0,700))
await tab('计划');const pl=await p.locator('body').innerText();console.log('---计划\n'+pl.slice(0,900))
// 健康：恢复趋势 7/30/90 + 卡片同源 + 日期
await tab('健康');await p.getByText('健康记录').first().waitFor();await p.waitForTimeout(1200)
await p.screenshot({path:'/workspace/out/v78-health.png',fullPage:true});const hb=await p.locator('body').innerText()
const tileT=async n=>(await p.locator('button',{hasText:n}).filter({hasText:/\d\d-\d\d|点一下/}).first().innerText()).replace(/\s+/g,' ')
const rt=await tileT('静息心率'),rc=await tileT('恢复状态');console.log('---卡片',rt,'|',rc)
check('健康卡片 RHR = 10-19 佳明值 53（48+19%7），与趋势同源 snapshot',/53 次\/分 10-19/.test(rt),rt)
check('恢复状态（主观，10-18 评过）今天显示“今天未评 · 上次 4 · 10-18”，不冒充今天',/今天未评 上次 4 · 10-18/.test(rc),rc)
const trend=p.locator('section',{hasText:'恢复趋势'}).last()
await trend.getByRole('button',{name:'静息心率'}).click()
for(const [dd,first] of [[7,'10-13'],[30,'09-20'],[90,'07-22']]){await trend.getByRole('button',{name:`${dd}天`}).click();await p.waitForTimeout(300)
 const cov=await trend.getByTestId('trend-coverage').innerText(),txt=await trend.innerText(),segs=await trend.locator('svg g[data-segments]').first().getAttribute('data-segments')
 console.log(`---恢复趋势 ${dd}天`,cov,'| 轴',txt.match(/\d\d-\d\d/g)?.slice(-5).join(' '),'| 段',segs)
 check(`恢复趋势 ${dd}天：x 轴从 ${first} 起（所选范围，不是数据首尾）`,txt.includes(first),txt)
 const nDays=dd===7?7:13
 check(`恢复趋势 ${dd}天：${nDays} 天有数据${dd>14?'，写明不足 '+dd+' 天':''}`,cov.includes(`${nDays} 天有数据`)&&(dd<=14||cov.includes(`不足 ${dd} 天`)),cov)
 check(dd===7?'恢复趋势 7天：范围内连续 → 1 段':`恢复趋势 ${dd}天：10-10 缺一天 → 断开成 2 段，不画假线`,segs===(dd===7?'1':'2'),segs)}
const bf=await p.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('fk-garmin-health-backfill')).map(([k,v])=>v))
check('健康历史逐次补到 90 天：本次额外请求 14 天更早数据（09-22..10-05）',bf[0]==='28'&&healthAsked.has('2026-09-22')&&!healthAsked.has('2026-09-21'),JSON.stringify({bf,asked:[...healthAsked].sort().slice(0,3)}))
// 今日 / 计划 记录状态
check('今日：记一笔两条 ✓ 按计划；V4 主卡 进行中',/深蹲 3×8 60kg[\s\S]{0,60}✓ 按计划/.test(td)&&/跑步 5 公里[\s\S]{0,60}✓ 按计划/.test(td)&&/10月19日 周一\n进行中/.test(td),td.slice(0,400))
check('计划：V4 日期已确认（用户 t486），大警告卡收起为一行；W3 标题显示 11月7日',/✓ 日期已确认 · 整体顺延 7 天/.test(pl)&&!/日期待核对/.test(pl)&&/11月7日/.test(pl)&&!/10月31日/.test(pl),pl.slice(0,700))
check('计划：10/19 V4 课 进行中',/10\/19 周一\n速度耐力＋力量A\n[^\n]*\n进行中/.test(pl),pl.slice(0,600))
// 方坤上下文（联网事实包）
await p.evaluate(()=>localStorage.setItem('fk-coach-online-v1',JSON.stringify({on:true,consentAt:'2026-10-19T00:00:00Z',by:'test'})));await p.reload();await ready()
await p.getByRole('button',{name:'打开方坤',exact:true}).click();await p.getByPlaceholder('输入你的问题').fill('看看我最近两周的训练');await p.getByRole('button',{name:'发送',exact:true}).click();await p.waitForTimeout(4000)
const f=(chats.at(-1)||{}).facts||'';console.log('---事实包\n'+f.slice(0,2500));fs.writeFileSync('/workspace/out/v78-facts.txt',f)
const fk=[['2026-10-18','6.01 km'],['力量·小腿'],['力量·下肢'],['核心+下肢'],['深蹲 3×8'],['V4 计划记录（2026-10-19'],['2026-10-12 V4']]
for(const parts of fk)check(`方坤上下文含 ${parts.join(' ')}`,parts.every(x=>f.includes(x)),'')
check('方坤上下文不含没练/未来的课',!/没练）|未来的课/.test(f))
const once=(t)=>(f.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))||[]).length
check('方坤上下文 6.01 km 只出现一次（不重复计）',once('6.01 km')===1,`次数 ${once('6.01 km')}`)
await p.getByRole('button',{name:'关闭方坤',exact:true}).click().catch(()=>{})
// 刷新后再验一遍
await p.reload();await ready();await tab('计划');check('刷新后日期确认仍在',/✓ 日期已确认/.test(await p.locator('body').innerText()));await verify('刷新后')
check('no page errors',errs.length===0,errs.join(' | '))
fs.writeFileSync('/workspace/out/v78-matrix-dump.txt',Object.entries(dump).map(([k,v])=>`### ${k}\n${v}`).join('\n\n'))
fs.writeFileSync('/workspace/out/v78-matrix.txt',M.join('\n'))
await b.close();console.log(fails?`FAILS ${fails}`:'ALL PASS');process.exit(fails?1:0)
