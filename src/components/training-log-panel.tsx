import { useMemo, useState } from "react"
import { Activity, CalendarDays, Dumbbell } from "lucide-react"
import { loadEvents } from "@/lib/core/events"
import { attemptsForOccurrence, getTrainingPlanSnapshot, listTrainingOccurrences, type TrainingOccurrence } from "@/lib/core/occurrence"
import { loadTrainingFact } from "@/lib/core/training-fact"
import { appendCorrection, compensationDraft, effectiveStrengthFields, listCorrections, occurrenceVoided, strengthSetKey, UNWIRED_CORRECTION_FIELDS, type CorrectionField } from "@/lib/core/training-correction"
import { loadConfirmedTrainingImports, permanentlyDeleteConfirmedTrainingImport, type ConfirmedTrainingImport } from "@/lib/core/training-import"
import { calendarDayShanghai, formatDeviceLocal, logMarks, occurrenceTitle, userFacingStatus } from "@/lib/ui/training-log-view"
import { TrackStructureList } from "@/components/track-session"
import { AthleteGrowthCard } from "@/components/athlete-growth-card"
import { projectRunningExecution } from "@/lib/core/running-execution"
import { correctRunningMetric, correctedRunningMetric, runningCorrectionKey } from "@/lib/core/running-log-correction"
import type { RunningRepetitionSlot } from "@/lib/core/running-execution"
import type { Plan } from "@/lib/strength/model"

const FEEL: Record<string, string> = { easy: "轻松", ok: "正好", hard: "吃力", pain: "有不适", skip: "这周没练" }
const STATUS: Record<string, string> = { COMPLETED: "已完成", SKIPPED: "已跳过", NOT_RECORDED: "未记录", UNKNOWN: "证据不足", IN_PROGRESS: "进行中", INTERRUPTED: "已中断", UNCLASSIFIED_CLOSE: "结束状态未分类", DUPLICATE_CLOSE: "重复结束" }
const FIELDS: { id: CorrectionField; label: string }[] = [
  { id: "weight", label: "重量" },
  { id: "reps", label: "次数" },
  { id: "distance", label: "距离" },
  { id: "duration", label: "时间" },
  { id: "feedback", label: "训练反馈" },
]

function monthGrid(cursor: string) {
  const [year, month] = cursor.split("-").map(Number)
  const first = new Date(Date.UTC(year, month - 1, 1))
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (first.getUTCDay() + 6) % 7
  return { year, month, days, pad, label: `${year}年${month}月` }
}

function textOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function OccurrenceCard({ item, plan, onAsk }: { item: TrainingOccurrence; plan: Plan; onAsk: (occurrenceId: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [sheet, setSheet] = useState<null | "correct" | "void" | "restore" | "undo" | "history">(null)
  const [step, setStep] = useState<"edit" | "confirm">("edit")
  const [reason, setReason] = useState("")
  const [field, setField] = useState<CorrectionField>("weight")
  const [setKey, setSetKey] = useState("")
  const [originalValue, setOriginalValue] = useState("")
  const [nextValue, setNextValue] = useState("")
  const [tick, setTick] = useState(0)
  const [fail, setFail] = useState("")
  const [runningEdit, setRunningEdit] = useState<RunningRepetitionSlot | null>(null)
  const [runningMetric, setRunningMetric] = useState<"distance" | "duration">("duration")
  const [runningValue, setRunningValue] = useState("")
  const [runningReason, setRunningReason] = useState("")
  const snapshot = item.trainingPlanSnapshotId ? getTrainingPlanSnapshot(item.trainingPlanSnapshotId) : null
  const planName = plan.sessions.find((session) => session.id === item.sessionId)?.name ?? ""
  const title = occurrenceTitle(snapshot?.sessionName, planName, item.sessionId)
  const voided = occurrenceVoided(item.trainingOccurrenceId)
  const status = userFacingStatus({ lifecycle: item.lifecycle, outcome: item.outcome, voided })
  const history = listCorrections(item.trainingOccurrenceId)
  const events = loadEvents()
  const fact = loadTrainingFact(item.trainingOccurrenceId, events)
  const attempts = attemptsForOccurrence(item.trainingOccurrenceId, events)
  const track = projectRunningExecution(item.trainingOccurrenceId, events)
  const trackSlots = track.availability === "AVAILABLE" ? track.repetitions : []
  const runningRecorded = trackSlots.filter((slot) => slot.status === "COMPLETED").length
  const runningSkipped = trackSlots.filter((slot) => slot.status === "SKIPPED").length
  const hasRunning = trackSlots.length > 0
  const hasStrength = attempts.length > 0 || Boolean(snapshot?.exercises.length)
  const sessionType = hasRunning && hasStrength ? "跑步 + 力量" : hasRunning ? "跑步训练" : hasStrength ? "力量训练" : "训练类型待确认"
  const windowEvents = (() => {
    const startAt = events.findIndex((event) => event.event_id === item.startEventId)
    if (startAt < 0) return []
    const closeAt = item.closeEventId ? events.findIndex((event) => event.event_id === item.closeEventId) : -1
    const end = closeAt >= startAt ? closeAt + 1 : events.length
    return events.slice(startAt, end).filter((event) => event.payload.sessionId === item.sessionId || event.payload.trainingOccurrenceId === item.trainingOccurrenceId || event.event_id === item.startEventId || event.event_id === item.closeEventId)
  })()
  const rawFeedback = [...windowEvents].reverse().find((event) => event.event_type === "SUBJECTIVE_FEEDBACK" && textOf(event.payload.text))
  const feedback = textOf(rawFeedback?.payload.text) || "未记录"
  const rpeEvent = [...windowEvents].reverse().find((event) => event.event_type === "RPE_RECORDED")
  const rpeValue = rpeEvent && (typeof rpeEvent.payload.value === "number" || typeof rpeEvent.payload.rpe === "number") ? String(rpeEvent.payload.value ?? rpeEvent.payload.rpe) : null
  const pain = windowEvents.some((event) => event.event_type === "PAIN_RECORDED") ? "有记录" : "未记录"
  const unwired = history.some((row) => row.kind === "FIELD" && (UNWIRED_CORRECTION_FIELDS as readonly string[]).includes(row.field ?? ""))
  void tick

  function resetSheet() {
    setSheet(null)
    setStep("edit")
    setReason("")
    setNextValue("")
    setOriginalValue("")
    setSetKey("")
  }

  function save() {
    const trimmed = reason.trim()
    if (!trimmed) {
      setFail("要写原因才能保存。原记录还在，没有删除。")
      return
    }
    let saved: ReturnType<typeof appendCorrection> = null
    if (sheet === "correct") {
      if (!nextValue.trim()) {
        setFail("要写纠正后的数值。没有可靠训练组绑定时，纠正不会进入有效事实。")
        return
      }
      saved = appendCorrection({ trainingOccurrenceId: item.trainingOccurrenceId, kind: "FIELD", field, setKey: setKey.trim() || null, originalValue: originalValue.trim(), newValue: nextValue.trim(), reason: trimmed })
    } else if (sheet === "void") {
      saved = appendCorrection({ trainingOccurrenceId: item.trainingOccurrenceId, kind: "VOID", reason: trimmed })
    } else if (sheet === "restore") {
      saved = appendCorrection({ trainingOccurrenceId: item.trainingOccurrenceId, kind: "RESTORE", reason: trimmed })
    } else if (sheet === "undo") {
      const draft = compensationDraft(item.trainingOccurrenceId)
      if (!draft) {
        setFail("没有可撤销的操作。")
        return
      }
      saved = appendCorrection({ trainingOccurrenceId: item.trainingOccurrenceId, kind: draft.kind, field: draft.field, setKey: draft.setKey, originalValue: draft.originalValue, newValue: draft.newValue, reason: trimmed })
    }
    if (!saved) {
      setFail("没有写入。这条记录必须带训练编号。原记录还在，没有按日期猜测，也没有删除。")
      return
    }
    setFail("")
    setTick((value) => value + 1)
    setMore(false)
    resetSheet()
  }

  const confirmLabel = sheet === "void" ? "确认作废" : sheet === "restore" ? "确认恢复" : sheet === "undo" ? "确认撤销" : "确认纠正"
  const undo = compensationDraft(item.trainingOccurrenceId)

  return <article className="border-b border-line py-1 text-sm last:border-b-0">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-12 w-full items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-accent">
      <span className={(hasRunning && !hasStrength ? "chip-run" : "chip-lift") + " grid size-10 shrink-0 place-items-center rounded-2xl"}>{hasRunning && !hasStrength ? <Activity className="size-4" /> : <Dumbbell className="size-4" />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate font-bold">{title}</span><span className="mt-0.5 block truncate text-xs text-muted">{formatDeviceLocal(item.startedAt)} · {status}{hasRunning ? ` · 跑步 ${runningRecorded}/${trackSlots.length} 段` : hasStrength ? ` · 力量 ${attempts.length || snapshot?.exercises.length || 0} 组` : ""}</span></span>
      <span className="shrink-0 text-lg text-muted" aria-hidden="true">{open ? "↑" : "›"}</span>
    </button>
    {open ? <div className="mt-2 border-t border-line pt-2"><p className="text-xs font-bold text-accent">{sessionType}</p><button type="button" onClick={() => onAsk(item.trainingOccurrenceId)} className="mt-2 min-h-10 rounded-xl border border-line px-3 font-bold">问教练</button></div> : null}
    {open ? <div className="mt-3 space-y-2 border-t border-line pt-3">
      <p>开始时间 {formatDeviceLocal(item.startedAt)}</p>
      <p className="font-bold">原计划（保留快照）</p>
      {snapshot?.exercises.length ? <ul className="space-y-1">{snapshot.exercises.map((exercise) => <li key={exercise.moveId}>{exercise.name || "未命名动作"} · {exercise.sets} 组 · {exercise.amount} {exercise.mode === "seconds" ? "秒" : "次"}{exercise.weightKg > 0 ? ` · ${exercise.weightKg} kg` : ""}</li>)}</ul> : <p className="text-muted">未记录</p>}
      <TrackStructureList occurrenceId={item.trainingOccurrenceId} />
      {hasRunning ? <section className="space-y-2" aria-label="田径逐段实际记录">
        <p className="font-bold">田径实际记录与纠错</p>
        {trackSlots.map((slot, index) => {
          const distance = correctedRunningMetric(slot, "distance")
          const duration = correctedRunningMetric(slot, "duration")
          return <div key={`${slot.componentId}:${slot.blockId}:${slot.stepId}:${slot.roundOrdinal}:${slot.repeatOrdinal}`} className="rounded-card border border-line p-2">
            <p>第 {slot.roundOrdinal} 轮 · 第 {slot.repeatOrdinal} 次 · {slot.status === "COMPLETED" ? "已完成" : slot.status === "SKIPPED" ? "已跳过" : slot.status === "DUPLICATE_UNRESOLVED" ? "重复待核对" : "未记录"}</p>
            <p className="text-muted">距离 {distance.value ?? "未记录"} 米 · 用时 {duration.value ?? "未记录"} 秒{distance.corrected || duration.corrected ? " · 已纠错（仅日志视图）" : ""}</p>
            {runningCorrectionKey(slot) ? <button type="button" className="min-h-11 underline" onClick={() => { setRunningEdit(slot); setRunningMetric("duration"); setRunningValue(String(duration.value ?? "")); setRunningReason(""); setFail("") }}>修改本段成绩</button> : null}
          </div>
        })}
        
      </section> : null}
      <p className="font-bold">力量实际完成</p>
      {attempts.length ? <ul className="space-y-1">{attempts.map((event) => {
        const payload = event.payload ?? {}
        const overlay = effectiveStrengthFields(payload)
        const bound = overlay.binding === "BOUND" && overlay.identity?.trainingOccurrenceId === item.trainingOccurrenceId
        const moveId = textOf(payload.moveId) || "set"
        const setIndex = typeof payload.setIndex === "number" ? payload.setIndex : 0
        const key = bound && overlay.identity ? strengthSetKey(overlay.identity.moveId, overlay.identity.setIndex) : `${moveId}:${setIndex}`
        const name = textOf(payload.name) || snapshot?.exercises.find((exercise) => exercise.moveId === moveId)?.name || "动作"
        const mode = payload.mode === "seconds" ? "seconds" : "reps"
        const weightText = bound ? (overlay.weight.status === "UNKNOWN" || overlay.weight.value == null ? "未记录" : String(overlay.weight.value)) : (typeof payload.actualWeight === "number" ? String(payload.actualWeight) : "未记录")
        const amountText = mode === "seconds"
          ? (typeof payload.actualAmount === "number" ? String(payload.actualAmount) : "未记录")
          : bound ? (overlay.reps.status === "UNKNOWN" || overlay.reps.value == null ? "未记录" : String(overlay.reps.value)) : (typeof payload.actualAmount === "number" ? String(payload.actualAmount) : "未记录")
        const state = payload.skipped === true ? "已跳过" : payload.completed === true ? "已完成" : "未记录"
        const corrected = bound && (overlay.weight.status === "CORRECTED" || (mode !== "seconds" && overlay.reps.status === "CORRECTED"))
        const unreadable = bound && (overlay.weight.status === "UNKNOWN" || (mode !== "seconds" && overlay.reps.status === "UNKNOWN"))
        return <li key={event.event_id ?? key}>
          {name} 第 {setIndex || "?"} 组 · 有效 {weightText} kg · {amountText} {mode === "seconds" ? "秒" : "次"} · {state}
          {corrected ? ` · 原记录 ${typeof payload.actualWeight === "number" ? payload.actualWeight : "未记录"} kg / ${typeof payload.actualAmount === "number" ? payload.actualAmount : "未记录"}` : " · 原记录即有效记录"}
          {unreadable ? " · 纠正值无法读取" : ""}{bound ? "" : " · 没有可靠组绑定，纠正未进入有效事实"}
          {bound ? <button type="button" className="ml-2 min-h-11 underline" onClick={() => { setField("weight"); setSetKey(key); setOriginalValue(typeof payload.actualWeight === "number" ? String(payload.actualWeight) : ""); setSheet("correct"); setStep("edit") }}>纠正这组</button> : null}
        </li>
      })}</ul> : <p className="text-muted">{fact?.completedSetCount == null ? "未记录" : `已记录完成 ${fact.completedSetCount} 组`}</p>}
      {unwired ? <p className="text-muted">部分纠正仅保存了审计记录，尚未更新有效训练事实。</p> : null}

      <p>训练反馈 {feedback}</p>
      <p>RPE {rpeValue ?? "未记录"} · 疼痛 {pain}</p>
      <p className="text-xs text-muted">过程 {item.lifecycle} · 结果 {item.outcome} · 审计编号 {item.trainingOccurrenceId}</p>
      {fail ? <p className="text-sm">{fail}</p> : null}
      <div className="flex flex-wrap gap-2">
        {attempts.length ? <button type="button" onClick={() => { setSheet("correct"); setStep("edit"); setFail("") }} className="min-h-11 rounded-card border border-line px-3 font-bold">纠正力量记录</button> : null}
        {voided ? <button type="button" onClick={() => { setSheet("restore"); setStep("edit"); setFail("") }} className="min-h-11 rounded-card border border-line px-3 font-bold">恢复这次训练</button> : <button type="button" onClick={() => { setSheet("void"); setStep("edit"); setFail("") }} className="min-h-11 rounded-card border border-line px-3 font-bold">作废整次训练</button>}
        <button type="button" aria-expanded={more} onClick={() => setMore((value) => !value)} className="min-h-11 rounded-card border border-line px-3 font-bold">更多操作</button>
      </div>
      {more ? <div className="flex flex-col gap-2">
        <button type="button" onClick={() => { setSheet("undo"); setStep(undo ? "edit" : "confirm"); setFail("") }} className="min-h-11 rounded-card border border-line px-3 text-left font-bold">撤销最近操作</button>
        <button type="button" onClick={() => setSheet("history")} className="min-h-11 rounded-card border border-line px-3 text-left font-bold">查看修改历史</button>
      </div> : null}
    </div> : null}
    {runningEdit ? <div className="fixed inset-0 z-50 flex items-end bg-bg/80 px-4 pb-4" role="dialog" aria-modal="true" aria-label="修改田径成绩">
      <div className="mx-auto w-full max-w-3xl rounded-card bg-surface p-4 space-y-3">
        <p className="font-bold">修改第 {runningEdit.roundOrdinal} 轮第 {runningEdit.repeatOrdinal} 次成绩</p>
        <label className="block">字段<select className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" value={runningMetric} onChange={event => { const metric = event.target.value as "distance" | "duration"; setRunningMetric(metric); setRunningValue(String(correctedRunningMetric(runningEdit, metric).value ?? "")) }}><option value="duration">用时（秒）</option><option value="distance">距离（米）</option></select></label>
        <label className="block">正确数值<input type="number" min="0.001" step="any" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" value={runningValue} onChange={event => setRunningValue(event.target.value)}/></label>
        <label className="block">修改原因<input className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" value={runningReason} onChange={event => setRunningReason(event.target.value)} placeholder="例如计时笔误" /></label>
        
        {fail ? <p role="alert">{fail}</p> : null}
        <button type="button" className="min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg" onClick={() => { const ok = correctRunningMetric(runningEdit, runningMetric, Number(runningValue), runningReason); if (ok) { setRunningEdit(null); setTick(v => v + 1) } else setFail("请填写有效的正数和修改原因，且本段必须有唯一来源事件。") }}>确认保存纠错</button>
        <button type="button" className="min-h-11 w-full" onClick={() => setRunningEdit(null)}>取消</button>
      </div>
    </div> : null}
    {sheet ? <div className="fixed inset-0 z-50 flex items-end bg-bg/80 px-4 pb-4" role="dialog" aria-modal="true">
      <div className="mx-auto w-full max-w-3xl rounded-card bg-surface p-4">
        <p className="font-bold">{sheet === "history" ? "修改历史" : sheet === "void" ? "作废整次训练" : sheet === "restore" ? "恢复这次训练" : sheet === "undo" ? "撤销最近操作" : "纠正记录"}</p>
        {sheet === "history" ? <>
          {history.length ? <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">{history.map((row) => <li key={row.correctionId} className="rounded-card border border-line p-2">{formatDeviceLocal(row.at)} · {row.kind === "FIELD" ? "纠正" : row.kind === "VOID" ? "作废" : "恢复"}{row.field ? ` · ${FIELDS.find((item) => item.id === row.field)?.label ?? row.field}` : ""}{row.kind === "FIELD" ? ` · ${row.originalValue || "未记录"} → ${row.newValue || "未记录"}` : ""} · {row.reason}</li>)}</ul> : <p className="mt-3 text-muted">还没有修改记录。</p>}
          <button type="button" onClick={resetSheet} className="mt-3 min-h-11 w-full rounded-card border border-line font-bold">关闭</button>
        </> : sheet === "undo" && !undo ? <>
          <p className="mt-2 text-muted">没有可撤销的已保存操作。未提交的填写可以直接取消。</p>
          <button type="button" onClick={resetSheet} className="mt-3 min-h-11 w-full rounded-card border border-line font-bold">关闭</button>
        </> : step === "edit" ? <>
          {sheet === "correct" ? <>
            <label className="mt-3 block text-muted">要改的内容
              <select value={field} onChange={(event) => setField(event.target.value as CorrectionField)} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3 text-fg">{FIELDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            </label>
            <label className="mt-3 block text-muted">组标识，可选
              <input value={setKey} onChange={(event) => setSetKey(event.target.value)} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" placeholder="例如 squat:1" />
            </label>
            <label className="mt-3 block text-muted">原来的值
              <input value={originalValue} onChange={(event) => setOriginalValue(event.target.value)} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" placeholder="未记录可留空" />
            </label>
            <label className="mt-3 block text-muted">改成
              <input value={nextValue} onChange={(event) => setNextValue(event.target.value)} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" />
            </label>
          </> : <p className="mt-2 text-muted">{sheet === "void" ? "作废后，这次训练不再作为有效证据。原始记录仍保留。" : sheet === "restore" ? "恢复后，这次训练可以重新作为有效证据。" : undo?.kind === "FIELD" ? `将最近一次纠正从 ${undo.originalValue || "未记录"} 补偿回 ${undo.newValue || "未记录"}。` : "将追加一条相反的作废或恢复记录，不删除原记录。"}</p>}
          <label className="mt-3 block text-muted">原因
            <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" />
          </label>
          <button type="button" disabled={!reason.trim() || (sheet === "correct" && !nextValue.trim())} onClick={() => setStep("confirm")} className="mt-3 min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg disabled:opacity-50">下一步</button>
          <button type="button" onClick={resetSheet} className="mt-2 min-h-11 w-full text-muted">取消</button>
        </> : <>
          <p className="mt-2">请再确认一次。原因：{reason.trim()}</p>
          
          <button type="button" onClick={save} className="mt-3 min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg">{confirmLabel}</button>
          <button type="button" onClick={() => setStep("edit")} className="mt-2 min-h-11 w-full text-muted">返回修改</button>
        </>}
      </div>
    </div> : null}
  </article>
}

function ImportRow({ item, onAsk, onDeleted }: { item: ConfirmedTrainingImport; onAsk: (occurrenceId: string | null) => void; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const run = item.runningSegments.length > 0
  const lift = item.strengthSets.length > 0
  return <article className="border-b border-line py-1 text-sm last:border-b-0">
    <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-12 w-full items-center gap-3 text-left">
      <span className={(run && !lift ? "chip-run" : "chip-lift") + " grid size-10 shrink-0 place-items-center rounded-2xl"}>{run && !lift ? <Activity className="size-4" /> : <Dumbbell className="size-4" />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate font-bold">{item.title.value || "未命名上传"}</span><span className="mt-0.5 block truncate text-xs text-muted">{formatDeviceLocal(item.occurredAt.value)} · {item.sport === "UNKNOWN" ? "证据不足" : "已确认上传"}</span></span>
      <span className="text-lg text-muted" aria-hidden="true">{open ? "↑" : "›"}</span>
    </button>
    {open ? <div className="mt-2 space-y-2 border-t border-line pt-2">
      
      {item.runningSegments.length ? <ul className="space-y-1">{item.runningSegments.map((segment, index) => <li key={segment.id}>跑步 {index + 1} · {segment.distanceMeters.value ?? "距离未记录"} 米 · {segment.durationSeconds.value ?? "时间未记录"} 秒 · {STATUS[segment.completion] ?? segment.completion}</li>)}</ul> : <p className="text-muted">跑步分段：未记录</p>}
      {item.strengthSets.length ? <ul className="space-y-1">{item.strengthSets.map((set, index) => <li key={set.id}>力量 {index + 1} · {set.exerciseName.value || "动作未记录"} · {set.repetitions.value ?? "次数未记录"} · {STATUS[set.completion] ?? set.completion}</li>)}</ul> : null}
      <button type="button" onClick={() => onAsk(null)} className="min-h-11 rounded-full border border-line px-3 font-bold">问教练</button>
      
      {!deleteConfirm ? <button type="button" onClick={() => { setDeleteConfirm(true); setDeleteError("") }} className="min-h-11 rounded-full border border-red-500 px-3 font-bold text-red-600">永久删除这条上传记录</button> : <div className="rounded-xl border border-red-500 p-3 space-y-2">
        <p className="font-bold">确认永久删除？</p>
        <p className="text-xs">将从本机已确认上传记录中移除该条数据，不能通过“恢复作废”找回。建议先导出备份。其他训练记录不受影响。</p>
        <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-full bg-red-600 px-3 font-bold text-white" onClick={() => { if (permanentlyDeleteConfirmedTrainingImport(item.confirmedImportId)) onDeleted(); else setDeleteError("删除失败，记录仍保留，请重试。") }}>确认永久删除</button><button type="button" className="min-h-11 rounded-full border border-line px-3" onClick={() => setDeleteConfirm(false)}>取消</button></div>
        {deleteError ? <p role="alert" className="text-red-600">{deleteError}</p> : null}
      </div>}

    </div> : null}
  </article>
}

function recordKind(item: TrainingOccurrence): "run" | "lift" | "mixed" | "unknown" {
  const events = loadEvents()
  const track = projectRunningExecution(item.trainingOccurrenceId, events)
  const attempts = attemptsForOccurrence(item.trainingOccurrenceId, events)
  const snapshot = item.trainingPlanSnapshotId ? getTrainingPlanSnapshot(item.trainingPlanSnapshotId) : null
  const hasRun = track.availability === "AVAILABLE" && track.repetitions.length > 0
  const hasLift = attempts.length > 0 || Boolean(snapshot?.exercises.length)
  if (hasRun && hasLift) return "mixed"
  if (hasRun) return "run"
  if (hasLift) return "lift"
  return "unknown"
}

export function TrainingLogPanel({ plan, onAsk }: { plan: Plan; onAsk: (occurrenceId: string | null) => void }) {
  const [logRevision, setLogRevision] = useState(0)
  const imports = useMemo(() => loadConfirmedTrainingImports().filter((item) => !String(item.title.value ?? "").includes("佳明账号同步")), [logRevision])
  const occurrences = useMemo(() => listTrainingOccurrences(), [])
  const grouped = useMemo(() => logMarks(
    imports.map((item) => ({ at: item.occurredAt.value })),
    occurrences.map((item) => ({ at: item.startedAt })),
  ), [imports, occurrences])
  const today = calendarDayShanghai(new Date().toISOString()) ?? "2026-10-01"
  const [cursor, setCursor] = useState(today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const [kind, setKind] = useState<"all" | "run" | "lift">("all")
  const [showCalendar, setShowCalendar] = useState(false)
  const grid = monthGrid(`${cursor}-01`)
  const marks = new Map(grouped.marks.map((item) => [item.day, item]))
  const matchesKind = (value: "run" | "lift" | "mixed" | "unknown") => kind === "all" || (kind === "run" ? value === "run" || value === "mixed" : value === "lift" || value === "mixed")
  const visibleOccurrences = [...occurrences].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).filter((item) => {
    if (!calendarDayShanghai(item.startedAt)) return false
    if (showCalendar && calendarDayShanghai(item.startedAt) !== selected) return false
    return matchesKind(recordKind(item))
  })
  const visibleImports = imports.filter((item) => {
    if (showCalendar && calendarDayShanghai(item.occurredAt.value) !== selected) return false
    const value = item.runningSegments.length && item.strengthSets.length ? "mixed" : item.runningSegments.length ? "run" : item.strengthSets.length ? "lift" : "unknown"
    return matchesKind(value)
  })
  const shift = (delta: number) => {
    const [year, month] = cursor.split("-").map(Number)
    const next = new Date(Date.UTC(year, month - 1 + delta, 1))
    setCursor(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`)
  }

  return <div className="mx-auto max-w-3xl px-3 pt-2 pb-nav">
    <section className="home-card px-3 py-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold">训练记录</h2>
        <button type="button" aria-expanded={showCalendar} aria-label="按日期筛选" onClick={() => setShowCalendar((open) => !open)} className="grid size-10 place-items-center rounded-xl bg-surface-2 text-accent"><CalendarDays className="size-5" /></button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1" role="group" aria-label="训练类型筛选">
        {([["all", "全部"], ["run", "跑步"], ["lift", "力量"]] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)} className={"min-h-10 rounded-full text-sm font-bold " + (kind === id ? "bg-surface text-fg shadow-sm" : "text-muted")}>{label}</button>
        ))}
      </div>
      {showCalendar ? <div className="mt-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className="min-h-11 px-3 font-bold" aria-label="上个月">上个月</button>
          <p className="font-bold">{grid.label}</p>
          <button type="button" onClick={() => shift(1)} className="min-h-11 px-3 font-bold" aria-label="下个月">下个月</button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs text-muted">{["一", "二", "三", "四", "五", "六", "日"].map((item) => <span key={item}>{item}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: grid.pad }, (_, index) => <span key={`pad-${index}`} />)}
          {Array.from({ length: grid.days }, (_, index) => {
            const day = `${cursor}-${String(index + 1).padStart(2, "0")}`
            const mark = marks.get(day)
            return <button key={day} type="button" aria-pressed={selected === day} onClick={() => setSelected(day)} className={"min-h-11 rounded-xl text-sm " + (selected === day ? "bg-accent font-bold text-accent-fg" : "bg-surface-2")}>{index + 1}{mark ? <span className="block text-[10px]">{mark.imports + mark.occurrences}</span> : null}</button>
          })}
        </div>
      </div> : null}
      {visibleOccurrences.length + visibleImports.length === 0 ? <p className="mt-4 text-sm text-muted">这一筛选下还没有训练记录。</p> : <div className="mt-2">
        {visibleOccurrences.map((item) => <OccurrenceCard key={item.trainingOccurrenceId} item={item} plan={plan} onAsk={onAsk} />)}
        {visibleImports.map((item) => <ImportRow key={item.confirmedImportId} item={item} onAsk={onAsk} onDeleted={() => setLogRevision((value) => value + 1)} />)}
      </div>}
    </section>
    <details className="home-card mt-3 px-4 py-3 text-sm">
      <summary className="min-h-11 cursor-pointer font-bold">本周期感受</summary>
      
      {plan.cycle?.logs.length ? <ul className="mt-2 space-y-2">{plan.cycle.logs.map((log) => <li key={log.sessionId}>{plan.sessions.find((item) => item.id === log.sessionId)?.name ?? "未命名课"} · {FEEL[log.feel] ?? log.feel}{log.note ? ` · ${log.note}` : ""}</li>)}</ul> : <p className="mt-2 text-muted">这周还没有感受记录。</p>}
    </details>
    <details className="home-card mt-3 px-4 py-3 text-sm">
      <summary className="min-h-11 cursor-pointer font-bold">本周成长</summary>
      <AthleteGrowthCard plan={plan} />
    </details>
    {grouped.undatedImports || grouped.undatedOccurrences ? <section className="home-card mt-3 px-4 py-3 text-sm">
      <h2 className="font-bold">没有可用日期的记录</h2>
      
      {imports.filter((item) => !calendarDayShanghai(item.occurredAt.value)).map((item) => <ImportRow key={item.confirmedImportId} item={item} onAsk={onAsk} onDeleted={() => setLogRevision((value) => value + 1)} />)}
      {occurrences.filter((item) => !calendarDayShanghai(item.startedAt)).map((item) => <OccurrenceCard key={item.trainingOccurrenceId} item={item} plan={plan} onAsk={onAsk} />)}
    </section> : null}
  </div>
}
