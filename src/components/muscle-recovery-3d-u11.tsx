import { useEffect, useMemo, useRef, useState } from 'react'
import { MESH_KEYS, REGIONS, REGION_LABEL, type Region, type RegionState } from '@/lib/health/muscle-recovery-u11'
import type { RecoveryProjection } from '@/lib/health/recovery-host-u11'
import './muscle-target-card.css'
type Pick = {k:string;g?:string|null;zh:string}|null
type Overlay = {keys:string[];color:string}
type API = {setView:(v:string)=>void;selectKey:(k:string|null)=>void;setOverlays:(v:Overlay[])=>void;destroy:()=>void}
const STATE: Record<RegionState,{label:string;color:string}> = {
  UNKNOWN:{label:'待判断',color:'#8b929a'},TRAINING_EXPOSURE:{label:'训练参与',color:'#3db7a0'},
  OVERLAP_OBSERVED:{label:'参与重叠',color:'#e5b94d'},REPORTED_SORENESS:{label:'自报酸痛',color:'#f59e45'},
  PAIN_REVIEW:{label:'自报疼痛',color:'#e85a58'},
}
export function MuscleRecovery3DU11({value}:{value:RecoveryProjection}) {
  const canvas=useRef<HTMLCanvasElement>(null),api=useRef<API|null>(null)
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const [side,setSide]=useState('front'),[selected,setSelected]=useState<Region|null>(null)
  const overlays=useMemo(()=>value.review.regions.filter(r=>r.state!=='UNKNOWN').map(r=>({keys:MESH_KEYS[r.region],color:STATE[r.state].color})),[value.revision])
  const latest=useRef(overlays); latest.current=overlays
  useEffect(()=>{
    let dead=false,instance:API|null=null
    setReady(false);setError('');setSide('front')
    const timer=setTimeout(()=>{if(!dead&&!instance)setError('模型加载较慢；下方仍可查看肌群依据。')},45000)
    import(/* @vite-ignore */new URL('/demo3d/anatomy3d.js',window.location.origin).href).then(async m=>{
      if(dead||!canvas.current)return
      instance=await m.createMuscleExplorer(canvas.current,{overlays:latest.current,onPick:(p:Pick)=>{
        if(dead)return
        const region=p?REGIONS.find(r=>MESH_KEYS[r].includes(p.k)||r===p.g):null
        setSelected(region??null)
      }}) as API
      if(dead){instance.destroy();return}
      api.current=instance;instance.setOverlays(latest.current);setReady(true);setError('');clearTimeout(timer)
    }).catch(()=>{if(!dead)setError('3D模型暂时无法加载；保留原模型接口，可在下方查看真实记录依据。')})
    return()=>{dead=true;clearTimeout(timer);instance?.destroy();api.current=null}
  },[retry])
  useEffect(()=>{api.current?.setOverlays(overlays)},[overlays])
  const row=selected?value.review.regions.find(r=>r.region===selected):null
  const ids=row?[...row.runEventIds,...row.strengthEventIds,...row.symptomEventIds]:[]
  return <section aria-label="肌肉训练反应" className="fk-target-card u11-muscle">
    <p className="keep text-sm text-muted">{value.review.summary}</p>
    <div className="fk-target-stage"><canvas ref={canvas} aria-label="U11 可旋转点选的3D肌群" data-ready={ready}/>
      {!ready?<div className="fk-target-status" role="status"><p>{error||'正在打开原有肌群模型…'}</p>{error?<button type="button" onClick={()=>setRetry(n=>n+1)}>重新加载</button>:null}</div>:null}
    </div>
    <div className="fk-target-controls" role="group" aria-label="恢复肌群视角">{[['front','正面'],['back','背面']].map(([id,text])=><button key={id} type="button" disabled={!ready} aria-pressed={side===id} onClick={()=>{setSide(id);api.current?.setView(id)}}>{text}</button>)}</div>
    <div className="u11-legend">{Object.entries(STATE).map(([key,s])=><span key={key}><i style={{background:s.color}}/>{s.label}</span>)}</div>
    <p className="text-sm text-muted">灰色表示证据不足；颜色不表示恢复百分比。拖动旋转，点击肌肉查看依据。</p>
    <div className="u11-regions" role="group" aria-label="查看肌群依据">{value.review.regions.map(r=><button key={r.region} type="button" aria-pressed={selected===r.region} onClick={()=>{api.current?.selectKey(MESH_KEYS[r.region][0]);setSelected(r.region)}}><i style={{background:STATE[r.state].color}}/>{REGION_LABEL[r.region]}</button>)}</div>
    <div className="u11-evidence" aria-live="polite" data-testid="u11-muscle-evidence">
      <b>{row?`${REGION_LABEL[row.region]} · ${STATE[row.state].label}`:'选择一个肌群查看依据'}</b>
      {row?.state==='UNKNOWN'?<p>无法判断具体肌群：没有足够的已确认动作或局部反馈。未记录不等于已经恢复。</p>:null}
      {ids.map(id=>{const source=value.sources.find(s=>s.id===id);return <div key={id} className="mt-2"><p>{source?.label??'训练来源'}：{source?.detail??'来源待核对'}</p>{source?<p className="text-muted">发生：{source.occurredAt?new Date(source.occurredAt).toLocaleString():'未知'} · 保存：{source.knownAt?new Date(source.knownAt).toLocaleString():'未知'}</p>:null}<details><summary>来源标识</summary><code className="break-all">{id}</code></details></div>})}
      {row?.notes.map(note=><p key={note}>{note}</p>)}
    </div>
    {value.review.gaps.length?<details className="u11-limits"><summary>缺失与待核对（{value.review.gaps.length}）</summary>{value.review.gaps.map(g=><p key={g}>{g}</p>)}</details>:null}
    <details className="u11-limits"><summary>模型与解释边界</summary><p>沿用原有 Écorché 独立肌肉网格。颜色表示训练涉及区域或自报症状；不是肌肉激活实测、恢复时长或医学许可。区域映射为待复核的解释资料，不自动调整训练计划。</p><a href="/demo3d/anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer">模型来源与授权</a></details>
  </section>
}
