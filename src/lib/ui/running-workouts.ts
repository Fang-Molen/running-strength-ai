import { createAppEvent, loadEvents, notifyCommittedEvent } from "@/lib/core/events";
import { getTrainingOccurrence, listTrainingOccurrences } from "@/lib/core/occurrence";
import {
  getRunningPlan,
  getRunningPlanSnapshot,
  listRunningPlans,
  saveRunningPlan,
  type RunningPlan,
  type SessionComponent,
} from "@/lib/core/running-plan";
import {
  projectRunningExecution,
  recordRunningContinuousCompleted,
  recordRunningRecovery,
  recordRunningRepetitionCompleted,
  recordRunningRepetitionSkipped,
  type RecoveryExecution,
  type RunningRepetitionSlot,
} from "@/lib/core/running-execution";
import type { AppEvent } from "@/lib/core/types";
import {
  commitRunningTransaction,
  runningFeedback,
  type RunningFeedback,
} from "@/lib/core/running-transaction";

export type TrackPresetId = "200x4x2" | "400-200";

export type TrackDraft = {
  targetSeconds: Array<number | null>;
  repRestSeconds: number | null;
  roundRestSeconds: number | null;
  stepRestSeconds: number | null;
};

export function emptyDraft(id: TrackPresetId): TrackDraft {
  return {
    targetSeconds: id === "400-200" ? [null, null] : [null],
    repRestSeconds: null,
    roundRestSeconds: null,
    stepRestSeconds: null,
  };
}

export function trackComponents(id: TrackPresetId, draft: TrackDraft): SessionComponent[] {
  if (id === "200x4x2") {
    return [
      {
        componentId: "run",
        modality: "RUNNING",
        purpose: "REPETITION_SPEED",
        structure: {
          kind: "REPEATED",
          blocks: [
            {
              blockId: "main",
              roundCount: 2,
              recoveryAfterRoundSeconds: draft.roundRestSeconds,
              steps: [
                {
                  stepId: "rep200",
                  plannedDistanceMeters: 200,
                  plannedDurationSeconds: draft.targetSeconds[0] ?? null,
                  repeatCount: 4,
                  recoveryAfterRepeatSeconds: draft.repRestSeconds,
                  recoveryBeforeNextStepSeconds: null,
                },
              ],
            },
          ],
        },
      },
    ];
  }
  return [
    {
      componentId: "run",
      modality: "RUNNING",
      purpose: "REPETITION_SPEED",
      structure: {
        kind: "REPEATED",
        blocks: [
          {
            blockId: "combo",
            roundCount: 1,
            recoveryAfterRoundSeconds: null,
            steps: [
              {
                stepId: "m400",
                plannedDistanceMeters: 400,
                plannedDurationSeconds: draft.targetSeconds[0] ?? null,
                repeatCount: 1,
                recoveryAfterRepeatSeconds: null,
                recoveryBeforeNextStepSeconds: draft.stepRestSeconds,
              },
              {
                stepId: "m200",
                plannedDistanceMeters: 200,
                plannedDurationSeconds: draft.targetSeconds[1] ?? null,
                repeatCount: 1,
                recoveryAfterRepeatSeconds: null,
                recoveryBeforeNextStepSeconds: null,
              },
            ],
          },
        ],
      },
    },
  ];
}

export const TRACK_PRESETS: { id: TrackPresetId; planId: string; title: string }[] = [
  { id: "200x4x2", planId: "track-200-4-2", title: "200米 × 4 × 2" },
  { id: "400-200", planId: "track-400-200", title: "400米 + 200米" },
];

export function confirmTrackPlan(id: TrackPresetId, draft: TrackDraft) {
  const preset = TRACK_PRESETS.find((item) => item.id === id);
  if (!preset) return { ok: false as const, errors: ["preset"] };
  return saveRunningPlan({
    planId: preset.planId,
    planSlotId: preset.planId,
    components: trackComponents(id, draft),
  });
}

export function openTrackOccurrence(planId: string) {
  return (
    [...listTrainingOccurrences()]
      .reverse()
      .find((item) => item.sessionId === planId && item.lifecycle === "IN_PROGRESS") ?? null
  );
}

