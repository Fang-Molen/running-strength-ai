import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]}); const R=[]; const ok=(n,c,x="")=>{const l=`${c?"PASS":"FAIL"} ${n}${x?" — "+x:""}`;R.push(l);console.log(l)};
const p = await b.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(800);
await tap(p.getByRole("button",{name:"自己加一节"})); await tap(p.getByRole("button",{name:/^力量$/}).first());
const names=["杠铃深蹲","高位下拉","站姿提踵","哑铃弯举"]; const maps={};
for (const n of names){ await p.getByPlaceholder("搜索动作").fill(n); await tap(p.getByRole("button",{name:"＋"+n,exact:true})); }
const demos=p.getByRole("button",{name:"看演示"});
for (let i=0;i<names.length;i++){
  await tap(demos.nth(i)); await p.waitForTimeout(1500);
  const d=p.getByRole("dialog",{name:"动作详情"});
  const t=await d.innerText();
  ok(`${names[i]}: single layout (no 练到哪里 duplicate)`, !t.includes("练到哪里") && (t.match(/目标肌群/g)||[]).length===1);
  ok(`${names[i]}: no English muscle names`, !/[a-z]{3,} ?(front|rear|side|med)|\bfeet\b/i.test(t.split("目标肌群")[1]||""));
  maps[names[i]] = await d.locator('[aria-label="目标肌群"] polygon[fill="#ff5a3c"]').count() + "/" + (await d.locator('[aria-label="目标肌群"] polygon[fill="#ffb199"]').count());
  await d.screenshot({path:`/workspace/out/detail-${i}-top.png`}).catch(()=>{});
  await d.locator('[aria-label="目标肌群"]').evaluate(e=>e.scrollIntoView({block:"start"})); await p.waitForTimeout(300); await p.screenshot({path:`/workspace/out/detail-${i}-muscle.png`});
  const back=d.locator('[aria-label="目标肌群"]').getByRole("button",{name:"背面",exact:true}); await tap(back); await p.waitForTimeout(200); await p.screenshot({path:`/workspace/out/detail-${i}-muscle-back.png`});
  const play=d.getByRole("button",{name:/播放动画演示/}); if(await play.count()){ await tap(play); await p.waitForTimeout(5000); }
  const pb=d.getByRole("button",{name:/^(播放|暂停)$/}); ok(`${names[i]}: play/pause control inside layout`, await pb.count()>0);
  if(await pb.count()){ await pb.first().evaluate(e=>e.scrollIntoView({block:"center"})); await p.waitForTimeout(2500); await p.screenshot({path:`/workspace/out/detail-${i}-demo.png`}); }
  await tap(d.getByRole("button",{name:"关闭"})); await p.waitForTimeout(500);
}
ok("muscle highlight differs per exercise (front counts)", new Set(Object.values(maps)).size>=3, JSON.stringify(maps));
ok("no page errors", errs.length===0, errs.slice(0,2).join("|"));
await b.close();
