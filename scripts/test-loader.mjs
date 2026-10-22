// Uses the project's locked TypeScript dependency; no npx download or IPC socket.
import { readFile, access, mkdir, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as pathResolve } from 'node:path'
import ts from 'typescript'
const root=pathResolve(fileURLToPath(new URL('..',import.meta.url)))
async function existingFile(path) {for(const suffix of ['', '.ts','.tsx','.js','.mjs','/index.ts','/index.tsx']) {try {await access(path+suffix);if(suffix==='' && !/\.(?:tsx?|m?js|json)$/.test(path))continue;return pathToFileURL(path+suffix).href}catch{}}return null}
export async function resolve(specifier,context,nextResolve) {
  if(specifier.startsWith('@/')) {const url=await existingFile(pathResolve(root,'src',specifier.slice(2)));if(url)return {url,shortCircuit:true}}
  try{return await nextResolve(specifier,context)}catch(error){
    if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')) {const url=await existingFile(fileURLToPath(new URL(specifier,context.parentURL)));if(url)return {url,shortCircuit:true}}
    throw error
  }
}
export async function load(url,context,nextLoad) {
  // SSR assertions run in Node without a CSS engine. Production styles are
  // still loaded by Vite; only side-effect style imports are empty here.
  if(url.startsWith('file:') && url.endsWith('.css')) return {format:'module',source:'export {}',shortCircuit:true}
  if(url.startsWith('file:')&&/\.tsx?$/.test(url)) {
    const source=await readFile(fileURLToPath(url),'utf8')
    // Opt-in local test acceleration only. Content, TS version and file extension
    // key the cache; no assertion or business result is cached.
    const cacheDir=process.env.FK_TEST_TRANSPILE_CACHE
    const cacheKey=createHash('sha256').update('fk-ts-cache-v1:'+ts.version+':'+(url.endsWith('.tsx')?'tsx':'ts')+':'+source).digest('hex')
    const cached=cacheDir?pathResolve(cacheDir,cacheKey+'.mjs'):null
    if(cached)try{return {format:'module',source:await readFile(cached,'utf8'),shortCircuit:true}}catch{}
    const result=ts.transpileModule(source,{fileName:fileURLToPath(url),reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,sourceMap:false}})
    const errors=(result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    if(errors.length)throw new SyntaxError(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}))
    if(cached)try{await mkdir(cacheDir,{recursive:true});const tmp=cached+'.'+process.pid;await writeFile(tmp,result.outputText);await rename(tmp,cached)}catch{/* a cache failure never skips compilation */}
    return {format:'module',source:result.outputText,shortCircuit:true}
  }
  if(url.startsWith('file:')&&url.endsWith('.json'))return nextLoad(url,{...context,importAttributes:{...context.importAttributes,type:'json'}})
  return nextLoad(url,context)
}
