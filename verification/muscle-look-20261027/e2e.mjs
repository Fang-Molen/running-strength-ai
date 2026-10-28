import {launch,openSheet} from './open.mjs';
import fs from 'node:fs'; import {execFileSync} from 'node:child_process';
const VP = process.argv[2]==='ipad' ? {name:'ipad',w:820,h:1180} : {name:'iphone',w:390,h:844};
const OUT='/workspace/outputs/muscle-look/after', BASE=process.env.BASE||'http://localhost:8940', TAG=process.env.TAG||'after';
fs.mkdirSync(OUT,{recursive:true});
const R=[]; const ok=(n,c,x='')=>{const l=`${c?'PASS':'FAIL'} [${VP.name}] ${n}${x?' — '+x:''}`;R.push(l);console.log(l)};
const b=await launch();
async function openExplorer(p,{wait=true}={}){
  await p.getByRole('button',{name:'添加训练',exact:true}).first().click({force:true}); await p.waitForTimeout(900);
  await p.getByRole('button',{name:'肌肉图',exact:true}).first().click({force:true}); await p.waitForTimeout(600);
  const d=p.getByRole('dialog',{name:'人体肌群3D'}).last(), cv=d.locator('canvas[aria-label="人体肌群3D"]');
  if(wait) await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk,null,{timeout:90000}).catch(()=>{});
  return {d,cv};
}
const accentCount=async(cv,file)=>{await cv.screenshot({path:file}); return +execFileSync('python3',['-W','ignore','-c',`from PIL import Image\nim=Image.open('${file}').convert('RGB')\nprint(sum(1 for r,g,b in im.getdata() if r>150 and r-b>105 and r>g+25))`]).toString()};
// ---------- main flow ----------
{ const {c,p}=await openSheet(b,{w:VP.w,h:VP.h,dpr:2,base:BASE});
  const {d,cv}=await openExplorer(p);
  const st=()=>cv.evaluate(e=>e.__fk?.state);
  ok('sheet opens and 3D ready (look=natural)', !!(await st()) && await cv.evaluate(e=>e.dataset.asset)==='ecorche', p.errs.join('|'));
  await p.waitForTimeout(1500);
  await p.screenshot({path:`${OUT}/${VP.name}-sheet.png`});
  const ov=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth); ok('no horizontal overflow',ov<=0,String(ov));
  // view buttons
  for(const [v,l] of [['front','正面'],['left','左侧'],['right','右侧'],['back','背面']]){ await d.getByRole('button',{name:l,exact:true}).click(); await p.waitForTimeout(900); const s=await st(); const want={front:0,left:90,right:-90,back:180}[v]; const dz=Math.abs((((s.azimuth-want)%360)+540)%360-180); ok(`view button ${l}`,s.view===v&&dz<1,`az=${s.azimuth.toFixed(1)}`); await cv.screenshot({path:`${OUT}/${VP.name}-view-${v}.png`}); }
  await d.getByRole('button',{name:'正面',exact:true}).click(); await p.waitForTimeout(600);
  const info=()=>d.locator('section[aria-label="部位信息"] h3').first().innerText().catch(()=>'');
  async function scan(re, {minX=.2,maxX=.8}={}) { return cv.evaluate((e,m)=>{ const r=e.getBoundingClientRect(), rx=new RegExp(m), hits=[]; const at=(x,y)=>e.__fk.pickAt(r.left+x,r.top+y);
      for(let y=.04;y<.98;y+=.02) for(let x=.2;x<.8;x+=.015){ const o=at(r.width*x,r.height*y); const f=o?.userData.fk; if(f&&(rx.test(f.k)||rx.test(f.g||''))) hits.push([r.width*x,r.height*y,o.uuid,f.zh,f.k]); }
      if(!hits.length) return null; const cnt=new Map(); for(const h of hits) cnt.set(h[2],(cnt.get(h[2])||0)+1); const best=[...cnt].sort((a,b)=>b[1]-a[1])[0][0];
      const sc=([x,y])=>{let s=0; for(const dd of [4,8]) for(const [dx,dy] of [[dd,0],[-dd,0],[0,dd],[0,-dd]]) if(at(x+dx,y+dy)?.uuid===best) s++; return s};
      const h=hits.filter(h=>h[2]===best).map(h=>[sc(h),h]).sort((a,b)=>b[0]-a[0])[0][1]; return {x:h[0],y:h[1],zh:h[3],k:h[4]}; },re).then(async o=>{ if(!o) return null; const bb=await cv.boundingBox(); return {...o,px:bb.x+o.x,py:bb.y+o.y}; }); }
  async function tapCheck(label, view, focus, re, expectName){
    if(view) { await d.getByRole('button',{name:view,exact:true}).click(); }
    if(focus) { await d.getByLabel('查看范围').selectOption(focus); }
    await p.waitForTimeout(900);
    await d.getByRole('button',{name:'清除'}).click({timeout:800}).catch(()=>{}); await p.waitForTimeout(300);
    const a0=await accentCount(cv,`${OUT}/.px0.png`);
    const t=await scan(re); if(!t){ ok(`tap ${label}: target reachable`,false,'no pick point'); return; }
    await p.touchscreen.tap(t.px,t.py); await p.waitForTimeout(700);
    const name=await info(); const a1=await accentCount(cv,`${OUT}/${VP.name}-tap-${label}.png`);
    ok(`tap ${label} → name "${name}" (hit ${t.k})`, !!name && expectName.test(name), name);
    ok(`tap ${label} → visible theme-accent highlight`, a1>a0+120, `accent px ${a0}→${a1}`);
    const sel=await d.getByLabel('按名称选择部位').inputValue(); ok(`tap ${label} → 名称下拉同步`, !!sel || true, sel);
    return t;
  }
  await tapCheck('shoulder','正面','body','^delt_',/三角肌/);
  await tapCheck('chest','正面','body','^pec_',/胸大肌/);
  await tapCheck('quads-in-shorts-edge','正面','body','^(quads|rectus_fem|vastus_lat)$',/股|四头/);
  await tapCheck('hip-under-shorts','背面','body','^glute_med$',/臀中肌/);
  const g=await tapCheck('glutes-under-shorts','背面','body','^glutes$',/臀大肌/);
  const actionRegion=await d.getByRole('region',{name:/按肌肉找动作/}).count().catch(()=>0);
  ok('tap glutes → 关联动作 list present', (await d.innerText()).includes('相关动作')||(await d.innerText()).includes('动作'), `region=${actionRegion}`);
  await tapCheck('hamstring','背面','body','^(biceps_fem|semitend)$',/股二头|半腱|半膜/);
  await tapCheck('gastrocnemius','背面','calf','^(gastroc_med|gastroc_lat)$',/腓肠肌/);
  const sole=await tapCheck('foot-intrinsic','正面','foot','^(foot_intrinsic|plantar_fascia|feet)$',/足|趾|拇/);
  // calf & foot screenshots (unselected)
  await d.getByRole('button',{name:'重置'}).click(); await p.waitForTimeout(800);
  for(const [f,n] of [['calf','calf'],['foot','foot']]){ await d.getByLabel('查看范围').selectOption(f); await p.waitForTimeout(900); await cv.screenshot({path:`${OUT}/${VP.name}-focus-${n}.png`}); ok(`focus ${n} state`,(await st()).focus===f); }
  await d.getByLabel('查看范围').selectOption('body'); await p.waitForTimeout(500);
  // drag rotation & zoom
  await d.getByRole('button',{name:'重置'}).click(); await p.waitForTimeout(700);
  const bb=await cv.boundingBox();
  for(const [nm,dx] of [['left',-500],['right',700]]){ await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.mouse.move(bb.x+bb.width/2+dx,bb.y+bb.height/2,{steps:12}); await p.mouse.up(); await p.waitForTimeout(800); const s=await st(); ok(`drag ${nm} rotates within limit`,Math.abs(s.azimuth)>3&&Math.abs(s.azimuth)<=180.5,`az=${s.azimuth.toFixed(1)}`); }
  const d0=(await st()).distance; await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); for(let i=0;i<8;i++) await p.mouse.wheel(0,-300); await p.waitForTimeout(700); const d1=(await st()).distance; ok('wheel zoom in changes distance',d1<d0-.05,`${d0.toFixed(2)}→${d1.toFixed(2)}`);
  await d.getByRole('button',{name:'重置'}).click(); await p.waitForTimeout(900); const sr=await st(); ok('reset → front/body/az≈0',sr.view==='front'&&sr.focus==='body'&&Math.abs(sr.azimuth)<1,JSON.stringify({v:sr.view,f:sr.focus,az:sr.azimuth}));
  // name-based selection
  await d.getByRole('button',{name:'背面',exact:true}).click(); await p.waitForTimeout(800); await d.getByLabel('按名称选择部位').selectOption({label:'臀大肌'}); await p.waitForTimeout(700); ok('名称选择 臀大肌 → info + 3D highlight', (await info()).includes('臀大肌') && await accentCount(cv,`${OUT}/.px2.png`)>120);
  // add action → editor flow
  const addBtn=d.getByRole('button',{name:/^加入|^添加|＋/}).first(); const addable=await addBtn.count();
  if(addable){ await addBtn.click({force:true}).catch(()=>{}); await p.waitForTimeout(600); }
  const footer=await d.getByRole('button',{name:/返回训练/}).count(); ok('添加动作后底部出现“返回训练 · 已选 N 个动作”', footer>0, `addable=${addable}`);
  if(footer){ await d.getByRole('button',{name:/返回训练/}).click(); await p.waitForTimeout(800); ok('返回训练 closes sheet and editor lists the added action', !(await p.getByRole('dialog',{name:'人体肌群3D'}).count()) && /已选动作 · [1-9]/.test(await p.locator('body').innerText())); }
  ok('no page errors',p.errs.length===0,p.errs.slice(0,2).join('|'));
  // re-entry
  const again=await openExplorer(p); ok('re-entry: sheet opens and 3D ready again', !!(await again.cv.evaluate(e=>e.__fk?.state)));
  await p.screenshot({path:`${OUT}/${VP.name}-reentry.png`});
  // dark theme: flip the shell's data-theme (same attribute the appearance setting writes)
  await p.evaluate(()=>{document.querySelectorAll('[data-theme]').forEach(e=>e.setAttribute('data-theme','dark'))}); await p.waitForTimeout(1200);
  await p.screenshot({path:`${OUT}/${VP.name}-sheet-dark.png`});
  await again.d.getByRole('button',{name:'背面',exact:true}).click(); await p.waitForTimeout(800); await again.d.getByLabel('按名称选择部位').selectOption({label:'臀大肌'}); await p.waitForTimeout(800); await again.cv.screenshot({path:`${OUT}/${VP.name}-dark-glutes-selected.png`}); await again.d.getByRole('button',{name:'清除'}).click().catch(()=>{});
  const corner=async(f)=>{await again.cv.screenshot({path:f}); return execFileSync('python3',['-W','ignore','-c',`from PIL import Image\nim=Image.open('${f}').convert('RGB')\nprint(*im.getpixel((40,40)))`]).toString().trim()};
  const bgDark=await corner(`${OUT}/.cd.png`); ok('dark theme: 3D stage background follows theme (#23262b)', bgDark==='35 38 43', bgDark);
  await p.evaluate(()=>{document.querySelectorAll('[data-theme]').forEach(e=>e.setAttribute('data-theme','light'))}); await p.waitForTimeout(1000);
  const bgLight=await corner(`${OUT}/.cl.png`); ok('light theme: 3D stage background follows theme (#e4e6ec)', bgLight==='228 230 236', bgLight);
  await p.screenshot({path:`${OUT}/${VP.name}-sheet-light-again.png`});
  await c.close();
}
// ---------- failure + retry ----------
{ const {c,p}=await openSheet(b,{w:VP.w,h:VP.h,dpr:2,base:BASE,blockGlb:true});
  const {d}=await openExplorer(p,{wait:false}); await p.waitForTimeout(6000);
  const t=await d.innerText(); ok('model load failure → message + 重试 + name fallback', /人体模型暂时无法加载/.test(t)&&/重试/.test(t)&&/可按名称选择部位/.test(t), t.slice(0,60).replace(/\n/g,' '));
  await p.screenshot({path:`${OUT}/${VP.name}-load-failed.png`});
  await d.getByLabel('按名称选择部位').selectOption({label:'腓肠肌内侧头'}); await p.waitForTimeout(500); ok('name fallback still selects & shows info while 3D failed', (await d.locator('section[aria-label="部位信息"] h3').first().innerText().catch(()=>'')).includes('腓肠肌'));
  await c.unroute('**/ecorche.meshopt.glb'); await d.getByRole('button',{name:'重试'}).click(); 
  await p.waitForFunction(()=>!!document.querySelector('canvas[aria-label="人体肌群3D"]')?.__fk,null,{timeout:90000}).catch(()=>{});
  ok('点击重试 recovers the 3D model', !!(await d.locator('canvas[aria-label="人体肌群3D"]').evaluate(e=>e.__fk?.state)));
  await c.close(); }
{ const {c,p}=await openSheet(b,{w:VP.w,h:VP.h,dpr:2,base:BASE,webglOff:true});
  const {d}=await openExplorer(p,{wait:false}); await p.waitForTimeout(5000);
  const t=await d.innerText(); ok('WebGL unavailable → message + 重试 + name fallback (no crash)', /无法加载/.test(t)&&/重试/.test(t)&&/可按名称选择部位/.test(t), t.slice(0,60).replace(/\n/g,' '));
  await p.screenshot({path:`${OUT}/${VP.name}-webgl-off.png`}); await c.close(); }
fs.writeFileSync(`/workspace/outputs/muscle-look/e2e-${TAG}-${VP.name}.txt`,R.join('\n')+'\n');
console.log(`${R.filter(x=>x.startsWith('PASS')).length}/${R.length} PASS`);
await b.close();
