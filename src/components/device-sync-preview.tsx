import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from '@/lib/core/events'
import { coachImports } from '@/lib/core/coach-import-evidence'
import { crossBrandCandidates, providerOf } from '@/lib/health/brand-isolation'
import { valueText } from '@/lib/health/observation'
import { fmtDurationPrecise } from '@/lib/ui/activity-format'
import { METRIC_LABELS } from '@/lib/ui/device-parse'
import { activityDraftId, existingKeys, healthSavedKey, saveDeviceRows } from '@/lib/ui/device-store'
import { platformSync, type PlatformPreview, type RemotePlatform } from '@/lib/ui/platform-sync-runtime'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'

type ActivityConflict = { durationSec: number | null; distanceM: number | null; identityChanged: boolean }
type Choices = { a: Record<string, boolean>; h: Record<string, boolean>; duplicateA: Set<string>; conflictA: Map<string, ActivityConflict>; duplicateH: Set<string>; cross: Set<string> }
const selections = new Map<RemotePlatform, { owner: string; preview: PlatformPreview; choices: Choices }>()
if (typeof window !== 'undefined') window.addEventListener(ATHLETE_SCOPE_CHANGED, () => selections.clear())
function makeChoices(preview: PlatformPreview): Choices {
  const have = existingKeys()
  const imports = coachImports(), byDraft = new Map<string, typeof imports[number]>()
  for (const previous of imports) if (!byDraft.has(previous.draftId)) byDraft.set(previous.draftId, previous)
  const duplicateA = new Set<string>(), conflictA = new Map<string, ActivityConflict>()
  for (const activity of preview.activities) {
    const id = activityDraftId(activity)
    if (!have.activities.has(id)) continue
    const previous = byDraft.get(id)
    // Use the same immutable source totals as saveDeviceRows. A handwritten
    // correction is separate evidence and must never be replaced by this preview.
    if (activity.sourceIdentity && previous && (previous.sourceRecordIdentity !== activity.sourceIdentity || previous.durationSeconds.value !== activity.durationSec || previous.totalDistanceMeters.value !== activity.distanceM)) {
      conflictA.set(activity.key, { durationSec: previous.durationSeconds.value, distanceM: previous.totalDistanceMeters.value, identityChanged: previous.sourceRecordIdentity !== activity.sourceIdentity })
    } else duplicateA.add(activity.key)
  }
  const duplicateH = new Set(preview.health.filter(h => have.health.has(healthSavedKey(h))).map(h => h.key))
  let cross = new Set<string>()
  try {
    const incoming = preview.activities.filter(a => !duplicateA.has(a.key) && !conflictA.has(a.key)).map(a => ({ id: a.key, sport: a.sport, startedAt: a.startIso, distanceM: a.distanceM, durationSec: a.durationSec }))
    cross = new Set(crossBrandCandidates(incoming, loadTrainingActivities(), providerOf(preview.activities[0]?.sourceIdentity)).keys())
  } catch { /* unavailable history does not prove a duplicate */ }
  return { a: Object.fromEntries(preview.activities.map(a => [a.key, !duplicateA.has(a.key) && !conflictA.has(a.key) && !cross.has(a.key)])), h: Object.fromEntries(preview.health.map(h => [h.key, !duplicateH.has(h.key)])), duplicateA, conflictA, duplicateH, cross }
}
const time = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
const measuredTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const rawDistance = (value: number | null) => value === null ? '距离未提供' : `${value} m`
const sourceName = (source: string) => source.trim() || '未提供'

