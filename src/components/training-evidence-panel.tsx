import { useEffect, useState } from 'react'
import { openCoachEvidenceTools } from '@/lib/core/coach-evidence-tools'
import { onAppEvent } from '@/lib/core/events'
import { HEALTH_CHANGED } from '@/lib/health/observation'
import { periodStart, validDay } from '@/lib/core/coach-period-review'
import { parseDecimalDraft } from '@/lib/ui/decimal-draft'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'
import { isGarmin, isPhone } from '@/lib/ui/log-range'

type Tools = ReturnType<typeof openCoachEvidenceTools>
type View = Extract<ReturnType<Tools['readView']>, { ok: true }>['data']
const metricNames: Record<string, string> = { SPLIT_SECONDS: '实际分段用时', STRENGTH_KG: '实际外加重量', STRENGTH_REPS: '实际次数', STRENGTH_SECONDS: '实际持续时间', REST_SECONDS: '实际休息', SESSION_RPE: '整课用力感', PAIN_SCORE: '疼痛自报', SLEEP_HOURS: '睡眠', SUBJECTIVE_RECOVERY: '主观恢复', SORENESS: '酸痛', HR_AVG_BPM: '平均心率' }

/** v77：画像只统计“开始训练”生成的执行记录；同一时段的佳明/手机记录来自同一读模型，这里明确列出数量，避免和日志列表对不上。 */
function OtherRecordsNote({ start, end }: { start: string; end: string }) {
  let rows: ReturnType<typeof loadTrainingActivities> = []
  try { rows = loadTrainingActivities().filter(r => r.date >= start && r.date <= end && !(r.sources ?? [r.source]).includes('execution')) } catch { rows = [] }
  if (!rows.length) return null
  const g = rows.filter(isGarmin).length, ph = rows.filter(r => !isGarmin(r) && isPhone(r)).length, other = rows.length - g - ph
  return <p className="keep text-xs text-muted">同期另有 {rows.length} 条记录不是“开始训练”生成的（{[g ? `佳明 ${g}` : '', ph ? `手机记录 ${ph}` : '', other ? `聊天/上传 ${other}` : ''].filter(Boolean).join('、')}），见上方训练记录；这里的画像不含它们。</p>
}
/** Read-only record drilldown: exact same frozen projection as the six local tools. */
export function TrainingEvidencePanel({ today }: { today: string }) {
  const [range, setRange] = useState('7'), [start, setStart] = useState(periodStart(today, 7)), [end, setEnd] = useState(today)
  const [tick, setTick] = useState(0), [tools, setTools] = useState<Tools | null>(null), [view, setView] = useState<View | null>(null)
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('')
  const [distance, setDistance] = useState(''), [preview, setPreview] = useState('')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const refresh = () => { setView(null); setTools(null); setSelected(null); setPreview(''); setTick(n => n + 1) }
    const off = onAppEvent(refresh)
    for (const name of ['storage', 'focus', 'fk-training-activities-changed', 'fk-health-changed', HEALTH_CHANGED]) window.addEventListener(name, refresh)
    const timer = window.setInterval(() => { if (tools && !tools.readView().ok) refresh() }, 1000)
    return () => { off(); window.clearInterval(timer); for (const name of ['storage', 'focus', 'fk-training-activities-changed', 'fk-health-changed', HEALTH_CHANGED]) window.removeEventListener(name, refresh) }
  }, [tools])
  useEffect(() => {
    setSelected(null); setPreview('')
    try {
      if (!validDay(start) || !validDay(end) || start > end || end > today) throw Error('INVALID_RANGE')
      const days = range === 'custom' ? Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1 : Number(range)
      if (days > 366) throw Error('INVALID_RANGE')
      const t = openCoachEvidenceTools(range === 'custom' ? end : today, days), next = t.readView()
      if (!next.ok) throw Error(next.code)
      setTools(t); setView(next.data); setError('')
    } catch { setTools(null); setView(null); setError('请核对日期范围（最多366天）；若记录无法读取，请稍后重试。未修改已有数据。') }
  }, [today, range, start, end, tick])
  const openRecord = (id: string) => {
    const r = tools?.invoke('read_confirmed_training_records', { occurrenceId: id })
    if (!r?.ok) { setView(null); setError('记录已变化，请刷新依据。'); return }
    setSelected(id); setPreview(''); setDistance('')
  }
  return <section className="home-card mx-3 mb-3 p-3 text-sm" aria-label="可核对的训练画像">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">训练事实画像</h2>
      <select aria-label="画像日期范围" className="min-h-11 rounded-card border border-line bg-bg px-2" value={range} onChange={e => setRange(e.target.value)}>
        <option value="7">近7天</option><option value="28">近28天</option><option value="90">近90天</option><option value="custom">自选日期</option>
      </select></div>
    {range === 'custom' && <div className="flex flex-wrap gap-2"><label>起日<input aria-label="画像起日" type="date" value={start} max={end} onChange={e => setStart(e.target.value)} className="block min-h-11 bg-bg" /></label><label>止日<input aria-label="画像止日" type="date" value={end} max={today} onChange={e => setEnd(e.target.value)} className="block min-h-11 bg-bg" /></label></div>}
    {error && <p role="alert">{error}</p>}
    {view && <>
      <p>{view.profile.start}—{view.profile.end} · 方坤执行记录 {view.profile.recordedSessions} 课 / {view.profile.recordedDays} 天</p>
      <OtherRecordsNote start={view.profile.start} end={view.profile.end} />
      <p className="text-xs text-muted">北京时间归属；当前范围可能未记全。跑步 {view.profile.runningSessions} 课、力量 {view.profile.strengthSessions} 课；混合课分别出现，不相加作总课数。</p>
      <div className="mt-2"><button type="button" aria-expanded={expanded} className="min-h-11 py-2 text-left font-bold" onClick={() => setExpanded(value => !value)}>核对事实、数据缺口与原记录</button>
      {expanded && <div>
        <p>已知分段距离：{view.profile.knownSegmentDistanceM ?? '待记录'}{view.profile.knownSegmentDistanceM !== null ? ' m' : ''} · 距离覆盖 {view.profile.distanceCoverage.known}/{view.profile.distanceCoverage.eligible} 个已读分段，不代表整课总距离。</p>
        <p>已知整课时长：{view.profile.knownMinutes === null ? '待记录' : `${Number(view.profile.knownMinutes.toFixed(2))} 分钟`} · 覆盖 {view.profile.durationCoverage.known}/{view.profile.durationCoverage.eligible} 课</p>
        <p>能力变化：{view.profile.trends.length ? '有同协议记录变化，仍需核对条件；不等于能力提升。' : '可比历史不足，待评估。'}</p>
        <p className="text-xs text-muted">正式组肌群归属待专业映射和组用途核对；不生成恢复分或训练均衡分。</p>
        <ul>{view.sessions.map(s => <li key={s.occurrenceId}><button type="button" className="min-h-11 w-full border-b border-line py-2 text-left" onClick={() => openRecord(s.occurrenceId)}>{s.day} · {s.runningSegments ? `跑步${s.runningSegments}段` : ''} {s.strengthSets ? `力量${s.strengthSets}个已记录组` : ''}{s.durationOnly ? '仅有时长记录' : ''} · 查看原依据 ›</button></li>)}</ul>
        {selected && <div className="my-2 space-y-2 rounded-card border border-line p-3" role="region" aria-label="训练原依据">
          <button type="button" className="min-h-11" onClick={() => setSelected(null)}>收起原依据</button>
          {view.rows.filter(r => r.occurrenceId === selected).map(r => <div key={r.id} className="break-words"><b>{metricNames[r.metric] ?? r.metric}：{r.value ?? '未知'} {r.unit}</b><p className="text-xs text-muted">{r.confirmation === 'CONFIRMED' ? '正式事实' : '自报/导入，未升级为正式事实'} · {r.eventAt}</p><details><summary>来源和原结构</summary><p className="break-all text-xs">{r.context} · {r.sourceId}</p></details></div>)}
          {view.running.filter(p => p.occurrenceId === selected).map(p => <div key={p.sourceId} className="rounded-card border border-line p-2"><p>{p.distanceMeters} m · {p.paceSecondsPerKm === null ? '配速未知' : `${Number(p.paceSecondsPerKm.toFixed(2))} s/km`}</p>
            <label>核对距离（米）<input aria-label={`核对距离 ${p.sourceId}`} inputMode="decimal" value={distance} onChange={e => { setDistance(e.target.value); setPreview('') }} className="min-h-11 w-full rounded-card border border-line bg-bg px-2" /></label>
            <button type="button" className="min-h-11" onClick={() => {
              const parsed = parseDecimalDraft(distance)
              if (!parsed.ok || parsed.value === null || parsed.value <= 0) { setPreview('请输入有效正数距离。'); return }
              const value = parsed.value
              const raw = view.rows.find(r => r.sourceId === p.sourceId && r.metric === 'SPLIT_SECONDS')
              const result = tools?.invoke('preview_segment_correction', { sourceId: p.sourceId, expectedDistanceM: p.distanceMeters, expectedSeconds: raw?.value, confirmedDistanceM: value })
              if (!result?.ok) { setPreview('依据已变化或无法唯一绑定，请刷新后核对。'); return }
              const data = result.data as { afterPaceSecondsPerKm: number }
              setPreview(`预览配速 ${Number(data.afterPaceSecondsPerKm.toFixed(2))} s/km；时长不变。尚未保存，没有替换正式记录。`)
            }}>只预览配速变化</button>
          </div>)}
          {preview && <p role="status">{preview}</p>}
        </div>}
        <p className="text-xs text-muted">{view.profile.unknowns.join(' ')}</p>
        <p className="mt-2 text-xs text-muted">依据截至 {new Date(view.profile.asOf).toLocaleString('zh-CN')}；更正、同步或切换主体后重新读取。</p>
      </div>}</div>
    </>}
    <button type="button" className="min-h-11 text-xs underline" onClick={() => setTick(n => n + 1)}>刷新依据</button>
  </section>
}
