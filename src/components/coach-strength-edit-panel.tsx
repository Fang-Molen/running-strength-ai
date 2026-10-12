import {useMemo,useState} from 'react'
import {proposeStrengthReduction,type StrengthProposal} from '@/lib/core/coach-strength-plan-control'
import type {Plan} from '@/lib/strength/model'
export type CoachStrengthAction=(action:'APPLY'|'ROLLBACK',proposal:StrengthProposal|null,consent:{previewUnlocked:boolean;athleteConfirmed:boolean;confirmedProposalId:string|null;noCurrentPain:boolean})=>Promise<{ok:boolean;reason:string}>
export function CoachStrengthEditPanel({plan,onAction}:{plan:Plan;onAction:CoachStrengthAction}){
  const [sessionId,setSessionId]=useState('')
  const [moveId,setMoveId]=useState('')
  const [unlocked,setUnlocked]=useState(false)
  const [confirmed,setConfirmed]=useState(false)
  const [noPain,setNoPain]=useState(false)
  const [busy,setBusy]=useState(false)
  const [status,setStatus]=useState('')
  const session=plan.sessions.find(s=>s.id===sessionId)??plan.sessions[0]
  const move=session?.moves.find(m=>m.id===moveId)??session?.moves.find(m=>m.sets>1)
  const proposal=useMemo(()=>session&&move?proposeStrengthReduction(plan,session.id,move.id):null,[plan,session,move])
  const last=plan.coachEditHistory?.at(-1)
  const common={previewUnlocked:unlocked,athleteConfirmed:confirmed,confirmedProposalId:proposal?.id??null,noCurrentPain:noPain}
  async function submit(action:'APPLY'|'ROLLBACK'){
    if(busy)return
    if(!unlocked||!confirmed||!noPain)return setStatus('需要逐项确认权限、当前身体状态和本次提案')
    if(action==='APPLY'&&!proposal)return setStatus('没有可执行的减量提案')
    if(!window.confirm(action==='APPLY'?`确认将「${session?.name}」的「${move?.customName||move?.catalogId||'动作'}」从 ${proposal?.beforeSets} 组减少到 ${proposal?.afterSets} 组？\n原重量、次数、历史训练保持不变。`:'确认撤销最近一次方坤修改？将生成新的审计记录，不删除历史。'))return
    setBusy(true)
    try{const result=await onAction(action,action==='APPLY'?proposal:null,common);setStatus(result.reason);if(result.ok){setConfirmed(false);setNoPain(false)}}catch{setStatus('修改失败，未确认保存，请检查本机记录')}
    finally{setBusy(false)}
  }
  return <section className="rounded-card border border-line bg-surface p-3 text-sm" aria-label="受控力量计划修改">
    <h3 className="font-bold">方坤 · 受控力量计划减量预览</h3>
    <p className="mt-1 text-xs text-muted">当前仅支持减少一个未来力量动作的1组，不调整跑步间歇、不自动加量、不修改历史。仅在浏览器支持互斥锁、当前计划未变化时写入。</p>
    <label className="mt-2 block text-xs">选择力量课程<select value={session?.id??''} onChange={e=>{setSessionId(e.target.value);setMoveId('');setConfirmed(false)}} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2">{plan.sessions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label className="mt-2 block text-xs">选择动作<select value={move?.id??''} onChange={e=>{setMoveId(e.target.value);setConfirmed(false)}} className="mt-1 min-h-11 w-full rounded-card border border-line bg-bg px-2">{session?.moves.map(m=><option key={m.id} value={m.id}>{m.customName||m.catalogId||'自定义动作'} · {m.sets}组</option>)}</select></label>
    {proposal?<div className="mt-2 rounded-card bg-bg p-3"><p className="font-bold">原计划 {proposal.beforeSets} 组 → 提案 {proposal.afterSets} 组</p><p className="mt-1 text-xs text-muted">重量、每组次数、休息与其他动作不变。依据：用户主动要求的保守减量预览；不是已验证的个人疲劳结论。</p><p className="mt-1 break-all text-xs text-muted">提案编号：{proposal.id}</p></div>:<p className="mt-2 text-xs text-warn">此动作不足2组或无效，不能减量。</p>}
    <div className="mt-3 space-y-2 text-xs">
      <label className="flex items-start gap-2"><input type="checkbox" checked={unlocked} onChange={e=>setUnlocked(e.target.checked)}/>我知道这是独立预览权限，并允许本次受控修改</label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={noPain} onChange={e=>setNoPain(e.target.checked)}/>确认目前没有需要优先处理的疼痛、骨痛、步态改变或功能受限；如有则不执行修改</label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对上述原计划与新计划，并针对当前提案确认</label>
    </div>
    <div className="mt-3 flex gap-2"><button type="button" disabled={busy||!proposal} onClick={()=>void submit('APPLY')} className="min-h-11 flex-1 rounded-card bg-accent px-3 font-bold text-accent-fg disabled:opacity-40">确认减一组</button><button type="button" disabled={busy||last?.action!=='APPLY'} onClick={()=>void submit('ROLLBACK')} className="min-h-11 rounded-card border border-line px-3 disabled:opacity-40">撤销最近修改</button></div>
    {last?<p className="mt-2 text-xs text-muted">最近审计：{last.action} · 修订 {last.revision} · {last.timestamp}，历史审计共 {plan.coachEditHistory?.length??0} 条</p>:null}
    {status?<p role="status" className="mt-2 rounded-card bg-surface-2 p-2 text-xs">{status}</p>:null}
    <p className="mt-2 text-xs text-muted">多标签页、旧版编辑器与断电场景尚未完成独立浏览器验证；请在修改前通过「个人与数据」备份。此功能不代替专业训练和伤病评估。</p>
  </section>
}
