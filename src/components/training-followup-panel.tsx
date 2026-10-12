import { useMemo, useRef, useState } from "react"
import type { ConfirmedTrainingImport } from "@/lib/core/training-import"
import { assessImportedFollowups, saveImportedFollowup, type BodyReportState, type FollowupInput } from "@/lib/core/training-followup"

type BodyDraft = { state: BodyReportState; location: string; intensity: string }
const blankBody = (): BodyDraft => ({ state: "UNKNOWN", location: "", intensity: "" })
const optionalNumber = (text: string) => text.trim() ? Number(text) : null

function BodyInput({ name, value, disabled, onChange }: { name: string; value: BodyDraft; disabled: boolean; onChange: (next: BodyDraft) => void }) {
  return <fieldset disabled={disabled} className="min-w-0 rounded-card border border-line p-3">
    <legend className="px-1 text-sm font-bold">当前{name}</legend>
    <select aria-label={`当前${name}状态`} value={value.state} onChange={(e) => onChange({ ...blankBody(), state: e.target.value as BodyReportState })} className="h-12 w-full rounded-card border border-line bg-bg px-2">
      <option value="UNKNOWN">未记录 / 不确定</option><option value="PRESENT">当前有{name}</option><option value="ABSENT">我明确报告当前没有{name}</option>
    </select>
    {value.state === "PRESENT" ? <div className="mt-2 grid grid-cols-2 gap-2">
      <input aria-label={`${name}部位`} maxLength={40} value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} placeholder="具体部位" className="h-12 min-w-0 rounded-card border border-line bg-bg px-2" />
      <input aria-label={`${name}程度`} inputMode="numeric" value={value.intensity} onChange={(e) => onChange({ ...value, intensity: e.target.value })} placeholder="程度1–10" className="h-12 min-w-0 rounded-card border border-line bg-bg px-2" />
    </div> : null}
  </fieldset>
}

// Parent keys this panel by confirmedImportId: switching records discards drafts.
export function TrainingFollowupPanel({ record, disabled = false }: { record: ConfirmedTrainingImport; disabled?: boolean }) {
  const [recovery, setRecovery] = useState("")
  const [sleep, setSleep] = useState("")
  const [pain, setPain] = useState<BodyDraft>(blankBody)
  const [soreness, setSoreness] = useState<BodyDraft>(blankBody)
  const [version, setVersion] = useState(0)
  const [message, setMessage] = useState("")
  const submitted = useRef<FollowupInput | null>(null)
  const assessment = useMemo(() => assessImportedFollowups(record), [record, version])
  const sources = new Map(assessment.sources.map((item) => [item.id, item.detail]))
  const saving = useRef(false)
  function edited(update: () => void) { submitted.current = null; setMessage(""); update() }
  function submit() {
    if (disabled || saving.current) return
    saving.current = true
    try {
      const body = (value: BodyDraft): FollowupInput["pain"] => value.state === "PRESENT"
        ? { state: "PRESENT", location: value.location, intensity: optionalNumber(value.intensity) }
        : { state: value.state, location: null, intensity: null }
      const input = submitted.current ?? {
        requestId: crypto.randomUUID(), confirmedImportId: record.confirmedImportId, observedAt: new Date().toISOString(),
        recoveryScore: optionalNumber(recovery), sleepHours: optionalNumber(sleep), pain: body(pain), soreness: body(soreness),
      }
      const result = saveImportedFollowup(input)
      if (!result.ok) { setMessage(result.reason); return }
      submitted.current = input
      setVersion((n) => n + 1)
      setMessage(result.duplicate ? "这份反馈已经保存，未重复写入。" : "反馈已绑定到这份导入训练，没有改原训练、课表或疲劳分。没有调用模型。")
    } finally {
      saving.current = false
    }
  }
  const claims = [...assessment.observations, ...assessment.evidenceGaps]
  return <section className="mt-3 rounded-card border border-line bg-surface p-3">
    <h3 className="font-bold">训练后恢复观察</h3>
    <p className="mt-1 text-sm text-muted">时间从这份已确认训练时间起算，不推断结束时间。24–48h、48–72h分窗展示；现在填写只记录现在，不补造过去。</p>
    <p className="mt-2 text-xs text-muted">透明规则观察，暂未送入模型复盘。打开、查看和保存都不会调用模型。后续反应分析不会自动开始。自报没有疼痛不等于医学确认。</p>
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">补充当前恢复反馈</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="min-w-0 text-sm">恢复评分 1–10<input aria-label="后续恢复评分" disabled={disabled} inputMode="numeric" value={recovery} onChange={(e) => edited(() => setRecovery(e.target.value))} placeholder="未记录" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-2" /></label>
        <label className="min-w-0 text-sm">本次反馈睡眠（小时）<input aria-label="后续睡眠小时" disabled={disabled} inputMode="decimal" value={sleep} onChange={(e) => edited(() => setSleep(e.target.value))} placeholder="未记录" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-2" /></label>
        <div className="col-span-2"><BodyInput name="疼痛" value={pain} disabled={disabled} onChange={(next) => edited(() => setPain(next))} /></div>
        <div className="col-span-2"><BodyInput name="酸痛" value={soreness} disabled={disabled} onChange={(next) => edited(() => setSoreness(next))} /></div>
      </div>
      <button type="button" disabled={disabled} onClick={submit} className="mt-3 min-h-12 w-full rounded-card border border-line font-bold disabled:opacity-50">确认当前反馈</button>
    </details>
    {message ? <p role="status" className="mt-2 break-words text-sm">{message}</p> : null}
    <p className="mt-3 text-xs text-muted">{assessment.status === "MULTIPLE_RECORDS" ? "同窗多条，需人工核对" : assessment.status === "CAUTION" ? "有需核对的身体或恢复记录" : assessment.status === "NEEDS_INPUT" ? "证据不足，不能确认已恢复" : "仅观察，不作恢复许可"}</p>
    {claims.map((item, i) => <div key={`claim-${i}`} className="mt-2 rounded-card bg-bg p-2 text-sm"><p>{item.text}</p>{item.citations.length ? <p className="mt-1 break-words text-xs text-muted">依据：{item.citations.map((id) => sources.get(id) ?? id).join("；")}</p> : null}</div>)}
    {assessment.facts.length ? <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">已保存反馈与来源（{assessment.facts.length}）</summary><ul className="space-y-2">{assessment.facts.map((item) => <li key={item.citations[0]} className="break-words rounded-card bg-bg p-2 text-xs"><p>{item.text}</p><p className="mt-1 text-muted">来源：{item.citations[0]}</p></li>)}</ul></details> : <p className="mt-2 text-sm text-muted">这份训练尚无后续反馈。</p>}
  </section>
}
