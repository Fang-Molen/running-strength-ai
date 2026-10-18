import {lazy,Suspense,useEffect,useRef,useState} from 'react'
import {mountFieldwork} from './fieldwork-v4/app.js'
import {readFieldworkState,commitFieldworkDraft,removeFieldworkDraft,commitFieldworkMeal,commitFieldworkMeasurement,saveFieldworkPreferences,type FieldworkLocale} from '@/lib/ui/fieldwork-host'
import './fieldwork-v4/styles.css'
import './fieldwork-v4/host.css'
import HomeOrderPanel from './fangkun-ui/home-order-panel'
import './fangkun-ui/ui.css'
const AtlasPanel=lazy(()=>import('./fangkun-ui/atlas-panel'))
const NutritionPanel=lazy(()=>import('./fangkun-ui/nutrition-panel'))

type Props={page:'today'|'body'|'nutrition';locale:FieldworkLocale;revision:number;onNavigate:(page:string)=>void;onOpenExercise:(id:string)=>void}
export default function FieldworkPanel(props:Props){return <Suspense fallback={<p className="p-4">正在打开页面…</p>}>{props.page==='body'?<AtlasPanel onNavigate={props.onNavigate} onOpenExercise={props.onOpenExercise}/>:props.page==='nutrition'?<NutritionPanel revision={props.revision} onNavigate={props.onNavigate}/>:<TodayPanel {...props}/>}</Suspense>}
function TodayPanel({page,locale,revision,onNavigate,onOpenExercise}:Props){
  const [orderRevision,setOrderRevision]=useState(0)
  const root=useRef<HTMLDivElement>(null),api=useRef<ReturnType<typeof mountFieldwork>|null>(null)
  const callbacks=useRef({onNavigate,onOpenExercise});callbacks.current={onNavigate,onOpenExercise}
  useEffect(()=>{
    if(!root.current)return
    api.current=mountFieldwork(root.current,{embedded:true,initialPage:page,initialState:{...readFieldworkState(),locale},
      onNavigate:next=>callbacks.current.onNavigate(next),onOpenExercise:id=>callbacks.current.onOpenExercise(id),
      onPreferencesChange:input=>{saveFieldworkPreferences(input)},onPlanAdd:commitFieldworkDraft,onPlanRemove:removeFieldworkDraft,onMealAdd:commitFieldworkMeal,onMeasurementAdd:commitFieldworkMeasurement})
    return()=>{api.current?.destroy();api.current=null}
  },[])
  useEffect(()=>{api.current?.navigate(page,false)},[page])
  useEffect(()=>{api.current?.setLocale(locale)},[locale])
  useEffect(()=>{api.current?.updateState(readFieldworkState())},[revision,orderRevision])
  return <><div ref={root} data-testid="fieldwork-view"/><HomeOrderPanel onChange={()=>setOrderRevision(v=>v+1)}/></>
}
