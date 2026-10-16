import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"});
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const R=[]; const ok=(n,c)=>{R.push(`${c?"PASS":"FAIL"} ${n}`)}; const sh=f=>p.screenshot({path:`/workspace/out/e2e-${f}.png`});
await p.goto("https://molen-fangkun.pages.dev/", { waitUntil: "networkidle" });
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
const today=new Date().toISOString().slice(0,10); const ts=Date.now();
await p.evaluate(({today,ts})=>{localStorage.setItem("fr255-food-log-v1",JSON.stringify([{id:"hls",date:today,at:ts,meal:"午餐",name:"华莱士鸡腿堡",grams:0,kcal:0,label:"品牌待核"},{id:"egg",date:today,at:ts,meal:"早餐",name:"鸡蛋",grams:50,kcal:72,protein:6.3,carb:0.4,fat:4.8,label:"手填"}])); localStorage.removeItem("fk-food-migrate-v3");
 const k="fr255-profile-v1"; let o={}; try{o=JSON.parse(localStorage.getItem(k)||"{}")}catch{} localStorage.setItem(k,JSON.stringify({...o,heightCm:"172",weightKg:"56.4",targetKg:"60",sex:"male",age:"30"}));
 localStorage.setItem("fr255-body-v1", JSON.stringify([{id:today,date:today,weight:56.4,fat:18.8,muscle:43.3}]));},{today,ts});
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
await p.getByLabel("切换到饮食").click({force:true}); await p.waitForTimeout(2000);
const body=()=>p.locator("body").innerText();
let t=await body(); ok("2 migrated 华莱士 shows 已记录，营养待补充 (not 0 kcal)", t.includes("已记录，营养待补充") && !/华莱士鸡腿堡\s*0 g · 0 kcal/.test(t));
ok("3 partial totals show 项待补充", t.includes("项待补充")); await sh("1-diet-pending"); await p.screenshot({path:"/workspace/out/e2e-1-diet-full.png",fullPage:true});
await p.getByText("午餐").first().click({force:true}); await p.waitForTimeout(800); await sh("2-meallist");
const btn=p.getByRole("button",{name:"补录"}).first(); ok("4a 补录 button present", await btn.count()>0);
if(await btn.count()){ await btn.click(); await p.getByLabel("热量kcal").fill("520"); await p.getByLabel("蛋白g").fill("24"); await p.getByLabel("碳水g").fill("50"); await p.getByLabel("脂肪g").fill("25"); await p.getByLabel("份量g").fill("200"); await sh("3-editor"); await p.getByRole("button",{name:"保存"}).click(); await p.waitForTimeout(500);
 t=await body(); ok("4b save recomputes (520 kcal shown)", t.includes("520 kcal")); await sh("4-after-save");
 await p.getByRole("button",{name:"编辑"}).first().click(); await p.getByLabel("份量g").fill("100"); await p.getByRole("button",{name:"保存"}).click(); await p.waitForTimeout(500);
 t=await body(); ok("4c portion 200→100 halves to 260 kcal", t.includes("260 kcal")); }
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500); await p.getByLabel("切换到饮食").click({force:true}); await p.waitForTimeout(2000);
t=await body(); ok("1 persists after reload (260 kcal, total 332)", t.includes("260 kcal") || t.includes("332")); await sh("5-after-reload");
await p.getByText("午餐").first().click({force:true}); await p.waitForTimeout(800);
const d=p.getByRole("button",{name:"删除"}).first(); if(await d.count()){await d.click(); await p.waitForTimeout(500);}
const n=await p.evaluate(()=>JSON.parse(localStorage.getItem("fr255-food-log-v1")).length); ok("5 delete removes entry; other data kept (1 left)", n===1); await sh("6-after-delete");
await p.keyboard.press("Escape"); await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
await p.getByLabel("切换到健康").click({force:true}); await p.waitForTimeout(2000);
await p.getByText("我的形象 ›").first().click(); await p.waitForTimeout(2500);
await p.getByRole("button",{name:"62 kg"}).click(); await p.getByRole("button",{name:"10%"}).click(); await p.waitForTimeout(800); await sh("7-figure-target");
t=await body(); ok("T target 62 kg + 体脂率 10% shown", t.includes("62 kg") && /目标体脂率\s*10(\.0)?%/.test(t));
await p.getByRole("button",{name:"设为目标"}).click(); await p.waitForTimeout(500);
const tk=await p.evaluate(()=>JSON.parse(localStorage.getItem("fr255-profile-v1")).targetKg); ok("T saved targetKg=62", tk==="62");
await p.screenshot({path:"/workspace/out/e2e-8-figure-full.png",fullPage:true});
console.log(R.join("\n")); await b.close();
