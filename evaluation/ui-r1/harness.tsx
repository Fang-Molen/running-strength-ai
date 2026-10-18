import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TodayChecklist} from '../../src/components/today-checklist';
import {DecimalInput} from '../../src/components/decimal-input';
import {setStoreBackend} from '../../src/lib/core/storage';
import '../../src/styles.css';
setStoreBackend(localStorage);
const course=(id:string)=>({id,name:'合成验收课程 '+id,moves:[{id:'qa-m1',catalogId:'back-squat',sets:2,amount:8,weightKg:12,restSec:30,mode:'reps',name:'合成深蹲'}]});
const a=course('qa-A'),b=course('qa-B');
function Harness(){
 const [selected,setSelected]=useState('A'),[amount,setAmount]=useState<number|null>(100),[grams,setGrams]=useState<number|null>(null);
 return <main style={{padding:16,maxWidth:600,margin:'auto'}}><h1>合成数据组件验收 · 非真实运动员</h1>
 <button onClick={()=>setSelected(selected==='A'?'B':'A')}>切换课程</button><p id="course">{selected}</p>
 <TodayChecklist date={selected==='A'?'2026-10-17':'2026-10-16'} slotId={'qa-'+selected} session={(selected==='A'?a:b) as never} runTitle="合成跑步" onOpenRun={()=>{}} onOpenFull={()=>{}} onAskCoach={()=>{}}/>
 <form onSubmit={e=>{e.preventDefault();setGrams(amount)}}><label>食物份量<DecimalInput aria-label="合成份量" value={amount} min={.01} max={10000} onCommit={setAmount}/></label><button>确认份量</button></form><output id="amount">{grams===null?'未保存':grams}</output>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
