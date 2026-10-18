import { useEffect, useState } from 'react'
import { calendarDay } from '@/lib/core/coach-calendar'
import { formatLoadTrend, shiftLoadDay, type LoadTrend } from '@/lib/core/coach-load-metrics'
import { confirmLoadCoverage, readLoadTrend } from '@/lib/core/coach-load-metrics-store'

/** Read-only metric unless the user explicitly attests completeness of the selected dates. */
export function CoachLoadMetricsPanel({ revision = 0 }: { revision?: number }) {
  const [endDay, setEndDay] = useState('')
  const [latestDay, setLatestDay] = useState('')
  const [trend, setTrend] = useState<LoadTrend | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const day = shiftLoadDay(calendarDay(new Date().toISOString())!, -1)!
    setLatestDay(day)
    setEndDay(day)
  }, [])
  useEffect(() => {
    if (endDay) setTrend(readLoadTrend(endDay))
    setConfirmed(false)
  }, [endDay, revision, refresh])
  const startDay = shiftLoadDay(endDay, -27)
  return <details data-testid="load-metrics-panel" className="rounded-card border border-line bg-surface p-3 text-sm">
    <summary data-testid="load-metrics-summary" className="cursor-pointer font-bold">负荷变化提示</summary>
    <div className="mt-3 space-y-3">
      <p data-testid="load-metrics-output" aria-live="polite">{trend ? formatLoadTrend(trend) : '正在读取已保存的训练资料。'}</p>
      <label className="block">查看截至哪天的 28 天记录
        <input data-testid="load-metrics-end-day" type="date" value={endDay} max={latestDay} onChange={event => { setEndDay(event.target.value); setNotice('') }} className="mt-1 block h-11 w-full rounded-card border border-line bg-bg px-3" />
      </label>
      <p className="text-xs text-muted">仅使用本人已保存的整课 RPE × 整课分钟数（AU）。单组评分和聊天里尚未保存的评分不计入。无记录的日子需要本人确认，才按无训练处理。</p>
      {trend && <details className="rounded-card border border-line p-2">
        <summary className="cursor-pointer">逐日来源与计算方法</summary>
        <p className="mt-2 text-xs text-muted">日期按北京时间归属。需连续 28 天完整记录；短期为 7 天、长期为 28 天 EWMA，α＝2/(天数＋1)，以窗口首日负荷初始化，后续逐日递推。两者都包含所选日期；窗口之前不补零。初始化与缺漏都会影响数值，不设阈值或训练处方。</p>
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
          {trend.days.map(day => <li key={day.day}>{day.day} · {day.sessionCount} 节 · {day.au === null ? day.confirmed ? '整课数据不全' : '当天尚未核对完整' : `${Number(day.au.toFixed(2))} AU${day.sessionCount === 0 ? '（本人已确认无训练）' : ''}`}</li>)}
        </ul>
        {trend.sourceIds.length > 0 && <p className="mt-2 break-all text-xs text-muted">训练来源：{trend.sourceIds.join('、')}</p>}
      </details>}
      <label className="flex min-h-11 items-start gap-2">
        <input data-testid="load-metrics-confirm" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
        <span>我已核对 {startDay ?? '开始日期'} 至 {endDay || '结束日期'}：所有训练均已记录，整课时长包含热身、恢复与整理；没有列出训练的日期确实没有训练。</span>
      </label>
      <button data-testid="load-metrics-save" type="button" disabled={!confirmed || !startDay || !endDay || endDay > latestDay} className="min-h-11 w-full rounded-card border border-line px-3 font-bold disabled:opacity-50" onClick={() => {
        if (!confirmed || !startDay) return
        const result = confirmLoadCoverage(startDay, endDay)
        setNotice(result.reason)
        if (result.ok) { setConfirmed(false); setRefresh(value => value + 1) }
      }}>保存这段日期的完整性确认</button>
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
    </div>
  </details>
}
