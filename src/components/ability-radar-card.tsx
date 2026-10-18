import {useEffect,useState} from 'react'
import {CoachAbilityPanel} from './coach-ability-panel'
import {readOfflineWorkspace} from '@/lib/core/coach-offline-workspace'
import {currentAthleteId,onAppEvent} from '@/lib/core/events'
import {listTrainingOccurrences} from '@/lib/core/occurrence'
import {loadPlan} from '@/lib/strength/model'
import {computeAbilities} from '@/lib/ui/ability-radar'
import {loadSchedule} from '@/lib/ui/day-schedule'
/** Reuse the approved five-axis evidence projection, instead of frequency-derived scores. */
export function AbilityRadarCard({asOf}:{asOf:string}){
 const [revision,refresh]=useState(0)
 useEffect(()=>{const update=()=>refresh(n=>n+1),off=onAppEvent(update);window.addEventListener('storage',update);window.addEventListener('fk-schedule-changed',update);return()=>{off();window.removeEventListener('storage',update);window.removeEventListener('fk-schedule-changed',update)}},[])
 const date=/^\d{4}-\d{2}-\d{2}$/.test(asOf)?asOf:new Date().toISOString().slice(0,10)
 const id=listTrainingOccurrences().filter(o=>o.startedAt && o.startedAt.slice(0,10)<=date).at(-1)?.trainingOccurrenceId??null
 let development;try{development=readOfflineWorkspace(loadPlan(),currentAthleteId(),id,'查看能力原始指标',date===new Date().toISOString().slice(0,10)?new Date().toISOString():date+'T23:59:59.999Z').review.development}catch{/* Missing formal facts remain visibly pending. */}
 const data=computeAbilities({entries:loadSchedule().entries,vitals:[],extras:[],checkins:[],tier:'pro',asOf:date})
 return <section className="home-card p-4" aria-label="我的能力五维指标" data-revision={revision}><h2 className="text-base font-bold">我的能力</h2><p className="keep mt-1 mb-3 text-xs text-muted">实测指标与个人历史 · 没有核准常模时待评估</p>{development?<CoachAbilityPanel development={development}/>:<div className="grid gap-2 sm:grid-cols-2">{data.map(d=><div key={d.key} className="rounded-xl border border-line p-3"><b>{d.label}</b><span className="ml-2 text-xs text-muted">待评估</span>{d.drivers.map(t=><p key={t} className="keep mt-2 text-xs text-muted">{t}</p>)}</div>)}</div>}</section>
}