export function startTrackSession(
  planId: string,
  candidate?: RunningPlan,
): { ok: true; trainingOccurrenceId: string } | { ok: false; reason: string } {
  const plan = candidate ?? getRunningPlan(planId);
  if (!plan) return { ok: false, reason: "还没有确认的计划，不会临时编一节。" };
  const open = openTrackOccurrence(planId);
  if (open) return { ok: true, trainingOccurrenceId: open.trainingOccurrenceId };
  const started = createAppEvent("TRAINING_STARTED", { sessionId: plan.planSlotId });
  const occurrence = {
    trainingOccurrenceId: started.event_id,
    startEventId: started.event_id,
    sessionId: plan.planSlotId,
    planSlotId: plan.planSlotId,
    trainingPlanSnapshotId: null,
    planKnowledge: "UNKNOWN" as const,
    lifecycle: "IN_PROGRESS" as const,
    outcome: "UNKNOWN" as const,
    reason: "UNKNOWN" as const,
    startedAt: started.timestamp,
    endedAt: null,
    closeEventId: null,
    duplicateCloseEventIds: [],
    duplicateStartEventIds: [],
    futureLinks: { strengthRpeEventId: null, painEventIds: [] as [], injuryEventId: null },
  };
  const snapshot = {
    runningPlanSchemaVersion: 1 as const,
    runningSnapshotId: crypto.randomUUID(),
    capturedAt: started.timestamp,
    trainingOccurrenceId: started.event_id,
    sourcePlanId: plan.planId,
    components: structuredClone(plan.components),
  };
  if (
    !commitRunningTransaction({
      version: 1,
      id: crypto.randomUUID(),
      events: [started],
      starts: [occurrence],
      snapshots: [snapshot],
      ...(candidate ? { plans: [{ plan: candidate, previous: null }] } : {}),
    })
  )
    return { ok: false, reason: "开始保存未确认；请刷新核对后重试，不会声称训练已开始。" };
  notifyCommittedEvent(started);
  return { ok: true, trainingOccurrenceId: occurrence.trainingOccurrenceId };
}

