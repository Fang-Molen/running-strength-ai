import {useEffect,useState} from 'react'
import {calendarDate} from '@/lib/health/load-evidence'
import {readLoadMemory,watchLoadMemory,type LoadMemoryResult} from '@/lib/health/load-memory'
import {currentAthleteId} from '@/lib/core/events'
import {LoadEvidenceView} from './load-evidence-view'
export function TrainingLoadEvidence({id,startedAt}:{id:string;startedAt:string|null}){
 const [data,setData]=useState<LoadMemoryResult|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 useEffect(()=>watchLoadMemory(()=>{setData(null);setRevision(r=>r+1)}),[])
 useEffect(()=>{setData(null);setError('');if(!startedAt){setError('训练时刻未知，无法归入日汇总。');return}try{const day=calendarDate(startedAt,Intl.DateTimeFormat().resolvedOptions().timeZone),next=readLoadMemory({startDay:day,endDay:day});if(next.summary.athleteId===currentAthleteId())setData(next)}catch{setError('训练依据读取失败，未补零。')}},[id,startedAt,revision])
 const rows=data?.summary.athleteId===currentAthleteId()?data.summary.occurrences.filter(o=>o.id===id||o.refs.some(r=>data.snapshot.facts.some(f=>f.id===r.id&&f.sourceRecordId===id))):[]
 return <details className="rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2">本节负荷依据与口径补项</summary>{error?<p role="alert">{error}</p>:!data?<p>正在核对本节记录。</p>:<LoadEvidenceView sessions={rows} athleteId={data.summary.athleteId} rawRevisions={data.rawRevisions} onSaved={()=>setRevision(r=>r+1)}/>}</details>
}
