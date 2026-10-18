import { useEffect, useState } from 'react'
import { currentAthleteId } from '@/lib/core/events'
import { calendarDay } from '@/lib/core/coach-calendar'
import { readCoachReviewWorkspace } from '@/lib/core/coach-review-workspace'
import { formatPeriodReview } from '@/lib/core/coach-period-review'
import { saveCoachContextMemory, withdrawCoachMemory, COACH_MEMORY_UPDATED_EVENT, type CoachContextMemory } from '@/lib/core/coach-context-memory'
import type { CoachInputSummary } from '@/lib/core/coach-input-summary'
import { listConfirmedDeviceEvidence } from '@/lib/core/device-evidence-idb'

export function CoachIntegrationPanel({ revision, prepareInput }: { revision: number; prepareInput: () => CoachInputSummary }) {
  const [days, setDays] = useState(7)
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState<ReturnType<typeof readCoachReviewWorkspace> | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<CoachContextMemory['kind']>('PREFERENCE')
  const [expiresOn, setExpiresOn] = useState('')
  const [notice, setNotice] = useState('')
  const [input, setInput] = useState<CoachInputSummary | null>(null)
  useEffect(() => {
    let active = true
    void (async () => { try {
      const asOf = new Date().toISOString()
      let failed = false
      const devices = await listConfirmedDeviceEvidence().catch(() => { failed = true; return [] })
      if (!active) return
      setView(readCoachReviewWorkspace(currentAthleteId(), calendarDay(asOf)!, days, asOf, devices, failed))
      setError('')
    } catch { if (active) { setView(null); setError('记录暂时无法完整读取，请稍后重试；没有修改已有数据。') } } })()
    return () => { active = false }
  }, [days, revision, refresh])
  useEffect(() => {
    const update = () => { setRefresh(n => n + 1); setInput(null) }
    window.addEventListener('storage', update)
    window.addEventListener('focus', update)
    window.addEventListener(COACH_MEMORY_UPDATED_EVENT, update)
    // Expiration is rechecked while the panel remains open, including across midnight.
    const timer = window.setInterval(update, 60_000)
    return () => { window.removeEventListener('storage', update); window.removeEventListener('focus', update); window.removeEventListener(COACH_MEMORY_UPDATED_EVENT, update); window.clearInterval(timer) }
  }, [])
  return <section data-testid="coach-integration" className="space-y-3 rounded-card border border-line bg-surface p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-bold">周期复盘与安排偏好</h3>
      <select aria-label="复盘范围" value={days} onChange={e => setDays(Number(e.target.value))} className="min-h-11 rounded-card border border-line bg-bg px-2">
        <option value={7}>最近 7 天</option><option value={28}>最近 28 天</option>
      </select>
    </div>
    {error && <p role="alert">{error}</p>}
    {view && <>
      {view.safety !== 'NONE' && view.safetyMessage && <p className="rounded-card border border-line p-2">{view.safetyMessage}</p>}
      <p data-testid="period-review" className="whitespace-pre-line">{formatPeriodReview(view.period)}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 font-bold">查看观察依据与力量工作组</summary>
        <p className="text-xs text-muted">可用记录 {view.sourceCounts.visible} 条；排除 {view.sourceCounts.excluded} 条；冲突或待核对 {view.sourceCounts.conflicts} 条；提交时间未知 {view.sourceCounts.unknownCommitTime} 条。日期按北京时间归属。</p>
        {view.period.trends.map((trend, i) => <p key={i} className="mt-2 break-words">同协议观察：{trend.protocol} · {trend.values.join(' → ')} {trend.unit}。只说明记录变化。</p>)}
        {view.period.recoveryClues.map((clue, i) => <p key={`${clue.sourceId}:${i}`} className="mt-2 break-words">{clue.day} · {clue.kind === 'RHR' ? '静息心率' : '睡眠'} {clue.value} {clue.unit} · {clue.method} · 仅作线索</p>)}
        {view.strength.length ? view.strength.map(review => <p key={review.occurrenceId} className="mt-2">力量记录：{review.candidate.reason}</p>) : <p className="mt-2">该范围暂无可复盘的力量工作组记录。</p>}
        <p className="mt-2 break-all text-xs text-muted">来源：{view.period.sourceIds.join('、') || '暂无执行来源'}</p>
      </details>
    </>}
    <details data-testid="coach-preferences"><summary className="min-h-11 cursor-pointer py-2 font-bold">记住我的安排偏好</summary>
      <p className="mb-2 text-xs text-muted">只保存你明确填写的偏好与临时安排；每次回答最多使用最近 8 条有效偏好，历史仍保留。身体不适请在身体反馈中记录；这里不会修改训练事实或计划。</p>
      {view?.memory.active.map(entry => <div key={entry.id} className="mb-2 flex items-start gap-2 rounded-card border border-line p-2">
        <p className="min-w-0 flex-1 break-words">{entry.text}<span className="mt-1 block text-xs text-muted">本人明确保存 · {calendarDay(entry.recordedAt)}{entry.expiresOn ? ` · 有效至 ${entry.expiresOn}` : ' · 持续有效，可撤回'}</span></p>
        <button type="button" aria-label={`撤回偏好：${entry.text}`} className="min-h-11 shrink-0 px-2" onClick={() => {
          const ok = withdrawCoachMemory(currentAthleteId(), entry.id)
          if (ok) setView(current => current ? { ...current, memory: { ...current.memory, active: current.memory.active.filter(n => n.id !== entry.id) } } : current)
          setNotice(ok ? '已撤回，后续请求不再使用这条偏好。' : '未能撤回，请刷新后重试。')
          setRefresh(n => n + 1); setInput(null)
        }}>撤回</button>
      </div>)}
      {!!view?.memory.excluded.length && <p className="mb-2 text-xs text-muted">{view.memory.excluded.length} 条记录已过期、撤回或因来源变化而停用。</p>}
      <label className="block">偏好类型<select aria-label="偏好类型" value={kind} onChange={e => setKind(e.target.value as CoachContextMemory['kind'])} className="ml-2 min-h-11 rounded-card border border-line bg-bg px-2"><option value="PREFERENCE">长期安排偏好</option><option value="TEMPORARY_LIMIT">临时安排限制</option></select></label>
      <textarea aria-label="安排偏好内容" value={text} onChange={e => setText(e.target.value)} maxLength={400} placeholder="例如：周三晚上无法训练，希望优先安排周末" className="mt-2 w-full rounded-card border border-line bg-bg p-3" rows={2} />
      {kind === 'TEMPORARY_LIMIT' && <label className="block">有效至<input aria-label="偏好结束日期" type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)} className="mt-1 block min-h-11 w-full rounded-card border border-line bg-bg px-2" /></label>}
      <button type="button" disabled={!text.trim() || kind === 'TEMPORARY_LIMIT' && !expiresOn} className="mt-2 min-h-11 rounded-card border border-line px-3 font-bold disabled:opacity-40" onClick={() => {
        const result = saveCoachContextMemory({ athleteId: currentAthleteId(), text, kind, expiresOn: kind === 'TEMPORARY_LIMIT' ? expiresOn : null, explicitlyConfirmed: true })
        setNotice(result.reason)
        if (result.ok) { setText(''); setRefresh(n => n + 1); setInput(null) }
      }}>确认保存偏好</button>
    </details>
    <details><summary className="min-h-11 cursor-pointer py-2 font-bold">预览模型请求依据</summary>
      <p className="text-xs text-muted">按当前输入和所选单次训练生成请求预览；尚未输入问题时使用“这次训练怎么样”。此预览不包含比较与系列请求，不会上传或调用模型。</p>
      <button type="button" className="mt-2 min-h-11 rounded-card border border-line px-3" onClick={() => {
        try { setInput(prepareInput()); setNotice('') } catch { setInput(null); setNotice('无法读取请求依据，请稍后重试。') }
      }}>生成依据预览</button>
      {input && <div data-testid="coach-input-summary" className="mt-2 space-y-1 break-words text-xs">
        <p>本次预览包含 {input.personalSources.length} 个个人来源、{input.memoryCount} 条安排偏好。数据截至 {input.asOf ?? '未绑定训练快照'}。</p>
        <p>教学候选 {input.teachingCandidates} 项，待研究 {input.pendingResearch} 项；没有将其新增为已验证训练规则。</p>
        <p>{input.evidenceOmitted ? '存在遗漏或提交时间未知的记录，不能视为完整依据。' : '本次请求未报告证据截断。'}请求正文大小 {input.bytes} 字节。</p>
        <p className="break-all">个人来源：{input.personalSources.join('、') || '暂无'}</p>
      </div>}
    </details>
    {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
  </section>
}