function positive(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export function commitTrackSlot(
  slot: RunningRepetitionSlot,
  action: "complete" | "skip",
  secondsText: string,
  distanceText: string,
): { ok: true } | { ok: false; reason: string } {
  const current = projectRunningExecution(slot.trainingOccurrenceId, loadEvents()).repetitions.find(
    (item) =>
      item.componentId === slot.componentId &&
      item.blockId === slot.blockId &&
      item.stepId === slot.stepId &&
      item.roundOrdinal === slot.roundOrdinal &&
      item.repeatOrdinal === slot.repeatOrdinal,
  );
  if (!current || current.status !== "NOT_YET_RECORDED")
    return { ok: false, reason: "这段已经有记录，不会再写一条。" };
  if (action === "skip") {
    if (secondsText.trim() || distanceText.trim())
      return { ok: false, reason: "跳过不能同时写实际成绩。" };
    const saved = recordRunningRepetitionSkipped(slot);
    return saved ? { ok: true } : { ok: false, reason: "跳过没有写入，原记录还在。" };
  }
  const actualDurationSeconds = positive(secondsText);
  const actualDistanceMeters = positive(distanceText);
  if (
    (actualDurationSeconds === null && actualDistanceMeters === null) ||
    actualDurationSeconds === undefined ||
    actualDistanceMeters === undefined
  )
    return { ok: false, reason: "成绩要写成大于 0 的数，或留空表示未记录。" };
  const saved = recordRunningRepetitionCompleted({
    ...slot,
    actualDurationSeconds,
    actualDistanceMeters,
  });
  return saved ? { ok: true } : { ok: false, reason: "这段没有写入，原记录还在。" };
}

export type CustomStep = {
  distanceMeters: number | null;
  repeatCount: number;
  targetSeconds: number | null;
  repRestSeconds: number | null;
  stepRestSeconds: number | null;
};

export function customTrackComponents(
  rounds: number,
  roundRestSeconds: number | null,
  steps: CustomStep[],
): { ok: true; components: SessionComponent[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Number.isInteger(rounds) || rounds < 1) errors.push("roundCount");
  if (rounds === 1 && roundRestSeconds != null) errors.push("recoveryAfterRoundSeconds");
  if (roundRestSeconds != null && roundRestSeconds < 0) errors.push("recoveryAfterRoundSeconds");
  if (steps.length === 0) errors.push("steps");
  steps.forEach((step, index) => {
    if (!Number.isInteger(step.repeatCount) || step.repeatCount < 1) errors.push("repeatCount");
    if (
      (step.distanceMeters == null || step.distanceMeters <= 0) &&
      (step.targetSeconds == null || step.targetSeconds <= 0)
    )
      errors.push("stepDose");
    if (step.distanceMeters != null && step.distanceMeters <= 0)
      errors.push("plannedDistanceMeters");
    if (step.targetSeconds != null && step.targetSeconds <= 0)
      errors.push("plannedDurationSeconds");
    if (step.repeatCount === 1 && step.repRestSeconds != null)
      errors.push("recoveryAfterRepeatSeconds");
    if (index === steps.length - 1 && step.stepRestSeconds != null)
      errors.push("recoveryBeforeNextStepSeconds");
    if (step.repRestSeconds != null && step.repRestSeconds < 0)
      errors.push("recoveryAfterRepeatSeconds");
    if (step.stepRestSeconds != null && step.stepRestSeconds < 0)
      errors.push("recoveryBeforeNextStepSeconds");
  });
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    components: [
      {
        componentId: "run",
        modality: "RUNNING",
        purpose: "REPETITION_SPEED",
        structure: {
          kind: "REPEATED",
          blocks: [
            {
              blockId: "main",
              roundCount: rounds,
              recoveryAfterRoundSeconds: roundRestSeconds,
              steps: steps.map((step, index) => ({
                stepId: `step-${index + 1}`,
                plannedDistanceMeters: step.distanceMeters,
                plannedDurationSeconds: step.targetSeconds,
                repeatCount: step.repeatCount,
                recoveryAfterRepeatSeconds: step.repeatCount === 1 ? null : step.repRestSeconds,
                recoveryBeforeNextStepSeconds:
                  index === steps.length - 1 ? null : step.stepRestSeconds,
              })),
            },
          ],
        },
      },
    ],
  };
}

export function saveCustomTrackPlan(
  planId: string,
  rounds: number,
  roundRestSeconds: number | null,
  steps: CustomStep[],
) {
  if (typeof planId !== "string" || planId.length === 0)
    return { ok: false as const, errors: ["planId"] };
  const built = customTrackComponents(rounds, roundRestSeconds, steps);
  if (!built.ok) return built;
  return saveRunningPlan({ planId, planSlotId: planId, components: built.components });
}

export function describeTrackPlan(plan: RunningPlan): string {
  const component = plan.components.find((item) => item.modality === "RUNNING");
  if (!component || component.modality !== "RUNNING" || component.structure.kind !== "REPEATED")
    return plan.planId;
  return component.structure.blocks
    .map((block) => {
      const text = block.steps
        .map((step) => {
          const distance =
            step.plannedDistanceMeters == null ? "未设置距离" : `${step.plannedDistanceMeters}米`;
          return step.repeatCount > 1 ? `${distance}×${step.repeatCount}` : distance;
        })
        .join("+");
      return block.roundCount > 1 ? `(${text})×${block.roundCount}` : text;
    })
    .join(" · ");
}

export function listTrackPlans(): RunningPlan[] {
  return listRunningPlans();
}

export function describePlanRest(plan: RunningPlan): string {
  const component = plan.components.find((item) => item.modality === "RUNNING");
  if (!component || component.modality !== "RUNNING" || component.structure.kind !== "REPEATED")
    return "计划休息：结构未记录";
  const parts: string[] = [];
  for (const block of component.structure.blocks) {
    if (block.roundCount > 1)
      parts.push(
        block.recoveryAfterRoundSeconds == null
          ? "轮间未设置"
          : `轮间 ${block.recoveryAfterRoundSeconds} 秒`,
      );
    for (const step of block.steps) {
      if (step.repeatCount > 1)
        parts.push(
          step.recoveryAfterRepeatSeconds == null
            ? "组间未设置"
            : `组间 ${step.recoveryAfterRepeatSeconds} 秒`,
        );
      if (step.recoveryBeforeNextStepSeconds != null)
        parts.push(`段间 ${step.recoveryBeforeNextStepSeconds} 秒`);
    }
  }
  return parts.length ? `计划休息：${parts.join(" · ")}` : "计划休息：未设置";
}

