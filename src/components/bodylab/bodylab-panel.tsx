import {useEffect,useRef,useState} from 'react'
import {buildAvatarSvg} from './avatar.mjs'
import {PRESETS} from './profile.mjs'
import {loadProfile} from '@/lib/strength/profile'
import './ui.css'
type Side={heightCm:number;massKg:number;bodyFatPct:number;frame:number}
type BodyScenario={sex:'male'|'female';left:Side;right:Side}
const KEY='fk-bodylab-v1'
function initial():BodyScenario{
 try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&v.left&&v.right)return v}catch{}
 const p=loadProfile();const sex=p.sex==='female'?'female':'male';const base=structuredClone(sex==='male'?PRESETS.maleweight:PRESETS.weight) as BodyScenario
 const h=Number(p.heightCm),w=Number(p.weightKg),bf=Number(p.bodyFat)
 const me={...base.left,...(h>=140&&h<=210?{heightCm:h}:{}),...(w>=35&&w<=160?{massKg:w}:{}),...(bf>0&&bf<60?{bodyFatPct:bf}:{})}
 return {sex,left:me,right:{...me}}
}
type Profile=BodyScenario['left']&{sex:string}
type Avatar={update:(profile:object)=>void;setYaw:(yaw:number)=>void;setFraming:(height:number)=>void;dispose:()=>void;error?:unknown}
type Module={AvatarViewer:new(canvas:HTMLCanvasElement,options?:{onError?:(error:unknown)=>void;onYawChange?:(yaw:number)=>void})=>Avatar}
function Model({profile,yaw,onYaw,frameHeight}:{profile:Profile;yaw:number;frameHeight:number;onYaw:(yaw:number)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),model=useRef<Avatar|null>(null),latest=useRef({profile,yaw,onYaw,frameHeight});latest.current={profile,yaw,onYaw,frameHeight}
 const [error,setError]=useState(false),[loaded,setLoaded]=useState(false)
 useEffect(()=>{let stopped=false;const url=new URL('/fangkun-bodylab/model/avatar3d.mjs',window.location.origin).href
 import(/* @vite-ignore */ url).then((module:Module)=>{if(stopped||!canvas.current)return;const avatar=new module.AvatarViewer(canvas.current,{onError:()=>{if(!stopped)setError(true)},onYawChange:y=>latest.current.onYaw(y)});model.current=avatar;avatar.setFraming(latest.current.frameHeight);avatar.update(latest.current.profile);avatar.setYaw(latest.current.yaw);if(!avatar.error)setLoaded(true)}).catch(()=>{if(!stopped)setError(true)});return()=>{stopped=true;model.current?.dispose();model.current=null}},[])
 useEffect(()=>{model.current?.update(profile)},[profile.heightCm,profile.massKg,profile.bodyFatPct,profile.frame,profile.sex])
 useEffect(()=>{model.current?.setYaw(yaw)},[yaw])
 useEffect(()=>{model.current?.setFraming(frameHeight)},[frameHeight])
 return <div className="fk-body-model" data-webgl-ready={loaded&&!error?'true':'false'}>{error?<><div className="fk-body-svg" dangerouslySetInnerHTML={{__html:buildAvatarSvg(profile,{view:'front',label:'体型二维备用示意',frameHeight})}}/><p className="fk-model-fallback" role="status">已切换为二维示意</p></>:<><canvas ref={canvas} aria-label="BodyLab参数化3D人偶"/>{!loaded?<div className="fk-model-loading" role="status">正在打开人物…</div>:null}</>}</div>
}
export default function BodyLabPanel(){
 const [scenario,setScenario]=useState<BodyScenario>(initial)
 const [yaw,setYaw]=useState(0),[view,setView]=useState('front'),[mode,setMode]=useState<'2d'|'3d'>('3d'),[edit,setEdit]=useState<'left'|'right'>('right'),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false)
 const change=(field:keyof BodyScenario['left'],value:number)=>{setScenario(s=>({...s,[edit]:{...s[edit],[field]:value}}));setDirty(true);setMessage('')}
 const selectSex=(sex:'male'|'female')=>{setScenario(s=>({...s,sex}));setDirty(true);setMessage('')}
 const selectView=(v:string)=>{setView(v);setYaw(v==='side'?Math.PI/2:v==='back'?Math.PI:0)}
 return <section className="fk-panel fk-bodylab" data-testid="bodylab"><header className="fk-heading"><div><small>BODYLAB</small><h2>体型情景</h2></div><div className="fk-segmented" aria-label="人物外观">{(['female','male'] as const).map(sex=><button key={sex} aria-pressed={scenario.sex===sex} onClick={()=>selectSex(sex)}>{sex==='female'?'女版':'男版'}</button>)}</div></header>
 <div className="fk-body-stage"><div className="fk-body-toolbar"><div className="fk-segmented" aria-label="人物展示方向">{['front','side','back'].map((v,i)=><button key={v} aria-pressed={view===v} onClick={()=>selectView(v)}>{['正面','侧面','背面'][i]}</button>)}</div><button className="fk-render-toggle" onClick={()=>setMode(mode==='3d'?'2d':'3d')}>{mode==='3d'?'切换二维':'切换三维'}</button></div>
 <div className="fk-body-pair">{(['left','right'] as const).map((side,index)=><div key={side} className="fk-body-person"><header><span>{index===0?'A':'B'}</span><div><h3>{index===0?'现在':'目标情景'}</h3><small>{scenario[side].massKg} kg · {scenario[side].heightCm} cm</small></div></header>{mode==='2d'?<div className="fk-body-svg" dangerouslySetInnerHTML={{__html:buildAvatarSvg({...scenario[side],sex:scenario.sex},{view,frameHeight:Math.max(scenario.left.heightCm,scenario.right.heightCm)/100,label:`情景${index===0?'A':'B'}假设外观`})}}/>:<Model frameHeight={Math.max(scenario.left.heightCm,scenario.right.heightCm)/100} profile={{...scenario[side],sex:scenario.sex}} yaw={yaw} onYaw={y=>{setYaw(y);setView('free')}}/>}</div>)}</div><div className="fk-stage-caption"><span>{mode==='3d'?'左右拖动 · 两侧同步旋转':'二维轮廓 · 与三维同色系'}</span><button onClick={()=>selectView('front')}>回到正面</button></div></div>
 <details className="fk-disclosure fk-body-editor"><summary>调整情景参数 <span>{dirty?'未保存':'A / B'}</span></summary><div className="fk-segmented" aria-label="编辑情景"><button aria-pressed={edit==='left'} onClick={()=>setEdit('left')}>编辑 A</button><button aria-pressed={edit==='right'} onClick={()=>setEdit('right')}>编辑 B</button></div><div className="fk-fields">{([['heightCm','身高',140,210,1,'cm'],['massKg','体重',35,160,.5,'kg'],['bodyFatPct','假设体脂率',6,48,.5,'%'],['frame','外观骨架宽窄',-1,1,.1,'']] as const).map(([field,label,min,max,step,unit])=><label key={field}><span>{label}<b>{scenario[edit][field]} {unit}</b></span><input aria-label={`${edit==='left'?'A':'B'}${label}`} type="range" min={min} max={max} step={step} value={scenario[edit][field]} onChange={e=>change(field,Number(e.target.value))}/></label>)}</div><p className="fk-note">假设体重差 {(scenario.right.massKg-scenario.left.massKg).toFixed(1)} kg；只改变示意外观。</p></details>
 <div className="fk-body-save"><button className="fkb-primary" onClick={()=>{let saved=true;try{localStorage.setItem(KEY,JSON.stringify(scenario))}catch{saved=false};setMessage(saved?'已保存':'未能保存，请保留当前参数。');if(saved)setDirty(false)}}>保存</button></div><p role="status" className="fk-status">{message}</p></section>
}
