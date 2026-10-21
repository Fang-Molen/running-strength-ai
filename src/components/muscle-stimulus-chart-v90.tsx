/** Evidence-anchored but UNCALIBRATED scenario visualization, not a recovery predictor. */
import { useEffect, useMemo, useState } from 'react'
import { REGION_LABEL, type Region } from '@/lib/health/muscle-recovery-u11'
import type { RecoveryProjection } from '@/lib/health/recovery-host-u11'
import { simulateMuscleStimulus, type StimulusEvidence } from '@/lib/health/muscle-stimulus-simulation-v90'

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
  if (!result) return <section className="fk-m89-card space-y-2" aria-label="训练刺激情景图">
    <b>训练刺激情景 · {REGION_LABEL[region]}</b>
    <p className="keep text-sm text-muted">没有足够的带时间戳实际训练记录。计划动作、手表力量摘要和主观评分不能代替实际组次。</p>
    <button type="button" className="fk-h89-pill" onClick={() => setShowExample(true)}>查看纯虚构示例曲线</button>
  </section>
  const W = 330, H = 172, left = 30, right = 10, top = 15, bottom = 26
  const offsets = result.points.map(p => p.offsetHours), xmin = Math.min(...offsets), xmax = Math.max(...offsets)
  const x = (v: number) => left + (v - xmin) / (xmax - xmin) * (W - left - right)
  const y = (v: number) => top + (100 - v) / 100 * (H - top - bottom)
  const poly = (field: 'central' | 'fast' | 'slow') => result.points.map(p => `${x(p.offsetHours).toFixed(1)},${y(p[field]).toFixed(1)}`).join(' ')
  return <section className="fk-m89-card space-y-2" aria-label="未校准训练刺激变化情景图" data-testid="muscle-stimulus-v90">
    <div className="flex items-center justify-between gap-2"><b>训练刺激变化 · {REGION_LABEL[region]}</b><span className="rounded-lg border border-orange-600 px-2 py-1 text-xs text-orange-400">未校准模拟</span></div>
    {actual ? <p className="keep text-xs text-muted">已确认来源：跑步 {result.runningEvents} 条、已完成力量 {result.strengthEvents} 条（按涉及这块肌群的实际组数）；以下模型参数仍未校准。</p>
      : <p className="keep text-xs text-orange-300">纯虚构示例：假设一次跑步和3组力量；不是你的训练记录，不会写入方坤数据或判断。</p>}
    <svg role="img" aria-label="训练刺激相对单位，零时刻为当前，右侧为未来情景，不是恢复百分比" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <rect x={x(0)} y={top} width={x(xmax) - x(0)} height={H - top - bottom} fill="#26323c" opacity=".35" />
      {[0, 50, 100].map(v => <g key={v}><line x1={left} x2={W-right} y1={y(v)} y2={y(v)} stroke="#46505a" strokeDasharray="2 5"/><text x={left-5} y={y(v)+3} textAnchor="end" fontSize="10" fill="#8f9aa6">{v}</text></g>)}
      <line x1={x(0)} x2={x(0)} y1={top} y2={H-bottom} stroke="#b2b8c2" strokeDasharray="4 3" />
      <polyline points={poly('fast')} fill="none" stroke={COLORS.fast} strokeWidth="1.7" strokeDasharray="4 3" />
      <polyline points={poly('slow')} fill="none" stroke={COLORS.slow} strokeWidth="1.7" strokeDasharray="4 3" />
      <polyline points={poly('central')} fill="none" stroke={COLORS.main} strokeWidth="2.7" />
      {[-48,-24,0,24,48,72].filter(v => v>=xmin&&v<=xmax).map(v => <text key={v} x={x(v)} y={H-9} textAnchor="middle" fontSize="10" fill="#9da7b1">{v===0?'现在':`${v>0?'+':''}${v}h`}</text>)}
    </svg>
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs"><span style={{color:COLORS.main}}>━ 中间情景</span><span style={{color:COLORS.fast}}>┄ 较快消退</span><span style={{color:COLORS.slow}}>┄ 较慢消退</span></div>
    <p className="keep text-xs text-muted">{result.disclaimer} 疼痛或局部功能限制应单独复核，不随模拟曲线自动解除。</p>
  </section>
}