export function DeviceSyncPreview({ provider, owner, preview, disabled, onSaved }: { provider: RemotePlatform; owner: string; preview: PlatformPreview; disabled: boolean; onSaved: () => void }) {
  const [choices, setChoices] = useState<Choices>(() => { const last = selections.get(provider); return last?.owner === owner && last.preview === preview ? last.choices : makeChoices(preview) })
  const [limit, setLimit] = useState(20)
  useEffect(() => { const last = selections.get(provider); setChoices(last?.owner === owner && last.preview === preview ? last.choices : makeChoices(preview)); setLimit(20) }, [provider, owner, preview])
  const update = (value: Choices) => { selections.set(provider, { owner, preview, choices: value }); setChoices(value) }
  const canSelectActivity = (key: string) => !choices.duplicateA.has(key) && !choices.conflictA.has(key)
  const count = preview.activities.filter(a => choices.a[a.key] && canSelectActivity(a.key)).length + preview.health.filter(h => choices.h[h.key] && !choices.duplicateH.has(h.key)).length
  const save = () => {
    if (disabled || owner !== currentAthleteId() || platformSync.snapshot(provider).preview !== preview || platformSync.snapshot(provider).action) return
    const result = saveDeviceRows(preview.health.filter(h => choices.h[h.key] && !choices.duplicateH.has(h.key)), preview.activities.filter(a => choices.a[a.key] && canSelectActivity(a.key)))
    const message = `已保存 ${result.saved} 条${result.skipped ? `，跳过已有 ${result.skipped} 条` : ''}${result.errors.length ? `；${result.errors.slice(0, 2).join('；')}` : ''}`
    platformSync.saved(provider, message, !result.errors.length)
    if (result.errors.length) update(makeChoices(preview)); else selections.delete(provider)
    if (result.saved) onSaved()
  }
  const all = (checked: boolean) => update({ ...choices,
    a: Object.fromEntries(preview.activities.map(a => [a.key, checked && canSelectActivity(a.key) && !choices.cross.has(a.key)])),
    h: Object.fromEntries(preview.health.map(h => [h.key, checked && !choices.duplicateH.has(h.key)])),
  })
  return <div className="device-read-preview" data-testid="platform-preview">
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <h4 className="font-bold">核对本次记录</h4>
      <span className="text-sm text-muted">训练 {preview.activities.length} · 健康 {preview.health.length}</span>
    </div>
    {preview.notes.length ? <details className="device-sync-disclosure"><summary>本次读取说明（{preview.notes.length}）</summary><div className="device-sync-detail-body space-y-2 text-muted">{preview.notes.map((n, i) => <p key={i}>{n}</p>)}</div></details> : null}
    {preview.activities.length || preview.health.length ? <>
      <div className="flex gap-3"><button type="button" className="min-h-11 text-sm text-accent" onClick={() => all(true)} disabled={disabled}>选择新记录</button><button type="button" className="min-h-11 text-sm text-muted" onClick={() => all(false)} disabled={disabled}>清空选择</button></div>
      <div className="divide-y divide-line">
        {preview.activities.slice(0, limit).map(a => {
          const conflict = choices.conflictA.get(a.key)
          return <label key={a.key} className="flex min-h-14 items-start gap-3 py-3">
            <input type="checkbox" className="mt-1 size-4 shrink-0" disabled={disabled || !canSelectActivity(a.key)} checked={Boolean(choices.a[a.key]) && canSelectActivity(a.key)} onChange={e => update({ ...choices, a: { ...choices.a, [a.key]: e.target.checked } })} aria-label={`保存${a.sportLabel} ${time(a.startIso)}，来源 ${sourceName(a.source)}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{a.sportLabel} · {time(a.startIso)}</span>
              <span className="mt-1 block text-sm tabular-nums text-muted">{a.distanceM !== null ? `${(a.distanceM / 1000).toFixed(2)} km · ` : ''}{fmtDurationPrecise(a.durationSec)}{a.avgHr !== null ? ` · 心率 ${a.avgHr}` : ''}</span>
              <span className="mt-1 block break-words text-sm text-muted">来源：{sourceName(a.source)}</span>
              {conflict ? <span className="mt-1 block text-sm text-warn">
                <span className="block">来源数据已变化，未覆盖已保存记录或手填更正。</span>
                {conflict.identityChanged ? <span className="block">来源标识与已保存记录不一致。</span> : null}
                <span className="block tabular-nums">已保存：{fmtDurationPrecise(conflict.durationSec)} · {rawDistance(conflict.distanceM)}</span>
                <span className="block tabular-nums">本次：{fmtDurationPrecise(a.durationSec)} · {rawDistance(a.distanceM)}</span>
              </span> : choices.duplicateA.has(a.key) ? <span className="block text-sm text-muted">已保存</span> : choices.cross.has(a.key) ? <span className="block text-sm text-warn">可能与其他来源重复，请核对后选择</span> : null}
            </span>
          </label>
        })}
        {preview.health.slice(0, limit).map(h => {
          const measuredAt = h.observation?.measuredAt
          const hasMeasurementTime = measuredAt && Number.isFinite(Date.parse(measuredAt))
          return <div key={h.key} className="py-3">
            <label className="flex min-h-14 items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 shrink-0" disabled={disabled || choices.duplicateH.has(h.key)} checked={Boolean(choices.h[h.key]) && !choices.duplicateH.has(h.key)} onChange={e => update({ ...choices, h: { ...choices.h, [h.key]: e.target.checked } })} aria-label={`保存${h.day} ${METRIC_LABELS[h.metric]}，来源 ${sourceName(h.source)}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{METRIC_LABELS[h.metric]}{h.metric === 'HRV' && h.hrvMethod ? ` · ${h.hrvMethod}` : ''}</span>
                <span className="block text-sm text-muted">{h.day}{choices.duplicateH.has(h.key) ? ' · 已保存' : ''}</span>
                <span className="mt-1 block break-words text-sm text-muted">来源：{sourceName(h.source)}</span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">{valueText(h.metric, h.value)}</span>
            </label>
            <details className="device-sync-disclosure ml-7 text-sm">
              <summary><span>指标口径与测量时间</span><ChevronDown aria-hidden="true" /></summary>
              <div className="device-sync-detail-body space-y-2 break-words text-sm text-muted">
                <p>口径：{h.observation?.statistic || '未提供'}</p>
                <p>{hasMeasurementTime ? <>测量时间：<time dateTime={measuredAt} title={measuredAt}>{measuredTime(measuredAt)}</time></> : '测量时间未提供'}</p>
                {h.observation?.sourceId ? <p>来源标识：{h.observation.sourceId}</p> : null}
              </div>
            </details>
          </div>
        })}
      </div>
      {preview.activities.length > limit || preview.health.length > limit ? <button type="button" className="min-h-11 w-full text-sm text-accent" onClick={() => setLimit(n => n + 30)}>查看更多记录</button> : null}
      <button type="button" className="mt-3 min-h-12 w-full rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50" onClick={save} disabled={disabled || !count}>保存选中的 {count} 条</button>
    </> : null}
  </div>
}
