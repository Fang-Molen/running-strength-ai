import ts from 'typescript'
import {readdirSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,relative,dirname} from 'node:path'
const root=process.cwd(),src=resolve('src')
const files=readdirSync(src,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&/\.(?:[cm]?js|tsx?)$/.test(e.name)&&!/(?:\.test\.|\.d\.ts$)/.test(e.name)).map(e=>resolve(e.parentPath,e.name))
const set=new Set(files),edges=new Map(),incoming=new Map(files.map(f=>[f,[]]))
for(const f of files){
 const ast=ts.createSourceFile(f,readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true),specs=[]
 const visit=n=>{if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))specs.push(n.moduleSpecifier.text);if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))specs.push(n.arguments[0].text);ts.forEachChild(n,visit)};visit(ast)
 const deps=[]
 for(const spec of specs){if(!spec.startsWith('.')&&!spec.startsWith('@/'))continue;const base=spec.startsWith('@/')?resolve(src,spec.slice(2)):resolve(dirname(f),spec);const stem=base.replace(/\.(?:[cm]?js|tsx?)$/,'');const target=[base,...['.ts','.tsx','.mjs','.js','/index.ts','/index.tsx'].map(e=>stem+e)].find(p=>set.has(p));if(target){deps.push(target);incoming.get(target).push(f)}}
 edges.set(f,[...new Set(deps)])
}
const walk=seeds=>{const seen=new Set(),stack=[...seeds];while(stack.length){const f=stack.pop();if(seen.has(f)||!set.has(f))continue;seen.add(f);stack.push(...edges.get(f))}return seen}
const routed=walk([resolve('src/routes/__root.tsx'),resolve('src/routes/index.tsx')]),pipe=walk([resolve('src/lib/strength/coach-pipeline.ts'),resolve('src/lib/strength/coach-ai.ts')])
const path=f=>relative(root,f)
const result={method:'TypeScript AST static imports/exports and literal dynamic imports; includes type imports, so reachability does not prove runtime enforcement. No database/storage-string edges.',productionFiles:files.length,routeReachable:routed.size,pipelineClosure:pipe.size,unreachable:files.filter(f=>!routed.has(f)).map(f=>({file:path(f),productionImporters:incoming.get(f).map(path),classification:/app-data|\/auth\/|multiplayer/.test(f)?'PLATFORM_RESERVED':/research-|running-.*context|reasoning-audit|coach-v4-c12|coach-v4-c15-exam|athlete-.*(?:baseline|dimensions|readiness|longitudinal)/.test(f)?'EXPERIMENTAL_OR_TEST_ONLY':'NOT_ROUTE_REACHABLE_REVIEW_REQUIRED'}))}
const out=process.env.FANGKUN_AUDIT_OUTPUT||'../evidence/r8/module-reachability.json';mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({productionFiles:files.length,routeReachable:routed.size,pipelineClosure:pipe.size,unreachable:result.unreachable.length}))
