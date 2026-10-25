/** Descriptive personal response, reusing the canonical projection and exact-dose protocol.
 * Product policy can request review; it never estimates tissue recovery or injury risk. */
import type {
  EvidenceSnapshot,
  TrainingFact,
  ResponseFact,
  EvidenceRef,
} from "./analysis-contract";
import { projectAnalysisEvidence, refOf, analysisDigest } from "./analysis-evidence";
import { responseProtocol, personalHistorySummary } from "./personal-response";
import { trainingDose } from "./muscle-exposure";
import { addDays } from "../ui/day-schedule-rules";
const dayOf = (at: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
const total = (xs: (number | null)[]) =>
  xs.length && xs.every((x) => x !== null) ? xs.reduce<number>((a, b) => a + b!, 0) : null;
export function buildAdaptiveReview(input: EvidenceSnapshot) {
  const s = projectAnalysisEvidence({
    context: input.context,
    facts: input.facts,
    safetyConstraints: input.safetyConstraints,
  });
  const now = Date.parse(s.context.asOf),
    today = dayOf(s.context.asOf, s.context.timeZone);
  const training = s.facts.filter(
    (f): f is TrainingFact =>
      f.kind === "TRAINING" &&
      Date.parse(f.startedAt) <= now &&
      Date.parse(f.startedAt) >= now - 90 * 864e5,
  );
  const responses = s.facts.filter((f): f is ResponseFact => f.kind === "RESPONSE");
  const windows = [0, 1].map((i) => {
    const end = addDays(today, -7 * i),
      start = addDays(end, -6),
      rows = training.filter((t) => {
        const d = dayOf(t.startedAt, s.context.timeZone);
        return d >= start && d <= end;
      });
    const run = rows.filter((t) => t.modality === "RUN"),
      strength = rows.filter((t) => t.modality === "STRENGTH"),
      doses = rows.map((t) => ({ t, d: trainingDose(t) }));
    const occurrences = [...new Set(rows.map((t) => t.canonicalActivityId))];
    return {
      start,
      end,
      coverage: "RECORDED_ONLY" as const,
      sessionCount: occurrences.length,
      runSessions: run.length,
      strengthSessions: strength.length,
      runDistanceM: total(
        run.map((t) => {
          const d = trainingDose(t);
          return d.complete.distance ? d.distanceM : null;
        }),
      ),
      runWorkSeconds: total(
        run.map((t) => {
          const d = trainingDose(t);
          return d.complete.work ? d.workSeconds : null;
        }),
      ),
      strengthSets: total(
        strength.map((t) => {
          const d = trainingDose(t);
          return d.complete.sets ? d.sets : null;
        }),
      ),
      minutes: total(
        rows.map((t) => (t.actualDurationSeconds === null ? null : t.actualDurationSeconds / 60)),
      ),
      jumpContacts: total(rows.filter((t) => t.modality === "JUMP").map((t) => t.jumpContacts)),
      otherSessions: rows.filter((t) => t.modality === "OTHER").length,
      refs: rows.map(refOf),
      missing: [...new Set(doses.flatMap((x) => x.d.missing))],
    };
  });
  const protocols = new Map<string, TrainingFact[]>();
  for (const t of training) {
    const key = responseProtocol(t);
    if (key) protocols.set(key, [...(protocols.get(key) ?? []), t]);
  }
  const groups = [...protocols].map(([key, ts]) => {
    const scoped = responses.filter((r) =>
      r.relatedTrainingRefs.some((ref) =>
        ts.some((t) => t.id === ref.id && t.revision === ref.revision),
      ),
    );
    const evidenceRefs: EvidenceRef[] = [...ts, ...scoped].map(refOf);
    const outcomes = ts.map((t) => {
      const origin = t.endedAt ? Date.parse(t.endedAt) : null;
      const linked = scoped.filter(
        (r) =>
          origin !== null &&
          Date.parse(r.occurredAt) >= origin &&
          Date.parse(r.occurredAt) <= origin + 72 * 36e5 &&
          r.relatedTrainingRefs.some((ref) => ref.id === t.id && ref.revision === t.revision),
      );
      const valid = linked.filter(
        (r) =>
          r.value !== null &&
          ((["PAIN", "SORENESS", "SUBJECTIVE_FATIGUE"].includes(r.measure) &&
            r.scale === "0-10_HIGH_WORSE" &&
            r.value >= 0 &&
            r.value <= 10) ||
            (r.measure === "FUNCTION" &&
              r.scale === "FUNCTION_LIMITATION_0_1" &&
              [0, 1].includes(r.value))),
      );
      const intervening =
        origin === null
          ? []
          : training.filter(
              (o) =>
                o.canonicalActivityId !== t.canonicalActivityId &&
                Date.parse(o.startedAt) >= origin &&
                Date.parse(o.startedAt) <=
                  Math.max(origin, ...linked.map((r) => Date.parse(r.occurredAt))),
            );
      const concern = valid.some(
        (r) =>
          ["PAIN", "FUNCTION", "SORENESS", "SUBJECTIVE_FATIGUE"].includes(r.measure) &&
          r.value! > 0,
      );
      const paired = valid.some(
        (r) =>
          r.measure === "PAIN" &&
          r.value === 0 &&
          valid.some(
            (f) =>
              f.measure === "FUNCTION" &&
              f.value === 0 &&
              f.region === r.region &&
              f.side === r.side,
          ),
      );
      return {
        ref: refOf(t),
        activity: t.canonicalActivityId,
        concern,
        supported: paired && !concern,
        missing: !paired,
        confounded: intervening.length > 0,
        feedbackRefs: linked.map(refOf),
      };
    });
    const independent = (pick: typeof outcomes) => new Set(pick.map((x) => x.activity)).size;
    const concernCount = independent(outcomes.filter((o) => o.concern && !o.confounded)),
      supportedCount = independent(outcomes.filter((o) => o.supported && !o.confounded));
    return {
      key: analysisDigest(key),
      protocol: key,
      modality: ts[0].modality,
      trainingRefs: ts.map(refOf),
      evidenceRefs,
      independentSessions: independent(outcomes),
      concernCount,
      supportedCount,
      missingCount: independent(outcomes.filter((o) => o.missing)),
      confoundedCount: independent(outcomes.filter((o) => o.confounded)),
      state:
        concernCount >= 2
          ? ("REVIEW_DOSE" as const)
          : supportedCount >= 2
            ? ("OBSERVED_TOLERANCE" as const)
            : ("INSUFFICIENT" as const),
      summary:
        concernCount >= 2
          ? "同口径训练后重复记录到症状，提出单变量调整并复核；不能确认训练致因"
          : supportedCount >= 2
            ? "重复记录支持该剂量下的已观察执行反应；不证明最佳剂量或允许加量"
            : "独立且可比的后续反馈不足，不推断恢复速度",
      history: personalHistorySummary(ts, scoped, s.context),
      outcomes,
    };
  });
  return {
    version: "FK_ADAPTIVE_1" as const,
    windows,
    groups,
    unmatchedTrainingCount: training.filter((t) => !responseProtocol(t)).length,
    evidenceVersion: analysisDigest([s.facts, s.safetyConstraints]),
    automaticProgression: false as const,
    isPhysiologicalModel: false as const,
    caveats: [
      "只统计已记录训练，未记录日不是休息日",
      "反馈关联描述不是因果证明；叠加训练单列，不用于独立响应计数",
      "两次重复是复核策略，不是科学校准完成门槛",
      "酸痛、疼痛、功能与组织恢复分别判断",
    ],
  };
}
export function adaptiveSummary(r: ReturnType<typeof buildAdaptiveReview>) {
  return [
    "近两周实际记录：",
    ...r.windows.map(
      (w) =>
        `${w.start}至${w.end}：${w.sessionCount}次；跑步${w.runDistanceM === null ? "总距离未知" : w.runDistanceM + "米"}；力量${w.strengthSets === null ? "总组数未知" : w.strengthSets + "组"}（仅已记录部分）`,
    ),
    ...r.groups
      .slice(0, 3)
      .map(
        (g) =>
          `${{ RUN: "跑步", STRENGTH: "力量", JUMP: "跳跃", OTHER: "其他" }[g.modality]}可比${g.independentSessions}次，症状反馈${g.concernCount}次、支持已观察耐受${g.supportedCount}次、缺随访${g.missingCount}次、叠加干扰${g.confoundedCount}次。${g.summary}`,
      ),
    "未校准个人最佳剂量、恢复时间或比赛能力。",
  ].join("\n");
}
