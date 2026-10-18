import type {DemoData} from './types'
import data from './data.json' with {type:'json'}
import {createPlayer} from './renderer.js'
import {motionKey} from './index'
export const demoData=data as unknown as DemoData
export type DemoView='front'|'side'|'back'|'three'
export type Shoes='on'|'clear'|'off'
export type DemoPlayer={setView:(view:DemoView)=>void;play:()=>void;pause:()=>void;setSpeed:(speed:number)=>void;setShoes:(mode:Shoes)=>void;seek?:(seconds:number)=>void;duration?:number;destroy:()=>void}
type Stage={setView:DemoPlayer['setView'];toggle:()=>boolean;setSpeed:DemoPlayer['setSpeed'];setShoes:DemoPlayer['setShoes'];seek?:(seconds:number)=>void;duration?:number;destroy:()=>void}
type Viewer={muscleIndexFor:(p:string[],s:string[])=>number[];createStage:(c:HTMLCanvasElement,m:unknown,o:{hi:number[];model?:string;onPhase?:(p:string)=>void})=>Promise<Stage>;createAnatomy:(c:HTMLCanvasElement,l:HTMLElement,h:number[])=>Promise<{seek?:(seconds:number)=>void;duration?:number;destroy:()=>void}>}
/** 2D is bundled in the lazy detail chunk, so WebGL/network failure never removes instructions. */
export function mount2d(svg:SVGSVGElement,id:string,onPhase?:(p:string)=>void):DemoPlayer{
 const e=demoData.exercises.find(e=>e.id===id),animation=e&&demoData.animations[e.anim]
 if(!e||!animation)throw new Error('动作2D资源尚未提供')
 const p=createPlayer(svg,animation,{primary:e.primary_muscles,secondary:e.secondary_muscles,onPhase})
 return {setView:()=>{},play:()=>p.play(),pause:()=>p.pause(),setSpeed:s=>p.setSpeed(s),setShoes:()=>{},destroy:()=>p.destroy()}
}
/** The supplied viewer is loaded only on detail open. Cancellation cleans up late arrivals. */
export async function mount3d(canvas:HTMLCanvasElement,id:string,opt:{signal:AbortSignal;onPhase?:(p:string)=>void;timeoutMs?:number;sex?:'male'|'female'}):Promise<DemoPlayer>{
 if(opt.signal.aborted)throw new Error('动作加载已取消')
 const e=demoData.exercises.find(e=>e.id===id),key=motionKey(id)
 if(!e||!key)throw new Error('此动作保留2D示意')
 const controller=new AbortController(),cancel=()=>controller.abort();opt.signal.addEventListener('abort',cancel,{once:true})
 let stage:Stage|undefined,timer:ReturnType<typeof setTimeout>|undefined
 const work=async()=>{
  // Fully-qualified same-origin URLs keep Vite from appending ?import to public modules.
  const viewerUrl=new URL('/demo3d/viewer3d.js',window.location.origin).href,motionsUrl=new URL('/demo3d/motions.js',window.location.origin).href
  const [V,MO]=await Promise.all([import(/* @vite-ignore */ viewerUrl) as Promise<Viewer>,import(/* @vite-ignore */ motionsUrl) as Promise<{default:Record<string,unknown>}>])
  if(controller.signal.aborted)throw new Error('动作加载已取消')
  if(!MO.default[key])throw new Error('动作3D映射缺失')
  stage=await V.createStage(canvas,MO.default[key],{hi:V.muscleIndexFor(e.primary_muscles,e.secondary_muscles),model:opt.sex==='female'?'athlete-female':'athlete-male',onPhase:opt.onPhase})
  if(controller.signal.aborted){stage.destroy();throw new Error('动作加载已取消')}
  let playing=true
  const duration=(MO.default[key] as {frames:{dur:number}[]}).frames.reduce((sum,f)=>sum+f.dur,0)
  return {setView:stage.setView,seek:(seconds:number)=>stage!.seek?.(seconds),duration,play:()=>{if(!playing){stage!.toggle();playing=true}},pause:()=>{if(playing){stage!.toggle();playing=false}},setSpeed:stage.setSpeed,setShoes:stage.setShoes,destroy:()=>{controller.abort();stage?.destroy()}}
 }
 // Cold model decoding and software-GPU shader setup can exceed 45 seconds under contention.
 // Keep the immediately available 2D view while allowing a bounded cold load.
 try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new Error('3D加载超时，已保留2D示意'));controller.abort()},opt.timeoutMs??90000);controller.signal.addEventListener('abort',()=>reject(new Error('3D加载已取消')),{once:true})})])}
 finally{clearTimeout(timer);opt.signal.removeEventListener('abort',cancel)}
}
export async function mountAnatomy(canvas:HTMLCanvasElement,labels:HTMLElement,id:string,signal:AbortSignal){
 const e=demoData.exercises.find(e=>e.id===id);if(!e)throw new Error('动作不存在')
 const url=new URL('/demo3d/viewer3d.js',window.location.origin).href,V=await import(/* @vite-ignore */ url) as Viewer
 if(signal.aborted)return null
 const map=await V.createAnatomy(canvas,labels,V.muscleIndexFor(e.primary_muscles,e.secondary_muscles))
 if(signal.aborted){map.destroy();return null}return map
}
