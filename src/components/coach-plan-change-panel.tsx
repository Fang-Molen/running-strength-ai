import { useEffect, useRef, useState } from 'react'
import { currentAthleteId, onAppEvent } from '@/lib/core/events'
import { PLAN_EXECUTION_EVENT, type PlanExecutionDocument, type PlanProposal, type PlanExecutionReceipt } from '@/lib/coach/plan-execution/core'
import { createCoachPlanChangeController, type CoachPlanHostSnapshot } from '@/lib/coach/plan-execution/host'

const button = 'min-h-11 rounded-card border border-line px-3 py-2 text-sm font-bold disabled:opacity-50'
/** Uses existing card/details styles. All writes remain blocked until source writers,
 * complete calendar and safety inputs are genuinely coordinated by the host.
 */
export function CoachPlanChangePanel({ revision }: { revision: number | string }) {
  const controller = useRef<ReturnType<typeof createCoachPlanChangeController> | null>(null)
  const [snapshot, setSnapshot] = useState<CoachPlanHostSnapshot | null>(null)
  const [document, setDocument] = useState<PlanExecutionDocument | null>(null)
  const [selected, setSelected] = useState(''), [toDate, setToDate] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const generation = useRef(0)
  async function refresh(clearSelection = false) {
    const token = ++generation.current, owner = currentAthleteId()
    if (clearSelection) { setSnapshot(null); setDocument(null); setSelected(''); setToDate(''); setMessage('') }
    try {
      controller.current ??= createCoachPlanChangeController()
      const value = await controller.current.refresh()
      if (token !== generation.current || owner !== currentAthleteId()) return
      setSnapshot(value.snapshot)
      if (value.document.ok) setDocument(value.document.value)
      else { setDocument(null); setMessage('尚未修改。暂时无法可靠读取已保存的提案和回执，请稍后刷新核对。') }
    } catch { if (token === generation.current && owner === currentAthleteId()) { setSnapshot(null); setDocument(null); setMessage('本机资料或回执读取失败，尚未修改。') } }
  }
  useEffect(() => {
    void refresh(true)
    const changed = () => { void refresh(true) }
    window.addEventListener('storage', changed)
    window.addEventListener(PLAN_EXECUTION_EVENT, changed)
    const off = onAppEvent(changed)
    return () => { generation.current += 1; window.removeEventListener('storage', changed); window.removeEventListener(PLAN_EXECUTION_EVENT, changed); off(); controller.current?.close(); controller.current = null }
  }, [revision])
  const current = snapshot?.host.actor?.athleteId === currentAthleteId() ? snapshot : null
  const choice = current?.choices.find(row => row.key === selected) ?? null
  const executionReady = !!current && current.host.persistenceBoundary === 'COORDINATED_LOCAL' && current.host.calendarCoverage === 'COMPLETE' && current.host.readState === 'AVAILABLE' && current.host.safety === 'ALLOW_DATE_MOVE'
  const pending = current && document && document.athleteId === current.host.actor?.athleteId ? Object.values(document.proposals).filter(row => row.actor.athleteId === current.host.actor?.athleteId && row.state === 'PENDING') : []
  const receipts = current && document && document.athleteId === current.host.actor?.athleteId ? Object.values(document.receipts).filter(row => row.actor.athleteId === current.host.actor?.athleteId) : []
  async function action(run: () => Promise<{ ok: boolean; message?: string; code?: string }>, success: string) {
    if (busy || !controller.current || !current) return
    const owner = currentAthleteId(); setBusy(true)
    try {
      const result = await run()
      if (owner !== currentAthleteId()) { await refresh(true); return }
      setMessage(result.ok ? success : result.message ?? '保存结果尚未核实，请刷新查看回执后再操作。')
      await refresh()
    } catch { if (owner === currentAthleteId()) setMessage('操作或回执读取失败，尚未确认修改；请刷新核对。') }
    finally { setBusy(false) }
  }
  function preview() {
    if (!choice?.componentId) return
    void action(() => controller.current!.previewMove({ scheduleId: choice.scheduleId, componentId: choice.componentId!, toDate }), '待确认提案已保存在本机；正式安排尚未修改。')
  }
  function confirm(proposal: PlanProposal) { void action(() => controller.current!.confirm(proposal), '已取得本机执行回执；需以回读结果核对，未宣称云端同步。') }
  function undo(receipt: PlanExecutionReceipt) { void action(() => controller.current!.undo(receipt), '已取得本机撤销回执；原历史审计保留。') }
  return <details className="mt-3 rounded-card border border-line bg-surface p-3">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">调整安排与回执（待核对）</summary>
    <p className="mt-2 text-sm text-muted">尚无法可靠核对完整安排与最新状态，尚未修改。这里只核对一个未开始分项的日期差异，原课表和实际训练记录保留。</p>
    <p className="keep mt-2 text-xs text-muted" data-keep="plan-change">仅使用当前本机档案的记录。一次确认只对应这一份差异，不代表开始或完成训练，也不能解除医疗限制。</p>
    <div className="mt-3 grid gap-3">
      <label className="min-w-0 text-sm">选择日程分项
        <select aria-label="待调整的日程分项" className="mt-1 min-h-12 w-full rounded-card border border-line bg-bg px-2" value={selected} disabled={busy || !current} onChange={e => { setSelected(e.target.value); setMessage('') }}>
          <option value="">请选择归属和身份明确的分项</option>
          {current?.choices.map(row => <option key={row.key} value={row.key} disabled={!row.identityResolved || row.state !== 'NOT_STARTED'}>{row.date} · {row.title}{row.reason ? ' · 待核对/不可移动' : ''}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">拟调整到的日期
        <input aria-label="拟调整到的日期" type="date" min={current?.host.today} value={toDate} disabled={busy || !current} onChange={e => { setToDate(e.target.value); setMessage('') }} className="mt-1 min-h-12 w-full rounded-card border border-line bg-bg px-2" />
      </label>
      {choice && toDate ? <p className="rounded-card bg-bg p-2 text-sm">待核对差异：{choice.date} 移出这一个分项，{toDate} 加入同一分项。相邻安排尚未完整核定，不代表已生成可执行提案。</p> : null}
      <button type="button" className={button} disabled={busy || !executionReady || !choice?.identityResolved || choice.state !== 'NOT_STARTED' || !toDate} onClick={preview}>核对差异 / 生成待确认提案</button>
      <button type="button" className={button} disabled={busy} onClick={() => { void refresh(true) }}>刷新本机提案与回执</button>
    </div>
    {message ? <p role="status" className="mt-3 break-words text-sm">{message}</p> : null}
    {current ? <>
      <p className="keep mt-3 text-xs text-muted" data-keep="plan-change">读取截止：{current.asOf}。已明确归属的日程 {current.coverage.ownedEntries} 条，不等于实际完成课次；完整安排仍待核对。</p>
      {current.coverage.unattributedEntries ? <p className="keep mt-2 text-xs text-muted" data-keep="plan-change">另有 {current.coverage.unattributedEntries} 条旧记录尚未确认归属，未自动加入本机档案。</p> : null}
      {current.choices.filter(row => row.reason).map(row => <p key={`reason:${row.key}`} className="keep mt-2 text-xs text-muted" data-keep="plan-change">{row.title}：{row.identityResolved ? '已有开始、完成或不明执行状态，不能按未开始分项移动。' : '尚不能可靠定位到单独分项，请先核对原训练安排。'}</p>)}
    </> : <p className="keep mt-3 text-xs text-muted" data-keep="plan-change">尚无法核对当前本机档案与记录归属，旧记录不会自动认领为本人。</p>}
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">本机待确认提案（{pending.length}）</summary>
      {pending.length ? pending.map(row => <div key={row.id} className="mt-2 rounded-card bg-bg p-2 text-sm"><p>{row.move.fromDate} → {row.move.toDate}，仅这一分项。</p><p className="keep mt-1 text-xs text-muted" data-keep="plan-change">尚未生效；仍需核对完整安排与最新状态。有效至 {row.expiresAt}</p><button type="button" className={`${button} mt-2`} disabled={busy || !executionReady} onClick={() => confirm(row)}>确认这次调整（暂不可提交）</button></div>) : <p className="text-sm text-muted">没有已核实可展示的待确认提案；暂时无法读取时会提示刷新核对。</p>}
    </details>
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">本机调整记录与撤销（{receipts.length}）</summary>
      {receipts.map(row => <div key={row.id} className="mt-2 rounded-card bg-bg p-2 text-xs"><p>{row.appliedAt} · {row.kind === 'UNDO' ? '撤销修订' : '日期修订'} · {row.move.fromDate} → {row.move.toDate}</p><p className="mt-1 text-muted">仅本机回执，未声明云端同步；训练实际记录不变。</p>{row.kind === 'MOVE' ? <button type="button" className={`${button} mt-2`} disabled={busy || !executionReady} onClick={() => undo(row)}>明确撤销这次调整（当前受阻）</button> : null}</div>)}
    </details>
  </details>
}
