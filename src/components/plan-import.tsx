import {ATHLETE_SCOPE_CHANGED,currentAthleteId} from '@/lib/core/events'
import type React from "react"
import { useEffect, useRef, useState } from "react"
import { FileUp } from "lucide-react"
import { loadProfile } from "@/lib/strength/profile"
import { PLAN_CHANGED_EVT } from "@/lib/plan/active-plan"
import { prepareImportCandidate, previewImport, type ImportPreview } from "@/lib/plan/plan-import"
import { stagePreparedBackup, type PreparedBackup } from '@/lib/ui/backup-center'
import { appStorage } from '@/lib/core/bulk-store'
import { BACKUP_ARCHIVE_MAX_JSON_BYTES } from '@/lib/core/backup-archive'
import { downloadRestoreCandidate } from '@/lib/vault'

/** 计划变化时重新渲染（导入、撤销、其他标签页）。 */
export function usePlanRevision(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => { const f = () => setRev(v => v + 1); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); window.addEventListener(PLAN_CHANGED_EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); window.removeEventListener(PLAN_CHANGED_EVT, f); window.removeEventListener("storage", f) } }, [])
  return rev
}

/** v89.6：通用「导入计划/备份文件」：选文件 → 预览 → 确认保存隔离候选；未应用到当前计划，无需撤销当前数据。任何用户都能用；应用不内置任何个人计划。 */
export function PlanImportPanel(_props: { onImported?: () => void }) {
  const [owner, setOwner] = useState(currentAthleteId)
  const [pv, setPv] = useState<ImportPreview | null>(null)
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null)
  const [msg, setMsg] = useState(''), [candidateId, setCandidateId] = useState('')
  const [busy, setBusy] = useState(false), running = useRef(false)
  useEffect(() => { const reset = () => { setOwner(currentAthleteId()); setPv(null); setPrepared(null); setCandidateId(''); setMsg('当前档案已切换，请重新选择导入文件。') }; window.addEventListener(ATHLETE_SCOPE_CHANGED, reset); return () => window.removeEventListener(ATHLETE_SCOPE_CHANGED, reset) }, [])
  const pick = async (file: File) => {
    setMsg(''); setPrepared(null); setPv(null); setCandidateId('')
    if (file.size > BACKUP_ARCHIVE_MAX_JSON_BYTES) { setMsg('文件超过 128 MiB 容器上限，未做任何修改。'); return }
    const subject = currentAthleteId()
    try {
      const raw = await file.text(); if (subject !== currentAthleteId()) return
      const storage = appStorage(), profile = loadProfile(), next = prepareImportCandidate(raw, storage, profile)
      if (!next.ok) { setMsg(next.reason); return }
      setOwner(subject); setPrepared(next); setPv(previewImport(raw, storage, profile))
    } catch { setMsg('文件或当前记录无法读取，尚未保存待核副本。') }
  }
  const confirm = async () => {
    if (!prepared || owner !== currentAthleteId() || running.current) return
    running.current = true; setBusy(true)
    try { const result = await stagePreparedBackup(prepared, appStorage()); setMsg(result.reason); if (result.candidateId) setCandidateId(result.candidateId); if (result.state === 'CANDIDATE_READY') { setPv(null); setPrepared(null) } }
    finally { running.current = false; setBusy(false) }
  }
  const download = async () => { try { await downloadRestoreCandidate(candidateId); setMsg('已触发待核副本下载，请确认保存位置。当前计划及资料未修改。') } catch (error) { setMsg((error as Error).message) } }
  return <div className="space-y-2" data-testid="plan-import">
    <label className="fk-orange-btn flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl font-bold"><FileUp className="size-4" />导入计划或备份
      <input type="file" accept=".json,application/json" className="sr-only" aria-label="导入计划/备份文件" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f) }} /></label>
    {pv && !pv.ok ? <p role="alert" className="keep text-sm text-risk">{pv.reason}</p> : null}
    {pv && pv.ok ? <div className="rounded-xl border border-line p-3 text-sm" data-testid="plan-import-preview">
      <b className="block">导入前预览 · {pv.preview.label}</b>
      {pv.plan ? <><p className="keep mt-1">{pv.plan.name} · {pv.plan.days} 天（{pv.plan.first} — {pv.plan.last}）</p><ul className="mt-1 list-disc pl-5 text-xs">{pv.plan.sample.map(s => <li key={s}>{s}</li>)}</ul></> : null}
      <p className="keep mt-1 text-xs text-muted">新增 {pv.preview.added} 项 · 与当前不同 {pv.preview.overwritten} 项 · 相同 {pv.preview.unchanged} 项{pv.preview.skipped ? ` · 跳过 ${pv.preview.skipped} 项` : ""}</p>
      {pv.profileChanges.length ? <p className="keep mt-1 text-xs">候选中附带以下空项默认值（当前资料不写入）：{pv.profileChanges.join("；")}（已有内容不覆盖）</p> : null}
      <p className="mt-2 text-xs text-warn">确认只保存待核副本，当前计划和资料保持原值。旧标签页写入无法证明已停止，因此尚不执行覆盖。</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={busy} className="fk-primary min-h-11" onClick={() => void confirm()}>{busy ? "正在保存…" : "确认保存待核副本"}</button><button type="button" className="fk-chip min-h-11 justify-center" onClick={() => { setPv(null); setPrepared(null) }}>取消</button></div>
    </div> : null}
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : null}
    {candidateId ? <div className="text-xs"><p className="break-all">待核副本编号：{candidateId}</p><button type="button" className="min-h-11 w-full rounded-xl border border-line" onClick={() => void download()}>下载待核副本</button></div> : null}
  </div>
}

/** 没有计划时只展示一个空状态；其他来源保留在折叠入口中。 */
export function NoPlanCard({ sourceSlot, onImported }: { sourceSlot?: React.ReactNode; onImported?: () => void }) {
  return <section className="home-card mb-3 p-4" aria-label="训练计划" data-testid="no-plan">
    <h2 className="text-lg font-bold">还没有训练计划</h2>
    <p className="keep mt-1 text-sm text-muted">导入课表，或添加一次训练。</p>
    <div className="mt-3"><PlanImportPanel onImported={onImported} /></div>
    {sourceSlot ? <details className="mt-2"><summary className="min-h-11 cursor-pointer text-sm text-muted">其他计划方式</summary>{sourceSlot}</details> : null}
  </section>
}
