import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const R=[];
const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(1000);
await p.getByRole("button",{name:"自己加一节"}).click(); await p.waitForTimeout(800);
const strength = p.getByRole("button",{name:/^力量$/}).first(); if(await strength.count()) await strength.click().catch(()=>{});
await p.getByPlaceholder("搜索动作").fill("深蹲"); await p.waitForTimeout(300);
await p.getByRole("button",{name:"＋杠铃深蹲"}).click(); await p.waitForTimeout(300);
R.push(`PASS 打开动作库 (今日→自己加一节→搜索动作)`);
for (const round of [1,2]) {
  await p.getByRole("button",{name:"看演示"}).first().click(); await p.waitForTimeout(4000);
  const dlg=p.getByRole("dialog",{name:"动作详情"});
  const play=dlg.getByRole("button",{name:"播放"}); const canPlay=await play.count(); if(canPlay) await play.click(); await p.waitForTimeout(1500);
  const paused=await dlg.getByRole("button",{name:"暂停"}).count();
  await p.screenshot({path:`/workspace/out/library-r${round}-play.png`});
  const bad=errs.filter(e=>/MIME|dynamically imported|went wrong/i.test(e));
  R.push(`${(await dlg.count())&&!bad.length?"PASS":"FAIL"} round ${round} 选择动作→打开演示 ${bad.join("|")}`);
  R.push(`${paused?"PASS":"FAIL"} round ${round} 播放 (button switched to 暂停)`);
  await dlg.getByRole("button",{name:/关闭|返回|×/}).first().click(); await p.waitForTimeout(600);
  R.push(`${(await dlg.count())===0?"PASS":"FAIL"} round ${round} 退出`);
}
console.log(R.join("\n")); console.log("errors:",errs.slice(0,4).join(" || ")); await b.close();
