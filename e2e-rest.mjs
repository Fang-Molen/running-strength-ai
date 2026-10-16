import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const R=[]; const ok=(n,c,x="")=>R.push(`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`);
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2, timezoneId:"Asia/Shanghai" });
const p = await ctx.newPage(); const sh=f=>p.screenshot({path:`/workspace/out/rest-${f}.png`});
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
// seed t422 scenario (simulates user's existing session; keeps any other entries)
await p.evaluate(()=>{const k="fk-schedule-v1"; let s={entries:[],acks:[]}; try{s=JSON.parse(localStorage.getItem(k))||s}catch{}
 s.entries.push({id:"custom:2026-10-17:seed1",date:"2026-10-17",kind:"strength",modality:"strength",title:"力量 · 下肢",focus:["下肢"],minutes:45,intensity:"MODERATE",lowerHeavy:true,source:"custom",refId:null,status:"planned",slot:"pm",exercises:[{name:"杠铃深蹲",sets:"3",reps:"8",weight:"60",rpe:""},{name:"罗马尼亚硬拉",sets:"3",reps:"8",weight:"50",rpe:""},{name:"保加利亚分腿蹲",sets:"3",reps:"8",weight:"",rpe:"",perSide:true}]});
 s.entries.push({id:"custom:2026-10-18:seed2",date:"2026-10-18",kind:"strength",modality:"strength",title:"力量 · 下肢",focus:["下肢"],minutes:45,intensity:"MODERATE",lowerHeavy:true,source:"custom",refId:null,status:"planned",slot:"pm",exercises:[{name:"杠铃深蹲",sets:"3",reps:"8",weight:"",rpe:""}]});
 localStorage.setItem(k,JSON.stringify(s)); localStorage.removeItem("fk-rest-fill-20261017"); localStorage.setItem("fk-probe","keep");});
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(2000);
const st=()=>p.evaluate(()=>JSON.parse(localStorage.getItem("fk-schedule-v1")).entries);
let es=await st(); const e17=es.find(e=>e.id==="custom:2026-10-17:seed1"), e18=es.find(e=>e.id==="custom:2026-10-18:seed2");
ok("t422 10/17 力量·下肢 every exercise restSec=75", e17.exercises.every(x=>x.restSec===75), e17.exercises.map(x=>x.restSec).join("/"));
ok("t422 other session untouched (未设置)", e18.exercises[0].restSec==null);
ok("t422 换侧间隔 / 动作之间休息 left unset", e17.exercises[2].sideRestSec==null && e17.betweenRestSec==null);
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(1500); es=await st();
ok("t422 idempotent after reload", es.filter(e=>e.id==="custom:2026-10-17:seed1").length===1 && JSON.parse(await p.evaluate(()=>localStorage.getItem("fk-rest-fill-20261017"))).changed>=0);
// display on 今日 card
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(1200);
const card=p.getByText("力量 · 下肢").first(); await tap(card); await p.waitForTimeout(800);
let t=await p.locator("body").innerText();
ok("card shows '杠铃深蹲 3×8次 @60kg｜组间休息：75秒'", t.includes("杠铃深蹲 3×8次 @60kg") && t.includes("｜组间休息：1分15秒")); await sh("1-card");
// timer: start → pause → resume → finish
await tap(p.getByRole("button",{name:"开始休息"}).first()); await p.waitForTimeout(2200);
await tap(p.getByRole("button",{name:"暂停"}).first()); const t1=await p.getByRole("timer").first().innerText(); await p.waitForTimeout(1500); const t2=await p.getByRole("timer").first().innerText();
ok("countdown runs and pause freezes", t1===t2 && t1!=="1:15", `${t1}`); await sh("2-timer-paused");
await tap(p.getByRole("button",{name:"继续"}).first()); await p.waitForTimeout(1200);
await tap(p.getByRole("button",{name:"结束并记录"}).first()); await p.waitForTimeout(500);
es=await st(); const lg=es.find(e=>e.id==="custom:2026-10-17:seed1").restLog||[];
ok("actual rest stored separately from plan", lg.length===1 && lg[0].planned===75 && lg[0].actual>=2 && lg[0].actual<10 && es.find(e=>e.id==="custom:2026-10-17:seed1").exercises[0].restSec===75, JSON.stringify(lg[0]));
await sh("3-after-log");
// new session via editor: batch 75 + override + save + reload
await tap(p.getByRole("button",{name:"自己加一节"})); await p.waitForTimeout(500); await tap(p.getByRole("button",{name:/^力量$/}).first());
await p.getByPlaceholder("搜索动作").fill("深蹲"); await tap(p.getByRole("button",{name:"＋杠铃深蹲",exact:true}));
await p.getByPlaceholder("搜索动作").fill("硬拉"); await tap(p.getByRole("button",{name:"＋罗马尼亚硬拉",exact:true}));
t=await p.locator("body").innerText(); ok("new exercises default to 未设置 (not 0)", (t.match(/未设置/g)||[]).length>=2);
await tap(p.getByRole("button",{name:"建议 75 秒"})); await tap(p.getByRole("button",{name:"应用到全部"}));
await p.getByLabel("罗马尼亚硬拉组间休息分").fill("2"); await p.getByLabel("罗马尼亚硬拉组间休息秒").fill("0");
await p.getByLabel("动作之间休息分").fill("3"); await sh("4-editor");
const addBtn=p.getByRole("button",{name:/加入|添加到/}).last(); await tap(addBtn); await p.waitForTimeout(800);
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(1500);
es=await st(); const n=es.filter(e=>e.source==="custom"&&e.exercises?.some(x=>x.name==="罗马尼亚硬拉")&&e.id!=="custom:2026-10-17:seed1").pop();
ok("save+reload: batch 75s, override 2分, 动作之间 3分 persisted", n && n.exercises[0].restSec===75 && n.exercises[1].restSec===120 && n.betweenRestSec===180, n?JSON.stringify(n.exercises.map(x=>x.restSec))+" between "+n.betweenRestSec:"no entry");
ok("other data preserved", await p.evaluate(()=>localStorage.getItem("fk-probe"))==="keep");
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(800); await sh("5-after-reload");
console.log(R.join("\n")); await b.close();
