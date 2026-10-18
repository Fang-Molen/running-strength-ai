import {useState} from 'react'
import {HOME_MODULES,normalizeOrder,readUIPreferences,saveUIPreferences,type HomeModule} from '@/lib/ui/fangkun-preferences'
import {moveModule} from './home-order.mjs'
const names:Record<HomeModule,string>={'daily-training':'每日训练','strength-library':'力量与跑步动作库','nutrition-health':'饮食与健康'}
export default function HomeOrderPanel({onChange}:{onChange:()=>void}){
 const [order,setOrder]=useState(readUIPreferences().homeOrder),[message,setMessage]=useState(''),[drag,setDrag]=useState<HomeModule|null>(null)
 const save=(next:HomeModule[])=>{if(saveUIPreferences({homeOrder:next})){setOrder(next);setMessage('首页显示顺序已保存');onChange()}else setMessage('保存失败，原顺序保留')}
 const move=(id:HomeModule,to:number)=>save(normalizeOrder(moveModule(order,id,to)))
 return <details className="fk-new fk-home-order"><summary>首页模块排序</summary><p className="fk-note">调整显示顺序；底部导航和训练安排保持独立。</p><ol>{order.map((id,index)=><li key={id} draggable onDragStart={()=>setDrag(id)} onDragEnd={()=>setDrag(null)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(drag)move(drag,index);setDrag(null)}}><span>{index+1}. {names[id]}</span><button type="button" aria-label={names[id]+'上移'} disabled={index===0} onClick={()=>move(id,index-1)}>↑</button><button type="button" aria-label={names[id]+'下移'} disabled={index===2} onClick={()=>move(id,index+1)}>↓</button></li>)}</ol><button type="button" onClick={()=>save([...HOME_MODULES])}>恢复默认顺序</button><p role="status">{message}</p></details>
}
