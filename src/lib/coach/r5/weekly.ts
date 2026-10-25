import { deriveAnalysisFacts } from "../../health/analysis-derived";
/** Descriptive weekly projection. No prediction of tissue recovery or inferred actuals. */
import type {
  AnalysisFact,
  EvidenceRef,
  MetricFact,
  TrainingFact,
} from "../../health/analysis-contract";
import type { SymptomRow } from "../../health/symptom-store";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import type { BodyCheck } from "../../nutrition/body";
import type { CoachSuggestion } from "../loop/suggestions";
import { addDays, weekOf } from "../../ui/day-schedule-rules";
import { analysisDigest, projectAnalysisEvidence, refOf } from "../../health/analysis-evidence";
import { trainingDose } from "../../health/muscle-exposure";
import { exerciseRegions, REGION_LABEL } from "../../health/muscle-recovery-u11";
import { localDay } from "../../health/observation";
import { reviewSymptoms } from "../../health/symptom-review";
import { describePair, plannedRunDose, type SchedulePair } from "./commands";
import type { JudgmentChain } from "./contracts";
export type WeeklyFood = {
  id: string;
  athleteId?: string;
  date: string;
  kcal: number | null;
  protein: number | null;
  carb: number | null;
  fat: number | null;
};
export type WeeklyInput = {
  athleteId: string;
  asOf: string;
  weekStart: string;
  entries: ScheduleEntry[];
  facts: AnalysisFact[];
  foods: WeeklyFood[];
  symptoms: SymptomRow[];
  suggestions: CoachSuggestion[];
  checks?: BodyCheck[];
  knowledgeSources?: JudgmentChain["scientificSources"];
  timeZone?: string;
};
const knownSum = (xs: (number | null)[]) =>
  xs.some((x) => typeof x === "number" && Number.isFinite(x))
    ? xs.reduce<number>((s, x) => s + (x ?? 0), 0)
    : null;
