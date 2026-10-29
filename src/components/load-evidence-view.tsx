import {useState} from 'react'
import type {LoadOccurrence} from '@/lib/health/load-evidence'
import {confirmLoadMeasurement} from '@/lib/health/load-memory'

export function LoadEvidenceView({sessions,athleteId,rawRevisions={},onSaved}:{sessions:LoadOccurrence[];athleteId?:string;rawRevisions?:Record<string,string>;onSaved?:()=>void}){
 return <section className="space-y-2" aria-label="跑步与力量实际记录">
  <p className="text-xs text-muted">仅含已保存记录。已知距离不代表全部跑量；单手重量不自动乘二。候选 AU 不进入整课曲线。</p>
  {!sessions.length?<p>所选范围没有可核对的训练，不能据此认定没有训练。</p>:<ul className="max-h-96 space-y-2 overflow-y-auto">
   {sessions.map(s=><li key={s.id+':'+s.revision} className="rounded-card border border-line p-3 break-words">
    <p className="font-bold">{s.day} · {s.modalities.map(m=>({RUN:'跑步',STRENGTH:'力量',JUMP:'跳跃'}[m]??'其他训练')).join(' + ')}</p>
    {s.modalities.includes('RUN')&&<p>{s.knownDistanceM===null?'距离不完整':'已知 '+Number((s.knownDistanceM/1000).toFixed(3))+' km'}{!s.distanceComplete?' · 分段尚不完整':''}</p>}
    {s.strength.map(g=><p key={g.key} className="text-xs">{g.catalogId??'动作未识别'} · {g.side} · {g.loadBasis}：完成 {g.completedSets} 组，跳过 {g.skippedSets}，未知 {g.unknownSets}；{g.knownReps??'未知'} 次 / {g.knownHoldSeconds??'未知'} 秒；{g.knownKgReps??'未知'} kg·次{g.volumeComplete?'':'（仅已知部分）'}；RIR {g.rir.join('/')||'未知'} / 单组 RPE {g.setRpe.join('/')||'未知'}；{g.restMissing} 组休息缺失</p>)}
    <p>整课负荷：{s.sessionAU!==null?s.sessionAU+' AU（本人已核对口径）':s.candidateAU!==null?s.candidateAU+' AU（候选）':'资料不足，未知'}</p>
    {!!s.gaps.length&&<p className="text-xs text-muted">待核对：{s.gaps.join('；')}</p>}
    <details><summary className="min-h-11 cursor-pointer py-2 text-xs">训练依据与补项</summary>
     <p className="break-all text-xs">原开始时刻：{s.startedAt}；结束：{s.endedAt??'未记录'}。整课 RPE {s.sessionRpe??'未知'}；完整分钟 {s.fullSeconds===null?'未知':s.fullSeconds/60}。</p>
     <p className="break-all text-xs">{s.refs.map(r=>r.id+'@'+r.revision).join('；')}</p>
     {athleteId&&rawRevisions[s.id]&&<Measurement key={s.revision} row={s} athleteId={athleteId} revision={rawRevisions[s.id]} onSaved={onSaved}/>}
     <p className="text-xs text-muted">评分或时长缺失时，先在对应训练中补录；桌宠“补训练反馈”需选定这节训练。此处核对不会填写未知数值。</p>
    </details>
   </li>)}
  </ul>}
 </section>
}
function Measurement({row,athleteId,revision,onSaved}:{row:LoadOccurrence;athleteId:string;revision:string;onSaved?:()=>void}){
 const [at,setAt]=useState(''),[scale,setScale]=useState(''),[checked,setChecked]=useState(false),[notice,setNotice]=useState('')
 if(row.sessionAU!==null)return null
 return <fieldset className="mt-2 space-y-2 border-t border-line pt-2"><legend className="text-xs">核对整课评分口径</legend>
  <label className="block text-xs">实际采集评分时刻（本地时间）<input type="datetime-local" value={at} onChange={e=>setAt(e.target.value)} className="block min-h-11 w-full min-w-0 rounded-card border border-line bg-bg px-2"/></label>
  <label className="block text-xs">当时使用的量表<select value={scale} onChange={e=>setScale(e.target.value)} className="block min-h-11 w-full rounded-card border border-line bg-bg px-2"><option value="">请选择已知量表</option><option value="CR10">Borg CR10（确实按此量表采集）</option><option value="0-10_SESSION_RPE">应用整课 0–10（自报）</option></select></label>
  <label className="flex min-h-11 items-start gap-2 text-xs"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} className="mt-1"/>我确认本节已结束；评分针对整课，时长包含热身、休息与整理，采集时刻属实。</label>
  <button type="button" disabled={!checked||!scale||!at||row.sessionRpe===null||row.fullSeconds===null} className="min-h-11 w-full rounded-card border border-line disabled:opacity-50" onClick={()=>{try{const r=confirmLoadMeasurement({occurrenceId:row.id,day:row.day,expectedRevision:revision,ratingCollectedAt:new Date(at).toISOString(),ratingScale:scale,athleteId,fullSession:checked,completed:checked});setNotice(r.reason);if(r.ok){setChecked(false);onSaved?.()}}catch{setNotice('核对未保存，请刷新来源后重试。')}}}>保存本节口径核对</button>
  {notice&&<p role="status" className="text-xs">{notice}</p>}
 </fieldset>
}
