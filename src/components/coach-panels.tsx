import { sleepHoursText } from "@/lib/health/observation";
import { useState } from "react"
import type { AbilityRow, SessionView, Tone } from "@/lib/core/coach-view"
import { inboxCopy } from "@/lib/core/brain-loop"
import type { TrainingDecision } from "@/lib/core/training-decision"
import type { DecisionRecord } from "@/lib/core/types"

const TONE: Record<Tone, string> = {
  normal: "text-accent",
  caution: "text-warn",
  risk: "text-warn",
  unknown: "text-muted",
}

export function SessionReview({ view }: { view: SessionView }) {
  return (
    <section className="rounded-card border border-line bg-surface p-3 text-sm">
      <h3 className="font-bold">这次训练</h3>
      <p className="mt-2 text-xs text-muted">事实</p>
      <p>目标 {view.goal}</p>
      <p>实际 {view.actual}</p>
      <p className="mt-2 text-xs text-muted">偏差</p>
      <p>组数 {view.deviation.sets ?? "未记录"} · 次数 {view.deviation.reps ?? "未记录"} · 负荷 {view.deviation.loadKg == null ? "未记录" : `${view.deviation.loadKg}kg`}</p>
      <p className="text-muted">用时 未记录 · 强度 未记录</p>
      <p className="mt-2 text-xs text-muted">判断</p>
      <p>原因 {view.reason}</p>
      <p>训练质量 {view.quality}</p>
      <p className="mt-2 text-xs text-muted">下一步</p>
      <p>{view.next}</p>
      <p className="mt-2 text-muted">本次采用 {view.adoptedLabel}</p>
    </section>
  )
}

