import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const ok=(n,c,x="")=>console.log(`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`);
const MODE=process.env.MODE||'safari'; const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
const today=new Date().toISOString().slice(0,10);
await p.evaluate((today)=>{ localStorage.setItem("fr255-body-v1", JSON.stringify([{id:today,date:today,weight:57,fat:19}])); },today); await p.reload({waitUntil:"networkidle"});
if(MODE==='standalone') await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important}"});
const before=await p.evaluate(()=>localStorage.getItem("fr255-body-v1"));
await p.getByLabel("切换到健康").click({force:true}); await p.waitForTimeout(1200);
await p.getByText("身体数据 ›").first().click({force:true}); await p.waitForTimeout(1000);
await p.getByText("手动记录体脂秤数据").click(); await p.waitForTimeout(300);
const btn=p.getByRole("button",{name:/拍照\/上传识别/}); ok("button disabled before consent", await btn.isDisabled());
await p.getByLabel("同意识别说明").check();
const run=async f=>{ await p.getByLabel("选择体脂秤图片").setInputFiles(`/workspace/out/scale/${f}`); await p.waitForFunction(()=>!/识别中|处理图片|加载|正在/.test(document.querySelector('[aria-label="拍照识别"]')?.innerText||""),null,{timeout:120000}); return p.locator('[aria-label="拍照识别"]').innerText(); };
let m=await run("app.png"); const v=k=>p.getByLabel(k,{exact:true}).inputValue();
ok("app: fields filled", (await v("体重"))==="56.4" && (await v("体脂率"))==="18.8" && (await v("基础代谢"))==="1494" && (await v("骨量"))==="2.6", m.slice(-60));
ok("app: date filled", (await p.locator('input.fk-cell[type=date]').inputValue())==="2026-10-16");
ok("not auto-saved", (await p.evaluate(()=>localStorage.getItem("fr255-body-v1")))===before);
await p.screenshot({path:`/workspace/out/scale-${MODE}-app.png`,fullPage:false});
for (const k of ["体重","体脂率","肌肉量","双臂肌肉","躯干肌肉","双腿肌肉","内脏脂肪","水分","骨量","基础代谢"]) await p.getByLabel(k,{exact:true}).fill("");
m=await run("partial.png"); ok("partial: 斤→kg, fat flagged, rest blank", (await v("体重"))==="56.4" && (await v("体脂率"))==="85" && (await v("肌肉量"))==="" && /标红/.test(m), m.slice(-60));
m=await run("blank.png"); ok("blank: reason shown, form kept", /没有识别到/.test(m) && (await v("体重"))==="56.4");
await p.getByLabel("体脂率",{exact:true}).fill("18.8"); await p.getByRole("button",{name:"保存",exact:true}).click(); await p.waitForTimeout(500);
const after=JSON.parse(await p.evaluate(()=>localStorage.getItem("fr255-body-v1"))); ok("save after review keeps other records", after.some(r=>r.weight===56.4) && after.length>=1, JSON.stringify(after).slice(0,120));
await b.close();