export function trackHomeView(preferredPlanId?: string): {
  planId: string | null;
  title: string;
  rest: string;
  openOccurrenceId: string | null;
  progress: string;
  previous: string;
  evidenceNote: string;
} {
  const evidenceNote =
    "这里只显示已保存的计划和记录。没有睡眠、疲劳或恢复记录时，不会把状态写成可以加量。";
  const plans = listTrackPlans().filter(plan=>preferredPlanId===undefined||plan.planId===preferredPlanId);
  const openPair = plans
    .map((plan) => ({ plan, open: openTrackOccurrence(plan.planId) }))
    .find((item) => item.open);
  const plan = openPair?.plan ?? plans[0] ?? null;
  const openId = openPair?.open?.trainingOccurrenceId ?? null;
  const events = loadEvents();
  const progress = openId ? repetitionSummary("这次", openId, events) : "这次：还没开始。";
  const previousId =
    [...listTrainingOccurrences()]
      .reverse()
      .find(
        (item) =>
          item.trainingOccurrenceId !== openId &&
          plans.some((saved) => saved.planId === item.sessionId),
      )?.trainingOccurrenceId ?? null;
  const previous = previousId
    ? repetitionSummary("上次", previousId, events)
    : "上次：还没有另一节田径记录。";
  if (!plan)
    return {
      planId: null,
      title: "还没有确认的田径计划",
      rest: "计划休息：未设置",
      openOccurrenceId: null,
      progress,
      previous,
      evidenceNote,
    };
  return {
    planId: plan.planId,
    title: describeTrackPlan(plan),
    rest: describePlanRest(plan),
    openOccurrenceId: openId,
    progress,
    previous,
    evidenceNote,
  };
}

function repetitionSummary(
  label: string,
  trainingOccurrenceId: string,
  events: ReturnType<typeof loadEvents>,
): string {
  const view = projectRunningExecution(trainingOccurrenceId, events);
  if (view.availability !== "AVAILABLE" || view.repetitions.length === 0)
    return `${label}：结构未记录。`;
  const done = view.repetitions.filter((item) => item.status === "COMPLETED").length;
  const skipped = view.repetitions.filter((item) => item.status === "SKIPPED").length;
  const pending = view.repetitions.filter(
    (item) => item.status === "NOT_YET_RECORDED" || item.status === "NOT_RECORDED",
  ).length;
  return `${label}：完成 ${done} · 跳过 ${skipped} · 未完成 ${pending} · 共 ${view.repetitions.length}`;
}

export function commitTrackRecovery(
  slot: RecoveryExecution,
  secondsText: string,
): { ok: true } | { ok: false; reason: string } {
  const current = projectRunningExecution(slot.trainingOccurrenceId, loadEvents()).recoveries.find(
    (item) =>
      item.kind === slot.kind &&
      item.blockId === slot.blockId &&
      item.componentId === slot.componentId &&
      item.blockId === slot.blockId &&
      item.stepId === slot.stepId &&
      item.roundOrdinal === slot.roundOrdinal &&
      item.afterRepeatOrdinal === slot.afterRepeatOrdinal &&
      item.fromStepId === slot.fromStepId &&
      item.toStepId === slot.toStepId &&
      item.afterRoundOrdinal === slot.afterRoundOrdinal,
  );
  if (!current || current.status !== "NOT_YET_RECORDED")
    return { ok: false, reason: "这次休息已经有记录，不会再写一条。" };
  const trimmed = secondsText.trim();
  if (!trimmed) return { ok: false, reason: "留空不会把休息写成 0，仍是未记录。" };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0)
    return { ok: false, reason: "休息要写成 0 或更大的秒数。" };
  const saved = recordRunningRecovery({
    trainingOccurrenceId: slot.trainingOccurrenceId,
    runningSnapshotId: slot.runningSnapshotId,
    componentId: slot.componentId,
    blockId: slot.blockId,
    kind: slot.kind,
    stepId: slot.stepId,
    roundOrdinal: slot.roundOrdinal,
    afterRepeatOrdinal: slot.afterRepeatOrdinal,
    fromStepId: slot.fromStepId,
    toStepId: slot.toStepId,
    afterRoundOrdinal: slot.afterRoundOrdinal,
    actualRecoverySeconds: value,
  });
  return saved ? { ok: true } : { ok: false, reason: "休息没有写入，原记录还在。" };
}

