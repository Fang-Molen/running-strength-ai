import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const ok=(n,c,x="")=>console.log(`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`);
const MODE=process.env.MODE||'safari'; const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
const today=new Date().toISOString().slice(0,10);
await p.evaluate((today)=>{ const k="fr255-profile-v1"; let o={}; try{o=JSON.parse(localStorage.getItem(k)||"{}")}catch{} localStorage.setItem(k,JSON.stringify({...o,heightCm:"172",weightKg:"56.4",targetKg:"60",sex:"male",age:"30"})); localStorage.setItem("fr255-body-v1", JSON.stringify([{id:today,date:today,weight:56.4,fat:18.8,muscle:43.3}])); },today);
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1200);
if(MODE==='standalone') await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important}"});
await p.getByLabel("切换到健康").click({force:true}); await p.waitForTimeout(1500);
await p.screenshot({path:`/workspace/out/figure-${MODE}-card.png`});
let t=await p.locator("body").innerText(); ok("card: 体型模拟尚未启用 + 静态插画", t.includes("体型模拟尚未启用") && t.includes("静态插画"));
ok("card uses figure-male.webp", (await p.locator('img[src*="figure-male.webp"]').count())>0);
await p.getByText("我的形象 ›").first().click(); await p.waitForTimeout(1500);
await p.getByRole("button",{name:"62 kg"}).click(); await p.getByRole("button",{name:"10%"}).click(); await p.waitForTimeout(800);
await p.screenshot({path:`/workspace/out/figure-${MODE}-detail.png`});
t=await p.locator("body").innerText();
ok("detail: no 3D canvas", (await p.locator('canvas[aria-label="体型3D"]').count())===0);
ok("detail: 体型模拟尚未启用 + numbers + selector", t.includes("体型模拟尚未启用") && t.includes("62 kg") && t.includes("目标体脂率"));
ok("detail: character art both sides", (await p.locator('img[src*="figure-male.webp"]').count())>=2);
ok("no page errors", errs.length===0, errs.join("|"));
await b.close();
