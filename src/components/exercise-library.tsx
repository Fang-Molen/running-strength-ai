import { useEffect, useState } from 'react'
import { demoData } from '@/lib/strength/demo/provider'
import { muscleMapSVG, MUSCLES } from '@/lib/strength/demo/musclemap.js'
import { characterReference, type Gender } from '@/lib/strength/approved-motion'
import { validateVideoManifest } from '@/lib/character/identity'
import type { MuscleId } from '@/lib/strength/demo/types'
import './exercise-demo.css'
import { poseCardUrl, POSE_CARD_LABEL, defaultPoseGender } from '@/lib/strength/pose-cards-r8'
import RunningTechniqueLibrary from './running-technique-library'
import './running-technique-library.css'

/** The list never depicts old athlete figures or calls an unreviewed 3D motion a finished animation. */
function Thumb({ gender, exerciseId }: { gender: Gender; exerciseId?: string }) {
  const card = poseCardUrl(exerciseId, gender)
  if (card) return <div data-testid="pose-thumb" style={{ position: 'relative', flexShrink: 0, width: 78, height: 90, borderRadius: 12, background: '#17191c', overflow: 'hidden' }}>
    <img src={card} loading="lazy" decoding="async" alt="姿势示意（待审核）" style={{ height: '100%', width: '100%', objectFit: 'cover', objectPosition: 'top' }}/>
    <span style={{ position: 'absolute', bottom: 2, left: 2, right: 2, textAlign: 'center', fontSize: 9, background: '#17191cdd', color: '#fbbf24', borderRadius: 4 }}>{POSE_CARD_LABEL}</span>
  </div>
  return <div style={{ position: 'relative', flexShrink: 0, width: 78, height: 90, borderRadius: 12,
    background: '#17191c', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
    <img src={characterReference(gender)} loading="lazy" alt={`${gender === 'male' ? '男性' : '女性'}新版角色形象，仅为外观参考`} style={{ height: '100%', width: '100%', objectFit: 'contain' }}/>
    <span style={{ position: 'absolute', bottom: 2, left: 2, right: 2, textAlign: 'center', fontSize: 9,
      background: '#17191cdd', color: '#fff', borderRadius: 4 }}>人物参考</span>
  </div>
}
const EQ: [string, RegExp][] = [['杠铃',/杠铃|EZ|六角杠/],['哑铃',/哑铃/],['壶铃',/壶铃/],['绳索/器械',/龙门|滑轮|器|机|下拉/],['凳',/凳/],['单杠/双杠',/单杠|双杠|史密斯/],['无器械',/无器械/]]
export default function ExerciseLibrary({ onSelect }: { onSelect: (id: string) => void }) {
  const [kind, setKind] = useState<'strength' | 'technique'>('strength')
  return <section className="fk-demo fk-library" aria-label="动作库"><h1>动作库</h1>
    <div className="library-tabs" role="group" aria-label="动作类型"><button type="button" aria-pressed={kind==='strength'} onClick={()=>setKind('strength')}>力量动作</button><button type="button" aria-pressed={kind==='technique'} onClick={()=>setKind('technique')}>跑步技术</button></div>
    {kind==='strength' ? <StrengthLibrary onSelect={onSelect}/> : <RunningTechniqueLibrary/>}</section>
}
function StrengthLibrary({ onSelect }: { onSelect: (id: string) => void }) {
 const [q, setQ] = useState(''), [g, setG] = useState('全部'), [eq, setEq] = useState('全部'), [muscle, setMuscle] = useState<MuscleId|null>(null)
 const [gender,setGender] = useState<Gender>(defaultPoseGender)
 const [approved,setApproved] = useState<Set<string>>(new Set())
 const [onlyApproved,setOnlyApproved] = useState(false)
 useEffect(() => {
   const c = new AbortController()
   fetch('/fangkun-video/manifest-r6.json',{signal:c.signal,cache:'no-store'})
     .then(async response => {if(!response.ok || /text\/html/i.test(response.headers.get('content-type')||'')) throw Error('审核列表不可用');return response.json()})
     .then((data: unknown) => {if(!c.signal.aborted) setApproved(validateVideoManifest(data) ? new Set(data.assets.map(item=>`${item.gender}:${item.exerciseId}`)) : new Set())})
     .catch(() => {if(!c.signal.aborted)setApproved(new Set())})
   return () => c.abort()
 },[])
 const hasApproved = (id:string) => approved.has(`${gender}:${id}`)
 const rows = demoData.exercises.filter(e=>(g==='全部'||e.category===g)&&(eq==='全部'||e.equipment.some(x=>EQ.find(([n])=>n===eq)?.[1].test(x)))&&(!muscle||e.primary_muscles.includes(muscle)||e.secondary_muscles.includes(muscle))&&(!onlyApproved||hasApproved(e.id))&&(!q||e.name_zh.includes(q)||e.name_en.toLowerCase().includes(q.toLowerCase())))
 const approvedCount=demoData.exercises.filter(e=>hasApproved(e.id)).length
 return <section className="fk-demo" aria-label="力量动作库"><h2>力量动作</h2>
  <input className="search" aria-label="搜索力量动作" placeholder="搜索动作" value={q} onChange={e=>setQ(e.target.value)}/>
  <div className="ctrl" role="group" aria-label="新版角色外观">{(['male','female'] as const).map(x=><button type="button" key={x} aria-pressed={gender===x} onClick={()=>setGender(x)}>{x==='male'?'男版':'女版'}</button>)}</div>
  <div className="chips">{['全部','胸','背','肩','手臂','腿','臀','核心','全身'].map(x=><button className={'chip '+(g===x?'on':'')} key={x} type="button" onClick={()=>setG(x)}>{x}</button>)}</div>
  <div className="chips">{['全部',...EQ.map(([n])=>n)].map(x=><button className={'chip '+(eq===x?'on':'')} type="button" key={x} onClick={()=>setEq(x)}>{x==='全部'?'全部器械':x}</button>)}</div>
  <div className="maps" onClick={event=>{const target=(event.target as Element).closest('[data-m]');const m=target?.getAttribute('data-m') as MuscleId|null;if(m&&MUSCLES[m])setMuscle(m===muscle?null:m)}}>{(['front','back'] as const).map((v,i)=><div key={v}><div dangerouslySetInnerHTML={{__html:muscleMapSVG(v,[],[],{selected:muscle?[muscle]:[]})}}/>{i?'背面':'正面'}</div>)}</div>
  <div className="selbar"><span>{muscle?'肌肉：'+MUSCLES[muscle]:'点人体图按肌肉筛选'} · {rows.length} 个</span>{muscle?<button type="button" onClick={()=>setMuscle(null)}>清除</button>:null}</div>
  <label className="only3d"><input type="checkbox" checked={onlyApproved} onChange={e=>setOnlyApproved(e.target.checked)}/>只看已审核同角色视频（当前{approvedCount}个）</label>
  <p className="note">缩略图为 R8 姿势示意（程序化简化人形，待审核，不是标准教学）；缺图的动作仍显示人物外观参考。有合格同角色素材才显示视频。</p>
  <div className="list">{rows.map(e=><button type="button" className="item" key={e.id} onClick={()=>onSelect(e.id)}><Thumb gender={gender} exerciseId={e.id}/><div style={{textAlign:'left',minWidth:0}}><b>{e.name_zh}{hasApproved(e.id)?<em className="b3">已审核视频</em>:null}</b><small>{e.category} · {e.equipment.join('、')}</small></div></button>)}</div>
  {rows.length===0?<p className="note">当前筛选下没有符合要求的动作，或尚无审核通过的同角色视频。可取消已审核过滤继续查看图文。</p>:null}
  <p className="note">肌肉映射待教练组审校。浏览、搜索和筛选不会加入训练。</p>
 </section>
}
