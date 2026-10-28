import { chromium } from '/workspace/fangkun-muscle/node_modules/playwright/index.mjs';
export async function launch(){ return chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}); }
export async function openSheet(b,{w=390,h=844,dpr=2,theme=null,base='http://localhost:8940',blockGlb=false,webglOff=false}={}){
  const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:dpr,hasTouch:true,isMobile:true,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
  if(theme) await c.addInitScript(t=>{try{localStorage.setItem('__t',t)}catch{}},theme);
  if(blockGlb) await c.route('**/ecorche.meshopt.glb',r=>r.abort());
  if(webglOff) await c.addInitScript(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...a){return /webgl/.test(t)?null:g.call(this,t,...a)}});
  await c.route('**/api/**',r=>r.fulfill({status:503,json:{error:'offline'}}));
  const p=await c.newPage(); p.errs=[]; p.on('pageerror',e=>p.errs.push(String(e)));
  await p.goto(base+'/'); await p.waitForTimeout(2500);
  for(let i=0;i<10;i++){const k=p.getByRole('button',{name:/^逐个调整$|^暂不需要$|^知道了$|跳过/}).first(); if(!(await k.isVisible().catch(()=>false)))break; await k.click({force:true}).catch(()=>{}); await p.waitForTimeout(700);}
  return {c,p};
}
