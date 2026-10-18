import { structuredCoachingCandidate, hasExplicitUniformPacingGoal } from './coach-structured-candidate.ts'
import type { CoachNextSessionView } from './coach-next-session.ts'
import { isConditionalAdvice, isNonFactNumber, reportedSessionRpes } from "./coach-claim-scope.ts";
import { buildCoachingReview, formatCoachingReview } from "./coach-playbook-review.ts";
import { strictIso } from "./coach-v4-c11-adapter.ts";
import {
  comparisonProtocol,
  type EvolutionEvidence,
  type EvolutionSnapshot,
} from "./coach-evolution-v4.ts";
import {
  auditFeedbackRevision,
  buildSafetyEnvelope,
  compareCompetingHypotheses,
} from "./coach-evolution-v4-c10.ts";
import { revisePriorClaims } from "./coach-v4-c13-revision.ts";
import { screenLocalSafety, localSafetyAction } from "./coach-local-safety.ts";

/** Software coordination, not new sport knowledge or an LLM's private chain of thought. */
export const REASONING_VERSION = "FK-R10-REASONING-1" as const;
/** A user's explicit date alias can identify a session; it is not a saved cycle mapping. */
function resolveWeekReference(question: string, facts: readonly EvolutionEvidence[]) {
  const week = "第\\s*[一二三四五六七八九十0-9]+\\s*周";
  const weeks = [...question.matchAll(new RegExp(week, "g"))];
  if (!weeks.length) return { status: "NOT_REQUESTED" as const, date: null };
  const dates = [...question.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => m[0]);
  const anchor = question.match(new RegExp(`${week}\\s*(?:就是|即|指的是|对应|[（(])\\s*(\\d{4}-\\d{2}-\\d{2})`));
  const executionDates = new Set(facts.filter(e => e.metric === "SPLIT_SECONDS" && e.confirmation === "CONFIRMED" && e.value !== null).map(e => e.eventAt.slice(0, 10)));
  const matched = weeks.length === 1 && dates.length === 1 && anchor && executionDates.size === 1 && executionDates.has(anchor[1]);
  return matched
    ? { status: "USER_DATE_ANCHOR" as const, date: anchor[1] }
    : { status: "UNRESOLVED" as const, date: null };
}
/** Evidence-read failures must not suppress immediately visible safety signals. No storage reads. */
export function reasoningReadFailure(question: string, medicalRisk = false): string {
  const level = screenLocalSafety(question).level;
  const action = localSafetyAction(question);
  if (action) return action;
  const message =
    "本次训练证据读取失败，尚不能完成个人分析。请重试或核对原始记录；缺数据不代表恢复正常，没有修改训练。";
  if (level === "EMERGENCY")
    return (
      "存在可能需要紧急处理的风险信号，请停止训练并及时联系当地急救或急诊服务；这不是诊断。" +
      message
    );
  if (level === "MEDICAL_REVIEW" || medicalRisk)
    return (
      "存在尚需核实的疼痛或健康风险线索，请暂停相关训练并寻求运动医学或康复专业评估。" + message
    );
  return message;
}
export type ReasoningBasis = {
  version: typeof REASONING_VERSION;
  athleteId: string;
  asOf: string;
  scopeOccurrenceIds: string[];
  sources: { sourceId: string; signature: string }[];
  complete: boolean;
};
const sameScope = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const sourceSignature = (s: EvolutionSnapshot, id: string) =>
  JSON.stringify(
    s.active
      .filter((e) => e.sourceId === id)
      .map((e) =>
        JSON.stringify([
          e.id,
          e.occurrenceId,
          e.metric,
          e.value,
          e.unit,
          e.context,
          e.eventAt,
          e.recordedAt,
          e.source,
          e.confirmation,
          e.supersedes ?? null,
          e.measurement ?? null,
          e.unverifiedHeartRate ?? null,
        ]),
      )
      .sort(),
  );
