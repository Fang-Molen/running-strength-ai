import { assessAthleteHistory } from '../assessment/history';
/** Read-only, source-separated athlete portrait over the established fact projection. */
import { projectAnalysisEvidence, refOf, analysisDigest } from "../../health/analysis-evidence";
import { deriveAnalysisFacts } from "../../health/analysis-derived";
import { adaptTrainingModelInput } from "../training-models/host";
import { localDay } from "../../health/observation";
import { weekOf, addDays } from "../../ui/day-schedule-rules";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import type { TrainingFact } from "../../health/analysis-contract";
import type { CycleInput } from "./types";
/** Linked rows must still exist in the canonical projection. Deduplicate occurrence identity,
 * including overlapping mixed-session links; conflicting duplicate doses are withheld. */
export function validActualEntries(input: CycleInput, training: TrainingFact[]): ScheduleEntry[] {
  const owner = input.snapshot.context.athleteId,
    now = Date.parse(input.snapshot.context.asOf);
  const valid = new Set(training.map((t) => t.occurrenceId));
  const rows = input.entries.filter(
    (e) =>
      (e.athleteId ?? "local") === owner &&
      e.actual &&
      Date.parse(e.actual.at) <= now &&
      e.date <= localDay(new Date(now)) &&
      (!e.actual.occurrenceIds?.length || e.actual.occurrenceIds.every((id) => valid.has(id))),
  );
  const identity = (e: ScheduleEntry) =>
    e.actual?.occurrenceIds?.length ? e.actual.occurrenceIds : [`manual:${e.id}`];
  const dose = (e: ScheduleEntry) =>
    analysisDigest([
      e.actual?.minutes,
      e.actual?.km,
      e.actual?.intensity,
      e.actual?.outcome,
      e.actual?.executionState,
    ]);
  const conflicts = new Set<string>();
  const doses = new Map<string, string>();
  for (const e of rows)
    for (const id of identity(e)) {
      if (doses.has(id) && doses.get(id) !== dose(e)) conflicts.add(id);
      doses.set(id, dose(e));
    }
  const seen = new Set<string>();
  return rows.filter((e) => {
    const ids = identity(e);
    if (ids.some((id) => seen.has(id) || conflicts.has(id))) return false;
    ids.forEach((id) => seen.add(id));
    return true;
  });
}
export function buildAthletePortrait(input: CycleInput) {
  const snapshot = projectAnalysisEvidence({
      context: input.snapshot.context,
      facts: input.snapshot.facts,
    }),
    owner = snapshot.context.athleteId,
    now = Date.parse(snapshot.context.asOf),
    today = localDay(new Date(now));
  const facts = snapshot.facts.filter((f) => Date.parse(f.occurredAt) >= now - 90 * 86400000),
    training = facts.filter((f): f is TrainingFact => f.kind === "TRAINING");
  const model = adaptTrainingModelInput({ ...snapshot, facts }, input.recovery);
  const performances = model.performances.map((p) => ({
    meters: p.distanceM,
    seconds: p.seconds,
    date: localDay(new Date(p.occurredAt)),
    source: [p.provider, p.accountRef, p.deviceId, p.protocolKey].join("/"),
    ref: refOf(p),
    isTarget: false as const,
  }));
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const start = addDays(weekOf(today)[0], -7 * (i + 1)),
      days = weekOf(start),
      ts = training.filter((t) => days.includes(localDay(new Date(t.startedAt))));
    const actualEntries = validActualEntries(input, training).filter(
      (e) =>
        (e.athleteId ?? "local") === owner &&
        days.includes(e.date) &&
        e.actual &&
        Date.parse(e.actual.at) <= now &&
        e.actual.outcome !== "missed",
    );
    const countedOccurrences = new Set(ts.map((t) => t.occurrenceId)),
      extra = actualEntries.filter(
        (e) => !e.actual?.occurrenceIds?.some((id) => countedOccurrences.has(id)),
      );
    const groups = new Map<string, typeof ts>();
    for (const t of ts) groups.set(t.occurrenceId, [...(groups.get(t.occurrenceId) ?? []), t]);
    const times = [
      ...[...groups].map(([id, rows]) => {
        const reported = actualEntries.find((e) => e.actual?.occurrenceIds?.includes(id));
        if (reported?.actual?.minutes != null) return reported.actual.minutes;
        return rows.every((t) => t.actualDurationSeconds !== null)
          ? rows.reduce((s, t) => s + t.actualDurationSeconds!, 0) / 60
          : null;
      }),
      ...extra.map((e) => e.actual!.minutes),
    ];
    const complete = times.length > 0 && times.every((x) => x !== null && Number.isFinite(x));
    return {
      start,
      minutes: complete ? times.reduce<number>((s, n) => s + n!, 0) : null,
      observedSessions: new Set([...ts.map((t) => t.occurrenceId), ...extra.map((e) => e.id)]).size,
      coverage: "RECORDED_ONLY" as const,
      refs: ts.map(refOf),
      entryIds: extra.map((e) => e.id),
    };
  });
  const responseGroups = new Map<
    string,
    { key: string; refs: ReturnType<typeof refOf>[]; values: number[] }
  >();
  for (const f of facts)
    if (f.kind === "RESPONSE" && f.value !== null) {
      const key = JSON.stringify([
        f.measure,
        f.scale,
        f.provider,
        f.accountRef,
        f.deviceId,
        f.protocolKey,
        f.region,
        f.side,
      ]);
      const g = responseGroups.get(key) ?? { key, refs: [], values: [] };
      g.refs.push(refOf(f));
      g.values.push(f.value);
      responseGroups.set(key, g);
    }
  const derived = deriveAnalysisFacts({ ...snapshot, facts });
  const unknowns = [
    ...(!performances.length ? ["近期没有可核实的最大努力比赛/测试成绩；目标不作能力依据"] : []),
    ...(input.goal.experience === "UNKNOWN" ? ["训练经历尚未确认"] : []),
    ...(!input.training.days ? ["可训练星期未知"] : []),
    ...(!input.training.minutes ? ["单次可用时长未知"] : []),
    ...(!training.length ? ["近期实际训练明细未知"] : []),
    ...input.training.conflicts,
    ...snapshot.gaps,
  ];
  return {
    athleteId: owner,
    asOf: snapshot.context.asOf,
    performances,
    history: assessAthleteHistory({ ...snapshot, facts, safetyConstraints: input.snapshot.safetyConstraints }),
    training,
    derived,
    weeks,
    responseGroups: [...responseGroups.values()],
    strength: training
      .filter((t) => t.modality === "STRENGTH")
      .map((t) => ({
        ref: refOf(t),
        sets: t.strengthSets.filter((s) => s.completion === "COMPLETED"),
      })),
    unknowns: [...new Set(unknowns)],
    universalLevel: null,
    goalIsMeasurement: false as const,
    version: analysisDigest([facts, input.profileVersion, input.training.version, input.goal]),
    snapshot: { ...snapshot, facts },
  };
}
export type AthletePortrait = ReturnType<typeof buildAthletePortrait>;
