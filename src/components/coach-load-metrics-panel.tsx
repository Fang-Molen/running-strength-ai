import {useEffect,useState} from 'react'
import {formatLoadTrend,shiftLoadDay,validLoadDay} from '@/lib/core/coach-load-metrics'
import {calendarDate,summaryLoadTrend,type LoadSummary} from '@/lib/health/load-evidence'
import {confirmSummaryCoverage,readLoadMemory,watchLoadMemory,type LoadMemoryResult} from '@/lib/health/load-memory'
import {currentAthleteId} from '@/lib/core/events'
import {LoadEvidenceView} from './load-evidence-view'

export function CoachLoadMetricsPanel({revision=0,day}:{revision?:number;day?:string}){
 const [endDay,setEndDay]=useState(day??''),[span,setSpan]=useState(28),[opened,setOpened]=useState(false),[data,setData]=useState<LoadMemoryResult|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState(''),[selected,setSelected]=useState('')
 const update=()=>{setData(null);setConfirmed(false);setRefresh(n=>n+1)}
 useEffect(()=>{if(day)setEndDay(day);else setEndDay(shiftLoadDay(calendarDate(new Date().toISOString(),Intl.DateTimeFormat().resolvedOptions().timeZone),-1)!)},[day])
 useEffect(()=>watchLoadMemory(()=>{update();setNotice('资料已变化，汇总正在更新。')}),[])
 useEffect(()=>{if(!opened||!validLoadDay(endDay))return;setData(null);setError('');setConfirmed(false);try{const next=readLoadMemory({startDay:shiftLoadDay(endDay,1-span)!,endDay});if(next.summary.athleteId===currentAthleteId())setData(next)}catch{setError('资料读取失败，汇总待更新；未沿用旧结果或补零。')}},[opened,endDay,span,revision,refresh])
 const summary=data?.summary,visible=summary?.athleteId===currentAthleteId()?summary:null
 return <details data-testid="load-metrics-panel" className="rounded-card border border-line bg-surface p-3 text-sm" onToggle={e=>{if(e.target===e.currentTarget)setOpened(e.currentTarget.open)}}>
  <summary data-testid="load-metrics-summary" className="min-h-11 cursor-pointer py-2 font-bold">负荷变化与训练记录</summary>
  <div className="mt-2 space-y-3">
   <p data-testid="load-metrics-output" aria-live="polite">{error||(!visible?'正在读取已保存的资料。':visible.occurrences.length+' 节已记录训练；'+visible.days.filter(d=>d.sessionAU!==null).length+'/'+visible.days.length+' 天整课资料完整。空白不代表休息。')}</p>
   <div className="grid grid-cols-2 gap-2"><label>截至日期<input data-testid="load-metrics-end-day" type="date" value={endDay} onChange={e=>{setEndDay(e.target.value);setSelected('');setNotice('')}} className="block min-h-11 w-full min-w-0 rounded-card border border-line bg-bg px-2"/></label><label>查看范围<select value={span} onChange={e=>{setSpan(Number(e.target.value));setSelected('')}} className="block min-h-11 w-full rounded-card border border-line bg-bg px-2"><option value={7}>7 天</option><option value={28}>28 天</option><option value={90}>90 天</option><option value={366}>366 天</option></select></label></div>
   {visible&&<>
    <p className="text-xs text-muted">更新于 {new Date(visible.asOf).toLocaleString()} · 日期按 {visible.timeZone}，跨午夜整课归开始日。</p>
    {!!visible.gaps.length&&<p className="text-xs text-muted">{visible.gaps.join('；')}</p>}
    <LoadChart summary={visible} selected={selected} onSelect={setSelected}/>
    <details className="rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2">逐日记录、覆盖与补项</summary>
     <label className="block">选择某天<input aria-label="查当天训练依据" type="date" min={visible.startDay} max={visible.endDay} value={selected} onChange={e=>setSelected(e.target.value)} className="block min-h-11 w-full min-w-0 rounded-card border border-line bg-bg px-2"/></label>
     {selected&&<p className="my-2 text-xs">{visible.days.find(d=>d.day===selected)?.gaps.join('；')||'当天资料已核对。'}</p>}
     <LoadEvidenceView sessions={visible.occurrences.filter(o=>!selected||o.day===selected)} athleteId={visible.athleteId} rawRevisions={data!.rawRevisions} onSaved={update}/>
    </details>
    {span===28&&<details className="rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2">描述性负荷比较与算法</summary><p>{formatLoadTrend(summaryLoadTrend(visible))}</p><p className="mt-2 text-xs text-muted">整课 AU＝已核对的整课 RPE × 完整分钟。连续 28 天资料完整，才递推 7/28 天 EWMA；α＝2/(天数＋1)，以窗口首日初始化，两者包含截至日。不是疲劳、恢复或伤病概率，不设训练阈值。</p></details>}
    <details className="rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2">核对日期完整性</summary>
     <label className="flex min-h-11 items-start gap-2"><input data-testid="load-metrics-confirm" type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/><span>我已核对 {visible.startDay} 至 {visible.endDay} 所有训练均已记录；未列出训练的日期确实没有训练。本确认不会替代每节课的评分口径核对。</span></label>
     <button data-testid="load-metrics-save" type="button" disabled={!confirmed} className="min-h-11 w-full rounded-card border border-line disabled:opacity-50" onClick={()=>{try{const r=confirmSummaryCoverage(visible);if(r.ok)update();setNotice(r.reason)}catch{setNotice('确认保存失败，请刷新核对。')}}}>保存这段日期的完整性确认</button>
    </details>
    <p className="break-all text-xs text-muted">算法 {visible.algorithm} · 来源版本 {visible.sourceVersion}。个人生理基线未建立。</p>
   </>}
   <button type="button" className="min-h-11 w-full rounded-card border border-line px-3" onClick={update}>刷新并核对记录</button>
   {notice&&<p role="status" className="text-xs text-muted">{notice}</p>}
  </div>
 </details>
}
function LoadChart({summary,selected,onSelect}:{summary:LoadSummary;selected:string;onSelect:(day:string)=>void}){
 const [metric,setMetric]=useState<'AU'|'RUN'|'STRENGTH'>('AU'),values=summary.days.map(d=>metric==='AU'?d.sessionAU:metric==='RUN'?d.knownDistanceM===null?null:d.knownDistanceM/1000:d.knownStrengthSets),max=Math.max(1,...values.filter((v):v is number=>v!==null)),x=(i:number)=>12+i*576/Math.max(1,values.length-1),y=(v:number)=>118-v/max*100
 const path=values.map((v,i)=>v===null?'':(i&&values[i-1]!==null?'L':'M')+x(i)+','+y(v)).join(' ')
 return <section aria-label="训练记录曲线" className="space-y-2"><label>曲线指标<select value={metric} onChange={e=>setMetric(e.target.value as typeof metric)} className="ml-2 min-h-11 rounded-card border border-line bg-bg px-2"><option value="AU">已核对整课 AU</option><option value="RUN">已知跑步距离 km</option><option value="STRENGTH">已完成力量组数</option></select></label>
  <svg role="img" aria-label={metric+' 曲线；缺失为断点，日期按钮可查依据'} viewBox="0 0 600 142" className="w-full text-accent"><path d="M12 118H588" stroke="currentColor" opacity=".25"/><path d={path} fill="none" stroke="currentColor" strokeWidth="2"/>{values.map((v,i)=>v===null?<text key={i} x={x(i)} y={132} textAnchor="middle" fill="currentColor" fontSize="9">?</text>:<circle key={i} cx={x(i)} cy={y(v)} r="3" fill="currentColor"/>)}<text x="12" y="12" fill="currentColor" fontSize="10">{Number(max.toFixed(2))}</text></svg>
  <p className="text-xs text-muted">{metric==='AU'?'未知为断点；零值须本人确认无训练。':'仅已知记录，可能不完整。组数不代表刺激强弱或肌肉疲劳。'}点击日期查看当日依据。</p>
  <div className="flex gap-1 overflow-x-auto pb-1" aria-label="曲线日期">{summary.days.map((d,i)=><button key={d.day} type="button" aria-pressed={selected===d.day} className="min-h-11 shrink-0 rounded-card border border-line px-2 text-xs" onClick={()=>onSelect(d.day)}>{d.day.slice(5)}<br/>{values[i]===null?'未知':Number(values[i]!.toFixed(2))}</button>)}</div>
  {selected&&<div aria-live="polite"><p>{selected} · {summary.days.find(d=>d.day===selected)?.coverage==='CONFIRMED_REST'?'本人已确认无训练':'见以下已保存依据'}</p><LoadEvidenceView sessions={summary.occurrences.filter(o=>o.day===selected)}/></div>}
 </section>
}
