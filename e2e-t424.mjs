import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]}); const R=[]; const ok=(n,c,x="")=>{const l=`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`;R.push(l);console.log(l)};
const MODE=process.env.MODE||'safari'; const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
if(MODE==='standalone') await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important} [aria-label='动作详情']{padding-top:51px!important;padding-bottom:66px!important}"});
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(800);
await tap(p.getByRole("button",{name:"自己加一节"})); await tap(p.getByRole("button",{name:/^力量$/}).first());
const names=["行走弓步"]; const maps={};
for (const n of names){ await p.getByPlaceholder("搜索动作").fill(n); await tap(p.getByRole("button",{name:"＋"+n,exact:true})); }
const demos=p.getByRole("button",{name:"看演示"});
for (let i=0;i<names.length;i++){
  await tap(demos.nth(i)); await p.waitForTimeout(1500);
  const d=p.getByRole("dialog",{name:"动作详情"});
  const t=await d.innerText();
  ok(`${names[i]}: single layout (no 练到哪里 duplicate)`, !t.includes("练到哪里") && (t.match(/目标肌群/g)||[]).length===1);
  ok(`${names[i]}: no English muscle names`, !/[a-z]{3,} ?(front|rear|side|med)|\bfeet\b/i.test(t.split("目标肌群")[1]||""));
  maps[names[i]] = await d.locator('[aria-label="目标肌群"] polygon[fill="#ff5a3c"]').count() + "/" + (await d.locator('[aria-label="目标肌群"] polygon[fill="#ffb199"]').count());
  await d.screenshot({path:`/workspace/out/detail-${MODE}-${i}-top.png`}).catch(()=>{});
  await d.locator('[aria-label="目标肌群"]').evaluate(e=>e.scrollIntoView({block:"start"})); await p.waitForTimeout(300); await p.screenshot({path:`/workspace/out/detail-${MODE}-${i}-muscle.png`});
  const back=d.locator('[aria-label="目标肌群"]').getByRole("button",{name:"背面",exact:true}); await tap(back); await p.waitForTimeout(200); await p.screenshot({path:`/workspace/out/detail-${MODE}-${i}-muscle-back.png`});
  const play=d.getByRole("button",{name:/播放动画演示/}); if(await play.count()){ await tap(play); await p.waitForTimeout(5000); }
  const pb=d.getByRole("button",{name:/^(播放|暂停)$/}); ok(`${names[i]}: play/pause control inside layout`, await pb.count()>0);
  if(await pb.count()){ await pb.first().evaluate(e=>e.scrollIntoView({block:"center"})); await p.waitForTimeout(2500); await p.screenshot({path:`/workspace/out/detail-${MODE}-${i}-demo.png`}); }
  if(names[i]==="坐姿提踵"){ const t2=await d.innerText(); ok("坐姿提踵 primary 比目鱼肌, source shown", /主要：比目鱼肌/.test(t2) && t2.includes("ExRx")); }
  if(names[i]==="双杠臂屈伸"){ const t2=await d.innerText(); ok("双杠臂屈伸 primary 肱三头肌, secondary 胸大肌/三角肌前束, source", /主要：肱三头肌/.test(t2) && /辅助：胸大肌、三角肌前束/.test(t2) && t2.includes("ExRx")); }
  ok("walk-lunge: lunge image shown", (await d.locator("img[src*=lunge-male]").count())>0); const fb=d.getByRole("button",{name:"女",exact:true}); if(await fb.count()){ await tap(fb); await p.waitForTimeout(400); ok("walk-lunge: female image", (await d.locator("img[src*=lunge-female]").count())>0); } ok("plank: animation fallback present", (await d.locator("canvas").count()+await d.getByRole("button",{name:/播放/}).count())>0); await d.screenshot({path:"/workspace/out/walklunge-"+MODE+".png"}).catch(()=>{});
  const cv=d.locator('canvas[aria-label="3D动作演示"]');
  if(await cv.count() && await cv.isVisible()){ await cv.evaluate(e=>e.scrollIntoView({block:"center"})); const bb=await cv.boundingBox();
    for (const [nm,dx,dy] of [["left",-400,0],["right",800,0],["up",0,-400],["down",0,600]]){ await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+bb.width/2+dx,bb.y+bb.height/2+dy,{steps:12}); await p.mouse.up(); await p.waitForTimeout(800); await cv.screenshot({path:`/workspace/out/detail-${MODE}-${i}-drag-${nm}.png`}); }
    const rs=d.getByRole("button",{name:"恢复默认视角"}); ok(`${names[i]}: reset view button`, await rs.count()>0); if(await rs.count()) await tap(rs); }
  await tap(d.getByRole("button",{name:"关闭"})); await p.waitForTimeout(500);
}
ok("muscle highlight differs per exercise (front counts)", new Set(Object.values(maps)).size>=3, JSON.stringify(maps));
ok("no page errors", errs.length===0, errs.slice(0,2).join("|"));
await b.close();
