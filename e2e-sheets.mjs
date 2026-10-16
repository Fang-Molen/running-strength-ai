import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome"}); const R=[];
for (const mode of ["safari","standalone"]) {
const ok=(n,c,x="")=>{const l=`${c?"PASS":"FAIL"} [${mode}] ${n}${x?" — "+x:""}`; R.push(l); console.log(l);};
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2, timezoneId:"Asia/Shanghai" });
const p = await ctx.newPage(); const sh=f=>p.screenshot({path:`/workspace/out/sheets-${mode}-${f}.png`});
const tap=async l=>{await l.evaluate(e=>e.scrollIntoView({block:"center"})); await l.click({force:true});};
await p.goto("https://molen-fangkun.pages.dev/",{waitUntil:"networkidle"});
for(let i=0;i<8;i++){const k=p.getByText("跳过，用默认"); if(!(await k.count()))break; await k.click(); await p.waitForTimeout(400);}
for(let i=0;i<6;i++){const k=p.getByRole("button",{name:/^接受$|暂不需要|知道了|跳过，从头开始/}).first(); if(!(await k.count()))break; await k.click().catch(()=>{}); await p.waitForTimeout(300);}
if (mode==="standalone") await p.addStyleTag({content:".product-ui .ui03-header{padding-top:51px!important} .product-ui .ui03-dock{padding-bottom:34px!important} .fk-sheet footer{padding-bottom:34px!important}"});
await p.evaluate(()=>localStorage.setItem("fk-probe","keep"));
// ---- 记一笔
await p.getByLabel("切换到今日").click({force:true}); await p.waitForTimeout(800);
await p.evaluate(()=>window.scrollTo(0,300)); const y0=await p.evaluate(()=>scrollY);
await p.getByRole("button",{name:"记一笔"}).first().click({force:true}); await p.waitForTimeout(500);
const dlg=p.getByRole("dialog",{name:"记一笔"});
ok("placeholder", await dlg.getByPlaceholder("记录训练、体重或身体感受……").count()===1);
const long="今天腿有点沉，热身后好一些。"+"感觉还可以，".repeat(40)+"\n体重 56.2";
await dlg.getByLabel("记录内容").fill(long);
await dlg.locator('input[type=file]').setInputFiles("/workspace/out/test-shot.png"); await p.waitForTimeout(2500);
ok("attachment preview", await dlg.getByRole("button",{name:/移除/}).count()===1);
const t=await dlg.innerText(); ok("parsed weight shown for confirm, original kept", t.includes("识别为体重") && t.includes("56.2"));
const btn=dlg.getByRole("button",{name:"保存记录"}); const bb=await btn.boundingBox(); ok("save button visible within viewport", bb && bb.y+bb.height<=844, JSON.stringify(bb&&Math.round(bb.y)));
await sh("1-quicklog-long");
// close keeps draft
await tap(dlg.getByRole("button",{name:"取消"})); await p.waitForTimeout(300);
ok("page scroll restored on close", Math.abs((await p.evaluate(()=>scrollY))-y0)<5, `${y0}`);
await tap(p.getByRole("button",{name:"记一笔"}).first()); await p.waitForTimeout(400);
ok("reopen continues draft", (await dlg.getByLabel("记录内容").inputValue()).includes("腿有点沉") && await dlg.getByRole("button",{name:/移除/}).count()===1);
// simulated failure
await p.evaluate(()=>{const o=Storage.prototype.setItem; window.__o=o; Storage.prototype.setItem=function(k,v){ if(k==="fk-notes-v1"||k==="fr255-body-v1") throw new Error("quota"); return o.call(this,k,v);} });
await tap(dlg.getByRole("button",{name:"保存记录"})); await p.waitForTimeout(400);
ok("failure shows reason + keeps input", (await dlg.innerText()).includes("保存失败") && (await dlg.getByLabel("记录内容").inputValue()).length>100);
await sh("2-quicklog-fail");
await p.evaluate(()=>{Storage.prototype.setItem=window.__o});
// unparseable note + double tap
await dlg.getByLabel("记录内容").fill("只是随便记一下：今天心情不错");
const before=await p.evaluate(()=>JSON.parse(localStorage.getItem("fk-notes-v1")||"[]").length);
await dlg.getByRole("button",{name:"保存记录"}).evaluate(e=>{e.click();e.click();});
await p.waitForTimeout(500);
const after=await p.evaluate(()=>JSON.parse(localStorage.getItem("fk-notes-v1")||"[]").length);
ok("unparseable saved as note; double tap = 1 record", after-before===1, `${before}->${after}`);
await sh("3-quicklog-saved");
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(1000);
await tap(p.getByRole("button",{name:"记一笔"}).first()); await p.waitForTimeout(400);
ok("reload persistence (note listed)", (await dlg.innerText()).includes("今天心情不错"));
await tap(dlg.getByRole("button",{name:"删除已保存记录"}).first()); await p.waitForTimeout(300);
ok("删除已保存记录 separate from 取消", (await p.evaluate(()=>JSON.parse(localStorage.getItem("fk-notes-v1")||"[]").length))===after-1);
await tap(dlg.getByRole("button",{name:"关闭"}));
// ---- 登记饮食
await p.getByLabel("切换到饮食").click({force:true}); await p.waitForTimeout(1200);
await tap(p.getByRole("button",{name:/记录饮食/}).first()); await p.waitForTimeout(800);
const fd=p.getByRole("dialog",{name:"登记饮食"});
await tap(fd.getByRole("button",{name:"午餐",exact:true}));
await fd.getByLabel("吃了什么").fill("鸡腿堡"); await p.waitForTimeout(1500);
const rt=await fd.getByLabel("搜索结果").innerText().catch(()=> ""); ok("results show brand/spec/status", /品牌|通用/.test(rt) && /待|已核/.test(rt), rt.split("\n").slice(0,4).join(" / "));
await sh("4-food-search");
// unknown food with per100g
await fd.getByLabel("吃了什么").fill("自制牛肉饼XYZ"); await p.waitForTimeout(500); {const f=fd.getByRole("button",{name:/都不是/}); if(await f.count()) await tap(f);}
await fd.getByLabel("份量").fill("150"); await tap(fd.getByRole("button",{name:"每100g"}));
await fd.getByLabel("热量kcal（每100g）").fill("200"); await fd.getByLabel("蛋白g（每100g）").fill("20");
ok("per-100g converts once (300 kcal for 150g)", (await fd.innerText()).includes("300 kcal"));
await sh("5-food-manual");
const kb0=await p.evaluate(()=>JSON.parse(localStorage.getItem("fr255-food-log-v1")||"[]").length);
await fd.getByRole("button",{name:"保存到午餐"}).evaluate(e=>{e.click();e.click();}); await p.waitForTimeout(600);
let fl=await p.evaluate(()=>JSON.parse(localStorage.getItem("fr255-food-log-v1")||"[]"));
ok("double tap saves once; kcal 300 protein 30", fl.length-kb0===1 && fl.at(-1).kcal===300 && fl.at(-1).protein===30, `${fl.length-kb0} ${fl.at(-1)?.kcal}`);
// unknown nutrition (blank) + second food
await fd.getByLabel("吃了什么").fill("神秘饭团ABC"); await p.waitForTimeout(400); {const f=fd.getByRole("button",{name:/都不是/}); if(await f.count()) await tap(f);} await fd.getByLabel("份量").fill("1"); await tap(fd.getByRole("button",{name:"份",exact:true}));
await p.waitForTimeout(700); await tap(fd.getByRole("button",{name:"保存到午餐"})); await p.waitForTimeout(500);
fl=await p.evaluate(()=>JSON.parse(localStorage.getItem("fr255-food-log-v1")||"[]"));
ok("multiple foods; blank nutrition = 营养待补充", fl.length-kb0===2 && fl.at(-1).label==="营养待补充");
// db food change portion
await fd.getByLabel("吃了什么").fill("米饭"); await p.waitForTimeout(800); await tap(fd.getByLabel("搜索结果").getByRole("button").first());
await fd.getByLabel("份量").fill("200"); const t200=await fd.innerText(); await fd.getByLabel("份量").fill("100"); const t100=await fd.innerText();
ok("db food portion change updates macros", t200!==t100);
// failure
await p.evaluate(()=>{const o=Storage.prototype.setItem; window.__o=o; Storage.prototype.setItem=function(k,v){ if(k==="fr255-food-log-v1") throw new Error("quota"); return o.call(this,k,v);} });
await tap(fd.getByRole("button",{name:"保存到午餐"})); await p.waitForTimeout(400);
ok("food save failure shows reason + keeps input", (await fd.innerText()).includes("保存失败") && (await fd.getByLabel("份量").inputValue())==="100");
await p.evaluate(()=>{Storage.prototype.setItem=window.__o});
await sh("6-food-fail");
await tap(fd.getByRole("button",{name:"关闭"})); await p.waitForTimeout(300);
await tap(p.getByRole("button",{name:/记录饮食/}).first()); await p.waitForTimeout(500);
ok("food draft kept after close", (await fd.getByLabel("份量").inputValue())==="100");
await tap(fd.getByRole("button",{name:"关闭"}));
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(1000); await p.getByLabel("切换到饮食").click({force:true}); await p.waitForTimeout(1200);
const body=await p.locator("body").innerText(); ok("day totals reflect saved food after reload", body.includes("项待补充") );
ok("other data preserved", await p.evaluate(()=>localStorage.getItem("fk-probe"))==="keep");
await sh("7-diet-after"); await ctx.close();
}
await b.close();