/** Every browser write in the running execution UI shares this origin-wide lock.
 * No unsafe localStorage CAS fallback on unsupported browsers. */
export async function withRunningWriteLock<T>(
  work: () => T,
): Promise<T | { ok: false; reason: string }> {
  if (typeof window === "undefined") return work();
  if (!navigator.locks?.request)
    return {
      ok: false,
      reason: "此浏览器缺少安全并发写入能力；请使用支持 Web Locks 的 HTTPS 独立预览，当前未保存。",
    };
  try {
    return await navigator.locks.request("fr255-running-write-r3", work);
  } catch {
    return { ok: false, reason: "并发保存未确认，请刷新核对后重试。" };
  }
}
export const startTrackSessionSafely = (planId: string) =>
  withRunningWriteLock(() => startTrackSession(planId));

export function commitTrackContinuous(
  occurrenceId: string,
  componentId: string,
  secondsText: string,
  distanceText: string,
) {
  const view = projectRunningExecution(occurrenceId, loadEvents());
  const slot = view.continuous.find((x) => x.componentId === componentId);
  if (view.terminal || !slot || slot.status !== "NOT_YET_RECORDED")
    return { ok: false as const, reason: "这段已关闭或已有记录，请刷新核对。" };
  const seconds = positive(secondsText),
    distance = positive(distanceText);
  if (seconds === undefined || distance === undefined || (seconds === null && distance === null))
    return { ok: false as const, reason: "至少填写一项实际时长或距离；缺失不能当作已完成。" };
  const saved = recordRunningContinuousCompleted({
    ...slot,
    actualDistanceMeters: distance,
    actualDurationSeconds: seconds,
  });
  return saved
    ? { ok: true as const }
    : { ok: false as const, reason: "实际记录保存未确认，请刷新核对。" };
}
function feedbackValid(rpe: number | null, pain: number | null, recovery: number | null) {
  return (
    (rpe == null || (Number.isFinite(rpe) && rpe >= 1 && rpe <= 10)) &&
    (pain == null || (Number.isFinite(pain) && pain >= 0 && pain <= 10)) &&
    (recovery == null || (Number.isFinite(recovery) && recovery >= 1 && recovery <= 10))
  );
}
export function finishTrackSession(
  occurrenceId: string,
  kind: "COMPLETED" | "INTERRUPTED",
  rpe: number | null,
  pain: number | null,
) {
  const occurrence = getTrainingOccurrence(occurrenceId),
    snapshot = getRunningPlanSnapshot(occurrenceId);
  if (!occurrence || !snapshot || !feedbackValid(rpe, pain, null))
    return { ok: false as const, reason: "训练编号或反馈无效。" };
  if (snapshot.components.some((x) => x.modality !== "RUNNING"))
    return {
      ok: false as const,
      reason: "含力量的整节课请在原训练结束入口确认，避免误报全部完成。",
    };
  if (occurrence.lifecycle !== "IN_PROGRESS")
    return { ok: false as const, reason: "训练已经结束，请刷新核对；没有重复写入。" };
  const view = projectRunningExecution(occurrenceId, loadEvents());
  const pending = [...view.repetitions, ...view.continuous].some(
    (x) => x.status !== "COMPLETED" && x.status !== "SKIPPED",
  );
  const conflicts = [...view.repetitions, ...view.continuous].some(
    (x) => x.status === "DUPLICATE_UNRESOLVED",
  );
  if (kind === "COMPLETED" && (pending || conflicts))
    return {
      ok: false as const,
      reason: "还有未记录或冲突的主课，不能报全部完成；可明确提前结束。",
    };
  const close = createAppEvent(
    kind === "COMPLETED" ? "TRAINING_COMPLETED" : "TRAINING_INTERRUPTED",
    {
      sessionId: occurrence.sessionId,
      trainingOccurrenceId: occurrenceId,
      decisionId: "running-r3",
      actual: {
        repetitions: view.repetitions.filter((x) => x.status === "COMPLETED").length,
        continuous: view.continuous.filter((x) => x.status === "COMPLETED").length,
      },
      interruptions: kind === "INTERRUPTED" ? 1 : 0,
    },
  );
  const feedback: RunningFeedback = {
    id: crypto.randomUUID(),
    trainingOccurrenceId: occurrenceId,
    recordedAt: close.timestamp,
    source: "USER_CONFIRMED",
    rpe,
    pain,
    recovery: null,
    horizon: "SESSION",
  };
  const events: AppEvent[] = [close];
  if (rpe != null)
    events.push(
      createAppEvent("RPE_RECORDED", {
        trainingOccurrenceId: occurrenceId,
        evidenceType: "SESSION_RPE",
        value: rpe,
      }),
    );
  if (pain != null && pain > 0)
    events.push(
      createAppEvent("PAIN_RECORDED", {
        trainingOccurrenceId: occurrenceId,
        evidenceType: "PAIN",
        intensity: pain,
        location: "未指定部位",
      }),
    );
  if (
    !commitRunningTransaction({
      version: 1,
      id: crypto.randomUUID(),
      events,
      close: { occurrenceId, eventId: close.event_id, at: close.timestamp, kind },
      feedback: [feedback],
    })
  )
    return { ok: false as const, reason: "结束与反馈保存未确认；请刷新核对，当前不报告成功。" };
  events.forEach(notifyCommittedEvent);
  return { ok: true as const };
}
export function recordTrackRecoveryFeedback(
  occurrenceId: string,
  horizon: "24H" | "48H",
  value: number,
  pain: number | null,
  now = new Date(),
) {
  const occurrence = getTrainingOccurrence(occurrenceId);
  if (
    !occurrence ||
    occurrence.lifecycle === "IN_PROGRESS" ||
    !occurrence.startedAt ||
    !feedbackValid(null, pain, value)
  )
    return { ok: false as const, reason: "训练尚未结束或评分无效。" };
  const elapsed = now.getTime() - Date.parse(occurrence.startedAt),
    hours = horizon === "24H" ? 24 : 48;
  if (Math.abs(elapsed - hours * 3600000) > 3 * 3600000)
    return {
      ok: false as const,
      reason: "当前不在所选观察时段（±3小时的产品容差）；不要提前补填恢复事实。",
    };
  if (
    runningFeedback().some((x) => x.trainingOccurrenceId === occurrenceId && x.horizon === horizon)
  )
    return { ok: false as const, reason: "此时段已有反馈；重复来源需核对，未覆盖原记录。" };
  const event = createAppEvent("RPE_RECORDED", {
    trainingOccurrenceId: occurrenceId,
    evidenceType: "SUBJECTIVE_RECOVERY",
    value,
    horizon,
  });
  event.timestamp = now.toISOString();
  const events: AppEvent[] = [event];
  if (pain != null && pain > 0) {
    const painEvent = createAppEvent("PAIN_RECORDED", {
      trainingOccurrenceId: occurrenceId,
      evidenceType: "PAIN",
      intensity: pain,
      location: "未指定部位",
      horizon,
    });
    painEvent.timestamp = now.toISOString();
    events.push(painEvent);
  }
  const feedback: RunningFeedback = {
    id: crypto.randomUUID(),
    trainingOccurrenceId: occurrenceId,
    recordedAt: event.timestamp,
    source: "USER_CONFIRMED",
    rpe: null,
    pain,
    recovery: value,
    horizon,
  };
  if (
    !commitRunningTransaction({
      version: 1,
      id: crypto.randomUUID(),
      events,
      feedback: [feedback],
    })
  )
    return { ok: false as const, reason: "恢复反馈保存未确认，请刷新核对。" };
  events.forEach(notifyCommittedEvent);
  return { ok: true as const };
}
