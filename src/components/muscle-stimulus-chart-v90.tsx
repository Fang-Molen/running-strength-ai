/** Evidence-anchored but UNCALIBRATED scenario visualization, not a recovery predictor. */
import { useEffect, useMemo, useState } from 'react'
import { REGION_LABEL, type Region } from '@/lib/health/muscle-recovery-u11'
import type { RecoveryProjection } from '@/lib/health/recovery-host-u11'
import { localDay } from '@/lib/health/observation'
import { simulateMuscleStimulus, type StimulusEvidence } from '@/lib/health/muscle-stimulus-simulation-v90'
import './muscle-recovery-detail.css'

const COLORS = { main: '#ff7a28', fast: '#e9b24c', slow: '#65a7d7' }
export function MuscleStimulusChartV90({ value, region }: { value: RecoveryProjection; region: Region }) {
  const [showExample, setShowExample] = useState(false)
  useEffect(() => setShowExample(false), [region, value.revision])
  const actual = useMemo(() => {
    const row = value.review.regions.find(r => r.region === region)
    if (!row) return null
    const items: StimulusEvidence[] = [
      ...row.runEventIds.map(id => ({ id, modality: 'RUN' as const, occurredAt: value.sources.find(s => s.id === id)?.occurredAt ?? null })),
      ...row.strengthEventIds.map(id => ({ id, modality: 'STRENGTH' as const, occurredAt: value.sources.find(s => s.id === id)?.occurredAt ?? null,
        actualSets: (() => { const s = value.sources.find(x => x.id === id); return s?.regionSets?.[region] ?? s?.actualSets ?? null })() })),
    ]
    return simulateMuscleStimulus({ asOf: value.review.asOf, evidence: items })
  }, [value, region])
  const example = useMemo(() => simulateMuscleStimulus({asOf:value.review.asOf,evidence:[
    {id:'EXAMPLE_RUN',modality:'RUN',occurredAt:new Date(Date.parse(value.review.asOf)-30*3600000).toISOString()},
    {id:'EXAMPLE_LIFT',modality:'STRENGTH',actualSets:3,occurredAt:new Date(Date.parse(value.review.asOf)-18*3600000).toISOString()},
  ]}),[value.review.asOf])
  const result = actual ?? (showExample ? example : null)
  if (!result) return <section className="fk-m89-card fk-muscle-stimulus fk-muscle-stimulus-empty" aria-label="训练刺激情景图">
    <b>训练刺激情景 · {REGION_LABEL[region]}</b>
    <p className="keep text-sm text-muted">没有足够的带时间戳实际训练记录。计划动作、手表力量摘要和主观评分不能代替实际组次。</p>
    <button type="button" className="fk-h89-pill" onClick={() => setShowExample(true)}>查看纯虚构示例曲线</button>
  </section>
  const W = 330, H = 172, left = 30, right = 10, top = 15, bottom = 26
  const offsets = result.points.map(p => p.offsetHours), xmin = Math.min(...offsets), xmax = Math.max(...offsets)
  const x = (v: number) => left + (v - xmin) / (xmax - xmin) * (W - left - right)
  const y = (v: number) => top + (100 - v) / 100 * (H - top - bottom)
  const poly = (field: 'central' | 'fast' | 'slow') => result.points.map(p => `${x(p.offsetHours).toFixed(1)},${y(p[field]).toFixed(1)}`).join(' ')
  const historical = value.day < localDay()
  const referenceLabel = historical ? '所选时点' : '现在'
  return <section className="fk-m89-card fk-muscle-stimulus" aria-label="未校准训练刺激变化情景图" data-testid="muscle-stimulus-v90">
    <div className="fk-muscle-stimulus-heading"><b>训练刺激变化</b><span>{REGION_LABEL[region]}{historical ? ` · ${value.day.slice(5).replace('-', '/')}` : ''}</span></div>
    <p className="keep fk-muscle-stimulus-mode">未校准模拟 · 非疲劳百分比</p>
    {actual ? <p className="keep fk-muscle-stimulus-sources">已确认来源：跑步 {result.runningEvents} 条 · 力量 {result.strengthEvents} 条</p>
      : <p className="keep fk-muscle-stimulus-example">纯虚构示例：假设一次跑步和3组力量；不是你的训练记录，不会写入方坤数据或判断。</p>}
    <div className="fk-muscle-stimulus-periods" aria-hidden="true"><span>历史训练情景</span><span>未来模拟</span></div>
    <svg className="fk-muscle-stimulus-plot" role="img" aria-label={`训练刺激相对单位，零时刻为${historical ? `${value.day}所选时点` : '当前'}，左右两侧均为未校准情景，不是恢复百分比`} viewBox={`0 0 ${W} ${H}`}>
      <rect className="fk-muscle-stimulus-future" x={x(0)} y={top} width={x(xmax) - x(0)} height={H - top - bottom} />
      {[0, 50, 100].map(v => <g key={v}><line x1={left} x2={W-right} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeDasharray="2 5"/><text x={left-5} y={y(v)+3} textAnchor="end" fontSize="10" fill="var(--color-muted)">{v}</text></g>)}
      <line className="fk-muscle-stimulus-now" x1={x(0)} x2={x(0)} y1={top} y2={H-bottom} strokeDasharray="4 3" />
      <polyline data-series="fast" points={poly('fast')} fill="none" stroke={COLORS.fast} strokeWidth="1.7" strokeDasharray="4 3" />
      <polyline data-series="slow" points={poly('slow')} fill="none" stroke={COLORS.slow} strokeWidth="1.7" strokeDasharray="4 3" />
      <polyline data-series="central" points={poly('central')} fill="none" stroke={COLORS.main} strokeWidth="2.7" />
      {[-48,-24,0,24,48,72].filter(v => v>=xmin&&v<=xmax).map(v => <text key={v} x={x(v)} y={H-9} textAnchor="middle" fontSize="10" fill="var(--color-muted)">{v===0?referenceLabel:`${v>0?'+':''}${v}h`}</text>)}
    </svg>
    <div className="fk-muscle-stimulus-legend"><span><i style={{ borderColor: COLORS.main }} />中间情景</span><span><i className="is-dashed" style={{ borderColor: COLORS.fast }} />较快消退</span><span><i className="is-dashed" style={{ borderColor: COLORS.slow }} />较慢消退</span></div>
    <p className="keep fk-muscle-stimulus-caution">疼痛或局部功能限制应单独复核，不随模拟曲线自动解除。</p>
    <details className="fk-recovery-disclosure" data-testid="muscle-stimulus-details"><summary>来源与模拟说明</summary><div className="fk-recovery-disclosure-body">
      {actual ? <p className="keep">已确认来源：跑步 {result.runningEvents} 条、已完成力量 {result.strengthEvents} 条（按涉及这块肌群的实际组数）；以下模型参数仍未校准。</p> : null}
      <p className="keep">{result.disclaimer}</p>
      <p className="keep">模拟曲线不表示真实肌肉疲劳或恢复百分比；只有实际完成的训练可用于刺激情景，疼痛需独立核对。</p>
    </div></details>
  </section>
}
