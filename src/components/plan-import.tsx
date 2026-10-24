import {ATHLETE_SCOPE_CHANGED,currentAthleteId} from '@/lib/core/events'
import type React from "react"
import { useEffect, useState } from "react"
import { FileUp, Undo2 } from "lucide-react"
import { loadProfile, saveProfile } from "@/lib/strength/profile"
import { PLAN_CHANGED_EVT } from "@/lib/plan/active-plan"
import { confirmImport, previewImport, undoImport, type ImportPreview, type ImportUndo } from "@/lib/plan/plan-import"

const notify = () => { window.dispatchEvent(new Event(PLAN_CHANGED_EVT)); window.dispatchEvent(new Event("fk-schedule-changed")); window.dispatchEvent(new Event("fk-plan400-changed")) }
/** 计划变化时重新渲染（导入、撤销、其他标签页）。 */
export function usePlanRevision(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => { const f = () => setRev(v => v + 1); window.addEventListener(ATHLETE_SCOPE_CHANGED, f); window.addEventListener(PLAN_CHANGED_EVT, f); window.addEventListener("storage", f); return () => { window.removeEventListener(ATHLETE_SCOPE_CHANGED, f); window.removeEventListener(PLAN_CHANGED_EVT, f); window.removeEventListener("storage", f) } }, [])
  return rev
}

/** v89.6：通用「导入计划/备份文件」：选文件 → 预览 → 确认写入 → 可撤销。任何用户都能用；应用不内置任何个人计划。 */
export function PlanImportPanel({ onImported }: { onImported?: () => void }) {
  const [owner,setOwner]=useState(currentAthleteId)
  useEffect(()=>{const reset=()=>{setOwner(currentAthleteId());setRaw(null);setPv(null);setUndo(null);setMsg('当前档案已切换，请重新选择导入文件。')};window.addEventListener(ATHLETE_SCOPE_CHANGED,reset);return()=>window.removeEventListener(ATHLETE_SCOPE_CHANGED,reset)},[])
  const [raw, setRaw] = useState<string | null>(null), [pv, setPv] = useState<ImportPreview | null>(null)
  const [undo, setUndo] = useState<ImportUndo | null>(null), [msg, setMsg] = useState("")
  const pick = async (f: File) => {
    setMsg(""); setUndo(null)
    if (f.size > 20 * 1024 * 1024) { setMsg("文件过大（上限 20MB），未做任何修改。"); return }
    const actor=currentAthleteId(); const text = await f.text(); if(actor!==currentAthleteId())return; setOwner(actor); setRaw(text); setPv(previewImport(text, localStorage, loadProfile()))
  }
  const confirm = () => {
    if (!raw || owner!==currentAthleteId()) return
    const r = confirmImport(raw, localStorage, loadProfile(), saveProfile)
    setPv(null); setRaw(null)
    if (!r.ok) { setMsg(r.reason); return }
    setUndo(r.undo); setMsg(`已导入 ${r.restored} 项。`); notify(); onImported?.()
  }
  const revert = () => { if (undo && undoImport(undo, localStorage)) { setUndo(null); setMsg("已撤销这次导入。"); notify() } else setMsg("撤销失败，请到设置的备份与恢复里核对。") }
  return <div className="space-y-2" data-testid="plan-import">
    <label className="fk-orange-btn flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl font-bold"><FileUp className="size-4" />导入计划或备份
      <input type="file" accept=".json,application/json" className="sr-only" aria-label="导入计划/备份文件" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f) }} /></label>
    {pv && !pv.ok ? <p role="alert" className="keep text-sm text-risk">{pv.reason}</p> : null}
    {pv && pv.ok ? <div className="rounded-xl border border-line p-3 text-sm" data-testid="plan-import-preview">
      <b className="block">导入前预览 · {pv.preview.label}</b>
      {pv.plan ? <><p className="keep mt-1">{pv.plan.name} · {pv.plan.days} 天（{pv.plan.first} — {pv.plan.last}）</p><ul className="mt-1 list-disc pl-5 text-xs">{pv.plan.sample.map(s => <li key={s}>{s}</li>)}</ul></> : null}
      <p className="keep mt-1 text-xs text-muted">新增 {pv.preview.added} 项 · 覆盖 {pv.preview.overwritten} 项 · 相同 {pv.preview.unchanged} 项{pv.preview.skipped ? ` · 跳过 ${pv.preview.skipped} 项` : ""}</p>
      {pv.profileChanges.length ? <p className="keep mt-1 text-xs">资料里为空的项将填入：{pv.profileChanges.join("；")}（已有内容不覆盖）</p> : null}
      <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className="fk-primary min-h-11" onClick={confirm}>确认导入</button><button type="button" className="fk-chip min-h-11 justify-center" onClick={() => { setPv(null); setRaw(null) }}>取消</button></div>
    </div> : null}
    {msg ? <p role="status" className="keep text-xs">{msg}</p> : null}
    {undo ? <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={revert}><Undo2 className="size-4" />撤销这次导入</button> : null}
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
