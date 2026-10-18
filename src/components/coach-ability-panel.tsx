import { ABILITY_METRICS, type AbilityMeasurement } from '@/lib/core/coach-ability-standard'
import type { DevelopmentProjection } from '@/lib/core/coach-development-projection'

const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value)

function Measurement({ value }: { value: AbilityMeasurement }) {
  const title = value.variant === 'PARTIAL_TRAINING_OBSERVATIONS' ? '本课已记录分段' : value.variant === 'RAW_TRAINING_SETS' ? '本课力量组次与负荷' : ABILITY_METRICS[value.metricId].title
  return <div className="mt-2 space-y-1 text-xs">
    <p>{title}：{value.status === 'UNAVAILABLE' ? '待评估' : value.value === null ? '分项记录如下' : `${number(value.value)} ${value.unit}${value.estimate ? '（模型估计）' : ''}`}</p>
    {value.status === 'RAW_AVAILABLE' && value.components.map((item, i) => <p key={`${item.id}:${i}`} className="break-words text-muted">{item.id} · {item.value === null ? '未记录' : `${number(item.value)} ${item.unit}`}</p>)}
    <details><summary className="cursor-pointer py-1 text-muted">指标口径与来源</summary>
      <p>{value.reasons.join('；')}</p>
      <p className="break-all">发生：{value.eventTime ?? '未知'}；记录：{value.recordedAt ?? '未知'}；协议：{value.protocolKey ?? '未确认'}</p>
      <p className="break-all">{value.sourceRefs.map(s => s.id).join('、')}</p>
    </details>
  </div>
}

/** The five axes are shown without a radar polygon: unknown is not zero. */
export function CoachAbilityPanel({ development }: { development: DevelopmentProjection }) {
  const { ability, observationTasks, cycleCandidate } = development
  const labels = { REC: '恢复与症状', BEH: '训练执行', COMPETITION_RESULT: '比赛成绩', COMPETITION_POINTS: '官方赛事积分', TECHNIQUE: '技术观察' }
  return <div className="space-y-3" data-testid="r184-ability-profile">
    <div className="rounded-card border border-line p-3">
      <h4 className="font-bold">五维能力 · 原始指标</h4>
      <p className="mt-1 text-xs text-muted">已有数据先展示实测记录。当前没有核准的能力评分标准，缺少数据的维度保留待评估。</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {ability.axes.map(axis => <div key={axis.id} className="min-w-0 rounded-card border border-line p-2">
          <p className="font-bold">{axis.label} · {axis.status}</p>
          {axis.measurements.map(m => <Measurement key={m.id} value={m} />)}
        </div>)}
      </div>
      {ability.changes.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2">个人历史变化</summary>
        {ability.changes.map((change, i) => <p key={`${change.measurementId}:${i}`} className="text-xs">
          {ability.axes.flatMap(a => a.measurements).find(m => m.id === change.measurementId)?.metricId ?? '记录'}：
          {change.comparison.status === 'AVAILABLE' ? `观测变化 ${number(change.comparison.delta!)}${change.comparison.percent === null ? '' : `（${number(change.comparison.percent)}%）`}` : '不可比'}。{change.comparison.reason}
        </p>)}
      </details>}
      {ability.independent.map(domain => <details key={domain.domain}>
        <summary className="min-h-11 cursor-pointer py-2">{labels[domain.domain]} · {domain.measurements.length ? '有记录' : '待评估'}</summary>
        {domain.measurements.map(m => <Measurement key={m.id} value={m} />)}
        <p className="text-xs text-muted">独立于五维能力，不合成能力分。</p>
      </details>)}
    </div>
    <div className="rounded-card border border-line p-3" data-testid="r184-observation-tasks">
      <h4 className="font-bold">下一次观察目标</h4>
      {observationTasks.map(task => <div key={task.id} className="mt-2 space-y-1 text-xs">
        <p>{task.status === 'SAFETY_HOLD' ? '先处理安全限制' : task.courseId ? '已有批准课程可供确认' : '先补充观察记录'}：{task.reason}</p>
        <p>记录：{task.metrics.join('；')}。</p>
        <p>支持条件：{task.supportOutcome}</p><p>削弱条件：{task.refuteOutcome}</p>
        <p>不应执行：{task.doNotExecute.join('；')}。</p>
      </div>)}
      <p className="mt-2 text-xs text-muted">调整候选：{cycleCandidate.reason} 比赛优先级 {cycleCandidate.competitionPriority === 'UNKNOWN' ? '未确认' : cycleCandidate.competitionPriority}。正式计划尚未改变。</p>
    </div>
    <details><summary className="min-h-11 cursor-pointer py-2">技术、力量与比赛预测的边界</summary>
      <p className="text-xs">{development.transfer.physiologicalInterpretations.join('；')}</p>
      <p className="text-xs">{development.prediction.reason}</p>
    </details>
  </div>
}
