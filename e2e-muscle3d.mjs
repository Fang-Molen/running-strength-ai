import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]}); const R=[]; const ok=(n,c,x="")=>{const l=`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`;R.push(l);console.log(l)};
const MODE=process.env.MODE||'safari'; const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
if(MODE==='standalone') await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important} .fk-sheet{padding-bottom:34px!important}"});
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(800);
await tap(p.getByRole("button",{name:"自己加一节"})); await tap(p.getByRole("button",{name:/^力量$/}).first());
await tap(p.getByRole("button",{name:/人体肌群 3D/}).first());
const d=p.getByRole("dialog",{name:"人体肌群3D"}); ok("explorer opens", await d.count()>0);
const cv=d.locator('canvas[aria-label="人体肌群3D"]');
await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk,null,{timeout:40000}).catch(()=>{});
const st=()=>cv.evaluate(e=>e.__fk?.state); ok("3D ready", !!(await st()), errs.join("|"));
ok("region-painted label honest", (await d.innerText()).includes("不是独立肌肉建模"));
await p.waitForTimeout(1500);
for (const [v,l] of [["front","正面"],["left","左侧"],["right","右侧"],["back","背面"]]) { await tap(d.getByRole("button",{name:l,exact:true})); await p.waitForTimeout(900); await cv.screenshot({path:`/workspace/out/m3d-${MODE}-${v}.png`}); }
await tap(d.getByRole("button",{name:"正面",exact:true})); await p.waitForTimeout(600);
const bb=await cv.boundingBox();
for (const [nm,dx,dy] of [["left",-600,0],["right",900,0],["up",0,-500],["down",0,600]]) { await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+bb.width/2+dx,bb.y+bb.height/2+dy,{steps:14}); await p.mouse.up(); await p.waitForTimeout(900);
  const s=await st(); ok(`clamp after drag ${nm}`, Math.abs(s.azimuth)<=30.5 && s.polar>=61.5 && s.polar<=90.5, JSON.stringify(s)); await cv.screenshot({path:`/workspace/out/m3d-${MODE}-drag-${nm}.png`}); }
await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); for(let i=0;i<20;i++){ await p.mouse.wheel(0,-400); } await p.waitForTimeout(800); const z1=await st();
for(let i=0;i<30;i++){ await p.mouse.wheel(0,600); } await p.waitForTimeout(800); const z2=await st();
ok("zoom limits", z1.dist>=4.1*0.5-0.02 && z2.dist<=4.1*1.25+0.02, `${z1.dist.toFixed(2)}..${z2.dist.toFixed(2)}`);
await tap(d.getByRole("button",{name:"重置"})); await p.waitForTimeout(800);
await cv.click({position:{x:bb.width/2,y:bb.height*0.40}}); await p.waitForTimeout(500);
const info=d.getByRole("region",{name:"肌群信息"}).or(d.locator('[aria-label="肌群信息"]')); const it=await info.innerText();
ok("tap shows muscle name+function+linked", /功能：/.test(it) && /相关动作/.test(it), it.slice(0,80));
await tap(d.getByRole("group",{name:"聚焦"}).getByRole("button",{name:"小腿"})); await p.waitForTimeout(900); await cv.screenshot({path:`/workspace/out/m3d-${MODE}-focus-calf.png`});
await tap(d.getByRole("group",{name:"聚焦"}).getByRole("button",{name:"足部"})); await p.waitForTimeout(900); await cv.screenshot({path:`/workspace/out/m3d-${MODE}-focus-foot.png`}); ok("foot focus", (await st()).focus==="foot");
for (const c of ["足部与足弓","踝关节","小腿"]) { await tap(d.getByRole("group",{name:"动作分类"}).getByRole("button",{name:c})); await p.waitForTimeout(300); }
const all=["双脚提踵","单脚提踵","弹力带踝背屈与跖屈","毛巾抓握","脚趾抓取","短足练习（short foot）","踝内翻/外翻（弹力带）","单脚平衡"]; let found=0;
for (const c of ["足部与足弓","踝关节","小腿"]) { await tap(d.getByRole("group",{name:"动作分类"}).getByRole("button",{name:c})); await p.waitForTimeout(300); const t=await d.innerText(); found+=all.filter(n=>t.includes(n)).length; }
ok("8 foot/ankle/calf exercises listed", found>=8, String(found));
await tap(d.getByRole("button",{name:/单脚提踵/})); await p.waitForTimeout(400); const ct=await d.innerText();
ok("exercise detail sections", ["技术要点","常见错误","难度与进阶","组间休息","来源"].every(k=>ct.includes(k)));
const sets=d.getByLabel("组数").first(); await sets.fill("4"); await tap(d.getByRole("button",{name:"保存剂量"}).first()); const stored=await p.evaluate(()=>localStorage.getItem("fk-foot-dose-v1")); ok("dose saved separately", /"sets":4/.test(stored||""), stored);
await d.screenshot({path:`/workspace/out/m3d-${MODE}-library.png`}).catch(()=>{});
ok("no page errors", errs.length===0, errs.slice(0,2).join("|"));
await b.close();
