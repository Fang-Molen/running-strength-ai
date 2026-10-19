import { recordPlanAudit } from "@/lib/core/adaptive-plan-audit"
import { currentAthleteId } from '@/lib/core/events'
import { arbitratePlanChange } from "@/lib/core/adaptive-plan-permissions"
import { useMemo, useRef, useState } from "react"
import { Check, ChevronLeft, LoaderCircle, Pencil, ShieldCheck, X } from "lucide-react"
import { clockSeconds, daysUntil, distanceLabel } from "@/lib/strength/agent"
import type { Profile } from "@/lib/strength/profile"
import { chooseCoachPlanCandidate, coachPlanPreferenceSources, planningQuestions, saveCoachPlanCandidate, type CoachPlanCandidate, type PlanningContext, type StoredCoachPlanCandidate } from "@/lib/core/coach-plan"
import { projectPlanningRecovery } from "@/lib/core/coach-plan-recovery"
import { CoachPlanSessionDetails } from "@/components/coach-plan-session-details"
import { generateCoachPlan } from "@/lib/strength/coach-plan-ai"
import { CoachKnowledgePanel } from "@/components/coach-knowledge-panel"
import { profileSexLabel, type CoachingBackground } from "@/lib/core/coach-knowledge"

function buildContext(profile: Profile, weeklyRunKm: number | null, strengthDays: number, recentDate: string, recoveryScores: number[]): PlanningContext {
  const goalMark = profile.marks.find((item) => clockSeconds(item.goal) != null) ?? null
  const recentMark = profile.marks.find((item) => item.meters === goalMark?.meters && clockSeconds(item.recent) != null) ?? profile.marks.find((item) => clockSeconds(item.recent) != null) ?? null
  const sourceIds = ["profile:availability"]
  const sources = [{ id: "profile:availability", detail: `每周最多训练 ${profile.days} 天；每次最多 ${profile.minutes} 分钟；力量候选最多 ${strengthDays} 天` }]
  if (goalMark) {
    sourceIds.push("profile:goal")
    sources.push({ id: "profile:goal", detail: `${distanceLabel(goalMark.meters)} 目标 ${goalMark.goal}${goalMark.deadline ? `；日期 ${goalMark.deadline}` : ""}` })
  }
  if (recentMark) {
    sourceIds.push("profile:recent")
    sources.push({ id: "profile:recent", detail: `${distanceLabel(recentMark.meters)} 最近实际 ${recentMark.recent}；实际成绩日期${recentDate || "未记录"}` })
  }
  if (weeklyRunKm != null) {
    sourceIds.push("user:weekly-volume")
    sources.push({ id: "user:weekly-volume", detail: `用户本次填写近期稳定周跑量 ${weeklyRunKm} 公里` })
  }
  const limit = profile.limit.trim()
  if (limit) {
    sourceIds.push("profile:limit")
    sources.push({ id: "profile:limit", detail: `用户填写身体限制：${limit}` })
  }
  const preferenceNotes = coachPlanPreferenceSources()
  for (const note of preferenceNotes) {
    sourceIds.push(note.sourceId)
    sources.push({ id: note.sourceId, detail: `用户明确提出的计划修改：${note.text}` })
  }
  const recovery = projectPlanningRecovery(recoveryScores)
  sourceIds.push(...recovery.sourceIds)
  sources.push(...recovery.sources)
  return {
    goal: { distanceMeters: goalMark?.meters ?? null, targetSeconds: goalMark ? clockSeconds(goalMark.goal) : null, deadline: goalMark?.deadline || null, sourceIds: goalMark ? ["profile:goal"] : [] },
    recentPerformance: recentMark ? { distanceMeters: recentMark.meters, seconds: clockSeconds(recentMark.recent)!, recordedAt: recentDate || "日期未记录", sourceIds: ["profile:recent"] } : null,
    weeklyRunKm,
    availableDays: profile.days,
    minutesPerDay: profile.minutes,
    strengthDays,
    experience: "UNKNOWN",
    pain: /疼痛|疼|痛/.test(limit),
    rehab: /康复|术后|复健/.test(limit),
    daysToCompetition: goalMark?.deadline ? daysUntil(goalMark.deadline) : null,
    recoveryStatus: recovery.status,
    planningRecoveryScores: recovery.scores,
    sourceIds,
    sources,
    preferenceNotes,
  }
}

const TYPE_LABEL: Record<string, string> = { EASY_RUN: "轻松跑", QUALITY_RUN: "质量跑", LONG_RUN: "长距离", STRENGTH: "力量", RECOVERY: "恢复", REST: "休息" }

