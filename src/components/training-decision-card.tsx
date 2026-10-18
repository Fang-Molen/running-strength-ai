import {CoachSavedOfflineReview} from './coach-saved-offline-review'
import { useEffect, useMemo, useRef, useState } from "react"
import { TrainingRunner, resultLines } from "@/components/training-runner"
import { executionOf, feedbackOf, painOf, emptySets, mergeSets } from "@/lib/core/execution"
import { getTrainingOccurrence, getTrainingPlanSnapshot, listTrainingOccurrences } from "@/lib/core/occurrence"
import { bindTrainingStart, dispatchEvent, markCanonicalStarted } from "@/lib/core"
import {
  applyAdjustment,
  chooseAction,
  createTrainingDecision,
  firstPlannedSet,
  readTrainingContext,
  startTraining,
} from "@/lib/core/training-decision"
import { PrimaryButton, SecondaryButton, StatusBadge } from "@/components/ui"
import type { Plan, Session } from "@/lib/strength/model"
import { displayName, estimateMinutes, phaseOf } from "@/lib/strength/model"

const LABEL: Record<string, string> = {
  READY: "状态良好",
  CAUTION: "可以练，今天先不加",
  FATIGUED: "有疲劳，今天保持谨慎",
  HIGH_FATIGUE: "恢复不足，避免增加负荷",
  PAIN_REPORTED: "有疼痛，避免增加负荷",
  REHAB: "康复期，避免增加负荷",
  UNKNOWN: "证据不足，暂时无法判断",
}

