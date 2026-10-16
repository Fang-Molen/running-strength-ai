import { chromium } from "playwright";
const b = await chromium.launch({executablePath:"/usr/bin/google-chrome", args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
await p.goto("https://molen-fangkun.pages.dev/demo3d/LICENSES.md");
const shots = JSON.parse(process.env.SHOTS||'[["left","foot"]]'); const mod = process.env.MOD||'muscle';
await p.evaluate(()=>{ document.documentElement.innerHTML='<body style="margin:0;background:#000"><canvas id=c style="width:390px;height:420px;display:block"></canvas></body>'; });
const r = await p.evaluate(async(mod)=>{ try{ const M=await import('/demo3d/body3d.js?'+Date.now()); const c=document.getElementById('c');
  window.a = mod==='muscle' ? await M.createMuscleExplorer(c,{}) : await M.createFigureViewer(c,{count:2}); return 'ok'; }catch(e){ return 'ERR '+e.message+e.stack; } }, mod);
console.log(r);
for (const [i,s] of shots.entries()) { await p.evaluate(s=>{ const a=window.a; if(s[0]) a.setView(s[0]); if(s[1]&&a.setFocus) a.setFocus(s[1]); if(s[2]) a.setPose(s[2]); if(s[3]) { a.setShape(1,s[3]); } }, s); await p.waitForTimeout(1500); await p.screenshot({path:`/tmp/chk-${i}.png`, clip:{x:0,y:0,width:390,height:420}}); }
await b.close();
