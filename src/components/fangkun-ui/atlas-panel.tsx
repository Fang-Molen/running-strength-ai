import {useEffect,useRef,useState} from 'react'
import {mountFangkunAtlas,type AtlasRequest} from './atlas.js'
import {readFieldworkPreferences,saveFieldworkPreferences,commitFieldworkDraft} from '@/lib/ui/fieldwork-host'
import {readUIPreferences,saveUIPreferences} from '@/lib/ui/fangkun-preferences'
import {fieldworkExercise} from '@/lib/ui/fieldwork-catalogue'
import {SECTIONS} from '@/lib/ui/fieldwork-plan-drafts'
import {todayDate} from '@/lib/nutrition/body'
import './atlas.css'
import './ui.css'
export default function AtlasPanel({onOpenExercise,onNavigate}:{onOpenExercise:(id:string)=>void;onNavigate:(page:string)=>void}){
 const root=useRef<HTMLDivElement>(null),callbacks=useRef({onOpenExercise});callbacks.current={onOpenExercise}
 const [request,setRequest]=useState<AtlasRequest|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{if(!root.current)return;const api=mountFangkunAtlas(root.current,{assetBase:'/fangkun-atlas/',gender:readFieldworkPreferences().gender,favorites:readUIPreferences().favorites,onFavoritesChange:ids=>saveUIPreferences({favorites:ids}),onGenderChange:gender=>{saveFieldworkPreferences({gender})},onRequestPlanDraft:r=>{setError('');setRequest(r)},onOpen3D:id=>callbacks.current.onOpenExercise(id)});return()=>api.destroy()},[])
 const source=request?fieldworkExercise(request.id):null
 return <><div ref={root} className="fk-atlas" data-testid="fangkun-atlas"/>{request&&source?<div className="fk-new fk-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="确认待练草稿" className="fk-dialog"><h2>{source.title}</h2><p className="fk-note">先保存为待确认草稿。组数、数量与休息未知可留空，不自动采用插画中的训练剂量。</p><form onSubmit={async e=>{e.preventDefault();if(busy)return;const fd=new FormData(e.currentTarget),num=(k:string)=>String(fd.get(k)||'').trim()===''?null:Number(fd.get(k));setBusy(true);try{const result=await commitFieldworkDraft({id:source.id,date:String(fd.get('date')),slot:String(fd.get('slot')),sets:num('sets'),amount:num('amount'),unit:String(fd.get('unit')),restSec:num('rest'),intent:'create',plannedOnly:true,expectedRevision:null});if(result.ok){setRequest(null);onNavigate('today')}else setError(result.reason)}catch{setError('未能保存，输入仍保留。')}finally{setBusy(false)}}}>
 <div className="fk-form-grid"><label>训练日期<input name="date" type="date" defaultValue={todayDate()} required/></label><label>训练环节<select name="slot" defaultValue={source.type==='strength'?'strength':'technique'}>{SECTIONS.map((s,i)=><option key={s} value={s}>{['热身','技术','主课','力量','放松'][i]}</option>)}</select></label><label>组数<input name="sets" type="number" min="1" step="1" placeholder="待确认"/></label><label>每组数量<input name="amount" type="number" min="0.1" step="any" placeholder="待确认"/></label><label>单位<select name="unit" defaultValue={source.unit}>{(source.type==='strength'?['次','s']:['m','次','s']).map(u=><option key={u}>{u}</option>)}</select></label><label>组间休息（秒）<input name="rest" type="number" min="0" placeholder="待确认"/></label></div><p role="alert">{error}</p><div className="fk-actions"><button type="button" disabled={busy} onClick={()=>setRequest(null)}>取消</button><button className="fk-primary" disabled={busy}>确认保存待练草稿</button></div></form></section></div>:null}</>
}
