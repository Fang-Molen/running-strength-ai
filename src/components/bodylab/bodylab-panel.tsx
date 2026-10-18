import {useState} from 'react'
import { FangkunHealthCharacter } from '../fangkun-unified-character'
import { loadAvatar } from '@/lib/body/avatar-appearance'
import {ShapeSim3D} from '../shape-sim-3d'
import {loadChecks} from '@/lib/nutrition/body'
import {loadProfile} from '@/lib/strength/profile'
/** Same locally bundled characters as action demonstrations; appearance never writes health facts. */
export default function BodyLabPanel(){
 const [sex,setSex]=useState<'male'|'female'>(()=>loadProfile().sex==='female'?'female':'male')
 const latest=loadChecks().sort((a,b)=>a.date.localeCompare(b.date)).at(-1)
 return <section className="home-card p-4" aria-label="BODYLAB人物工作室"><header className="flex items-center justify-between gap-3"><div><small className="text-accent">BODYLAB</small><h2 className="text-lg font-bold">人物与外形</h2></div><div className="flex gap-2" role="group" aria-label="人物外观">{(['male','female'] as const).map(s=><button type="button" key={s} className="fk-chip" aria-pressed={s===sex} onClick={()=>setSex(s)}>{s==='male'?'男版':'女版'}</button>)}</div></header><p className="keep mt-2 text-sm text-muted">人物外形偏好与身体实测分开保存。合格3D到位前显示同角色参考图。</p><ShapeSim3D key={sex} sex={sex} cur={{kg:latest?.weight??null,bf:latest?.fat??null}} tgt={{kg:null,bf:null}}/></section>
}

// Compact diet-page view shows the same approved design reference until the new rig exists.
export function Model({profile,yaw=0}:{profile:{sex:string;heightCm?:number;massKg?:number;bodyFatPct?:number;frame?:number};yaw?:number;frameHeight?:number;onYaw?:(v:number)=>void}){
 const gender=profile.sex==='female'?'female':'male'
 const view = Math.abs(yaw) >= 2.5 ? 'back' : Math.abs(yaw) > .9 ? 'side' : Math.abs(yaw) > .1 ? 'three' : 'front'
 return <FangkunHealthCharacter gender={gender} view={view} appearance={loadAvatar(gender).base}/>
}