export function readReasoningBasis(
  value: unknown,
  athleteId: string,
  asOf: string,
  scope: readonly string[],
): ReasoningBasis | null {
  if (!value || typeof value !== "object") return null;
  const b = value as ReasoningBasis;
  if (
    !["FK-R6-REASONING-1", "FK-R7-REASONING-1", "FK-R9-REASONING-1", REASONING_VERSION].includes(b.version) ||
    b.athleteId !== athleteId ||
    typeof b.asOf !== "string" ||
    !strictIso(b.asOf) ||
    Date.parse(b.asOf) >= Date.parse(asOf) ||
    !Array.isArray(b.scopeOccurrenceIds) ||
    b.scopeOccurrenceIds.length > 6 ||
    !b.scopeOccurrenceIds.every((id) => typeof id === "string" && id.length <= 80) ||
    !sameScope(b.scopeOccurrenceIds, scope) ||
    !Array.isArray(b.sources) ||
    b.sources.length > 32 ||
    typeof b.complete !== "boolean" ||
    !b.sources.every(
      (e) =>
        e &&
        typeof e.sourceId === "string" &&
        e.sourceId.length <= 160 &&
        typeof e.signature === "string" &&
        e.signature.length <= 2400,
    )
  )
    return null;
  if (new Set(b.sources.map((e) => e.sourceId)).size !== b.sources.length) return null;
  return {
    ...b,
    version: REASONING_VERSION,
    scopeOccurrenceIds: [...b.scopeOccurrenceIds],
    sources: b.sources.map((e) => ({ ...e })),
  };
}
export function createReasoningBasis(
  snapshot: EvolutionSnapshot,
  scope: readonly string[],
): ReasoningBasis {
  const ids = [
    ...new Set(
      snapshot.active.filter((e) => scope.includes(e.occurrenceId)).map((e) => e.sourceId),
    ),
  ].sort();
  const sources = ids
    .slice(0, 32)
    .map((sourceId) => ({ sourceId, signature: sourceSignature(snapshot, sourceId) }));
  const bounded = sources.filter((e) => e.signature.length <= 2400);
  return {
    version: REASONING_VERSION,
    athleteId: snapshot.athleteId,
    asOf: snapshot.asOf,
    scopeOccurrenceIds: [...scope],
    sources: bounded,
    complete: bounded.length === ids.length,
  };
}
export function latestReasoningBasis(
  messages: readonly { role: string; analysisBasis?: unknown }[],
  athleteId: string,
  asOf: string,
  scope: readonly string[],
): ReasoningBasis | null {
  for (const message of [...messages].reverse())
    if (message.role === "coach") {
      const basis = readReasoningBasis(message.analysisBasis, athleteId, asOf, scope);
      if (basis) return basis;
    }
  return null;
}
const unknownLabels: Record<string, string> = {
  NO_ACTUAL_SPLITS: "实际跑步分段未记录",
  NO_SLEEP_RECORD: "所选训练的睡眠反馈未知",
  NO_SESSION_RPE: "整课主观强度未知",
  NO_REST_PROTOCOL: "实际组间或轮间恢复未知",
  NO_EXPLICIT_PLAN_OR_GOAL: "对应目标或计划条件未知",
  NO_SYMPTOM_ASSESSMENT: "症状反馈未知，不能当作无痛",
  USER_REPORT_NEEDS_CONFIRMATION: "自报来源尚需核对",
  UNVERIFIED_SOURCE_PRESENT: "来源未经正式核验",
  UNRESOLVED_EVIDENCE_CONFLICT: "存在未解决的记录冲突",
};
export function buildReasoningFrame(input: {
  snapshot: EvolutionSnapshot;
  question: string;
  scopeOccurrenceIds: readonly string[];
  priorBasis?: unknown;
  previous?: EvolutionSnapshot;
  nextSession?: CoachNextSessionView;
}) {
  const { snapshot: s, question, scopeOccurrenceIds: scope } = input;
  const focus = { ...s, active: s.active.filter((e) => scope.includes(e.occurrenceId)) };
  const basis = createReasoningBasis(s, scope);
  const computed = computeReasoningFacts(s, scope);
  const conflicts = (s.conflictEvidence ?? []).filter((e) => scope.includes(e.occurrenceId));
  const reportedRpe = reportedSessionRpes(question);
  const recordedRpe = focus.active.filter((e) => e.metric === "SESSION_RPE" && e.value !== null);
  const rpeMismatch =
    scope.length === 1 && reportedRpe.some((n) => recordedRpe.some((e) => e.value !== n));
  if (rpeMismatch) conflicts.push(...recordedRpe);
  const timeReference = resolveWeekReference(question, focus.active);
  const unresolvedWeek = timeReference.status === "UNRESOLVED" && scope.length === 1;
  const rpeConflict =
    conflicts.some((e) => e.metric === "SESSION_RPE") ||
    rpeMismatch ||
    new Set(reportedRpe).size > 1;
  const prior = readReasoningBasis(input.priorBasis, s.athleteId, s.asOf, scope);
  let revision: {
    status: "NO_PRIOR" | "UNCHANGED" | "REASSESS_REQUIRED" | "UNVERIFIED_PRIOR";
    reasons: string[];
    withdrawnSources: string[];
  } = { status: "NO_PRIOR", reasons: [], withdrawnSources: [] };
  if (input.priorBasis) {
    if (!prior || !prior.complete || !input.previous)
      revision = {
        status: "UNVERIFIED_PRIOR",
        reasons: ["PRIOR_BASIS_NOT_REPRODUCIBLE"],
        withdrawnSources: [],
      };
    else {
      const previous = {
        ...input.previous,
        active: input.previous.active.filter((e) => scope.includes(e.occurrenceId)),
      };
      const unreproducible = prior.sources.filter(
        (e) => sourceSignature(previous, e.sourceId) !== e.signature,
      );
      const audit = auditFeedbackRevision(previous, focus);
      const claims = revisePriorClaims(previous, focus, [
        { claimId: "previous-analysis", text: "", sourceIds: prior.sources.map((e) => e.sourceId) },
      ]);
      const withdrawn = [
        ...new Set(
          claims
            .flatMap((c) => c.invalidatedSourceIds)
            .concat(unreproducible.map((e) => e.sourceId)),
        ),
      ];
      const changed = audit.changed || withdrawn.length > 0 || !basis.complete;
      revision = {
        status: changed ? "REASSESS_REQUIRED" : "UNCHANGED",
        reasons: [
          ...audit.reasonCodes,
          ...(unreproducible.length ? ["HISTORICAL_BASIS_CHANGED"] : []),
          ...(!basis.complete ? ["CURRENT_BASIS_INCOMPLETE"] : []),
        ],
        withdrawnSources: withdrawn,
      };
    }
  }
  const safety = buildSafetyEnvelope(s, question);
  const task = /(?:只|仅).{0,3}(?:计算|算|平均|合计)/.test(question)
    ? "CALCULATE"
    : /更正|纠错|撤回|改成/.test(question)
      ? "REVISE"
      : /安排|调整|下一课|加量|减量|怎么练/.test(question)
        ? "DECISION"
        : "ANALYZE";
  const unknowns = [...s.missing.map((k) => unknownLabels[k] ?? k)];
  for (const [index, id] of scope.entries())
    for (const [metric, label] of [
      ["SLEEP_HOURS", "睡眠"],
      ["SESSION_RPE", "整课RPE"],
      ["PAIN_SCORE", "症状"],
    ] as const)
      if (
        !focus.active.some(
          (e) => e.occurrenceId === id && e.metric === metric && e.value !== null,
        ) &&
        scope.length > 1
      )
        unknowns.push(`所选第${index + 1}课${label}未知`);
  const stage =
    safety.level !== "NONE"
      ? "SAFETY_FIRST"
      : !scope.length
        ? "CLARIFY_SCOPE"
        : unresolvedWeek
          ? "RESOLVE_TIME_REFERENCE"
          : (s.scopeConflictCount ?? s.quarantined.length) || rpeConflict
            ? "RESOLVE_CONFLICT"
            : !focus.active.some((e) => e.source !== "PLAN" && e.value !== null)
              ? "REQUEST_FACTS"
              : "EXPLAIN_EVIDENCE";
  const hypotheses =
    task === "CALCULATE" || safety.level !== "NONE" || !scope.length
      ? []
      : compareCompetingHypotheses(s).map((h) => ({
          ...h,
          supportSourceIds: h.supportSourceIds.filter((id) =>
            focus.active.some((e) => e.sourceId === id),
          ),
          challengeSourceIds: h.challengeSourceIds.filter((id) =>
            focus.active.some((e) => e.sourceId === id),
          ),
          evidenceState: h.supportSourceIds.some((id) =>
            focus.active.some((e) => e.sourceId === id),
          )
            ? h.limitations.length
              ? "CONFOUNDED"
              : "SUPPORTED_POSSIBILITY"
            : "NO_SPECIFIC_SUPPORT",
          causalConfidence: "UNDETERMINED" as const,
        }));
  const nextQuestion =
    stage === "SAFETY_FIRST"
      ? "当前是否仍有症状或日常活动受影响？"
      : stage === "CLARIFY_SCOPE"
        ? "你希望分析哪一次训练？"
        : stage === "RESOLVE_TIME_REFERENCE"
          ? "你说的这周对应哪天或哪条训练记录？目前关联的训练不能自动等同于该周。"
          : stage === "RESOLVE_CONFLICT"
            ? rpeConflict
              ? "这些RPE分别对应同一整课、单组，还是不同时间？哪条有效，哪条需要更正？"
              : "冲突记录分别来自什么时间和来源，哪条已经核实有效？"
            : s.missing.includes("NO_SLEEP_RECORD") &&
                focus.active.some((e) => e.metric === "SESSION_RPE" && (e.value ?? 0) >= 8)
              ? "这节训练前一晚实际睡了多久？"
              : s.missing.includes("NO_REST_PROTOCOL")
                ? "这节训练实际的组间和轮间休息各是多少？"
                : s.missing.includes("NO_SESSION_RPE")
                  ? "这节训练的整课RPE是多少（1—10）？"
                  : s.missing.includes("NO_SLEEP_RECORD")
                    ? "这节训练前一晚实际睡了多久？"
                    : "后续恢复反馈与这节训练之间相隔多久？";
  const coachingReview = buildCoachingReview({snapshot:s, computed, scope, stage, task, question});
  return {
    version: REASONING_VERSION,
    coachingReview,
    nextSession: input.nextSession,
    uniformPacingGoalReported: hasExplicitUniformPacingGoal(question),
    task,
    stage,
    scopeOccurrenceIds: [...scope],
    timeReference,
    observedSourceIds: focus.active
      .filter((e) => e.source !== "PLAN" && e.value !== null)
      .map((e) => e.sourceId),
    computed,
    conflicts,
    reportedRpe: rpeConflict ? reportedRpe : [],
    hypotheses,
    unknowns: [...new Set(unknowns)],
    nextQuestion,
    safety,
    revision,
    basis,
    decision: {
      status:
        stage === "SAFETY_FIRST"
          ? "SAFETY_REVIEW"
          : stage === "EXPLAIN_EVIDENCE"
            ? "CONDITIONAL_REVIEW"
            : "VERIFY_FIRST",
      planWrite: false,
      causalEffectKnown: false,
      conditions: [
        "先核实来源、训练课次与可比条件",
        "使用新反馈重新核对原解释",
        "候选修改须展示变化并由用户确认",
      ],
      tradeoff: "暂缓调整会减少立即改变刺激的机会，但可避免按误读或冲突记录改课",
    },
    memoryRole: "ANALYSIS_DEPENDENCY_RECEIPT_NOT_ATHLETE_FACT",
    operations: [
      "SCOPE",
      "RECONCILE_FACTS",
      "COMPARE_EXPLANATIONS",
      "CHECK_COUNTER_EVIDENCE",
      "REVIEW_OPTIONS",
      "REVISE_DEPENDENCIES",
    ],
  };
}
export type ReasoningFrame = ReturnType<typeof buildReasoningFrame>;
export function reasoningForModel(frame: ReasoningFrame, maxChars = 4000) {
  const out = {
    version: frame.version,
    task: frame.task,
    candidate: structuredCoachingCandidate(frame),
    stage: frame.stage,
    scopeOccurrenceIds: frame.scopeOccurrenceIds,
    timeReference: frame.timeReference,
    computed: {
      ...frame.computed,
      points: frame.computed.points.slice(0, 8),
      groups: frame.computed.groups
        .slice(0, 4)
        .map((g) => ({ ...g, sourceIds: g.sourceIds.slice(0, 4), paces: g.paces.slice(0, 4) })),
      rests: frame.computed.rests.slice(0, 6),
      ratings: frame.computed.ratings.slice(0, 4),
      strength: frame.computed.strength.slice(0, 8),
      heartRates: frame.computed.heartRates.slice(0, 8),
      truncated:
        frame.computed.points.length > 8 ||
        frame.computed.groups.length > 4 ||
        frame.computed.rests.length > 6,
    },
    conflicts: frame.conflicts
      .slice(0, 4)
      .map((e) => ({
        metric: e.metric,
        value: e.value,
        sourceId: e.sourceId,
        eventAt: e.eventAt,
        recordedAt: e.recordedAt,
        source: e.source,
      })),
    reportedRpe: frame.reportedRpe,
    hypotheses: frame.hypotheses
      .slice(0, 3)
      .map((h) => ({
        id: h.id,
        explanation: h.explanation,
        supportSourceIds: h.supportSourceIds.slice(0, 2),
        challengeSourceIds: h.challengeSourceIds.slice(0, 2),
        evidenceState: h.evidenceState,
        causalConfidence: h.causalConfidence,
        limitations: h.limitations,
        missingEvidence: h.missingEvidence,
      })),
    unknowns: frame.unknowns.slice(0, 4),
    nextQuestion: frame.nextQuestion,
    revision: {
      status: frame.revision.status,
      reasons: frame.revision.reasons,
      withdrawnSources: frame.revision.withdrawnSources.slice(0, 2),
    },
    decision: frame.decision,
    truncated: false,
  };
  const bound = Math.max(1200, Math.min(4000, Number.isFinite(maxChars) ? maxChars : 3000));
  while (JSON.stringify(out).length > bound && out.computed.points.length) {
    out.computed.points.pop();
    out.computed.truncated = true;
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.computed.groups.length) {
    out.computed.groups.pop();
    out.computed.truncated = true;
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.computed.rests.length) {
    out.computed.rests.pop();
    out.computed.truncated = true;
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.computed.ratings.length) {
    out.computed.ratings.pop();
    out.computed.truncated = true;
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.computed.strength.length) {
    out.computed.strength.pop();
    out.computed.truncated = true;
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.computed.heartRates.length) {
    out.computed.heartRates.pop(); out.computed.truncated = true; out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.conflicts.length) {
    out.conflicts.pop();
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.hypotheses.length) {
    out.hypotheses.pop();
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.unknowns.length) {
    out.unknowns.pop();
    out.truncated = true;
  }
  while (JSON.stringify(out).length > bound && out.revision.withdrawnSources.length) {
    out.revision.withdrawnSources.pop();
    out.truncated = true;
  }
  return out;
}
export function reasoningRevisionNotice(frame: ReasoningFrame): string {
  if (frame.revision.status === "UNVERIFIED_PRIOR")
    return "上次分析的依据无法完整复现，旧结论暂不作为本次判断依据。";
  if (frame.revision.status === "REASSESS_REQUIRED")
    return frame.revision.withdrawnSources.length
      ? "上次分析依赖的记录已更正、撤回或无法复现，撤回相关解释，按当前证据重新核对。"
      : "新增反馈改变了分析依据，重新核对旧解释，不能直接沿用原建议。";
  return "";
}
export function formatReasoningFrame(frame: ReasoningFrame, snapshot: EvolutionSnapshot): string {
  const notice = reasoningRevisionNotice(frame),
    lines = [notice];
  if (frame.safety.mustRetain) {
    lines.push(frame.safety.message ?? "");
    if(frame.safety.level!=="EMERGENCY"&&!/[？?]/.test(frame.safety.message??'')) lines.push(frame.nextQuestion);
    return lines.filter(Boolean).join("\n");
  }
  if (frame.stage === "CLARIFY_SCOPE") {
    lines.push("尚未关联本次训练，不能借其他课次的记录判断本次能力或恢复。", frame.nextQuestion);
    return lines.filter(Boolean).join("\n");
  }
  lines.push(formatComputedFacts(frame));
  if (frame.stage === "RESOLVE_TIME_REFERENCE") {
    lines.push("周次与所选课次尚未对应，不能把其他周或作废训练的成绩移过来。", frame.nextQuestion);
    return lines.filter(Boolean).join("\n");
  }
  if (frame.stage === "RESOLVE_CONFLICT") {
    lines.push(formatReasoningConflicts(frame), "先解决来源冲突：不平均、不挑选有利值，不根据冲突数据加量。", frame.nextQuestion);
    return lines.filter(Boolean).join("\n");
  }
  if (frame.coachingReview) lines.push(formatCoachingReview(frame.coachingReview));
  else {
    if (frame.unknowns.length) lines.push("仍未知：" + frame.unknowns.slice(0, 3).join("；") + "。");
    lines.push(frame.nextQuestion);
  }
  lines.push(formatReasoningCandidate(frame));
  if (frame.coachingReview && !/次日/.test(lines.at(-1)??"")) lines.push(frame.coachingReview.followup);
  return lines.filter(Boolean).join("\n");
}
export const REASONING_SYSTEM_BOUNDARY =
  "\nreasoningFrame是软件整理的证据与依赖关系，不是已证实的生理结论或模型思维过程。先按scopeOccurrenceIds绑定课次；说明客观观察与未知项。竞争解释必须区分有支持、被反证和未获得支持；排序不等于概率。缺失不当反证。目标不当能力，计划不当完成，别的课次不当本次。revision要求重算时撤回依赖旧依据的解释，不沿用聊天里旧建议；basis仅为依赖收据不是个人事实。必须使用computed里与所选课次绑定的实际数字，不从history恢复旧数字；训练分析正文依次写事实、两种竞争解释（各写支持与推翻条件）、关键缺项；计算或知识问答不硬凑解释。建议写在sections.suggestion或nextStep且不要重复，注明变量、前后值、依据、适用条件、终止条件和复核反馈。没有依据时列出具体缺项，不能为显得具体而缩短休息。RPE冲突展示两个原值与时间并核对整课/单组，不重复问RPE是多少。给出条件、取舍及最多三个会改变决定的核对问题，不展示内部字段，不因模板存在就宣称原因已确定。";

