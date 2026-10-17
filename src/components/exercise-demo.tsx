import { useEffect, useRef, useState } from 'react'
import { demoData, mount2d, mount3d, type DemoPlayer, type DemoView } from '@/lib/strength/demo/provider'
import { has3d } from '@/lib/strength/demo'
import './exercise-demo.css'
const PHASE: Record<string,string> = { con:'发力', ecc:'控制还原', hold:'' }

/** A single animation stage. Details and muscle selection are owned by DemoSheet. */
export default function ExerciseDemo({ catalogId, onAdd }: { catalogId:string; onAdd?:()=>void; compact?:boolean }) {
 const e = demoData.exercises.find(x => x.id === catalogId)
 const svg = useRef<SVGSVGElement>(null), canvas = useRef<HTMLCanvasElement>(null), player = useRef<DemoPlayer|null>(null)
 const preference = useRef({ playing:false, speed:1 })
 const [status,setStatus] = useState('正在加载3D示意…'), [ready,setReady] = useState(false), [available,setAvailable] = useState(false)
 const [phase,setPhase] = useState(''), [playing,setPlaying] = useState(false), [slow,setSlow] = useState(false), [view,setView] = useState<DemoView>('three')
 useEffect(() => {
  if (!e || !svg.current || !canvas.current) return
  const abort = new AbortController(); let p2:DemoPlayer|null = null, p3:DemoPlayer|null = null
  setReady(false); setAvailable(false); setPhase(''); setView('three'); setSlow(false); setPlaying(false)
  preference.current = { playing:false, speed:1 }
  const onPhase = (p:string) => { if (!abort.signal.aborted) setPhase(PHASE[p] ?? '') }
  try { p2 = mount2d(svg.current,catalogId,onPhase); p2.pause(); player.current = p2; setAvailable(true) }
  catch { setStatus('暂缺动画资源，可继续查看下方动作步骤。') }
  if (has3d(catalogId)) {
   setStatus('正在加载3D，当前为二维备用示意')
   mount3d(canvas.current,catalogId,{ signal:abort.signal,onPhase }).then(p => {
    if (abort.signal.aborted) { p.destroy(); return }
    p3 = p; p2?.pause(); player.current = p; p.setShoes('on'); p.setSpeed(preference.current.speed)
    if (!preference.current.playing) p.pause()
    setReady(true); setAvailable(true); setStatus('通用男性模型 · 受限旋转与缩放')
   }).catch(() => { if (!abort.signal.aborted) setStatus(p2 ? '3D暂不可用，当前为二维备用示意' : '动画加载失败，动作步骤仍可查看') })
  } else setStatus('当前为二维示意')
  const visibility = () => { if (document.hidden) { preference.current.playing = false; player.current?.pause(); setPlaying(false) } }
  document.addEventListener('visibilitychange',visibility)
  return () => { abort.abort(); p2?.destroy(); p3?.destroy(); player.current = null; document.removeEventListener('visibilitychange',visibility) }
 },[catalogId])
 if (!e) return <p>此动作暂无对应演示资源。</p>
 return <section className="fk-demo fk-demo-unified" aria-label={`${e.name_zh}动画演示`}>
  <div className="stage3"><canvas ref={canvas} aria-label="3D动作示意" style={{ visibility:ready?'visible':'hidden' }}/><div className="stage-fallback" hidden={ready}><svg ref={svg} className="fig" aria-label="二维备用示意"/></div><div className="phase">{phase}</div></div>
  <p className="keep fk-demo-status" role="status">{status}</p>
  <div className="ctrl" role="group" aria-label="动画视角">{(['front','side','back','three'] as const).map((v,i) => <button type="button" key={v} disabled={!ready} aria-pressed={view===v} className={view===v?'on':''} onClick={() => { setView(v); player.current?.setView(v) }}>{['正面','侧面','背面','斜侧'][i]}</button>)}</div>
  <div className="ctrl"><button type="button" disabled={!available} onClick={() => { const next = !playing; preference.current.playing = next; next ? player.current?.play() : player.current?.pause(); setPlaying(next) }}>{playing?'暂停':'播放'}</button>
   <button type="button" disabled={!available} aria-pressed={slow} className={slow?'on':''} onClick={() => { const next = !slow; preference.current.speed = next ? 0.35 : 1; player.current?.setSpeed(preference.current.speed); setSlow(next) }}>慢放</button>
   <button type="button" disabled={!ready} onClick={() => { setView('three'); player.current?.setView('three') }}>视角复原</button></div>
  {onAdd ? <button type="button" className="add" onClick={onAdd}>加入今天训练</button> : null}
 </section>
}