export function TrainingDecisionCard({ plan, session, onApply, onLive, planSlotId, onFinished, beforeStart, onStarted, embeddedRunner = false }: { plan: Plan; session: Session; onApply: (session: Session) => void; onLive: (decisionId: string | null) => void; planSlotId?: string; onFinished?: () => void; beforeStart?: () => string | null; onStarted?: (occurrenceId: string) => void; embeddedRunner?: boolean }) {
  const [mounted, setMounted] = useState(false)
  const signature = `${plan.cycle?.week ?? ""}:${plan.cycle?.bias ?? ""}:${session.id}:${session.moves.map((move) => `${move.sets}-${move.amount}-${move.weightKg}`).join(",")}`
  const decision = useMemo(() => {
    if (!mounted) return null
    const plannedSet = firstPlannedSet(session)
    return plannedSet ? createTrainingDecision(readTrainingContext(plan), plannedSet) : null
  }, [mounted, signature])
  const recoveryContext = useMemo(() => (mounted ? readTrainingContext(plan) : null), [mounted, signature])
  const planned = firstPlannedSet(session)
  const [summary, setSummary] = useState<ReturnType<typeof resultLines> | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [held, setHeld] = useState(false)
  const [saveError,setSaveError]=useState("")
  const starting=useRef(false)
  const execution = executionOf(session.id)
  const latestOccurrence = [...listTrainingOccurrences()].reverse().find((item) => item.sessionId === session.id) ?? null
  const live = running || execution.open
  const frozen = latestOccurrence?.trainingPlanSnapshotId ? getTrainingPlanSnapshot(latestOccurrence.trainingPlanSnapshotId) : null
  const effectiveSession = useMemo(() => frozen ? {id:session.id,name:frozen.sessionName,moves:frozen.exercises.map(x=>({id:x.moveId,catalogId:x.catalogId,customName:x.name,sets:x.sets,mode:x.mode,amount:x.amount,restSec:x.restSec,weightKg:x.weightKg,executionNote:x.executionNote}))} : null, [latestOccurrence?.trainingPlanSnapshotId, signature, live])
  const settled = !live && latestOccurrence != null && latestOccurrence.lifecycle !== "IN_PROGRESS"

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const state = executionOf(session.id)
    if (state.open) {
      setRunning(true)
      setSummary(null)
      return
    }
    const logged = mergeSets(emptySets(effectiveSession ?? session), state.sets)
    if (logged.some((set) => set.completed || set.skipped)) {
      setRunning(false)
      setSummary(resultLines(logged, painOf(session.id)))
      setFeedback(feedbackOf(session.id))
    }
  }, [session.id])

  if (!mounted) return null
  if (!planned) {
    return (
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-sm font-bold">今日训练</p>
        <p className="mt-2">今天没有已保存的训练内容。</p>
        <p className="mt-1 text-sm text-muted">不会在这里编造计划或建议。到计划页保存课程后，才能从这里开始。</p>
      </section>
    )
  }
  if (!decision) return null
  const current = decision
  const calm = current.change === "none" && (current.readiness === "READY" || current.readiness === "CAUTION")

  function begin(action: "AI_RECOMMENDED" | "ORIGINAL_PLAN" | "USER_MODIFIED") {
    if(starting.current)return
    const blocked = beforeStart?.(); if (blocked) { setSaveError(blocked); return; }
    starting.current=true
    setSaveError("")
    chooseAction(current.decision_id, action)
    const effective = action === "AI_RECOMMENDED" ? applyAdjustment(session, current) : session
    if (action === "AI_RECOMMENDED") onApply(effective)
    if (action === "USER_MODIFIED") {
      document.getElementById("session-name")?.focus()
    }
    const started = startTraining({ decisionId: current.decision_id, sessionId: session.id, action })
    const bound = started ? bindTrainingStart({
        startEventId: started.event_id,
        startedAt: started.timestamp,
        sessionId: session.id,
        planSlotId: planSlotId ?? session.id,
        plan: effective,
      }) : null
    if(!started || !bound || bound.planKnowledge !== "KNOWN" || getTrainingOccurrence(bound.trainingOccurrenceId)?.planKnowledge !== "KNOWN"){setSaveError("开始事件或原计划快照未核实保存，尚不能进入执行。请查看日志后重试。");starting.current=false;return}
    markCanonicalStarted(session.id)
    setRunning(true)
    onStarted?.(bound.trainingOccurrenceId)
    onLive(current.decision_id)
    starting.current=false
  }

  const tone = current.readiness === "PAIN_REPORTED" || current.readiness === "REHAB" || current.risk === "CRITICAL" ? "risk" : current.readiness === "UNKNOWN" ? "unknown" : current.readiness === "READY" ? "normal" : "caution"
  const week = plan.cycle?.week
  const phase = phaseOf(week ?? 1)

  return (
    <>
    <section className="rounded-card border border-line bg-surface p-4">
      {current.readiness === "READY" && recoveryContext?.sleepHours == null ? (
        <p className="mb-3 text-sm">证据不足：没有睡眠记录。下面的「状态良好」是现有引擎原文，不是恢复正常，也不是这节田径的结论。决策结果没有被改掉。核心待修复项：证据不足时引擎仍可能返回 READY。</p>
      ) : null}
      {saveError?<p role="alert" className="mb-3 text-sm text-risk">{saveError}</p>:null}
      <StatusBadge tone={tone}>{LABEL[current.readiness] ?? "数据不足，暂时无法判断"}</StatusBadge>
      <p className="mt-4 text-sm text-muted">今日力量训练 · {live ? "未完成，继续当前组" : settled ? latestOccurrence.lifecycle === "INTERRUPTED" ? "已中断" : execution.sets.some(x=>x.skipped) ? "部分执行已保存" : "已结束，请核对反馈" : held ? "这次先不执行" : "尚未开始"}</p>
      <h2 className="text-xl font-bold">{session.name}</h2>
      <p className="mt-1 text-sm text-muted">
        {week ? `第 ${week} 周 · ${phase.label}` : "周期未记录"} · {session.moves.length} 个动作 · 约 {estimateMinutes(session)} 分钟
      </p>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {session.moves.map((move) => (
          <li key={move.id}>{displayName(move)} · {move.sets} 组 · {move.mode === "seconds" ? `${move.amount} 秒` : `${move.amount} 次`}{move.weightKg > 0 ? ` · ${move.weightKg} kg` : " · 自重"}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">教练建议</p>
      <p>{current.readiness === "UNKNOWN" ? current.reason : current.change === "none" ? "建议维持原计划。你可以接受，也可以改。" : current.reason}</p>
      {live ? <p className="mt-3 text-sm">这节还没结束。继续入口已经打开，从当前未完成的组接着记，不会新开一节。</p> : held ? <p className="mt-2 text-sm text-muted">这次先不执行。课表没有改。</p> : settled ? (
      <div className="mt-4 flex flex-col gap-2">
        <p className="text-sm text-muted">这次已经保存。再练会另开一节，不会改掉刚才的记录。</p>
        <PrimaryButton onClick={() => begin("ORIGINAL_PLAN")}>再练一次</PrimaryButton>
      </div>
      ) : (
      <div className="mt-4 flex flex-col gap-2">
        {calm ? (
          <PrimaryButton onClick={() => begin("ORIGINAL_PLAN")}>开始训练</PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={() => begin("AI_RECOMMENDED")}>接受建议</PrimaryButton>
            <div className="grid grid-cols-2 gap-2">
              <SecondaryButton onClick={() => begin("ORIGINAL_PLAN")}>按原计划</SecondaryButton>
              <SecondaryButton onClick={() => {
                const editor = document.getElementById("session-editor") as HTMLDetailsElement | null
                if (editor) {
                  editor.open = true
                  editor.scrollIntoView({ block: "start" })
                }
              }}>修改</SecondaryButton>
            </div>
          </>
        )}
        <button type="button" className="h-11 text-sm text-muted" onClick={() => setHeld(true)}>暂不执行</button>
      </div>
      )}
      <details className="mt-3 text-sm text-muted">
        <summary className="h-11 cursor-pointer leading-[2.75rem]">为什么</summary>
        <p>{current.reason}</p>
        <p>依据 {current.evidence.join("，") || "暂无"}</p>
        <p>反证 {current.counterEvidence.join("，") || "暂无"}</p>
        <p>规则信心 {current.confidence >= 0.75 ? "高" : current.confidence >= 0.5 ? "中" : "低"} · 风险 {current.risk === "CRITICAL" ? "高，不能靠确认加量" : current.risk === "MODERATE" || current.risk === "HIGH" ? "注意" : "低"}</p>
      </details>
    </section>
      {running && effectiveSession ? (
        <TrainingRunner
          embedded={embeddedRunner}
          session={effectiveSession}
          decisionId={executionOf(session.id).open && executionOf(session.id).decisionId ? (executionOf(session.id).decisionId as string) : current.decision_id}
          onDone={(result) => {
            setSummary(resultLines(result.sets, result.pain))
            setFeedback(null)
            setRunning(false)
            onLive(null)
            onFinished?.()
          }}
        />
      ) : null}
      {running && !effectiveSession ? <p role="alert" className="mt-3 text-sm text-risk">当前课次的原计划快照不可读，不能用修改后的课表继续记录。请核对日志与备份。</p> : null}
      {summary&&latestOccurrence?.trainingOccurrenceId?<CoachSavedOfflineReview occurrenceId={latestOccurrence.trainingOccurrenceId}/>:null}
      {summary ? (
        <section className="mt-4 rounded-card border border-line bg-surface p-4 text-sm" aria-label="训练完成摘要">
          <h3 className="text-lg font-bold">{summary.reason === "疼痛" ? "训练结束 · 有疼痛反馈" : summary.skipped ? "部分执行已保存" : "本次训练已结束"}</h3>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-background p-2"><p className="font-bold">{summary.moves}</p><p className="text-xs text-muted">动作</p></div>
            <div className="rounded-xl bg-background p-2"><p className="font-bold">{summary.sets}</p><p className="text-xs text-muted">完成组</p></div>
            <div className="rounded-xl bg-background p-2"><p className="font-bold">{summary.skipped}</p><p className="text-xs text-muted">跳过组</p></div>
          </div>
          <p className="mt-3 text-muted">训练总量（原系统口径）：{summary.planned} → {summary.actual}</p>
          {summary.skipped !== 0 ? <p className="mt-1">有跳过组 · 可展开查看</p> : null}
          <p className="mt-2 font-medium">训练感受：{feedback ?? "尚未记录"}</p>
          {!feedback ? <div className="mt-2 grid grid-cols-4 gap-1">
            {["偏轻松", "刚好", "偏重", "有不适"].map((label) => (
              <button key={label} type="button" className="min-h-11 rounded-xl border border-line px-1 text-xs" onClick={() => { const saved=dispatchEvent("SUBJECTIVE_FEEDBACK", { sessionId: session.id, trainingOccurrenceId:latestOccurrence?.trainingOccurrenceId ?? null, text: label }); if(saved){setFeedback(label);setSaveError("");}else setSaveError("反馈没有保存，请重试。"); }}>{label}</button>
            ))}
          </div> : null}
          <details className="mt-3 rounded-xl border border-line p-3">
            <summary className="min-h-10 cursor-pointer font-medium">查看训练明细（{summary.lines.length}组）</summary>
            <p className="mt-2 text-muted">主要偏差：{summary.deviation}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {summary.lines.map((line, index) => (
                <li key={`${index}-${line.title}`} className="rounded-xl border border-line p-2">
                  <p className="font-medium">{line.title} · {line.state}</p>
                  <p>计划 {line.plan} → 实际 {line.actual}</p>
                  {line.gap ? <p className="text-muted">偏差 {line.gap}</p> : null}
                </li>
              ))}
            </ul>
          </details>
          <button type="button" className="mt-2 min-h-11 text-sm text-muted" onClick={() => {
            const editor = document.getElementById("session-editor") as HTMLDetailsElement | null
            if (editor) { editor.open = true; editor.scrollIntoView({ block: "start" }) }
          }}>更新后续计划</button>
        </section>
      ) : null}
    </>
  )
}
