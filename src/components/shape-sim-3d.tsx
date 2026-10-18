import {useState} from 'react'
import {CHANNELS,loadAvatar,normalizeAppearance,saveAvatar} from '@/lib/body/avatar-appearance'
import {FangkunHealthCharacter} from './fangkun-unified-character'
const labels=['纤细轮廓','清晰线条','肌肉饱满','柔和轮廓']
/** Drop-in for health ShapeSim3D with R6 approved identity. No old athlete/human. */
export function ShapeSim3D({cur,tgt,sex}:{cur:{kg:number|null;bf:number|null};tgt:{kg:number|null;bf:number|null}|null;sex:'male'|'female'}){
 const [shape,setShape]=useState(()=>loadAvatar(sex)),[view,setView]=useState<'front'|'side'|'back'|'three'>('front'),[editing,setEditing]=useState<'base'|'target'>(tgt?'target':'base'),[msg,setMsg]=useState('')
 const chip='min-h-11 rounded-xl border border-line px-3 text-sm'
 return <section className="mt-3 rounded-2xl border border-line p-3" aria-label="健康区统一人物 3D">
   <h3 className="font-bold">{sex==='female'?'女性':'男性'}人物 · 3D 体型参考</h3>
   <p className="keep mt-1 text-xs text-muted">仅使用已审核新人物；没有合格 GLB 时只显示同角色参考，不调用旧版人体。</p>
   <div className="mt-3 h-[360px] overflow-hidden rounded-xl"><FangkunHealthCharacter gender={sex} view={view} appearance={shape[editing]}/></div>
   <div className="mt-2 grid grid-cols-4 gap-2" aria-label="人物视角">{(['front','side','back','three'] as const).map((v,i)=><button type="button" key={v} className={chip} aria-pressed={view===v} onClick={()=>setView(v)}>{['正面','侧面','背面','45°'][i]}</button>)}</div>
   <p className="keep mt-2 text-xs text-muted">{cur.kg==null?'体重未记录':`当前记录 ${cur.kg} kg`} · {cur.bf==null?'体脂未记录':`体脂 ${cur.bf}%`}；{tgt?.kg==null?'目标体重未指定':`目标体重 ${tgt.kg} kg`}。人物不是通过体重、体脂自动计算的人体外形，不是身体扫描。</p>
   <details className="mt-3 rounded-xl border border-line p-3"><summary className="min-h-11 cursor-pointer font-bold">调整参考外形</summary>
    <div className="my-2 flex gap-2" aria-label="调整对象"><button type="button" className={chip} aria-pressed={editing==='base'} onClick={()=>setEditing('base')}>当前</button>{tgt?<button type="button" className={chip} aria-pressed={editing==='target'} onClick={()=>setEditing('target')}>目标</button>:null}</div>
    {CHANNELS.map((k,i)=><label key={k} className="mt-3 block text-sm">{labels[i]}<b className="float-right">{Math.round(shape[editing][k]*100)}%</b><input type="range" className="mt-2 w-full accent-[#ff6a1a]" aria-label={`${editing}${labels[i]}`} min={0} max={100} step={5} value={Math.round(shape[editing][k]*100)} onChange={e=>{setShape(p=>({...p,[editing]:normalizeAppearance({...p[editing],[k]:Number(e.target.value)/100})}));setMsg('未保存')}}/></label>)}
    <p className="keep mt-2 text-xs text-muted">修改仅为外观参考，绝不改变真实身体测量值。无合格模型时仅保存偏好，参考图不会随滑杆变形。</p>
    <button className={chip+' mt-3 w-full text-accent'} type="button" onClick={()=>{try{setShape(saveAvatar(shape,sex));setMsg('参考外形已保存')}catch(e){setMsg(e instanceof Error?e.message:'无法保存')}}}>保存视觉参考</button><p role="status" className="mt-2 text-xs">{msg}</p>
   </details>
 </section>
}