export function AbilityPanel({ rows }: { rows: AbilityRow[] }) {
  return (
    <section className="rounded-card border border-line bg-surface p-3 text-sm">
      <h3 className="font-bold">当前能力</h3>
      <p className="mt-1 text-xs text-muted">这是长期能力，不是今天的状态。</p>
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key}>
            <div className="flex items-baseline justify-between gap-2">
              <span>{row.label}</span>
              <span className="text-sm text-muted">{row.value == null ? "未记录" : `${row.value} / 100 · ${row.confidence}`}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
              {row.value == null ? <div className="h-full w-full bg-line" /> : <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, row.value))}%` }} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function TodayState({
  recovery,
  fatigue,
  usable,
  uncalibrated = false,
  sleep = null,
  painNoted = false,
  sessionRpe = null,
}: {
  recovery: string
  fatigue: number | null
  usable: string
  uncalibrated?: boolean
  sleep?: number | null
  painNoted?: boolean
  sessionRpe?: number | null
}) {
  return (
    <section className="text-sm">
      <h3 className="font-bold">今日状态</h3>
      <p className="text-xs text-muted">现有规则指标，尚未完成个人校准。不是疲劳百分比，也不是受伤概率。</p>
      {uncalibrated ? (
        <p className="mt-1">证据不足。没有训练反馈时，不把默认分说成正常或恢复较好。</p>
      ) : (
        <p className="mt-1">规则带 {recovery} · 规则分 {fatigue == null ? "未记录" : fatigue}。来源是教练记忆里已有的反馈，时间以那些记录为准。</p>
      )}
      {uncalibrated && fatigue === 20 ? <p className="mt-1">默认疲劳 20 不是已记录的恢复正常，也不代表今天状态良好。</p> : null}
      <p className="text-muted">睡眠 {sleep == null ? "未记录" : sleepHoursText(sleep)} · 笔记疼痛 {painNoted ? "出现过，不代表伤情结论" : "未见"} · 整课 RPE {sessionRpe == null ? "未记录" : sessionRpe}</p>
      <p className="text-muted">整课 RPE 不等于这个规则分，也不等于某一组的用力。本次表现 {usable}</p>
    </section>
  )
}

export function CoachStatusCard({
  tone,
  recovery,
  load,
  cycle,
  limiter,
  suggestion,
}: {
  tone: Tone
  recovery: string
  load: string
  cycle: string
  limiter: string
  suggestion: string
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-3 text-sm">
      <h3 className="font-bold">教练状态</h3>
      <p className={"mt-1 " + TONE[tone]}>恢复 {recovery}</p>
      <p>训练负荷 {load}</p>
      <p>当前周期 {cycle}</p>
      <p>主要限制 {limiter}</p>
      <p className="mt-1">今日建议 {suggestion}</p>
    </section>
  )
}

export function DecisionCard({
  decision,
  planned,
  onAccept,
  onOriginal,
  onEdit,
  onHold,
}: {
  decision: TrainingDecision
  planned: string
  onAccept: () => void
  onOriginal: () => void
  onEdit: () => void
  onHold?: () => void
}) {
  const [open, setOpen] = useState(false)
  const suggestion = decision.change === "drop-set" ? `${decision.weightKg}kg × ${decision.sets} × ${decision.amount}` : planned
  return (
    <section className="rounded-card border border-line p-3 text-sm">
      <h3 className="font-bold">今日训练决策</h3>
      <p className="mt-1 text-xs text-muted">建议，还没执行</p>
      <p className="mt-1">原计划 {planned}</p>
      <p>建议 {suggestion}</p>
      <p className="text-muted">{decision.reason}</p>
      <p className="text-muted">风险 {decision.risk === "CRITICAL" ? "高" : decision.risk === "LOW" ? "低" : "注意"} · 规则信心 {decision.confidence >= 0.75 ? "高" : decision.confidence >= 0.5 ? "中" : decision.readiness === "UNKNOWN" ? "不足" : "低"}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="h-11 rounded-2xl bg-accent px-3 text-sm font-bold text-accent-fg" onClick={decision.change === "none" ? onOriginal : onAccept}>{decision.change === "none" ? "按原计划" : "接受建议"}</button>
        <button type="button" className="h-11 rounded-2xl border border-line px-3 text-sm" onClick={onEdit}>修改</button>
        <button type="button" className="h-11 rounded-2xl px-3 text-sm text-muted" onClick={onHold ?? onOriginal}>暂不执行</button>
        <button type="button" className="h-11 rounded-card border border-line px-3" onClick={() => setOpen((value) => !value)}>为什么</button>
      </div>
      {open ? (
        <div className="mt-2 text-muted">
          <p>证据 {decision.evidence.join("，") || "暂无"}</p>
          <p>反证 {decision.counterEvidence.join("，") || "暂无"}</p>
          <p>监测 {decision.monitor.join("，")}</p>
          <p>不确定性 {decision.readiness === "UNKNOWN" ? "高" : "未记录的睡眠和长期跑量不算已知"}</p>
          <p>记录 {decision.decision_id}</p>
        </div>
      ) : null}
    </section>
  )
}

export function DecisionInbox({
  decision,
  onAccept,
  onKeep,
  onEdit,
}: {
  decision: DecisionRecord
  onAccept: () => void
  onKeep: () => void
  onEdit: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState("")
  const copy = inboxCopy(decision)
  const settled =
    decision.status === "EXECUTED" || decision.status === "ACCEPTED" || decision.status === "VALIDATED"
      ? "已经执行过，不会再执行一次。"
      : decision.status === "REJECTED"
        ? "已拒绝。原建议还在，不会再要求确认。"
        : decision.status === "MODIFIED"
          ? "已记下你的修改。原建议还在，不会改原来的课表。"
          : decision.status === "EXPIRED" || Date.parse(decision.expiry) <= Date.now()
            ? "这条建议已经过期，不能执行。"
            : null
  return (
    <section className="rounded-card border border-line bg-surface p-3 text-sm">
      <h3 className="font-bold">今日决策</h3>
      <p className="mt-1 text-xs text-muted">建议，不是已经发生的事实</p>
      <p className="mt-2 font-bold">{copy.headline}</p>
      <p>{copy.action}</p>
      <p className="mt-2">原因：{copy.reason}</p>
      <p className="mt-2">依据：</p>
      <ul className="text-muted">
        {(decision.evidence.length ? decision.evidence : ["已记录的疲劳和周期"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-2">规则信心：{copy.confidence}</p>
      <p>不确定性：{copy.uncertainty}</p>
      {decision.counter_evidence.length ? <p className="mt-1 text-muted">{decision.counter_evidence.join("")}</p> : null}
      {settled ? <p className="mt-2">{settled}</p> : copy.needsConfirm ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="h-11 rounded-2xl bg-accent px-3 text-sm font-bold text-accent-fg" onClick={onAccept}>接受调整</button>
          <button type="button" className="h-11 rounded-2xl border border-line px-3 text-sm" onClick={onKeep}>保持原计划</button>
          <button type="button" className="h-11 rounded-2xl border border-line px-3 text-sm" onClick={() => setEdit(true)}>修改</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="h-11 rounded-2xl bg-accent px-3 text-sm font-bold text-accent-fg" onClick={onAccept}>按建议执行</button>
          <button type="button" className="h-11 rounded-2xl border border-line px-3 text-sm" onClick={() => setOpen((value) => !value)}>查看详情</button>
        </div>
      )}
      {edit ? (
        <div className="mt-2 flex gap-2">
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="你要怎么改" className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 outline-none" />
          <button type="button" className="h-11 shrink-0 rounded-2xl border border-line px-3 text-sm" onClick={() => { if (text.trim()) onEdit(text.trim()) }}>记下</button>
        </div>
      ) : null}
      {open ? (
        <div className="mt-2 text-muted">
          <p>其他可能 {decision.alternative_actions.join("，") || "没有"}</p>
          <p>监测 {decision.monitoring_conditions.join("，") || "未记录"}</p>
          <p>打断 {decision.interrupt_conditions.join("，") || "未记录"}</p>
        </div>
      ) : null}
    </section>
  )
}
