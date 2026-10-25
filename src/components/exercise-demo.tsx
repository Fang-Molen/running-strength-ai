import { useEffect, useRef, useState } from 'react'
import { demoData, mount2d, mount3d, type DemoPlayer, type DemoView } from '@/lib/strength/demo/provider'
import { has3d } from '@/lib/strength/demo'
import { FangkunExerciseVideo } from './fangkun-unified-video'
import { defaultPoseGender } from '@/lib/strength/pose-cards-r8'
import PoseFrames from './pose-frames'
import type { Gender } from '@/lib/character/identity'
import './exercise-demo.css'
/** Shared by library, training execution and plan editor; exact catalogue ID is retained. */
export default function ExerciseDemo({catalogId,onAdd}:{catalogId:string;onAdd?:()=>void;compact?:boolean}){
 const [gender,setGender]=useState<Gender>(defaultPoseGender)
 const [showTrace,setShowTrace]=useState(false)
 const exercise=demoData.exercises.find(e=>e.id===catalogId)
 if(!exercise)return <p className="text-sm text-muted">暂无动作演示。</p>
 return <section className="fk-demo fk-demo-unified" aria-label={`${exercise.name_zh}演示`}>
  <div className="ctrl" role="group" aria-label="新版人物">{(['male','female'] as const).map(g=><button type="button" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div>
  <FangkunExerciseVideo exerciseId={catalogId} title={exercise.name_zh} gender={gender}/>
  <h3 className="mt-3 text-sm font-bold">关键帧示意</h3>
  <PoseFrames exerciseId={catalogId} gender={gender}/>
  <details className="mt-3" onToggle={e=>setShowTrace((e.currentTarget as HTMLDetailsElement).open)}><summary className="text-sm font-bold">旧版动作轨迹示意（较粗糙，点开才加载）</summary>{showTrace?<GenericDemo catalogId={catalogId}/>:null}</details>
  {onAdd&&<button type="button" className="add" onClick={onAdd}>加入今天训练</button>}
 </section>
}

const PHASE: Record<string,string> = { con:'发力', ecc:'控制还原', hold:'' }
/** v61–v72 通用示意动画（human.glb / 2D 备用），在同角色视频审核通过前保留播放、慢放与受限视角。 */
function GenericDemo({ catalogId }: { catalogId:string }) {
 const e = demoData.exercises.find(x => x.id === catalogId)
 const svg = useRef<SVGSVGElement>(null), canvas = useRef<HTMLCanvasElement>(null), player = useRef<DemoPlayer|null>(null)
 const preference = useRef({ playing:false, speed:1 })
 const [status,setStatus] = useState('演示加载中…'), [ready,setReady] = useState(false), [available,setAvailable] = useState(false)
 const [phase,setPhase] = useState(''), [playing,setPlaying] = useState(false), [slow,setSlow] = useState(false), [view,setView] = useState<DemoView>('three')
 useEffect(() => {
  if (!e || !svg.current || !canvas.current) return
  const abort = new AbortController(); let p2:DemoPlayer|null = null, p3:DemoPlayer|null = null
  setReady(false); setAvailable(false); setPhase(''); setView('three'); setSlow(false); setPlaying(false)
  preference.current = { playing:false, speed:1 }
  const onPhase = (p:string) => { if (!abort.signal.aborted) setPhase(PHASE[p] ?? '') }
  try { p2 = mount2d(svg.current,catalogId,onPhase); p2.pause(); player.current = p2; setAvailable(true) }
  catch { setStatus('动画暂不可用，可查看动作步骤。') }
  if (has3d(catalogId)) {
   setStatus('3D加载中…')
   mount3d(canvas.current,catalogId,{ signal:abort.signal,onPhase }).then(p => {
    if (abort.signal.aborted) { p.destroy(); return }
    p3 = p; p2?.pause(); player.current = p; p.setShoes('on'); p.setSpeed(preference.current.speed)
    if (!preference.current.playing) p.pause()
    setReady(true); setAvailable(true); setStatus('')
   }).catch(() => { if (!abort.signal.aborted) setStatus(p2 ? '当前显示二维示意' : '动画加载失败，可查看动作步骤。') })
  } else if (p2) setStatus('二维示意')
  const visibility = () => { if (document.hidden) { preference.current.playing = false; player.current?.pause(); setPlaying(false) } }
  document.addEventListener('visibilitychange',visibility)
  return () => { abort.abort(); p2?.destroy(); p3?.destroy(); player.current = null; document.removeEventListener('visibilitychange',visibility) }
 },[catalogId])
 if (!e) return <p>此动作暂无对应演示资源。</p>
 return <section className="fk-demo fk-demo-unified" aria-label={`${e.name_zh}通用示意动画`}>
  <div className="stage3"><canvas ref={canvas} aria-label="3D动作示意" style={{ visibility:ready?'visible':'hidden' }}/><div className="stage-fallback" hidden={ready}><svg ref={svg} className="fig" aria-label="二维备用示意"/></div><div className="phase">{phase}</div></div>
  {status ? <p className="fk-demo-status" role="status">{status}</p> : null}
  <div className="ctrl" role="group" aria-label="动画视角">{(['front','side','back','three'] as const).map((v,i) => <button type="button" key={v} disabled={!ready} aria-pressed={view===v} className={view===v?'on':''} onClick={() => { setView(v); player.current?.setView(v) }}>{['正面','侧面','背面','斜侧'][i]}</button>)}</div>
  <div className="ctrl"><button type="button" disabled={!available} onClick={() => { const next = !playing; preference.current.playing = next; next ? player.current?.play() : player.current?.pause(); setPlaying(next) }}>{playing?'暂停':'播放'}</button>
   <button type="button" disabled={!available} aria-pressed={slow} className={slow?'on':''} onClick={() => { const next = !slow; preference.current.speed = next ? 0.35 : 1; player.current?.setSpeed(preference.current.speed); setSlow(next) }}>慢放</button>
   <button type="button" disabled={!ready} onClick={() => { setView('three'); player.current?.setView('three') }}>视角复原</button></div>
 </section>
}
