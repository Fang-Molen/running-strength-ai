import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root=process.argv[2], port=+process.argv[3]; const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.glb':'model/gltf-binary','.webmanifest':'application/manifest+json','.webp':'image/webp','.jpg':'image/jpeg','.md':'text/plain','.wasm':'application/wasm'};
const failGlb = process.env.FAIL_GLB==='1';
http.createServer((req,res)=>{ let u=decodeURIComponent(req.url.split('?')[0]); if(globalThis.__block && /ecorche\.meshopt\.glb/.test(u)){res.writeHead(503);return res.end('x')}
 if(u==='/__block'){globalThis.__block=true;return res.end('ok')} if(u==='/__unblock'){globalThis.__block=false;return res.end('ok')}
 let f=path.join(root,u); if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) { if(u.startsWith('/api/')){res.writeHead(503);return res.end('{}')} f=path.join(root,'index.html'); }
 res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'}); fs.createReadStream(f).pipe(res); }).listen(port,()=>console.log('up',port));
