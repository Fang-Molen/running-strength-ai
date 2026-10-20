import { useEffect, useState } from 'react'
import { readRecoveryProjection, type RecoveryProjection } from '@/lib/health/recovery-host-u11'
import { subscribeGlobalCoach } from '@/lib/coach/global-coach-host-v89'
import { loadHealthSnapshot, healthSummaryLine } from '@/lib/health/snapshot'
import { HealthSourceDetails } from './health-source-details'
import { MuscleRecovery3DU11 } from './muscle-recovery-3d-u11'
import './unified-recovery-u11.css'

export function UnifiedRecoveryHostU11({day,onRecord}:{day:string;onRecord:()=>void}) {
  const [tab,setTab]=useState<'system'|'muscle'>('system'),[value,setValue]=useState<RecoveryProjection|null>(null)
  const [health,setHealth]=useState<ReturnType<typeof loadHealthSnapshot>|null>(null)
  useEffect(()=>{
    const refresh=()=>{try{setValue(readRecoveryProjection(day));setHealth(loadHealthSnapshot(day))}catch{setValue(null);setHealth(null)}}
    refresh();const off=subscribeGlobalCoach(refresh);return off
  },[day])
  return <section className="home-card u11-recovery" aria-label="全身与肌肉恢复" data-revision={value?.revision??'UNAVAILABLE'}>
    <header><h2>健康与恢复</h2><span>近 72 小时训练观察</span></header>
    <div className="u11-tabs" role="group" aria-label="恢复视图">
      <button type="button" aria-pressed={tab==='system'} onClick={()=>setTab('system')}>全身 · 设备恢复</button>
      <button type="button" aria-pressed={tab==='muscle'} onClick={()=>setTab('muscle')}>肌肉 · 训练反应</button>
    </div>
    {!value?<p role="status">暂时无法读取恢复依据，请重试；未把读取失败当作正常。</p>:tab==='muscle'?<MuscleRecovery3DU11 value={value}/>:<>
      <div className="u11-device-summary">{['BODY_BATTERY','RHR'].map(metric=>{
        const v=health?.metrics.find(m=>m.metric===metric),valid=v?.state==='AVAILABLE'
        return <div key={metric}><span>{metric==='RHR'?'静息心率':'身体电量'}</span><p><b>{valid?v.current?.value??'—':'—'}</b> {metric==='RHR'?'bpm':'/100'}</p><span>{valid?'已保存日记录 · 非当前实时读数':v?.state==='CONFLICT'?'来源冲突，待核对':'暂无当日可靠记录'}</span></div>
      })}</div>
      <p className="u11-evidence">暂无可靠的逐时数据；每日均值和最高值不能拼成全天曲线。已保存的日记录继续保留。</p>
      <details className="u11-limits"><summary>查看设备来源与限制</summary>
        {health?.metrics.filter(m=>['BODY_BATTERY','RHR'].includes(m.metric)).map(m=><div key={m.metric}><p>{healthSummaryLine(m)}</p><HealthSourceDetails view={m}/></div>)}
        {value.intraday.warnings.map(w=><p key={w}>{w}</p>)}
      </details>
      <p className="text-sm text-muted">身体电量不能说明某块肌肉已恢复，也不能抵消疼痛记录。</p>
      <button type="button" className="u11-record" onClick={onRecord}>查看 / 补充健康记录 ›</button>
    </>}
  </section>
}
