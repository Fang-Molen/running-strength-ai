import { chromium } from '/workspace/fangkun-muscle/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const b = await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
globalThis.STEP=+process.argv[4]||6;
async function map(port, look, W, H) {
  const p = await b.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
  await p.goto(`http://localhost:${port}/h.html?look=${look}&w=${W}&h=${H}`);
  await p.waitForFunction(()=>window.__ready,null,{timeout:60000});
  const out = {};
  for (const [focus,view] of [['body','front'],['body','back'],['body','left'],['body','right'],['calf','front'],['calf','back'],['foot','front'],['foot','back']]) {
    await p.evaluate(([v,f])=>{__api.setFocus(f);__api.setView(v)},[view,focus]); await p.waitForTimeout(500);
    out[`${focus}/${view}`] = await p.evaluate(({W,H,STEP})=>{ const e=document.getElementById('cv'), r=e.getBoundingClientRect(), rows=[];
      for(let y=2;y<H;y+=STEP){ const row=[]; for(let x=2;x<W;x+=STEP){ const o=__api.pickAt(r.left+x,r.top+y); const f=o?.userData.fk; row.push(o? (f.name||f.k)+'|'+(f.side||'')+'|'+f.k : (o===null?'-':'?')); } rows.push(row);} return rows; },{W,H,STEP:globalThis.STEP});
  }
  await p.close(); return out;
}
const W=+process.argv[2]||390,H=+process.argv[3]||320;
const base = await map(8931,'',W,H), nat = await map(8932,'natural',W,H);
let report=[]; let tot=0, diff=0, nonEdge=0;
for (const key of Object.keys(base)) {
  let d=0, n=0, ne=0, lost={}; const rows=base[key].length, cols=base[key][0].length;
  const lab=v=>v.split('|')[2]||v;
  const baseKeys=new Set(base[key].flat().map(v=>v)), natKeys=new Set(nat[key].flat().map(v=>v));
  const onlyBase=[...baseKeys].filter(v=>!natKeys.has(v)).map(lab), onlyNat=[...natKeys].filter(v=>!baseKeys.has(v)).map(lab);
  for (let y=0;y<rows;y++) for (let x=0;x<cols;x++){ const a=base[key][y][x], c=nat[key][y][x]; n++; if(a!==c){ d++;
      // edge = some 8-neighbour in either map carries a different label than this sample (a 1px camera-fit shift can only move boundaries)
      let edge=false; for(let dy=-1;dy<=1&&!edge;dy++) for(let dx=-1;dx<=1;dx++){ const yy=y+dy,xx=x+dx; if(yy<0||xx<0||yy>=rows||xx>=cols) continue; if(base[key][yy][xx]!==a||nat[key][yy][xx]!==c){edge=true;break} }
      if(!edge){ne++; const kk=`${lab(a)}->${lab(c)}`; (lost[kk]=lost[kk]||{n:0}).n++}} }
  tot+=n; diff+=d; nonEdge+=ne; report.push({view:key, samples:n, differing:d, interiorDiffs:ne, interior:Object.entries(lost).map(([k,v])=>k+' x'+v.n), meshesOnlyInOriginal:onlyBase, meshesOnlyInNew:onlyNat});
}
const result={W,H,step:globalThis.STEP,tot,diff,nonEdge,report};
console.log(JSON.stringify(result,null,1));
fs.writeFileSync(`/workspace/outputs/muscle-look/pickmap-diff-${W}x${H}.json`,JSON.stringify(result,null,1));
await b.close();
