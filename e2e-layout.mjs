import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const R=[];
for (const [name,vp,sa] of [["safari-portrait",{width:390,height:844},false],["standalone-portrait",{width:390,height:844},true],["landscape",{width:844,height:390},true]]) {
 const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
 await p.goto("https://molen-fangkun.pages.dev/", { waitUntil: "networkidle" });
 for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
 for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
 if (sa) await p.addStyleTag({content:":root{--sat:47px} .product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important}"});
 for (const tab of ["饮食","健康","日志"]) { await p.getByLabel("切换到"+tab).click({force:true}); await p.waitForTimeout(1800);
  await p.evaluate(()=>window.scrollTo(0,1e6)); await p.waitForTimeout(500);
  const r = await p.evaluate(()=>{const nav=document.querySelector(".ui03-dock").getBoundingClientRect(); const cards=[...document.querySelectorAll(".fk-dash-card,section,.home-card")].filter(e=>e.offsetParent&&!e.closest("details:not([open]) > :not(summary)")&&!e.closest("[role=dialog],.ui03-dock")).filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.top<innerHeight;}); const last=cards.map(c=>c.getBoundingClientRect()).sort((a,b)=>b.bottom-a.bottom)[0]; const fab=document.querySelector(".fk-fab")?.getBoundingClientRect(); return {lastBottom:last?.bottom, navTop:nav.top, fabBottom:fab?.bottom}});
  R.push(`${r.lastBottom<=r.navTop-8?"PASS":"FAIL"} ${name} ${tab}: last card bottom ${Math.round(r.lastBottom)} ≤ nav top ${Math.round(r.navTop)}${r.fabBottom?` · FAB bottom ${Math.round(r.fabBottom)}`:""}`);
  await p.screenshot({path:`/workspace/out/layout-${name}-${tab}-bottom.png`}); }
 await p.getByLabel("切换到健康").click({force:true}); await p.waitForTimeout(800); await p.evaluate(()=>window.scrollTo(0,0)); await p.screenshot({path:`/workspace/out/layout-${name}-top.png`});
 if (name==="safari-portrait") { await p.getByLabel("切换到饮食").click({force:true}); await p.waitForTimeout(1000); await p.getByText("午餐").first().click({force:true}); await p.waitForTimeout(600);
  const fabHidden = await p.evaluate(()=>{const f=document.querySelector(".fk-fab"); return !f||getComputedStyle(f).display==="none"}); R.push(`${fabHidden?"PASS":"FAIL"} no floating FAB (sheet open)`); await p.screenshot({path:`/workspace/out/layout-sheet-open.png`});
  await p.keyboard.press("Escape"); await p.mouse.click(10,10); await p.waitForTimeout(400);
  const inp=p.locator('input[type="text"],input:not([type]),input[inputmode],textarea').first(); if(await inp.count()){ await inp.focus(); await p.waitForTimeout(300); const kb=await p.evaluate(()=>{const f=document.querySelector(".fk-fab"); return !f||getComputedStyle(f).display==="none"}); R.push(`${kb?"PASS":"FAIL"} FAB hidden while keyboard/input focused`); await p.screenshot({path:`/workspace/out/layout-keyboard.png`}); } }
 await p.close(); }
{const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); await p.goto('https://molen-fangkun.pages.dev/',{waitUntil:'networkidle'}); for(let i=0;i<8;i++){const k=p.getByText('跳过，用默认'); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);} for(let i=0;i<6;i++){const k=p.getByRole('button',{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);} await p.keyboard.press('Escape'); const fab=await p.locator('.fk-fab').count(); R.push(`${fab===0?'PASS':'FAIL'} no .fk-fab on 今日`); const q=p.getByRole('button',{name:'记一笔'}); await q.first().click({force:true}); await p.waitForTimeout(500); const dl=await p.getByRole('dialog',{name:'记一笔'}).count(); R.push(`${dl?'PASS':'FAIL'} header 记一笔 opens quick-log sheet`); await p.screenshot({path:'/workspace/out/layout-quicklog.png'}); await p.close();}
const m = await (await fetch("https://molen-fangkun.pages.dev/manifest.webmanifest")).json().catch(()=>null);
R.push(`${m&&m.display==="standalone"&&m.start_url==="/"&&m.scope==="/"?"PASS":"FAIL"} manifest standalone/start_url/scope`);
console.log(R.join("\n")); await b.close();
