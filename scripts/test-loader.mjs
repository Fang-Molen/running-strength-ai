// Uses the project's locked TypeScript dependency; no npx download or IPC socket.
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as pathResolve } from 'node:path'
import ts from 'typescript'
const root=pathResolve(fileURLToPath(new URL('..',import.meta.url)))
async function existingFile(path) {for(const suffix of ['', '.ts','.tsx','.js','.mjs','/index.ts','/index.tsx']) {try {await access(path+suffix);if(suffix==='' && !/\.(?:tsx?|m?js)$/.test(path))continue;return pathToFileURL(path+suffix).href}catch{}}return null}
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
    const result=ts.transpileModule(source,{fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,sourceMap:false}})
    return {format:'module',source:result.outputText,shortCircuit:true}
  }
  return nextLoad(url,context)
}
