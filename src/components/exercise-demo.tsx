import {useEffect,useRef,useState} from 'react'
import {demoData,mount2d,mount3d,mountAnatomy,type DemoPlayer,type DemoView,type Shoes} from '@/lib/strength/demo/provider'
import {has3d,downloadDemoAssets} from '@/lib/strength/demo'
import {muscleMapSVG,MUSCLES} from '@/lib/strength/demo/musclemap.js'
import './exercise-demo.css'
const PHASE:Record<string,string>={con:'发力',ecc:'控制还原',hold:''}
export default function ExerciseDemo({catalogId,onAdd}:{catalogId:string;onAdd?:()=>void}){
 const e=demoData.exercises.find(e=>e.id===catalogId)
 const svg=useRef<SVGSVGElement>(null),canvas=useRef<HTMLCanvasElement>(null),anat=useRef<HTMLCanvasElement>(null),labels=useRef<HTMLDivElement>(null),player=useRef<DemoPlayer|null>(null)
 const [status,setStatus]=useState('先显示2D示意，3D模型加载中…'),[ready,setReady]=useState(false),[anatomyReady,setAnatomyReady]=useState(false),[phase,setPhase]=useState(''),[playing,setPlaying]=useState(true),[slow,setSlow]=useState(false),[view,setView]=useState<DemoView>('three'),[shoes,setShoes]=useState<Shoes>('on'),[download,setDownload]=useState('')
 useEffect(()=>{
  if(!e||!svg.current||!canvas.current)return
  const abort=new AbortController();let p2:DemoPlayer|null=null,p3:DemoPlayer|null=null,map:{destroy:()=>void}|null=null
  setReady(false);setAnatomyReady(false);setView('three');setShoes('on');setSlow(false)
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches
  try{p2=mount2d(svg.current,catalogId,p=>setPhase(PHASE[p]??''));player.current=p2;if(reduced){p2.pause();setPlaying(false)}}catch{setStatus('2D动画暂不可用；文字步骤仍可读')}
  if(has3d(catalogId)){
   setStatus('先显示2D示意，3D模型加载中…')
   mount3d(canvas.current,catalogId,{signal:abort.signal,onPhase:p=>setPhase(PHASE[p]??'')}).then(async p=>{
    if(abort.signal.aborted){p.destroy();return}p3=p;p2?.pause();player.current=p;p.setShoes('on');if(reduced){p.pause();setPlaying(false)}else setPlaying(true)
    setReady(true);setStatus('拖动旋转 · 双指缩放')
    if(anat.current&&labels.current)try{map=await mountAnatomy(anat.current,labels.current,catalogId,abort.signal);if(map&&!abort.signal.aborted)setAnatomyReady(true)}catch{/* Static front/back map stays visible. */}
   }).catch(error=>{if(!abort.signal.aborted){if(import.meta.env.DEV)console.warn('[fangkun-demo-load]',error);setStatus('3D暂不可用，已保留离线2D示意与动作要领')}})
  }else setStatus('此动作暂为2D示意')
  const visibility=()=>{if(document.hidden){player.current?.pause();setPlaying(false)}}
  document.addEventListener('visibilitychange',visibility)
  return ()=>{abort.abort();p2?.destroy();p3?.destroy();map?.destroy();player.current=null;document.removeEventListener('visibilitychange',visibility)}
 },[catalogId])
 if(!e)return <p>该动作的演示尚未提供；没有使用其他变式替代。</p>
 const cue=e.cues
 return <section className="fk-demo" style={{position:'relative'}} aria-label={`${e.name_zh}动作演示`}>
  <p className="meta">{e.category} · {e.equipment.join('、')}{e.tempo?` · ${e.tempo}`:''}</p>
  <div className="stage3" style={{marginTop:12}}><canvas ref={canvas} aria-label="3D动作演示" style={{visibility:ready?'visible':'hidden'}}/><div className="stage-fallback" hidden={ready}><svg ref={svg} className="fig" aria-label="2D动作示意"/></div><div className="phase">{phase}</div><div className="hint" role="status">{status}</div></div>
  <div className="ctrl">{(['front','side','back','three'] as const).map((v,i)=><button type="button" key={v} disabled={!ready} aria-pressed={view===v} className={view===v?'on':''} onClick={()=>{setView(v);player.current?.setView(v)}}>{['正面','侧面','背面','斜侧'][i]}</button>)}</div>
  <div className="ctrl"><button type="button" onClick={()=>{playing?player.current?.pause():player.current?.play();setPlaying(!playing)}}>{playing?'暂停':'播放'}</button><button type="button" className={slow?'on':''} onClick={()=>{player.current?.setSpeed(slow?1:.35);setSlow(!slow)}}>慢放</button></div>
  <div className="ctrl sm">{(['on','clear','off'] as const).map((mode,i)=><button type="button" disabled={!ready} key={mode} className={shoes===mode?'on':''} onClick={()=>{player.current?.setShoes(mode);setShoes(mode)}}>{['穿鞋','鞋透明','赤脚'][i]}</button>)}</div>
  <h2>练到哪里</h2><div className="legend"><span><i className="dot" style={{background:'#e8202a'}}/>主要发力</span><span><i className="dot" style={{background:'#ff9a6a'}}/>辅助</span></div>
  <div className="anat" style={anatomyReady?undefined:{position:'absolute',visibility:'hidden',pointerEvents:'none'}}><canvas ref={anat}/><div className="alabs" ref={labels}/><span className="al l">正面</span><span className="al r">背面</span><span className="al s">足底</span></div>
  {!anatomyReady?<div className="maps">{(['front','back'] as const).map((v,i)=><div key={v}><div dangerouslySetInnerHTML={{__html:muscleMapSVG(v,e.primary_muscles,e.secondary_muscles)}}/>{i?'背面':'正面'}</div>)}</div>:null}
  <div className="mus" style={{marginTop:10}}>{e.primary_muscles.map(m=><span className="mp" key={m}>{MUSCLES[m]}</span>)}{e.secondary_muscles.map(m=><span className="ms" key={m}>{MUSCLES[m]}</span>)}</div>
  <h2>怎么做</h2>{([['准备',cue.setup],['动作',cue.execution],['呼吸',cue.breathing],['常见错误',cue.mistakes],['安全',cue.safety],['变简单 / 变难',[...cue.regression.map(x=>'简单：'+x),...cue.progression.map(x=>'进阶：'+x)]]] as [string,string[]][]).map(([title,lines],i)=><details className="sec" key={title} open={i<2}><summary>{title}</summary><ul>{lines.map((line,n)=><li key={n}>{line}</li>)}</ul></details>)}
  {onAdd?<button className="add" type="button" onClick={onAdd}>加入今天训练 · {e.default_sets}组 × {e.default_reps_or_time.amount}{e.default_reps_or_time.mode==='seconds'?'秒':'次'} · 休息{e.default_rest_sec}秒</button>:null}
  <details className="sec"><summary>离线资源与来源</summary><button type="button" className="btn" disabled={download.startsWith('下载中')} onClick={()=>{setDownload('下载中…');void downloadDemoAssets((n,total)=>setDownload(`下载中 ${n}/${total}`)).then(()=>setDownload('动作资源已缓存；可离线查看')).catch(()=>setDownload('缓存未完成；2D示意仍可用，可重试'))}}>下载动作资源（约8MB）</button><p role="status" className="meta">{download}</p><p className="note">人体模型 MakeHuman（CC0），three.js（MIT），动作与肌肉标注来自用户交接包，仍待教练组审校。演示不代表已获医学许可，不自动增加训练。完整许可见 /demo3d/LICENSES.md。</p></details>
 </section>
}
