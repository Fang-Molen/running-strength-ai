import { useEffect, useState } from 'react'
import type { Plan } from '@/lib/strength/model'
import { currentAthleteId } from '@/lib/core/events'
import { listReviewSessions, plannedRepeatsFor, type ReviewSessionOption } from '@/lib/coach/review-view/host'
import { plainReview } from '@/lib/coach/review-view/plain-review'
import { CoachReviewPlain } from './coach-review-plain'
import { readOfflineWorkspace } from '@/lib/core/coach-offline-workspace'
import { emptyOfflineProfile, readOfflineProfile, saveOfflineProfile, readOfflineHistory, saveOfflineReview, saveOfflineFeedback, saveLinkedHypothesisObservation, offlineAthletePortrait, type OfflineProfile, type OfflineReview, type ReviewHistory } from '@/lib/core/coach-offline-loop'
import { researchIntakeAudit } from '@/lib/core/coach-research-index'
import { observationProtocolKey, type LinkedObservation } from '@/lib/core/coach-development-projection'
import { CoachAbilityPanel } from './coach-ability-panel'

export function CoachOfflineLoopPanel({plan,revision}:{plan:Plan;revision:number}){
 const [profile,setProfile]=useState<OfflineProfile>(()=>emptyOfflineProfile(currentAthleteId()))
 const [selected,setSelected]=useState('')
 const [picked,setPicked]=useState(false)
 const [sessions,setSessions]=useState<ReviewSessionOption[]>([])
 const [review,setReview]=useState<OfflineReview|null>(null)
 const [history,setHistory]=useState<ReviewHistory[]>([])
 const [tick,setTick]=useState(0),[notice,setNotice]=useState(''),[note,setNote]=useState('')
 const [verdict,setVerdict]=useState<'SUPPORT'|'CONTRADICT'|'UNKNOWN'|'REJECT'>('UNKNOWN')
 const [reviewId,setReviewId]=useState<string|null>(null)
 const refresh=()=>setTick(n=>n+1)
 useEffect(()=>{const id=currentAthleteId();setProfile(readOfflineProfile(id)?.profile??emptyOfflineProfile(id));setHistory(readOfflineHistory(id));const list=listReviewSessions(plan);setSessions(list);if(!picked)setSelected(s=>s&&list.some(o=>o.id===s)?s:list[0]?.id??'')},[plan,revision,tick,picked])
 useEffect(()=>{
  try{setReview(readOfflineWorkspace(plan,currentAthleteId(),selected||null).review);setReviewId(null)}
  catch{setReview(null);setNotice('这次记录未能完整读取，请重试；没有覆盖已有训练。')}
 },[plan,selected,revision,tick])
 useEffect(()=>{window.addEventListener('storage',refresh);return()=>window.removeEventListener('storage',refresh)},[])
 const set=<K extends keyof OfflineProfile>(key:K,value:OfflineProfile[K])=>setProfile(p=>({...p,[key]:value}))
 const portrait=offlineAthletePortrait(readOfflineProfile(currentAthleteId()),history)
 const inputClass='mt-1 min-h-11 w-full min-w-0 rounded-card border border-line bg-bg px-2'
 return <section data-testid="offline-coach-loop" className="space-y-3 rounded-card border border-line bg-surface p-3 text-sm">
  <h3 className="font-bold">训练复盘</h3>
  <p className="keep text-xs text-muted">选一次训练，方坤在手机上直接分析，不会自动改你的课表。</p>
  <details data-testid="offline-profile"><summary className="min-h-11 cursor-pointer py-2 font-bold">我的背景（选填：主项、PB、比赛日期）</summary>
   <div className="grid grid-cols-2 gap-2">
    <label>主项<select aria-label="离线教练主项" value={profile.event??''} onChange={e=>set('event',e.target.value||null)} className={inputClass}><option value="">未知</option>{['60米','100米','200米','400米','800米','1500米','3000米','5000米','10000米','半马','马拉松'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>近期 PB（秒）<input aria-label="离线教练PB秒" type="number" value={profile.pbSeconds??''} onChange={e=>set('pbSeconds',e.target.value?Number(e.target.value):null)} className={inputClass}/></label>
    <label>PB 日期<input aria-label="离线教练PB日期" type="date" value={profile.pbOn??''} onChange={e=>set('pbOn',e.target.value||null)} className={inputClass}/></label>
    <label>计时方式<select aria-label="离线教练计时方式" value={profile.timing} onChange={e=>set('timing',e.target.value as OfflineProfile['timing'])} className={inputClass}><option value="UNKNOWN">未知</option><option value="HAND">手计时</option><option value="ELECTRONIC">电子计时</option></select></label>
    <label>年龄<input aria-label="离线教练年龄" type="number" value={profile.age??''} onChange={e=>set('age',e.target.value?Number(e.target.value):null)} className={inputClass}/></label>
    <label>性别<select aria-label="离线教练性别" value={profile.sex??'UNKNOWN'} onChange={e=>set('sex',e.target.value as OfflineProfile['sex'])} className={inputClass}><option value="UNKNOWN">未提供</option><option value="FEMALE">女性</option><option value="MALE">男性</option></select></label>
    <label>训练经历（月）<input aria-label="离线教练训练月数" type="number" value={profile.experienceMonths??''} onChange={e=>set('experienceMonths',e.target.value?Number(e.target.value):null)} className={inputClass}/></label>
    <label>比赛日期<input aria-label="离线教练比赛日期" type="date" value={profile.competitionDate??''} onChange={e=>set('competitionDate',e.target.value||null)} className={inputClass}/></label>
    <label>比赛优先级<select aria-label="离线教练比赛优先级" value={profile.competitionPriority} onChange={e=>set('competitionPriority',e.target.value as OfflineProfile['competitionPriority'])} className={inputClass}><option value="UNKNOWN">未知</option><option value="A">A · 主要目标</option><option value="B">B · 次要目标</option><option value="C">C · 练习比赛</option></select></label>
    <label className="col-span-2">本人确认的当前阶段<select aria-label="离线教练当前阶段" value={profile.stage==='基础期'?'储备/基础期':profile.stage==='备赛期'?'备赛期/减量':profile.stage} onChange={e=>set('stage',e.target.value as OfflineProfile['stage'])} className={inputClass}><option value="UNKNOWN">未知，不按比赛日期猜测</option>{['储备/基础期','冬训期','专项准备期','备赛期/减量','比赛期','过渡期'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label className="col-span-2">当前教练意图（可留空）<input aria-label="离线教练意图" value={profile.coachIntent??''} maxLength={200} onChange={e=>set('coachIntent',e.target.value||null)} className={inputClass}/></label>
   </div>
   <button type="button" className="mt-2 min-h-11 rounded-card border border-line px-3" onClick={()=>{const ok=saveOfflineProfile(profile,true);setNotice(ok?'背景已保存，旧版本仍保留。':'背景未保存，请核对数值与日期。');if(ok)refresh()}}>确认保存教练背景</button>
  </details>
  <label className="block font-bold">选一次训练<select aria-label="离线复盘课次" value={selected} onChange={e=>{setPicked(true);setSelected(e.target.value)}} className={inputClass+' font-normal'}>{sessions.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}<option value="">不选课，只聊整体情况</option></select></label>
  {!sessions.length&&<p className="keep text-xs text-muted">还没有可复盘的训练：练完一节或导入一次跑步后，这里会列出来。</p>}
  {review&&<>
   <CoachReviewPlain plain={plainReview(review,plannedRepeatsFor(review.occurrenceId),sessions.find(o=>o.id===review.occurrenceId)?.summary??null)}>
    {review.development&&<CoachAbilityPanel development={review.development}/>}
    <p className="pb-3 text-xs">知识库：已接入 {researchIntakeAudit.candidateRuleCount} 条候选规则、{researchIntakeAudit.candidateCardCount} 张候选卡（都待审核，不会自动执行）。</p>
   </CoachReviewPlain>
   <button type="button" className="min-h-11 rounded-card border border-line px-3" onClick={()=>{const r=saveOfflineReview(review);setReviewId(r.ok?r.id:null);setNotice(r.ok?'这次复盘已保存。':'分析已生成，但历史未能保存。');setHistory(readOfflineHistory(currentAthleteId()))}}>保存这次复盘</button>
  </>}
  {reviewId&&<div className="space-y-2 rounded-card border border-line p-2">
   <label className="block">下次练完，告诉方坤结果<select aria-label="离线判断反馈类型" value={verdict} onChange={e=>setVerdict(e.target.value as typeof verdict)} className={inputClass}><option value="UNKNOWN">还看不出来</option><option value="SUPPORT">和方坤说的一致</option><option value="CONTRADICT">和方坤说的不一样</option><option value="REJECT">这条建议不适合我</option></select></label>
   <textarea aria-label="离线判断反馈内容" value={note} maxLength={600} rows={2} onChange={e=>setNote(e.target.value)} placeholder="比如：这次按同样配速跑，最后一组只慢了1秒" className={inputClass}/>
   <button type="button" disabled={!note.trim()} className="min-h-11 rounded-card border border-line px-3 disabled:opacity-40" onClick={()=>{const ok=saveOfflineFeedback(currentAthleteId(),reviewId,verdict,note);setNotice(ok?'反馈已保存。':'反馈未保存，请重试。');if(ok){setHistory(readOfflineHistory(currentAthleteId()));setNote('')}}}>保存反馈</button>
  </div>}
  {reviewId&&<LinkedObservationForm key={reviewId} athleteId={currentAthleteId()} reviewId={reviewId} history={history} onSaved={()=>setHistory(readOfflineHistory(currentAthleteId()))}/>}
  <details data-testid="offline-history"><summary className="min-h-11 cursor-pointer py-2 font-bold">以前的复盘（{portrait.judgments.length}）</summary>
   {portrait.judgments.map(j=><div key={j.id} className="mb-2 break-words"><p>{j.occurrenceId?sessions.find(o=>o.id===j.occurrenceId)?.label??'一次训练':'整体情况'}</p>{j.hypotheses.map(h=>{
    const state=j.hypothesisStates.find(s=>s.id===h.id)
    const reason=state?.reviewReason??state?.changes.at(-1)?.reason
    return <p key={h.id} className="text-xs">{state?.status==='WITHDRAWN'?'旧依据已撤回':state?.status==='REVIEW_REQUIRED'?'待重审':state?.status==='WEAKENED'?'证据削弱':state?.status==='SUPPORTED'?'获得支持（待继续验证）':'待验证'} · {h.explanation}{reason?`；${reason}`:''}</p>
   })}{!j.hypotheses.length&&<p className="text-xs">仅记录事实与观察目标</p>}</div>)}
   <p className="text-xs text-muted">旧判断、新证据和反馈各自保留；不因单次表现改变长期能力评分。</p>
  </details>
  {notice&&<p role="status" className="text-xs text-muted">{notice}</p>}
 </section>
}

function LinkedObservationForm({athleteId,reviewId,history,onSaved}:{athleteId:string;reviewId:string;history:ReviewHistory[];onSaved:()=>void}){
 const [priorId,setPriorId]=useState(''),[hypothesisId,setHypothesisId]=useState(''),[sourceIds,setSourceIds]=useState<string[]>([]),[reason,setReason]=useState(''),[notice,setNotice]=useState('')
 const [outcome,setOutcome]=useState<LinkedObservation['outcome']>('INCONCLUSIVE')
 const analyses=history.filter((r):r is Extract<ReviewHistory,{kind:'ANALYSIS'}>=>r.kind==='ANALYSIS')
 const current=analyses.find(r=>r.id===reviewId)
 const protocol=current?observationProtocolKey(current.review):null
 const eligible=analyses.filter(r=>r.id!==reviewId&&protocol&&observationProtocolKey(r.review)===protocol&&current!.review.comparableOccurrenceIds.includes(r.review.occurrenceId??'')&&Date.parse(r.review.asOf)<Date.parse(current!.review.asOf)&&r.review.hypotheses.length)
 const prior=eligible.find(r=>r.id===priorId)
 const evidence=current?.review.development?.dependencies.filter(d=>d.occurrenceId===current.review.occurrenceId&&prior&&Date.parse(d.eventAt)>Date.parse(prior.review.asOf))??[]
 if(!current||current.review.safetyRestricted)return null
 const save=()=>{
  if(!protocol||!prior)return
  const ok=saveLinkedHypothesisObservation(athleteId,{sourceReviewId:prior.id,observedReviewId:current.id,hypothesisId,sourceIds,outcome,reason,protocolKey:protocol,confirmed:true,reviewer:'USER',reviewedAt:new Date().toISOString()})
  setNotice(ok?'已保存本次证据复核，旧判断与来源仍保留。':'未能保存：请核对协议、来源和时间；已撤回的判断不能重新启用。')
  if(ok)onSaved()
 }
 return <details className="rounded-card border border-line p-2"><summary className="min-h-11 cursor-pointer py-2">和以前的复盘对照（进阶）</summary>
  {!eligible.length?<p className="text-xs text-muted">暂无目的、记录方式、结构和休息均可比的历史判断。先保留观察，不自动升降能力分。</p>:<div className="space-y-2">
   <label className="block">历史判断<select className="min-h-11 w-full rounded-card border border-line bg-bg" value={priorId} onChange={e=>{setPriorId(e.target.value);setHypothesisId('');setSourceIds([])}}><option value="">选择要复核的历史记录</option>{eligible.map(r=><option key={r.id} value={r.id}>{r.review.occurrenceId} · {r.review.asOf}</option>)}</select></label>
   <label className="block">待验证问题<select className="min-h-11 w-full rounded-card border border-line bg-bg" value={hypothesisId} onChange={e=>setHypothesisId(e.target.value)}><option value="">选择具体假设</option>{prior?.review.hypotheses.map(h=><option key={h.id} value={h.id}>{h.explanation}</option>)}</select></label>
   <fieldset><legend>本次新证据</legend>{evidence.filter((d,i,a)=>a.findIndex(x=>x.sourceId===d.sourceId)===i).map(d=><label key={d.sourceId} className="flex min-h-11 items-center gap-2 break-all text-xs"><input type="checkbox" checked={sourceIds.includes(d.sourceId)} onChange={e=>setSourceIds(ids=>e.target.checked?[...ids,d.sourceId]:ids.filter(id=>id!==d.sourceId))}/>{d.sourceId} · {d.eventAt}</label>)}</fieldset>
   <label className="block">观察结果<select className="min-h-11 w-full rounded-card border border-line bg-bg" value={outcome} onChange={e=>setOutcome(e.target.value as LinkedObservation['outcome'])}><option value="INCONCLUSIVE">仍无法区分</option><option value="SUPPORT">支持这项暂定解释</option><option value="REFUTE">削弱这项解释</option></select></label>
   <label className="block">实际观察与理由<textarea className="w-full rounded-card border border-line bg-bg p-2" maxLength={600} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button type="button" className="min-h-11 rounded-card border border-line px-3 disabled:opacity-40" disabled={!hypothesisId||!sourceIds.length||!reason.trim()} onClick={save}>确认保存证据复核</button>
   {notice&&<p role="status" className="text-xs text-muted">{notice}</p>}
  </div>}
 </details>
}
