import { useEffect, useMemo, useState } from 'react'
import { CoachAbilityPanel } from './coach-ability-panel'
import { readOfflineWorkspace } from '@/lib/core/coach-offline-workspace'
import { currentAthleteId, onAppEvent } from '@/lib/core/events'
import { listTrainingOccurrences } from '@/lib/core/occurrence'
import { loadPlan } from '@/lib/strength/model'
import { executionOf } from '@/lib/core/execution'
import { coachImports } from '@/lib/core/coach-import-evidence'
import { loadProfile } from '@/lib/strength/profile'
import { clockSeconds } from '@/lib/strength/agent'
import { scoreAbilities, type AxisScore, type LiftSet } from '@/lib/ui/ability-score-v76'
import { garminActivities } from '@/lib/coach/online-coach'
import { currentStore } from '@/lib/core/storage'
import { garminViewKey } from '@/lib/health/garmin-view-scope'
import { loadHealthSnapshot, healthSummaryLine } from '@/lib/health/snapshot'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'

const SIZE = 280, C = SIZE / 2, R = 92, N = 5
const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / N; return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v] as const }
const poly = (vals: (number | null)[]) => vals.flatMap((v, i) => (v == null ? [] : [pt(i, v / 100).join(',')])).join(' ')

/** 五维能力图：分数只来自你自己的成绩/训练数据；待评估维度画成虚线空心点，不当 0 分。 */
export function AbilityRadar({ axes, active, onPick }: { axes: AxisScore[]; active: number | null; onPick: (i: number) => void }) {
  const scored = axes.filter(a => a.score != null).length
  return <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[300px]" role="img" aria-label="五维能力图">
    {[0.25, 0.5, 0.75, 1].map(k => <polygon key={k} points={poly(Array(N).fill(k * 100))} fill="none" stroke="currentColor" className="text-line" strokeWidth={1} />)}
    {axes.map((d, i) => { const [x, y] = pt(i, 1); return <line key={d.key} x1={C} y1={C} x2={x} y2={y} stroke="currentColor" className="text-line" strokeDasharray={d.score == null ? '3 3' : undefined} /> })}
    {scored >= 3 ? <polygon points={poly(axes.map(d => d.score))} fill="currentColor" fillOpacity={0.18} stroke="currentColor" className="text-accent" strokeWidth={2} strokeLinejoin="round" /> : scored === 2 ? <polyline points={poly(axes.map(d => d.score))} fill="none" stroke="currentColor" className="text-accent" strokeWidth={2} /> : null}
    {axes.map((d, i) => {
      const [x, y] = d.score != null ? pt(i, d.score / 100) : pt(i, 1), [lx, ly] = pt(i, 1.24), on = active === i
      return <g key={d.key} role="button" tabIndex={0} aria-label={`${d.label} ${d.score != null ? d.score + ' 分' : '待评估'}`} aria-pressed={on} onClick={() => onPick(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i) } }} className="cursor-pointer outline-none">
        <circle cx={lx} cy={ly} r={24} fill="transparent" />
        {d.score != null ? <circle cx={x} cy={y} r={on ? 5.5 : 4} fill="currentColor" className="text-accent" /> : <circle cx={x} cy={y} r={4.5} fill="none" stroke="currentColor" strokeDasharray="2 2" className="text-muted" />}
        <text x={lx} y={ly - 2} textAnchor="middle" fontSize={12} fontWeight={on ? 700 : 600} fill="currentColor" className={d.score != null ? (on ? 'text-accent' : 'text-fg') : 'text-muted'}>{d.label}</text>
        <text x={lx} y={ly + 12} textAnchor="middle" fontSize={11} fill="currentColor" className="text-muted">{d.score != null ? d.score : '待评估'}</text>
      </g>
    })}
  </svg>
}
function liftSets(): LiftSet[] {
  const out: LiftSet[] = []
  try { for (const s of loadPlan()?.sessions ?? []) for (const r of executionOf(s.id).sets) if (r.completed && !r.skipped && r.mode === 'reps' && r.timestamp) out.push({ name: r.name, weightKg: r.actualWeight, reps: r.actualAmount, date: r.timestamp.slice(0, 10) }) } catch { /* none */ }
  try { for (const x of coachImports()) for (const s of x.strengthSets) if (s.completion === 'COMPLETED' && x.occurredAt.value) out.push({ name: s.exerciseName.value ?? '', weightKg: s.weightKg.value, reps: s.repetitions.value, date: x.occurredAt.value.slice(0, 10) }) } catch { /* none */ }
  return out
}
export function loadAbilityInput(asOf: string) {
  const p = loadProfile()
  let laps: Record<string, { dist: number | null; dur: number | null }[]> = {}
  try { laps = JSON.parse(currentStore()?.getItem(garminViewKey('fk-garmin-laps-v1')) ?? '{}') } catch { /* none */ }
  const bw = Number(p.weightKg)
  return { asOf, marks: p.marks.map(m => ({ meters: m.meters, recentSec: clockSeconds(m.recent ?? ''), goalSec: clockSeconds(m.goal ?? '') })), acts: garminActivities(), laps, lifts: liftSets(), bodyWeightKg: Number.isFinite(bw) && bw > 25 && bw < 250 ? bw : null }
}
export function AbilityRadarCard({ asOf }: { asOf: string }) {
  const [revision, refresh] = useState(0)
  useEffect(() => { const update = () => refresh(n => n + 1), off = onAppEvent(update); for (const n of ['storage', 'fk-schedule-changed', 'fk-garmin-synced']) window.addEventListener(n, update); return () => { off(); for (const n of ['storage', 'fk-schedule-changed', 'fk-garmin-synced']) window.removeEventListener(n, update) } }, [])
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10)
  const axes = useMemo(() => scoreAbilities(loadAbilityInput(date)), [date, revision])
  const first = axes.findIndex(a => a.score != null)
  const [active, setActive] = useState<number | null>(first >= 0 ? first : 0)
  const d = active != null ? axes[active] : null
  const pending = axes.filter(a => a.score == null)
  const others = useMemo(() => {
    const out: { group: string; lines: string[] }[] = []
    try { const snap = loadHealthSnapshot(date); out.push({ group: '恢复', lines: snap.metrics.filter(m => ['SLEEP', 'RHR', 'HRV'].includes(m.metric)).map(m => healthSummaryLine(m).split('；')[0]) }) } catch { out.push({ group: '恢复', lines: ['缺记录'] }) }
    try { const start = new Date(Date.parse(date + 'T00:00:00Z') - 27 * 864e5).toISOString().slice(0, 10); const rows = loadTrainingActivities().filter(r => r.date >= start && r.date <= date); out.push({ group: '训练执行', lines: [`近 28 天 ${rows.length} 条训练记录（跑步 ${rows.filter(r => r.sport === 'RUNNING').length} · 力量 ${rows.filter(r => r.sport === 'STRENGTH').length}）`] }) } catch { out.push({ group: '训练执行', lines: ['缺记录'] }) }
    const m = loadProfile().marks.filter(x => x.recent); out.push({ group: '比赛成绩', lines: m.length ? m.map(x => `${x.meters} 米 最近 ${x.recent}${x.goal ? ` · 目标 ${x.goal}` : ''}`) : ['缺记录：在个人资料填最近比赛/测试成绩'] })
    out.push({ group: '技术观察', lines: ['缺记录：可在训练记录里写跑姿/动作观察，方坤复盘时会引用'] })
    return out
  }, [date, revision])
  let development; try { const id = listTrainingOccurrences().filter(o => o.startedAt && o.startedAt.slice(0, 10) <= date).at(-1)?.trainingOccurrenceId ?? null; development = readOfflineWorkspace(loadPlan(), currentAthleteId(), id, '查看能力原始指标', date === new Date().toISOString().slice(0, 10) ? new Date().toISOString() : date + 'T23:59:59.999Z').review.development } catch { /* pending */ }
  return <section className="text-sm" aria-label="我的能力五维指标" data-revision={revision}>
    <div className="md:grid md:grid-cols-[300px_1fr] md:items-start md:gap-4">
      <AbilityRadar axes={axes} active={active} onPick={setActive} />
      {d ? <div className="mt-1 rounded-card bg-surface-2 p-3" aria-live="polite" aria-label="维度详情">
        <div className="flex items-baseline justify-between gap-2"><strong className="text-base">{d.label}</strong>{d.score != null ? <strong className="text-lg">{d.score}<span className="ml-1 text-xs font-normal text-muted">/100</span></strong> : <span className="text-xs text-muted">待评估 · {d.reason}</span>}</div>
        {d.inputs.length ? <ul className="keep mt-2 space-y-1 text-xs">{d.inputs.map(x => <li key={x}>· 输入：{x}</li>)}</ul> : null}
        <p className="keep mt-2 text-xs text-muted">算法：{d.method}</p>
        {d.score == null ? <p className="keep mt-1 text-xs">{d.reasonText}</p> : null}
      </div> : null}
    </div>
    {pending.length ? <details className="mt-2"><summary className="min-h-10 cursor-pointer content-center text-xs font-bold">待评估 {pending.length} 项（{pending.map(p => p.label).join('、')}）</summary><ul className="keep space-y-1 text-xs">{pending.map(p => <li key={p.key}><b>{p.label}</b> · {p.reason}：{p.reasonText}</li>)}</ul></details> : null}
    <p className="keep mt-2 text-[11px] text-muted">分数只用你自己的成绩和训练数据算出，点每一维能看到输入和算法；没数据的维度不打分。</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="其他指标（不计入五维）">{others.map(o => <div key={o.group} className="rounded-card bg-surface-2 p-2 text-xs"><b className="block">{o.group}</b>{o.lines.map(l => <span key={l} className="keep block text-muted">{l}</span>)}</div>)}</div>
    {development ? <details className="mt-2"><summary className="min-h-10 cursor-pointer content-center text-xs font-bold">方坤能力原始指标</summary><CoachAbilityPanel development={development} /></details> : null}
  </section>
}
