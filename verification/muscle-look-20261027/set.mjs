import { chromium } from '/workspace/fangkun-muscle/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const [port, outDir, look, theme='dark', tint='#ff8b45'] = process.argv.slice(2);
fs.mkdirSync(outDir,{recursive:true});
const b = await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:350,height:320},deviceScaleFactor:2});
await p.goto(`http://localhost:${port}/h.html?theme=${theme}&look=${look}&tint=${encodeURIComponent(tint)}&w=350&h=320`);
await p.waitForFunction(()=>window.__ready,null,{timeout:60000});
const shot=async n=>{await p.waitForTimeout(900);await p.locator('#cv').screenshot({path:`${outDir}/${theme}-${n}.png`})};
const st=async(view,focus,sel)=>{await p.evaluate(([v,f,s])=>{__api.reset();__api.setFocus(f);__api.setView(v);if(s)__api.selectKey(s)},[view,focus,sel||null])};
for(const v of ['front','left','right','back']){await st(v,'body');await shot(`view-${v}`)}
await st('front','calf');await shot('calf-front'); await st('back','calf');await shot('calf-back'); await st('front','foot');await shot('foot-front'); await st('back','foot');await shot('foot-back');
await st('back','body','glutes');await shot('sel-glutes'); await st('back','body','glute_med');await shot('sel-hip-glute_med'); await st('front','body','iliopsoas');await shot('sel-hip-iliopsoas'); await st('front','body','delt_side');await shot('sel-shoulder'); await st('back','calf','gastroc_med');await shot('sel-gastrocnemius'); await st('front','foot','foot_intrinsic');await shot('sel-foot-sole');
await b.close();
