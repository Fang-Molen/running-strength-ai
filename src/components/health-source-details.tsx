import { useState } from 'react'
import { saveHealthSource, type HealthMetricView } from '@/lib/health/snapshot'
import { valueText } from '@/lib/health/observation'

export function HealthSourceDetails({view}:{view:HealthMetricView}) {
  const [error,setError]=useState('')
  return <div className="space-y-2 text-xs">
    <label className="block font-bold">显示与分析使用的来源
      <select className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-2 text-sm" value={view.selectedSource??''} onChange={e=>setError(saveHealthSource(view.metric,e.target.value||null)?'':'来源选择未保存，请重试。')}>
        <option value="">自动核对（多来源时不合并）</option>
        {view.availableSources.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </label>
    {error?<p role="alert" className="text-risk">{error}</p>:null}
    {view.notes.map(n=><p key={n} className="text-muted">{n}</p>)}
    {view.candidates.map(p=><div key={p.id} className="rounded-lg border border-line p-2"><b>{valueText(p.metric,p.value)} · {p.day}</b><p className="break-words text-muted">{p.source} · {p.statistic}{p.method?` · ${p.method}`:''}</p><p className="text-muted">测量时间：{p.measuredAt||'未提供'} · 接收时间：{p.updatedAt?new Date(p.updatedAt).toLocaleString('zh-CN'):'旧记录未提供'}</p></div>)}
    {view.baseline?<p className="text-muted">比较范围 {view.baseline.start}—{view.baseline.end}，同来源 {view.baseline.count} 个记录日；缺失日不补0。变化不直接等于变好/变差。</p>:<p className="text-muted">至少3个可比记录日才显示近期参考均值；此为数据覆盖规则。</p>}
  </div>
}