export function buildWeeklyReview(input: WeeklyInput) {
  const days = weekOf(input.weekStart),
    today = localDay(new Date(input.asOf)),
    owner = input.athleteId;
  const inWeek = (day: string) => days.includes(day) && day <= today;
  const snapshot = projectAnalysisEvidence({
    context: {
      athleteId: owner,
      asOf: input.asOf,
      timeZone: input.timeZone ?? "Asia/Shanghai",
      planVersion: null,
      consentVersion: "NONE",
      analysisVersion: "R5_WEEK_1",
    },
    facts: input.facts,
  });
  const facts = snapshot.facts.filter((f) =>
    inWeek(
      f.kind === "TRAINING"
        ? localDay(new Date(f.startedAt))
        : f.kind === "METRIC"
          ? (f.providerDate ?? localDay(new Date(f.occurredAt)))
          : localDay(new Date(f.occurredAt)),
    ),
  );
  const training = facts.filter((f): f is TrainingFact => f.kind === "TRAINING"),
    running = training.filter((f) => f.modality === "RUN"),
    strength = training.filter((f) => f.modality === "STRENGTH");
  const runDoses = running.map(trainingDose),
    sets = strength.flatMap((f) => f.strengthSets.filter((s) => s.completion === "COMPLETED"));
  const entries = input.entries.filter(
    (e) =>
      (e.athleteId ?? "local") === owner &&
      days.includes(e.date) &&
      !["rejected", "proposed"].includes(e.status) &&
      !e.unplanned,
  );
  const completion = {
    planned: entries.length,
    completed: 0,
    partial: 0,
    missed: 0,
    unrecorded: 0,
    upcoming: 0,
    skipped: 0,
  };
  for (const e of entries) {
    if (e.actual?.outcome === "missed") completion.missed++;
    else if (e.actual?.executionState === "PARTIAL" || e.actual?.executionState === "INTERRUPTED")
      completion.partial++;
    else if (e.actual && e.status === "done") completion.completed++;
    else if (e.status === "skipped") completion.skipped++;
    else if (e.date < today) completion.unrecorded++;
    else completion.upcoming++;
  }
  const metricMap = new Map<string, MetricFact[]>();
  for (const f of facts.filter(
    (f): f is MetricFact =>
      f.kind === "METRIC" &&
      f.value !== null &&
      ["SLEEP", "SLEEP_SELF_REPORT", "HRV", "RMSSD", "LN_RMSSD", "RHR", "sleep"].includes(f.metric),
  )) {
    const k = JSON.stringify([
      f.metric,
      f.provider,
      f.accountRef,
      f.deviceId,
      f.protocolKey,
      f.unit,
    ]);
    const list = metricMap.get(k) ?? [];
    list.push(f);
    metricMap.set(k, list);
  }
  const metricGroups = [...metricMap].map(([sourceKey, rs]) => {
    const byDay = new Map<string, MetricFact[]>();
    for (const r of rs) {
      const d = r.providerDate ?? localDay(new Date(r.occurredAt)),
        list = byDay.get(d) ?? [];
      list.push(r);
      byDay.set(d, list);
    }
    const conflictedDays = [...byDay]
      .filter(([, v]) => new Set(v.map((x) => x.value)).size > 1)
      .map(([d]) => d);
    const points = [...byDay]
      .filter(([d]) => !conflictedDays.includes(d))
      .map(([day, v]) => ({ day, value: v[0].value!, refs: v.map(refOf) }))
      .slice()
      .sort((a, b) => a.day.localeCompare(b.day));
    return {
      sourceKey,
      metric: rs[0].metric,
      provider: rs[0].provider,
      deviceId: rs[0].deviceId,
      protocolKey: rs[0].protocolKey,
      unit: rs[0].unit,
      points,
      conflictedDays,
      mean: points.length ? points.reduce((s, p) => s + p.value, 0) / points.length : null,
      change: points.length >= 2 ? points.at(-1)!.value - points[0].value : null,
    };
  });
  const foods = input.foods.filter((f) => (f.athleteId ?? "local") === owner && inWeek(f.date));
  const nutrition = {
    recordCount: foods.length,
    daysRecorded: new Set(foods.map((f) => f.date)).size,
    recordedKcal: knownSum(foods.map((f) => f.kcal)),
    recordedProtein: knownSum(foods.map((f) => f.protein)),
    recordedCarb: knownSum(foods.map((f) => f.carb)),
    recordedFat: knownSum(foods.map((f) => f.fat)),
    missingFields: foods.filter(
      (f) => f.kcal === null || f.protein === null || f.carb === null || f.fat === null,
    ).length,
    dayComplete: false as const,
    dailyDeficitKcal: null,
    note: "仅已记录食物的已知小计；无法确认全天完整性，不能推断全天不足或热量缺口。",
  };
  const exposures = new Map<
    string,
    { region: string; days: string[]; refs: EvidenceRef[]; modalities: string[] }
  >();
  for (const t of training) {
    const regions =
      t.modality === "RUN" && t.observedType && t.observedTypeBasis.length
        ? (["quads", "hamstrings", "glutes", "calves"] as const)
        : [
            ...new Set(
              t.strengthSets
                .filter((s) => s.completion === "COMPLETED")
                .flatMap((s) => exerciseRegions(s.catalogId ?? undefined)),
            ),
          ];
    for (const region of regions) {
      const v = exposures.get(region) ?? {
        region: REGION_LABEL[region],
        days: [],
        refs: [],
        modalities: [],
      };
      v.days = [...new Set([...v.days, localDay(new Date(t.startedAt))])];
      v.refs.push(refOf(t));
      v.modalities = [...new Set([...v.modalities, t.modality])];
      exposures.set(region, v);
    }
  }
  const symptoms = reviewSymptoms(
    input.symptoms.filter((x) => x.athleteId === owner),
    days.at(-1)! > today ? today : days.at(-1)!,
    7,
  );
  const weights = (input.checks ?? [])
    .filter((c) => (c.athleteId ?? "local") === owner && inWeek(c.date))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const suggestions = input.suggestions
    .filter((s) => s.athleteId === owner && s.history.some((h) => inWeek(h.at.slice(0, 10))))
    .map((s) => ({
      id: s.id,
      status: s.status,
      history: s.history.filter((h) => inWeek(h.at.slice(0, 10))),
      outcome: s.outcome ?? null,
    }));
  const refs = training.map(refOf),
    metricRefs = metricGroups.flatMap((g) => g.points.flatMap((p) => p.refs));
  const hypotheses: JudgmentChain["hypotheses"] = [
    {
      claim: training.length
        ? "实际执行剂量、分段节奏或跑力叠加可能参与本周反应，尚不能确认因果。"
        : "实际训练明细不足，无法判断本周反应是否与训练剂量有关。",
      support: refs,
      counter: facts.filter((f) => f.kind === "RESPONSE" && f.value === 0).map(refOf),
      discriminator:
        "在原有、不诱发症状的课程中，比较同条件分段、逐组完成和主观反馈；不增加试探剂量。",
    },
    {
      claim: metricRefs.length
        ? "睡眠、生活压力或测量条件也可能参与状态变化。不同设备协议分别比较。"
        : "睡眠、生活压力及测量条件仍是待检验的另一种解释。",
      support: metricRefs,
      counter: [],
      discriminator: "补充同设备同协议睡眠/恢复及原热身功能；若背景相同而反应改变，削弱此解释。",
    },
  ];
  const unknowns = [
    ...(running.length ? runDoses.flatMap((d) => d.missing) : ["本周实际跑步明细未知"]),
    ...(strength.length
      ? sets.some((s) => s.reps === null)
        ? ["部分实际次数未知"]
        : []
      : ["本周实际逐组力量未知"]),
    ...(!metricGroups.length ? ["同协议恢复趋势未记录"] : []),
    nutrition.note,
    ...(!input.knowledgeSources?.length
      ? ["当前资料尚未匹配到已核对适用条件的科学参考；草案剂量边界是产品保护规则。"]
      : []),
    ...snapshot.gaps,
  ];
  const chain: JudgmentChain = {
    facts: training.map((t) => ({
      text: `${localDay(new Date(t.startedAt))} ${t.modality}，原记录 ${t.id}@${t.revision}`,
      refs: [refOf(t)],
    })),
    calculations: running.map((t, i) => ({
      text: `已知跑量 ${runDoses[i].distanceM ?? "未知"} m，纯跑 ${runDoses[i].workSeconds ?? "未知"} s`,
      refs: [refOf(t)],
    })),
    scientificSources: input.knowledgeSources ?? [],
    hypotheses,
    unknowns: [...new Set(unknowns)],
    candidate:
      symptoms.safety === "NO_KNOWN_HOLD"
        ? "以原已保存课程为上限，先核对下周草案；不自动加量。"
        : symptoms.message,
    requiresConfirmation: true,
    professionalValidation: "NOT_PROVEN",
  };
  const responseGroups = new Map<
    string,
    { measure: string; scale: string; points: { at: string; value: number; ref: EvidenceRef }[] }
  >();
  for (const f of facts)
    if (
      f.kind === "RESPONSE" &&
      f.value !== null &&
      ["RECOVERY_FEELING", "SUBJECTIVE_FATIGUE", "FUNCTION", "SORENESS", "PAIN"].includes(f.measure)
    ) {
      const key = JSON.stringify([
          f.measure,
          f.scale,
          f.provider,
          f.accountRef,
          f.deviceId,
          f.protocolKey,
          f.region,
          f.side,
        ]),
        g = responseGroups.get(key) ?? { measure: f.measure, scale: f.scale, points: [] };
      g.points.push({ at: f.occurredAt, value: f.value, ref: refOf(f) });
      responseGroups.set(key, g);
    }
  const subjectiveTrends = [...responseGroups.values()].map((g) => {
    const points = g.points.sort((a, b) => a.at.localeCompare(b.at));
    return {
      ...g,
      points,
      change: points.length > 1 ? points.at(-1)!.value - points[0].value : null,
    };
  });
  const deterministicCalculations = deriveAnalysisFacts({ ...snapshot, facts });
  const actualEntries = entries.filter((e) => e.actual && e.actual.outcome !== "missed");
  const actualRunning = actualEntries.filter(
    (e) => e.modality === "run" || e.trainingType === "mixed",
  );
  const intensityRank = { EASY: 1, MODERATE: 2, HARD: 3 };
  const actualIntensity = actualEntries
    .map((e) => e.actual!.intensity)
    .filter((x): x is "EASY" | "MODERATE" | "HARD" => x !== null);
  const actualDose = {
    minutes: knownSum(actualEntries.map((e) => e.actual!.minutes)),
    runDistanceM: runDoses.length
      ? knownSum(runDoses.map((d) => d.distanceM))
      : knownSum(actualRunning.map((e) => (e.actual!.km == null ? null : e.actual!.km! * 1000))),
    strengthSets:
      strength.length && strength.every((t) => t.strengthSets.length > 0) ? sets.length : null,
    maxIntensity: actualIntensity.length
      ? Math.max(...actualIntensity.map((x) => intensityRank[x]))
      : null,
    basis: "CONFIRMED_ACTUAL_ONLY" as const,
    partialCoverage: completion.unrecorded > 0 || completion.partial > 0,
  };
  return {
    schema: 1 as const,
    subjectiveTrends,
    deterministicCalculations,
    actualDose,
    athleteId: owner,
    weekStart: days[0],
    weekEnd: days[6],
    asOf: input.asOf,
    basisVersion: analysisDigest([
      owner,
      days,
      entries,
      facts,
      foods,
      input.symptoms,
      suggestions,
      weights,
    ]),
    completion,
    running: {
      knownDistanceM: runDoses.length
        ? knownSum(runDoses.map((d) => d.distanceM))
        : actualDose.runDistanceM,
      distanceSource: runDoses.length ? "CANONICAL_TRAINING_FACTS" : "EXPLICIT_SCHEDULE_ACTUAL",
      knownWorkSeconds: knownSum(runDoses.map((d) => d.workSeconds)),
      distanceComplete: runDoses.length > 0 && runDoses.every((d) => d.complete.distance),
      sessions: running.length,
      segments: running.map((t) => ({ ref: refOf(t), segments: trainingDose(t).segments })),
    },
    strength: {
      completedSets: sets.length,
      knownReps: knownSum(sets.map((s) => s.reps)),
      knownLoadDetails: strength.map((t) => ({
        ref: refOf(t),
        sets: t.strengthSets.filter((s) => s.completion === "COMPLETED"),
      })),
      sessions: strength.length,
    },
    metricGroups,
    nutrition,
    exposures: [...exposures.values()],
    symptoms,
    weight: {
      observations: weights,
      change: weights.length >= 2 ? weights.at(-1)!.weight - weights[0].weight : null,
    },
    suggestions,
    chain,
    hypotheses,
    unknowns: chain.unknowns,
  };
}
export type WeeklyReview = ReturnType<typeof buildWeeklyReview>;
export type WeekConditions = {
  safety: string;
  events: { date: string; label: string }[];
  days: number[] | null;
  minutes: number | null;
  goal: string | null;
  phase: string | null;
};
export function buildNextWeekDraft(
  review: WeeklyReview,
  previous: ScheduleEntry[],
  next: ScheduleEntry[],
  conditions: WeekConditions,
) {
  const nextStart = addDays(review.weekStart, 7),
    nextDays = weekOf(nextStart);
  const own = (e: ScheduleEntry) => (e.athleteId ?? "local") === review.athleteId;
  const future = next.filter(
    (e) => own(e) && nextDays.includes(e.date) && e.status === "planned" && !e.actual,
  );
  const seeds = future.length
    ? future
    : previous.filter(
        (e) =>
          own(e) &&
          weekOf(review.weekStart).includes(e.date) &&
          ["planned", "done"].includes(e.status) &&
          e.modality !== "rest",
      );
  const sessions: SchedulePair[] = [],
    warnings: string[] = [];
  for (const original of seeds) {
    const date = future.length ? original.date : addDays(original.date, 7);
    const { actual: _actual, movedFrom: _moved, ...source } = structuredClone(original);
    let after: ScheduleEntry = {
      ...source,
      id: future.length ? original.id : `r5-week:${nextStart}:${original.id}`,
      date,
      status: "planned",
      athleteId: review.athleteId,
      unplanned: false,
      edited: true,
      swapReason: "下周草案：沿用已保存课程上限，不自动进阶",
    };
    const unavailable =
      conditions.days && !conditions.days.includes(new Date(date + "T12:00:00Z").getUTCDay());
    const nearRace = conditions.events.some(
      (e) => Math.abs(Date.parse(e.date) - Date.parse(date)) <= 2 * 86400000,
    );
    const unknownTime = conditions.minutes !== null && after.minutes > conditions.minutes;
    const adjacent = sessions.some(
      (p) =>
        Math.abs(Date.parse(p.after.date) - Date.parse(date)) <= 86400000 &&
        (p.after.intensity === "HARD" || p.after.lowerHeavy) &&
        (after.intensity === "HARD" || after.lowerHeavy),
    );
    if (
      ["HOLD_ACTIVE", "ESCALATION_REQUIRED"].includes(conditions.safety) ||
      unavailable ||
      unknownTime ||
      (nearRace && (after.intensity === "HARD" || after.lowerHeavy)) ||
      adjacent
    ) {
      after = {
        ...after,
        title: "暂缓原课 · 待复核",
        modality: "rest",
        intensity: "EASY",
        lowerHeavy: false,
        minutes: 0,
        runComponents: [],
        exercises: [],
        focus: ["恢复与复核"],
        refId: null,
        reduced: true,
      };
      warnings.push(
        `${date} ${original.title}：${["HOLD_ACTIVE", "ESCALATION_REQUIRED"].includes(conditions.safety) ? "安全限制仍在生效" : unavailable ? "不在已确认训练日" : unknownTime ? "超过已确认可用时间" : nearRace ? "临近比赛，保护关键课" : "相邻关键课冲突"}，草案先暂缓，不自动补到其他日期。`,
      );
    }
    sessions.push({ before: future.length ? original : null, after });
  }
  const cap = review.actualDose,
    rank = { EASY: 1, MODERATE: 2, HARD: 3 };
  const active = sessions.filter((p) => p.after.modality !== "rest"),
    needsRun = active.some((p) => p.after.modality === "run" || p.after.trainingType === "mixed"),
    needsStrength = active.some(
      (p) => p.after.modality === "strength" || p.after.trainingType === "mixed",
    );
  let executable =
    cap.minutes !== null &&
    cap.maxIntensity !== null &&
    (!needsRun || cap.runDistanceM !== null) &&
    (!needsStrength || cap.strengthSets !== null);
  // A safety-only postponement may be confirmed without pretending tolerance is known.
  if (!active.length && sessions.length) executable = true;
  if (!executable)
    warnings.push(
      "近期实际时长、跑量、组数或强度上限未完整记录。具体原课程仅供核对，这份草案暂不能执行；请补充会改变剂量的实际记录。",
    );
  let minutesLeft = cap.minutes ?? 0,
    metersLeft = cap.runDistanceM ?? 0,
    setsLeft = cap.strengthSets ?? 0;
  for (const pair of sessions) {
    if (!executable || pair.after.modality === "rest") continue;
    let e = pair.after;
    if (rank[e.intensity] > (cap.maxIntensity ?? 0) || minutesLeft <= 0) {
      pair.after = {
        ...e,
        modality: "rest",
        title: "暂缓原课 · 实际耐受待复核",
        minutes: 0,
        intensity: "EASY",
        lowerHeavy: false,
        runComponents: [],
        exercises: [],
        refId: null,
      };
      continue;
    }
    e = { ...e, minutes: Math.min(e.minutes, minutesLeft) };
    minutesLeft -= e.minutes;
    if (e.modality === "run" || e.trainingType === "mixed") {
      const dose = plannedRunDose(e);
      if (dose.distanceM === null && dose.durationSeconds === null) {
        executable = false;
        warnings.push(`${e.date} 跑步结构剂量未知，需先补齐；草案未放行。`);
        continue;
      }
      const factor =
        dose.distanceM && dose.distanceM > 0 ? Math.min(1, metersLeft / dose.distanceM) : 0;
      if (factor === 0 && dose.distanceM === null) {
        executable = false;
        warnings.push(`${e.date} 只有时间目标，无法核对跑量上限；请先确认距离上限。`);
        continue;
      }
      e = {
        ...e,
        runComponents: e.runComponents?.map((c) =>
          c.modality !== "RUNNING"
            ? c
            : c.structure.kind === "CONTINUOUS"
              ? {
                  ...c,
                  structure: {
                    ...c.structure,
                    plannedDistanceMeters:
                      c.structure.plannedDistanceMeters === null
                        ? null
                        : c.structure.plannedDistanceMeters * factor,
                    plannedDistanceMaxMeters: null,
                    plannedDurationSeconds:
                      c.structure.plannedDurationSeconds === null
                        ? null
                        : Math.min(c.structure.plannedDurationSeconds, e.minutes * 60),
                  },
                }
              : {
                  ...c,
                  structure: {
                    ...c.structure,
                    blocks: c.structure.blocks
                      .map((b) => ({
                        ...b,
                        steps: b.steps
                          .map((step) => ({
                            ...step,
                            repeatCount: Math.floor(step.repeatCount * factor),
                          }))
                          .filter((step) => step.repeatCount > 0),
                      }))
                      .filter((b) => b.steps.length > 0),
                  },
                },
        ),
      };
      const afterDose = plannedRunDose(e);
      metersLeft -= afterDose.distanceM ?? 0;
      if ((afterDose.distanceM ?? 0) <= 0)
        e = {
          ...e,
          modality: "rest",
          minutes: 0,
          runComponents: [],
          exercises: [],
          title: "暂缓原课 · 本周跑量上限已用完",
          refId: null,
        };
    }
    if (e.modality === "strength" || e.trainingType === "mixed") {
      if (!e.exercises?.length || e.exercises.some((x) => !/^\d+$/.test(x.sets))) {
        executable = false;
        warnings.push(`${e.date} 逐动作组数未知，需核对；草案未放行。`);
        continue;
      }
      e = {
        ...e,
        exercises: e.exercises.flatMap((x) => {
          const n = Math.min(Number(x.sets), setsLeft);
          setsLeft -= n;
          return n > 0 ? [{ ...x, sets: String(n) }] : [];
        }),
      };
      if (!e.exercises?.length)
        e =
          e.trainingType === "mixed"
            ? { ...e, modality: "run", trainingType: "run" }
            : {
                ...e,
                modality: "rest",
                minutes: 0,
                title: "暂缓原课 · 实际组数上限已用完",
                refId: null,
              };
    }
    pair.after = e;
  }
  if (executable && active.length)
    warnings.push(
      "时长、跑量、组数与强度均以本周已记录实际值为上限；记录上限不等于已验证的个人耐受。",
    );
  if (!sessions.length)
    warnings.push("没有可核对的已保存课程；不能编造下周剂量。请先保存或选定具体课程。");
  if (!conditions.goal) warnings.push("个人目标尚未确认；仅沿用既有课程上限。");
  if (!conditions.phase) warnings.push("训练阶段未知；没有自动倒推周期或新增关键课。");
  return {
    athleteId: review.athleteId,
    weekStart: nextStart,
    basisVersion: review.basisVersion,
    sessions,
    diff: sessions.map(describePair),
    warnings,
    requiresConfirmation: true as const,
    planWritten: false as const,
    conditions,
    executable,
    volumeIncreased: executable ? false : null,
  };
}
