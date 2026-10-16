import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const R=[];
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const p = await ctx.newPage(); const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
const old = await (await fetch("https://a7625928.molen-fangkun.pages.dev/")).text();
const oldSw = await (await fetch("https://a7625928.molen-fangkun.pages.dev/sw.js")).text();
// 1. install OLD shell + OLD worker (v44) on the production origin, seed user data
await p.route("https://molen-fangkun.pages.dev/", r=>r.fulfill({status:200,contentType:"text/html",body:old}));
await p.route("https://molen-fangkun.pages.dev/sw.js", r=>r.fulfill({status:200,contentType:"application/javascript",body:oldSw}));
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"}); await p.waitForTimeout(2500);
await p.evaluate(()=>localStorage.setItem("fk-upgrade-probe","keep-me"));
const oldCache = await p.evaluate(async()=>(await caches.keys()).join(","));
R.push(`INFO old worker caches: ${oldCache}`);
const oldChunk = await p.evaluate(async()=>{try{await import("/assets/exercise-demo-B53_2-CQ.js");return "ok"}catch(e){return e.message}});
R.push(`${oldChunk==="ok"?"PASS":"FAIL"} old shell loads old chunk exercise-demo-B53_2-CQ.js (${oldChunk})`);
const missing = await p.evaluate(async()=>{const r=await fetch("/assets/exercise-demo-DOESNOTEXIST.js");return r.status+" "+r.headers.get("content-type")});
R.push(`${missing.startsWith("404")?"PASS":"FAIL"} missing chunk via SW → ${missing}`);
// 2. upgrade
await p.unroute("https://molen-fangkun.pages.dev/"); await p.unroute("https://molen-fangkun.pages.dev/sw.js");
await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); await r?.update();}); await p.waitForTimeout(3000);
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(2000);
const newCache = await p.evaluate(async()=>(await caches.keys()).join(","));
R.push(`${newCache.includes("v48")?"PASS":"FAIL"} upgraded caches: ${newCache}`);
R.push(`${await p.evaluate(()=>localStorage.getItem("fk-upgrade-probe"))==="keep-me"?"PASS":"FAIL"} user data preserved across upgrade`);
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
// 3. 动作库 flow twice: open demo → play → exit
for (const round of [1,2]) {
  await p.getByLabel("切换到计划").click({force:true}); await p.waitForTimeout(1500);
  let demo = p.getByRole("button",{name:"看演示"}).first();
  if(!(await demo.count())){ const ed=p.getByRole("button",{name:/编辑/}).first(); if(await ed.count()){await ed.click(); await p.waitForTimeout(800);} demo=p.getByRole("button",{name:"看演示"}).first(); }
  if(!(await demo.count())){ R.push(`FAIL round ${round}: no 演示 button found`); await p.screenshot({path:`/workspace/out/upgrade-r${round}-nodemo.png`,fullPage:true}); break; }
  await demo.click(); await p.waitForTimeout(3500);
  const dlg = p.getByRole("dialog",{name:"动作详情"}); const opened = await dlg.count();
  const play = p.getByRole("button",{name:/播放|play/i}).first(); if(await play.count()) await play.click().catch(()=>{}); await p.waitForTimeout(1500);
  await p.screenshot({path:`/workspace/out/upgrade-r${round}-demo.png`});
  const bad = errs.filter(e=>/MIME|dynamically imported|Something went wrong/i.test(e));
  R.push(`${opened&&!bad.length?"PASS":"FAIL"} round ${round}: 打开动作库→选择动作→播放 ${bad.join(" | ")}`);
  const close = dlg.getByRole("button",{name:/关闭|返回/}).first(); if(await close.count()) await close.click(); else await p.keyboard.press("Escape"); await p.waitForTimeout(800);
  R.push(`${(await dlg.count())===0?"PASS":"FAIL"} round ${round}: 退出`);
  if(round===1){ const ed=p.getByRole("button",{name:/取消|完成|保存/}).first(); }
}
console.log(R.join("\n")); console.log("errors:",errs.slice(0,5).join(" || ")); await b.close();