/** Only live selected observations; actual distances never come from goals or planned slots. */
export function computeReasoningFacts(snapshot: EvolutionSnapshot, scope: readonly string[]) {
  const facts = snapshot.active.filter(
    (e) => scope.includes(e.occurrenceId) && e.source !== "PLAN" && e.value !== null,
  );
  const points = facts
    .filter((e) => e.metric === "SPLIT_SECONDS" && e.unit === "s" && e.value! > 0)
    .map((e) => {
      const distance = Number(e.context.match(/:(\d+(?:\.\d+)?)m$/)?.[1]);
      const distanceMeters = Number.isFinite(distance) && distance > 0 ? distance : null;
      const paceSecondsPerKm = distanceMeters ? (e.value! * 1000) / distanceMeters : null;
      return {
        occurrenceId: e.occurrenceId,
        sourceId: e.sourceId,
        seconds: Number(e.value!.toFixed(2)),
        distanceMeters,
        paceSecondsPerKm,
        pace: paceSecondsPerKm !== null ? clock(paceSecondsPerKm) : null,
        protocol: e.context,
        eventAt: e.eventAt,
        source: e.source,
        confirmation: e.confirmation,
      };
    })
    .sort((a, b) => {
      if(a.occurrenceId===b.occurrenceId){
        // Import source ordinal is acquisition order, independent of distance/comparison eligibility.
        const imported=(id:string)=>Number(id.match(/:run-(\d+)$/)?.[1]);
        const ai=imported(a.sourceId),bi=imported(b.sourceId);
        if(Number.isFinite(ai)&&Number.isFinite(bi))return ai-bi;
        const repeat=(p:string)=>p.match(/^running:([^:]+):rep:([^:]+):([^:]+):([1-9]\d*):([1-9]\d*)/);
        const ar=repeat(a.protocol),br=repeat(b.protocol);
        if(ar&&br&&ar.slice(1,4).join(':')===br.slice(1,4).join(':'))return Number(ar[4])-Number(br[4])||Number(ar[5])-Number(br[5]);
      }
      return Date.parse(a.eventAt)-Date.parse(b.eventAt)||a.sourceId.localeCompare(b.sourceId,undefined,{numeric:true});
    });
  const by = new Map<string, typeof points>();
  for (const p of points) {
    const protocol = comparisonProtocol(p.protocol);
    if (!protocol || p.distanceMeters === null) continue;
    const key = JSON.stringify([p.occurrenceId, protocol, p.source, p.confirmation]);
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  const groups = [...by.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({
      occurrenceId: g[0].occurrenceId,
      sourceIds: g.map((p) => p.sourceId),
      count: g.length,
      distanceMeters: g[0].distanceMeters,
      paces: g.map((p) => p.pace!),
      trend: g.every((p, i) => i === 0 || p.seconds < g[i - 1].seconds)
        ? "FASTER"
        : g.every((p, i) => i === 0 || p.seconds > g[i - 1].seconds)
          ? "SLOWER"
          : "MIXED",
      averagePace: clock(
        (g.reduce((n, p) => n + p.seconds, 0) * 1000) /
          g.reduce((n, p) => n + p.distanceMeters!, 0),
      ),
      firstToLastSeconds: Number((g.at(-1)!.seconds - g[0].seconds).toFixed(2)),
    }));
  const rests = facts
    .filter((e) => e.metric === "REST_SECONDS" && e.unit === "s")
    .map((e) => {
      const rest = e.context.match(
        /^running:([^:]+):rest:([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)$/,
      );
      const work =
        rest && rest[3] === "AFTER_REPEAT"
          ? points.filter(
              (p) =>
                p.occurrenceId === e.occurrenceId &&
                p.source === e.source &&
                p.confirmation === e.confirmation &&
                p.protocol.startsWith(
                  `running:${rest[1]}:rep:${rest[2]}:${rest[4]}:${rest[5]}:${rest[6]}:`,
                ),
            )
          : [];
      return {
        occurrenceId: e.occurrenceId,
        sourceId: e.sourceId,
        seconds: Number(e.value!.toFixed(2)),
        protocol: e.context,
        workSourceId: work.length === 1 ? work[0].sourceId : null,
        recoveryToWorkRatio:
          work.length === 1 ? Number((e.value! / work[0].seconds).toFixed(3)) : null,
      };
    });
  const ratings = facts
    .filter((e) => ["SESSION_RPE", "SLEEP_HOURS", "PAIN_SCORE", "SUBJECTIVE_RECOVERY", "SORENESS"].includes(e.metric))
    .map((e) => ({
      metric: e.metric,
      value: e.value!,
      unit: e.unit,
      sourceId: e.sourceId,
      eventAt: e.eventAt,
      confirmation: e.confirmation,
    }));
  const strength = facts.filter(e => e.metric === "STRENGTH_REPS" || e.metric === "STRENGTH_SECONDS").map(e => {
    const weights = facts.filter(w => w.metric === "STRENGTH_KG" && w.occurrenceId === e.occurrenceId && w.context === e.context);
    const kg = weights.length === 1 ? weights[0].value : null;
    return { occurrenceId:e.occurrenceId, protocol:e.context, amount:e.value!, unit:e.unit, kg,
      volumeKgReps:e.metric === "STRENGTH_REPS" && kg !== null ? kg * e.value! : null,
      sourceIds:[e.sourceId,...weights.map(w=>w.sourceId)] };
  });
  return {
    points,
    groups,
    rests,
    ratings,
    strength,
    heartRates: facts.filter(e=>e.metric==='HR_AVG_BPM'&&e.measurement&&facts.some(p=>p.metric==='SPLIT_SECONDS'&&p.sourceId===e.measurement!.segmentSourceId&&p.occurrenceId===e.occurrenceId)).map(e=>({value:e.value!,sourceId:e.sourceId,method:e.measurement!.method,segmentSourceId:e.measurement!.segmentSourceId})),
    unverifiedHeartRates: facts.filter(e=>e.metric==='SPLIT_SECONDS'&&e.unverifiedHeartRate).map(e=>({value:e.unverifiedHeartRate!.value,sourceId:e.sourceId,method:'UNKNOWN',segmentSourceId:e.sourceId})),
    heartRateStatus: facts.some(e=>e.metric==='HR_AVG_BPM') ? "FORMAL_OBSERVATIONS_ONLY" as const : "NOT_A_FORMAL_FIELD" as const,
    physiologicalCauseKnown: false as const,
  };
}
const clock = (seconds: number) => {
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export function formatComputedFacts(frame: ReasoningFrame, detailed=false): string {
  const c=frame.computed,fmt=(n:number)=>Number(n.toFixed(2)),lines:string[]=[];
  const ratings=c.ratings.slice(0,3).map(r=>`${r.metric==='SESSION_RPE'?'整课RPE：':r.metric==='SLEEP_HOURS'?'记录睡眠':r.metric==='SUBJECTIVE_RECOVERY'?'主观恢复':r.metric==='SORENESS'?'酸痛':'疼痛'}${r.metric==='SESSION_RPE'?'':' '}${fmt(r.value)}${r.unit==='h'?'小时':'/10'}`);
  if(ratings.length)lines.push(`所选训练记录：${ratings.join('，')}。`);
  if(c.strength.length){
    const sets=c.strength.slice(0,detailed?12:3);
    lines.push(sets.map((set,i)=>`第${i+1}个力量组 ${set.kg===null?'重量未知':fmt(set.kg)+'kg'} × ${fmt(set.amount)}${set.unit==='s'?'秒':'次'}`).join('；')+(c.strength.length>sets.length?`；另有${c.strength.length-sets.length}组。`:'。'));
  }
  const grouped=new Set(c.groups.flatMap(g=>g.sourceIds));
  for(const g of c.groups.slice(0,detailed?4:2))lines.push(`${g.count} × ${g.distanceMeters}米，配速序列 ${c.points.filter(p=>g.sourceIds.includes(p.sourceId)).map(p=>p.pace??"未知").join(" → ")} /km；平均配速 ${g.averagePace}/km，${g.trend==='FASTER'?'逐段加快':g.trend==='SLOWER'?'逐段变慢':'用时有波动'}；末段较首段${g.firstToLastSeconds<0?'快':'慢'} ${fmt(Math.abs(g.firstToLastSeconds))}秒。`);
  const ungrouped=detailed?c.points:c.points.filter(p=>!grouped.has(p.sourceId));
  for(const p of ungrouped.slice(0,detailed?48:3))lines.push(`分段${c.points.indexOf(p)+1}：${p.distanceMeters===null?'实际距离未知':fmt(p.distanceMeters)+'米'}，${fmt(p.seconds)}秒${p.pace?'，配速 '+p.pace+'/km':'，缺实际距离，不能计算配速'}。`);
  if(ungrouped.length>(detailed?48:3))lines.push(`另有${ungrouped.length-(detailed?48:3)}段，详细数据保留在记录中。`);
  if(c.unverifiedHeartRates.length)lines.push(`分段心率自报 ${c.unverifiedHeartRates.slice(0,8).map(h=>fmt(h.value)).join(" / ")} bpm；测量方法未知，仅保留观察，不进入正式心率比较。`);
  if(c.heartRates.length)lines.push(`分段平均心率 ${c.heartRates.slice(0,8).map(h=>fmt(h.value)).join(' / ')} bpm；${c.heartRates.some(h=>h.method==='UNKNOWN')?'测量方法未记录，需核对后比较':'方法见记录，单凭平均值不能判断效率变化'}。`);
  if(detailed)for(const r of c.rests)lines.push(`实际恢复 ${fmt(r.seconds)}秒${r.recoveryToWorkRatio!==null?'，恢复/工作时长比 '+r.recoveryToWorkRatio:''}。`);
  if(!detailed){
    const warmup=c.points.filter(p=>/warmup|WARMUP|CONTINUOUS|continuous/.test(p.protocol));
    const strides=c.points.filter(p=>/STRIDE|stride|acceleration/.test(p.protocol)||(p.distanceMeters!==null&&p.distanceMeters<=250&&p.seconds<=45));
    const main=c.points.filter(p=>!warmup.includes(p)&&!strides.includes(p));
    const structure=c.points.length?`结构：热身/连续段${warmup.length}，主课${main.length}，恢复${c.rests.length}，加速跑${strides.length}段（按记录标签与短段形态，目的待核对）。`:'';
    const run=c.groups.map(g=>`${g.count} × ${g.distanceMeters}米：${g.paces.join(' → ')} /km；首末${g.firstToLastSeconds<0?'快':'慢'}${fmt(Math.abs(g.firstToLastSeconds))}秒`).join('；');
    const missing=c.points.filter(p=>p.distanceMeters===null).length;
    const individual=!run?c.points.slice(0,8).map(p=>`${p.distanceMeters===null?'距离未知':fmt(p.distanceMeters)+'米'}/${fmt(p.seconds)}秒${p.pace?'，'+p.pace+'/km':''}`).join('；'):'';
    const rest=c.rests.length?`恢复时长 ${fmt(Math.min(...c.rests.map(r=>r.seconds)))}–${fmt(Math.max(...c.rests.map(r=>r.seconds)))}秒。`:'';
    const heart=[...c.heartRates,...c.unverifiedHeartRates];
    return [ [structure,ratings.length?'所选训练记录：'+ratings.join('，')+'。':''].filter(Boolean).join(' '),
      [run||individual,missing?`${missing}段缺实际距离，不能计算配速。`:''].filter(Boolean).join('；'),
      [rest,c.strength.length?lines.find(l=>l.includes('力量组')):''].filter(Boolean).join(' '),
      heart.length?`分段平均心率 ${heart.slice(0,12).map(h=>fmt(h.value)).join(' / ')} bpm；方法 ${[...new Set(heart.map(h=>h.method==='UNKNOWN'?'未知（仅作观察）':h.method))].join('、')}，仅描述，不能据此判断效率。`:''
    ].filter(Boolean).join('\n');
  }
  return lines.join('\n');
}
export function formatReasoningConflicts(frame: ReasoningFrame): string {
  const sourceLabels: Record<string, string> = {
    TRAINING_FACT: "训练记录",
    DEVICE: "设备记录",
    USER_REPORT: "自报记录",
  };
  const lines = frame.conflicts
    .filter((e) => e.metric === "SESSION_RPE")
    .map(
      (e) =>
        `冲突RPE ${e.value}/10；${sourceLabels[e.source] ?? "待核实来源"}；发生 ${e.eventAt}，录入 ${e.recordedAt}。`,
    );
  if (frame.reportedRpe.length)
    lines.push(
      `本次消息自报RPE ${frame.reportedRpe.join("、")}/10，未保存；绑定记录与自报不能互相覆盖。`,
    );
  return lines.join("\n");
}
/** Render the same read-only candidate sent to the model and returned to the UI. */
export function formatReasoningCandidate(frame: ReasoningFrame): string {
  const candidate = structuredCoachingCandidate(frame);
  if (!candidate || candidate.decision === "HOLD")
    return "下一课候选待核实：尚不能定剂量，先核对缺项、冲突、症状与恢复。若当前无不适、日常活动正常且目标仍适合，可维持原课并观察逐组表现、整课RPE和次日反馈；出现不适、动作变形或热身反应异常就停止并重新评估。不按未知数据增加训练。";
  const group = frame.computed.groups.find((g) => g.count >= 2)!;
  const from = candidate.from as number, to = candidate.to as number;
  if (candidate.decision === "CONDITIONAL_ADJUST")
    return `下一课条件候选（未应用）：已记录同条件分段逐段变慢；仅在确认原目标为均匀配速、当前无不适、睡眠和精神如常且热身正常后，可考虑只把组间恢复 ${clock(from)} → ${clock(to)}（${from}秒 → ${to}秒），保留${group.count}组×${group.distanceMeters}米和原目标配速，其余段不变。这是一次可撤回的恢复时间试调，不能据此认定掉速原因；前提未满足先维持原课并观察，症状或恢复变差则暂停相关训练。出现不适、动作变形或热身反应异常停止并重新评估；对照逐段用时、整课RPE与次日反馈，无改善则撤回并重新核对。须由用户确认，不自动改课。`;
  return `下一课对照候选（未应用）：仅在目标和周期适合、当前无不适且恢复反馈核对后，考虑沿用已记录的${group.count}组×${group.distanceMeters}米、组间${clock(from)}（${from}秒）；恢复间隔 ${clock(from)} → ${clock(to)}，本次不缩短休息、不增加组数或速度。先保持可比条件，逐组记录实际用时、整课RPE和次日反馈；出现不适或热身反应异常停止并重新评估。若需调整，一次只改一个明确变量，展示前后值与理由后再采用；不能因最后一组更快就直接加密训练。`;
}
/** Lexical numeric check, not a complete semantic correctness certification. */
export function numericReasoningIssues(frame: ReasoningFrame, text: string): string[] {
  const issues: string[] = [];
  const valid = new Set([
    ...frame.computed.points.flatMap((p) => (p.pace ? [p.pace] : [])),
    ...frame.computed.groups.map((g) => g.averagePace),
  ]);
  const averages = new Set(frame.computed.groups.map(g => g.averagePace));
  // Carry the pace subject across commas, but reset it at sentence boundaries or a new metric.
  for (const sentence of text.split(/[。；\n]/)) {
    let paceSubject = false, averageSubject = false;
    for (const clause of sentence.split(/[，,]/)) {
      if (/配速|\/km|每公里/i.test(clause)) {
        paceSubject = true;
        if (/配速|每公里/i.test(clause)) averageSubject = /(?:平均|均值)配速/.test(clause);
      } else if (/休息|恢复|间隔|用时|耗时|RPE|睡眠/i.test(clause)) {
        paceSubject = false;
        averageSubject = false;
      }
      if (!paceSubject) continue;
      for (const m of clause.matchAll(/(?<!\d)(\d{1,2}:[0-5]\d)(?!\d)/g)) {
        const prefix = clause.slice(0, m.index);
        // Only a directly denied numeric assertion is exempt; "不能证明进步" denies a cause, not the number.
        if (/(?:不是|并非|不应为|不能(?:把配速)?(?:写成|当成|算成))\s*$/.test(prefix)) continue;
        if (isConditionalAdvice(sentence) || isNonFactNumber(clause,m.index??0)) continue;
        if (!valid.has(m[1])) issues.push("UNVERIFIED_PACE_VALUE");
        if (averageSubject) {
          if (!averages.size) issues.push("UNCOMPUTED_AVERAGE_PACE");
          else if (!averages.has(m[1])) issues.push("UNVERIFIED_AVERAGE_PACE");
        }
      }
    }
  }
  for (const [metric, pattern] of [
    ["SESSION_RPE", /RPE\s*(?:为|是|记为|[:：])?\s*(\d+(?:\.\d+)?)/gi],
    ["SLEEP_HOURS", /睡眠(?:时间|时长)?(?:为|是|记为|[:：])?\s*(\d+(?:\.\d+)?)\s*小时/g],
  ] as const) {
    const values = new Set(
      frame.computed.ratings.filter((r) => r.metric === metric).map((r) => r.value),
    );
    for (const match of text.matchAll(pattern))
      if (!isNonFactNumber(text,match.index??0) && !values.has(Number(match[1]))) issues.push("UNVERIFIED_RECOVERY_VALUE");
  }
  if (frame.computed.ratings.some((r) => r.metric === "SESSION_RPE"))
    for (const clause of text.split(/[。；，,\n]|但(?:是)?/)) {
      if (!/(?:缺少|未记录|缺乏).{0,12}(?:整课主观强度|RPE)|RPE.{0,6}(?:未记录|缺失)/i.test(clause)) continue;
      if (/(?:并非|不是|不能说|不再)(?:缺少|未记录|缺乏)/.test(clause)) continue;
      // These gaps concern another time span; none certifies that its data actually exists or is absent.
      if (/长期|历次|历史|趋势|当前|现在|此刻/.test(clause) && !/本次|这次|所选|该课/.test(clause)) continue;
      issues.push("RECORDED_RPE_MISSTATED_AS_MISSING");
    }
  return [...new Set(issues)];
}

export function nextStepReasoningIssues(
  frame: ReasoningFrame,
  nextStep: string | null,
  citations: readonly string[],
): string[] {
  if (!nextStep) return [];
  const issues: string[] = [];
  // Questions and bounded candidate advice do not assert completed facts or authorize a write.
  const questionOnly=/[？?]/.test(nextStep)&&!/建议|可以|执行|安排/.test(nextStep);
  if(questionOnly)return [];
  const conditional=isConditionalAdvice(nextStep);
  if(!conditional&&/(?:组间|轮间|休息|恢复).{0,30}(?:缩短|减少|压到|降到)/.test(nextStep))issues.push('REST_DENSITY_INCREASE_NOT_SUPPORTED');
  if (!conditional && /(?:组间|轮间|休息|恢复).{0,12}\d/.test(nextStep) &&
      !frame.computed.rests.some(r=>citations.includes(r.sourceId))) issues.push('NEXT_STEP_REST_SOURCE_MISSING');
  if(frame.stage==='RESOLVE_CONFLICT'&&!conditional)issues.push('NEXT_STEP_EVIDENCE_NOT_READY');
  return issues;
}