export function CoachPlanSheet({ profile, onEditProfile, onClose }: { profile: Profile; onEditProfile: () => void; onClose: () => void }) {
  const [weeklyKm, setWeeklyKm] = useState("")
  const [recentDate, setRecentDate] = useState("")
  const [strengthDays, setStrengthDays] = useState(1)
  const [recoveryMode, setRecoveryMode] = useState("MISSING")
  const [recoveryA, setRecoveryA] = useState("")
  const [recoveryB, setRecoveryB] = useState("")
  const generationInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [candidateState, setCandidateState] = useState<{ athleteId: string; value: CoachPlanCandidate } | null>(null)
  const candidate = candidateState?.athleteId === currentAthleteId() ? candidateState.value : null
  const [storedValue, setStored] = useState<StoredCoachPlanCandidate | null>(null)
  const stored = storedValue?.athleteId === currentAthleteId() ? storedValue : null
  const [modification, setModification] = useState("")
  const [support, setSupport] = useState<CoachingBackground["support"]>("NONE")
  const [shareSex, setShareSex] = useState(false)
  const recoveryScores = useMemo(() => recoveryMode === "MISSING" ? [] : recoveryMode === "AVAILABLE" ? [Number(recoveryA)] : [Number(recoveryA), Number(recoveryB)], [recoveryMode, recoveryA, recoveryB])
  const validRecovery = recoveryScores.every((score) => Number.isInteger(score) && score >= 1 && score <= 10)
  const context = useMemo(() => buildContext(profile, weeklyKm.trim() ? Number(weeklyKm) : null, strengthDays, recentDate, validRecovery ? recoveryScores : []), [profile, weeklyKm, strengthDays, recentDate, validRecovery, recoveryScores])

  const [feedbackRegion, setFeedbackRegion] = useState("")
  const [feedbackSeverity, setFeedbackSeverity] = useState("")
  const [feedbackLimitation, setFeedbackLimitation] = useState("UNKNOWN")
  const [feedbackDaysAhead, setFeedbackDaysAhead] = useState(0)
  const feedbackDecision = feedbackRegion.trim() ? arbitratePlanChange({
    daysAhead: feedbackDaysAhead, expectedRevision: 0, actualRevision: 0,
    reason: "用户训练前不适反馈", evidenceIds: ["user:pre-session-feedback"],
    discomfort: { region: feedbackRegion, severity: feedbackSeverity === "" ? null : Number(feedbackSeverity), functionalLimitation: feedbackLimitation === "UNKNOWN" ? null : feedbackLimitation === "YES" },
    nextSessionIntensity: "HARD", proposedAction: "POSTPONE",
  }) : null

  function saveFeedbackChoice(choice: "CONFIRM" | "DECLINE" | "ACKNOWLEDGE") {
    if (!candidate || !feedbackRegion.trim()) return
    const request = {
      daysAhead: feedbackDaysAhead, expectedRevision: 0, actualRevision: 0,
      reason: "用户训练前不适反馈（候选计划，尚无正式计划版本）", evidenceIds: ["user:pre-session-feedback"],
      discomfort: { region: feedbackRegion.trim(), severity: feedbackSeverity === "" ? null : Number(feedbackSeverity), functionalLimitation: feedbackLimitation === "UNKNOWN" ? null : feedbackLimitation === "YES" },
      nextSessionIntensity: "HARD" as const, proposedAction: "POSTPONE" as const,
    }
    try {
      const event = recordPlanAudit(window.localStorage, { candidateId: stored?.candidateId ?? "", request, choice })
      setMessage(`反馈已记录（${event.kind}），但没有修改正式课表。训练前仍须根据症状复核。`)
    } catch {
      setMessage("反馈未保存或当前状态不允许该操作。正式课表没有改变。")
    }
  }

  async function generate() {
    if (generationInFlight.current) return
    if (weeklyKm.trim() && (!Number.isFinite(Number(weeklyKm)) || Number(weeklyKm) < 0 || Number(weeklyKm) > 500)) return setMessage("周跑量需要填写有效的非负数，未知请留空，不能把无效输入当成 0。")
    if (!validRecovery) return setMessage("请将恢复记录填写为 1–10 的整数；未记录请选择未记录，不能把空白当成 0。")
    const questions = planningQuestions(context)
    if (questions.length) return setMessage(questions.join("；"))
    generationInFlight.current = true
    setBusy(true)
    setMessage("")
    const requestedAthlete = currentAthleteId()
    try {
      const background: CoachingBackground = { sex: shareSex && profile.sex === "female" ? "FEMALE" : shareSex && profile.sex === "male" ? "MALE" : "UNKNOWN", support }
      const result = await generateCoachPlan({ data: { context, background } })
      if (currentAthleteId() !== requestedAthlete) return
      if (!result.ok) {
        setMessage(result.questions?.join("；") || `没有拿到可核对的候选计划：${result.reason}${result.detail ? `（${result.detail}）` : ""}`)
        return
      }
      setCandidateState({ athleteId: requestedAthlete, value: result.candidate })
      const saved = saveCoachPlanCandidate(result.candidate)
      setStored(saved)
      if (saved.status === 'NOT_SAVED') setMessage('候选没有保存，尚不能采纳；原课表未改变。请稍后重试保存。')
    } catch {
      setMessage("计划请求失败。没有用固定模板冒充模型计划，请手动重试。")
    } finally {
      generationInFlight.current = false
      setBusy(false)
    }
  }

  function choose(status: "ACCEPTED" | "REJECTED" | "MODIFIED") {
    if (!stored) return
    if (stored.status === 'NOT_SAVED') return setMessage('候选尚未保存，不能记录采纳；原课表没有改变。')
    const next = chooseCoachPlanCandidate(stored.candidateId, status, modification)
    if (!next) return setMessage("选择没有保存，请重试")
    setStored(next)
    setMessage(status === "ACCEPTED" ? "已接受为候选方向；尚未覆盖现有课表。" : status === "REJECTED" ? "已拒绝；现有课表没有变化。" : "修改要求已保存；尚未覆盖现有课表。")
  }

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
    <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-3xl items-center gap-3"><button type="button" onClick={onClose} aria-label="返回" className="grid size-11 place-items-center rounded-full border border-line"><ChevronLeft className="size-5" /></button><div className="flex-1"><p className="text-xs text-muted">实验功能 · 接受不会应用课表</p><h2 className="text-lg font-bold">跑步＋力量周期计划</h2></div><button type="button" onClick={onClose} aria-label="关闭" className="grid size-11 place-items-center rounded-full border border-line"><X className="size-5" /></button></div></header>
    <main className="mx-auto max-w-3xl px-4 py-4 pb-12">
      {!candidate ? <>
        <label className="mb-3 block rounded-card border border-line bg-surface p-3"><span className="text-xs text-muted">近期实际成绩日期（不是目标比赛日期）</span><input type="date" value={recentDate} onChange={(event) => setRecentDate(event.target.value)} className="mt-1 h-12 w-full min-w-0 rounded-card border border-line bg-bg px-3" /></label>
        <section className="rounded-card border border-line bg-surface p-4"><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-accent" /><h3 className="font-bold">先用证据做计划，不猜能力</h3></div><p className="mt-2 text-sm text-muted">需要目标、近期同类成绩和可训练时间。没有周跑量时仍可生成保守候选，但不允许写百分比递增。</p>
          <dl className="mt-3 space-y-2 text-sm"><div><dt className="text-muted">目标</dt><dd>{context.goal.distanceMeters ? `${distanceLabel(context.goal.distanceMeters)} · ${profile.marks.find((item) => item.meters === context.goal.distanceMeters)?.goal || "时间未记录"}` : "未记录"}</dd></div><div><dt className="text-muted">近期成绩</dt><dd>{context.recentPerformance ? `${distanceLabel(context.recentPerformance.distanceMeters)} · ${profile.marks.find((item) => item.meters === context.recentPerformance?.distanceMeters)?.recent}` : "未记录"}</dd></div><div><dt className="text-muted">时间条件</dt><dd>每周 {profile.days} 天 · 每次 {profile.minutes} 分钟</dd></div></dl>
          <button type="button" onClick={onEditProfile} className="mt-3 h-11 w-full rounded-card border border-line font-bold">补充目标和近期成绩</button>
        </section>
        <section className="mt-3 grid grid-cols-2 gap-3 rounded-card border border-line bg-surface p-4"><label><span className="text-xs text-muted">近期稳定周跑量（可空）</span><input value={weeklyKm} onChange={(event) => setWeeklyKm(event.target.value)} inputMode="decimal" placeholder="公里" className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3" /></label><label><span className="text-xs text-muted">每周力量候选</span><select value={strengthDays} onChange={(event) => setStrengthDays(Number(event.target.value))} className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"><option value={0}>0 天</option><option value={1}>1 天</option><option value={2}>2 天</option></select></label></section>
        <section className="mt-3 rounded-card border border-line bg-surface p-4">
          <label className="block"><span className="text-xs text-muted">本次计划准备：主观恢复</span><select aria-label="恢复记录状态" value={recoveryMode} onChange={(event) => setRecoveryMode(event.target.value)} className="mt-1 h-12 w-full min-w-0 rounded-card border border-line bg-bg px-3"><option value="MISSING">未记录</option><option value="AVAILABLE">一条已核对记录</option><option value="CONFLICTING">两条记录待核对</option></select></label>
          {recoveryMode !== "MISSING" ? <div className="mt-3 grid grid-cols-2 gap-3"><label className="min-w-0"><span className="text-xs text-muted">恢复记录 A（1–10）</span><input aria-label="恢复记录 A" inputMode="numeric" value={recoveryA} onChange={(event) => setRecoveryA(event.target.value)} className="mt-1 h-12 w-full min-w-0 rounded-card border border-line bg-bg px-3" /></label>{recoveryMode === "CONFLICTING" ? <label className="min-w-0"><span className="text-xs text-muted">恢复记录 B（1–10）</span><input aria-label="恢复记录 B" inputMode="numeric" value={recoveryB} onChange={(event) => setRecoveryB(event.target.value)} className="mt-1 h-12 w-full min-w-0 rounded-card border border-line bg-bg px-3" /></label> : null}</div> : null}
          <p className="mt-2 text-xs text-muted">只用于本次候选准备，不替代历史训练记录。{recoveryMode === "CONFLICTING" ? "两条都保留；先人工核对，不平均、不代选。核对后改选一条，并填写有效分数。" : "缺失不代表恢复正常，也不代表 0。"}</p>
        </section>
        <details className="mt-3 rounded-card border border-line bg-surface p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">自愿补充执教背景</summary>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input aria-label="本次提供性别" type="checkbox" checked={shareSex} onChange={(event) => setShareSex(event.target.checked)} disabled={busy} />本次提供资料中的性别（{profileSexLabel(profile.sex)}）</label>
          <p className="mt-1 text-xs text-muted">默认不提供。性别不代表个人恢复速度，也不推断月经或孕产状态；有相关不适或限制请另行核对。</p>
          <label className="mt-3 block"><span className="text-xs text-muted">希望教练额外支持什么（可不选）</span><select aria-label="心理支持偏好" value={support} onChange={(event) => setSupport(event.target.value as CoachingBackground["support"])} disabled={busy} className="mt-1 h-12 w-full min-w-0 rounded-card border border-line bg-bg px-3"><option value="NONE">不需要额外支持</option><option value="RACE_NERVES">赛前紧张</option><option value="CONFIDENCE">训练信心</option><option value="CONSISTENCY">坚持训练的习惯</option></select></label>
          <p className="mt-2 text-xs text-muted">仅影响本次候选的解释与沟通，不是心理诊断，不写入训练事件或疲劳分。</p>
        </details>
        <button type="button" onClick={generate} disabled={busy} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent font-bold text-accent-fg disabled:opacity-50">{busy ? <LoaderCircle className="size-5 animate-spin" /> : null}{busy ? "正在生成并校验" : "生成待确认候选计划"}</button>
      </> : <>
        <div className="rounded-card border border-warn bg-surface p-3 text-sm"><b>还没有应用。</b> 这是独立候选，必须由你接受、拒绝或提出修改；当前课表、Decision 和疲劳分都不会变化。</div>
        <section className="mt-3 rounded-card border border-line bg-surface p-3"><h3 className="font-bold">{candidate.horizonWeeks} 周周期</h3><div className="mt-2 space-y-2">{candidate.phases.map((phase) => <div key={phase.name} className="rounded-card bg-bg p-3"><div className="flex justify-between gap-2"><b>{phase.name}</b><span className="text-sm text-muted">{phase.weeks} 周 · {phase.progression}</span></div><p className="mt-1 text-sm">{phase.purpose}</p></div>)}</div></section>
        <section className="mt-3 rounded-card border border-line bg-surface p-3"><h3 className="font-bold">第一周候选</h3><div className="mt-2 space-y-2">{candidate.firstWeek.map((session) => <div key={session.day} className="rounded-card bg-bg p-3"><div className="flex justify-between"><b>第 {session.day} 天 · {session.title}</b><span className="text-xs text-muted">{TYPE_LABEL[session.type] ?? session.type}</span></div><p className="mt-1 text-sm">{session.prescription}</p><CoachPlanSessionDetails session={session} /><p className="mt-1 text-xs text-muted">{session.rationale}</p></div>)}</div></section>
        <section className="mt-3 rounded-card border border-line bg-surface p-3" aria-label="训练前反馈与计划调整权限">
          <h3 className="font-bold">训练前反馈 · 调整权限预检</h3>
          <p className="mt-1 text-xs text-muted">仅展示建议和安全限制；不会自动修改已保存的训练计划。</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-sm">不适部位<input value={feedbackRegion} onChange={event => setFeedbackRegion(event.target.value)} placeholder="如：腘绳肌" className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2" /></label>
            <label className="text-sm">疼痛 0–10<select value={feedbackSeverity} onChange={event => setFeedbackSeverity(event.target.value)} className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2"><option value="">未确认</option>{Array.from({length:11},(_,n)=><option key={n} value={n}>{n}</option>)}</select></label>
            <label className="text-sm">动作功能受限<select value={feedbackLimitation} onChange={event => setFeedbackLimitation(event.target.value)} className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2"><option value="UNKNOWN">未确认</option><option value="YES">是</option><option value="NO">否</option></select></label>
            <label className="text-sm">调整哪天<select value={feedbackDaysAhead} onChange={event => setFeedbackDaysAhead(Number(event.target.value))} className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2"><option value={0}>今天</option><option value={1}>明天</option><option value={3}>未来 2–7 天</option><option value={8}>8 天后</option></select></label>
          </div>
          {feedbackDecision ? <p role="status" className="mt-3 rounded-card bg-bg p-3 text-sm font-medium">{feedbackDecision.explanation}</p> : <p className="mt-2 text-xs text-muted">填写不适部位后显示权限判断。出现明显疼痛、跛行或功能障碍，应停止高风险训练并寻求专业评估。</p>}
          {feedbackDecision ? <div className="mt-3 flex flex-wrap gap-2">
            {feedbackDecision.status === "REQUIRE_CONFIRMATION" ? <button type="button" onClick={() => saveFeedbackChoice("CONFIRM")} className="min-h-11 rounded-card border border-line px-3 text-sm font-bold">确认记录调整意向（不应用课表）</button> : null}
            {feedbackDecision.status === "NOTIFY_BEFORE_CHANGE" || feedbackDecision.status === "REPLAN_REVIEW" ? <button type="button" onClick={() => saveFeedbackChoice("ACKNOWLEDGE")} className="min-h-11 rounded-card border border-line px-3 text-sm font-bold">已知悉并记录</button> : null}
            <button type="button" onClick={() => saveFeedbackChoice("DECLINE")} className="min-h-11 rounded-card border border-line px-3 text-sm">不接受本次调整</button>
          </div> : null}
        </section>
        <section className="mt-3 rounded-card border border-line bg-surface p-3"><h3 className="font-bold">进阶与减量合同</h3><p className="mt-2 text-sm">{candidate.progressionRule}</p><p className="mt-2 text-sm">{candidate.deloadRule}</p></section>
        <textarea value={modification} onChange={(event) => setModification(event.target.value)} maxLength={500} placeholder="想怎么改，例如：周三不能训练、力量放周五" className="mt-3 w-full rounded-card border border-line bg-surface p-3" rows={3} />
        {stored?.status === 'NOT_SAVED' && <button type="button" className="mt-3 min-h-11 rounded-card border border-line px-3 text-sm" onClick={() => { const saved = saveCoachPlanCandidate(candidate); setStored(saved); setMessage(saved.status === 'NOT_SAVED' ? '仍未保存，请保留当前内容；原课表未改变。' : '候选已保存在当前本机档案；采纳仍不会自动覆盖课表。') }}>重试保存候选</button>}
        <div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => choose("ACCEPTED")} className="flex min-h-12 items-center justify-center gap-1 rounded-card bg-accent px-2 text-sm font-bold text-accent-fg"><Check className="size-4" />接受方向</button><button type="button" onClick={() => choose("MODIFIED")} disabled={!modification.trim()} className="flex min-h-12 items-center justify-center gap-1 rounded-card border border-line px-2 text-sm font-bold disabled:opacity-40"><Pencil className="size-4" />按我修改</button><button type="button" onClick={() => choose("REJECTED")} className="min-h-12 rounded-card border border-line px-2 text-sm font-bold">不采用</button></div>
      </>}
      <CoachKnowledgePanel mode="PLAN" />
      {message ? <p className="mt-4 rounded-card bg-surface-2 p-3 text-sm">{message}</p> : null}
    </main>
  </div>
}
