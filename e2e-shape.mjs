import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]}); const ok=(n,c,x="")=>console.log(`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`);
const MODE=process.env.MODE||'safari'; const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
const today=new Date().toISOString().slice(0,10);
await p.evaluate((today)=>{ const k="fr255-profile-v1"; let o={}; try{o=JSON.parse(localStorage.getItem(k)||"{}")}catch{} localStorage.setItem(k,JSON.stringify({...o,heightCm:"172",weightKg:"56.4",targetKg:"60",sex:"male",age:"30"}));
 localStorage.setItem("fr255-body-v1", JSON.stringify([{id:today,date:today,weight:56.4,fat:18.8,muscle:43.3}])); },today);
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
if(MODE==='standalone') await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important}"});
const before=await p.evaluate(()=>localStorage.getItem("fr255-body-v1"));
await p.getByLabel("切换到健康").click({force:true}); await p.waitForTimeout(1500);
await p.getByText("我的形象 ›").first().click(); await p.waitForTimeout(800);
await tap(p.getByRole("button",{name:"62 kg"})); await tap(p.getByRole("button",{name:"10%"})); await p.waitForTimeout(500);
const cv=p.locator('canvas[aria-label="体型3D"]'); ok("3D canvas present", await cv.count()>0);
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="体型3D"]')?.__fk,null,{timeout:40000}).catch(()=>{});
ok("3D ready", await cv.evaluate(e=>!!e.__fk), errs.join("|"));
const box=p.locator('[aria-label="体型模拟3D"]'); let t=await box.innerText();
ok("label 模拟外观，非准确预测", t.includes("模拟外观，非准确预测")); ok("current/target labels", t.includes("当前") && t.includes("目标 62.0 kg"));
await cv.evaluate(e=>e.scrollIntoView({block:"center"})); await p.waitForTimeout(1500); await cv.screenshot({path:`/workspace/out/shape-${MODE}-bf.png`});
await tap(box.getByRole("button",{name:"自定肌肉/脂肪比例"})); await p.waitForTimeout(300); t=await box.innerText(); ok("default split not all muscle (30%)", t.includes("30%"), t.match(/肌肉占比\s*\d+%/)?.[0]);
await box.getByLabel("肌肉占比").fill("80"); await p.waitForTimeout(800); await cv.screenshot({path:`/workspace/out/shape-${MODE}-split80.png`});
for (const [k,l] of [["relax","自然休闲"],["hips","叉腰"],["arms","轻抱臂"],["flex","屈肘展示"],["run","跑步定格"]]) { await tap(box.getByRole("button",{name:l})); await cv.evaluate(e=>e.scrollIntoView({block:"center"})); await p.waitForTimeout(900); await cv.screenshot({path:`/workspace/out/shape-${MODE}-pose-${k}.png`}); }
for (const [k,l] of [["side","侧面"],["back","背面"],["three","45°"]]) { await tap(box.getByRole("button",{name:l,exact:true})); await cv.evaluate(e=>e.scrollIntoView({block:"center"})); await p.waitForTimeout(900); await cv.screenshot({path:`/workspace/out/shape-${MODE}-view-${k}.png`}); }
const bb=await cv.boundingBox(); await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+bb.width/2+250,bb.y+bb.height/2,{steps:10}); await p.mouse.up(); await p.waitForTimeout(800); await cv.screenshot({path:`/workspace/out/shape-${MODE}-drag.png`});
await tap(box.getByRole("button",{name:"恢复默认"})); await p.waitForTimeout(600); const st=await cv.evaluate(e=>e.__fk.state); ok("reset to front", Math.abs(st.azimuth)<1, JSON.stringify(st));
ok("canvas touch-action pan-y", (await cv.evaluate(e=>e.style.touchAction))==="pan-y");
const sim=await p.evaluate(()=>localStorage.getItem("fk-shape-sim-v1")); ok("sim params stored separately", /leanShare/.test(sim||""), sim);
ok("measured data untouched", (await p.evaluate(()=>localStorage.getItem("fr255-body-v1")))===before);
ok("no page errors", errs.length===0, errs.slice(0,2).join("|"));
await b.close();
