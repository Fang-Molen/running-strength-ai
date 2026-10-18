import { useState } from 'react'
import { demoData } from '@/lib/strength/demo/provider'
import { FangkunExerciseVideo } from './fangkun-unified-video'
import type { Gender } from '@/lib/character/identity'
import './exercise-demo.css'
/** Shared by library, training execution and plan editor; exact catalogue ID is retained. */
export default function ExerciseDemo({catalogId,onAdd}:{catalogId:string;onAdd?:()=>void;compact?:boolean}){
 const [gender,setGender]=useState<Gender>('male')
 const exercise=demoData.exercises.find(e=>e.id===catalogId)
 if(!exercise)return <p className="keep text-sm text-muted">没有本动作对应演示；请核对动作编号与文字要领。</p>
 return <section className="fk-demo fk-demo-unified" aria-label={`${exercise.name_zh}演示`}>
  <div className="ctrl" role="group" aria-label="新版人物">{(['male','female'] as const).map(g=><button type="button" key={g} aria-pressed={gender===g} onClick={()=>setGender(g)}>{g==='male'?'男性':'女性'}</button>)}</div>
  <FangkunExerciseVideo exerciseId={catalogId} title={exercise.name_zh} gender={gender}/>
  {onAdd&&<button type="button" className="add" onClick={onAdd}>加入今天训练</button>}
 </section>
}
