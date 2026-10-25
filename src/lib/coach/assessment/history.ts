/** Read-only initial assessment. Describes recorded execution, never diagnoses capacity or readiness. */
import type {
  EvidenceSnapshot,
  EvidenceRef,
  TrainingFact,
  RunSegment,
} from "../../health/analysis-contract";
import { projectAnalysisEvidence, analysisDigest, refOf } from "../../health/analysis-evidence";
export type Comparability = "DIRECT" | "LIMITED" | "NOT_COMPARABLE";
export type RunObservation = {
  ref: EvidenceRef;
  occurrenceId: string;
  date: string;
  provider: string;
  accountRef: string | null;
  deviceId: string | null;
  protocol: string | null;
  segments: RunSegment[];
  distanceM: number | null;
  workSeconds: number | null;
  paceSecondsPerKm: number | null;
  heartRateBpm: number | null;
  heartRateMethod: string | null;
  rpe: number | null;
  rpeScale: string | null;
  complete: boolean;
  text: string;
};
export type HistoricalComparison = {
  current: EvidenceRef;
  baselineRefs: EvidenceRef[];
  status: Comparability;
  reasons: string[];
  priorDays: number;
  paceDeltaSecondsPerKm: number | null;
  heartRateDeltaBpm: number | null;
  rpeDelta: number | null;
  text: string;
  explanations: {
    claim: string;
    support: EvidenceRef[];
    counter: EvidenceRef[];
    missing: string[];
  }[];
};
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const known = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim() && !/UNKNOWN|UNSPECIFIED|未知/i.test(v);
const round = (v: number) => Math.round(v * 10) / 10;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b),
    i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const sumKnown = (xs: (number | null | undefined)[]) =>
  xs.length && xs.every(positive) ? xs.reduce<number>((s, v) => s + v!, 0) : null;
const pace = (s: number) =>
  `${Math.floor(Math.round(s) / 60)}分${String(Math.round(s) % 60).padStart(2, "0")}秒/公里`;
function observation(t: TrainingFact, timeZone: string): RunObservation {
  const segments = t.runSegments.filter((s) => s.completion === "COMPLETED"),
    distanceM = sumKnown(segments.map((s) => s.distanceM)),
    workSeconds = sumKnown(segments.map((s) => s.durationSeconds));
  const methods = [...new Set(segments.map((s) => s.heartRateMethod).filter(known))];
  const hrKnown =
    segments.length > 0 &&
    workSeconds !== null &&
    methods.length === 1 &&
    segments.every((s) => known(s.heartRateMethod) && positive(s.averageHeartRateBpm));
  const heartRateBpm = hrKnown
    ? round(
        segments.reduce((n, s) => n + s.averageHeartRateBpm! * s.durationSeconds!, 0) /
          workSeconds!,
      )
    : null;
  const paceSecondsPerKm =
    distanceM !== null && workSeconds !== null ? round((workSeconds / distanceM) * 1000) : null;
  const date = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(t.occurredAt)),
    complete = segments.length > 0 && segments.length === t.runSegments.length;
  return {
    ref: refOf(t),
    occurrenceId: t.occurrenceId,
    date,
    provider: t.provider,
    accountRef: t.accountRef,
    deviceId: t.deviceId,
    protocol: t.protocolKey,
    segments,
    distanceM,
    workSeconds,
    paceSecondsPerKm,
    heartRateBpm,
    heartRateMethod: hrKnown ? methods[0] : null,
    rpe: typeof t.sessionRpe === "number" && Number.isFinite(t.sessionRpe) ? t.sessionRpe : null,
    rpeScale: t.sessionRpeScale,
    complete,
    text: `${date}：已完成分段${segments.length}段${distanceM === null ? "，距离未知" : `，合计${round(distanceM)}米`}${paceSecondsPerKm === null ? "，配速未知" : `，工作段均配速${pace(paceSecondsPerKm)}`}；${heartRateBpm === null ? "心率或采集方法不足" : `已记分段加权心率${heartRateBpm}次/分（${({CHEST_STRAP:"胸带",WRIST_OPTICAL:"腕部光电",MANUAL:"手动测量"} as Record<string,string>)[methods[0]]??methods[0]}）`}。${complete ? "" : "未全部记录完成；"}这是训练执行记录，不等同最大能力。`,
  };
}
/** Time is deliberately absent from the structure key: it is the outcome under comparison. */
export function compareRunConditions(
  a: RunObservation,
  b: RunObservation,
): { status: Comparability; reasons: string[] } {
  const different: string[] = [],
    missing: string[] = [];
  for (const [key, label] of [
    ["provider", "来源"],
    ["accountRef", "账号"],
    ["deviceId", "设备"],
    ["protocol", "训练协议"],
  ] as const) {
    if (
      key === "accountRef" &&
      a.provider === b.provider &&
      ["MANUAL", "APP"].includes(a.provider) &&
      a[key] === null &&
      b[key] === null
    )
      continue;
    if (known(a[key]) && known(b[key]) && a[key] !== b[key]) different.push(`${label}不同`);
    else if (!known(a[key]) || !known(b[key])) missing.push(`${label}未完整记录`);
  }
  if (!a.complete || !b.complete) missing.push("存在未完成或未记录分段");
  if (a.segments.length !== b.segments.length) different.push("实际段数不同");
  else
    a.segments.forEach((s, i) => {
      const p = b.segments[i];
      if (s.kind === "REPETITION" || p.kind === "REPETITION") {
        if (!known(s.restScope) || !known(p.restScope)) missing.push("间歇作用范围未知");
        else if (s.restScope !== p.restScope) different.push("组间与轮间恢复不同");
      }
      for (const key of [
        "distanceM",
        "restAfterSeconds",
        "roundIndex",
        "stepIndex",
        "gradePercent",
        "surface",
        "kind",
      ] as const) {
        const x = s[key],
          y = p[key];
        if (x != null && y != null && x !== "UNKNOWN" && y !== "UNKNOWN" && x !== y)
          different.push(
            key === "restAfterSeconds"
              ? "间歇不同"
              : key === "distanceM"
                ? "段距离不同"
                : "结构或场地条件不同",
          );
        else if (x == null || y == null || x === "UNKNOWN" || y === "UNKNOWN")
          missing.push(
            key === "restAfterSeconds"
              ? "间歇未知"
              : key === "gradePercent" || key === "surface"
                ? "场地条件未知"
                : "结构字段未知",
          );
      }
    });
  return {
    status: different.length ? "NOT_COMPARABLE" : missing.length ? "LIMITED" : "DIRECT",
    reasons: [...new Set([...different, ...missing])],
  };
}
function compare(current: RunObservation, prior: RunObservation[]): HistoricalComparison | null {
  // Independent dates only: same-day double sessions do not inflate the reference count.
  const usable = prior.filter((p) => p.date < current.date),
    seen = new Set<string>();
  const ranked = usable.map((p) => ({ p, c: compareRunConditions(current, p) }));
  const direct = ranked.filter((x) => x.c.status === "DIRECT"),
    limited = ranked.filter((x) => x.c.status === "LIMITED");
  const candidates: typeof ranked = [];
  for (const x of direct.length ? direct : limited.length ? limited : ranked.slice(0, 1)) {
    if (
      seen.has(x.p.date) ||
      candidates.some((y) => compareRunConditions(x.p, y.p).status === "NOT_COMPARABLE")
    )
      continue;
    candidates.push(x);
    seen.add(x.p.date);
    if (candidates.length === 6) break;
  }
  if (!candidates.length) return null;
  const rows = candidates.map((x) => x.p),
    status = candidates[0].c.status,
    refs = rows.map((x) => x.ref),
    reasons = [...new Set(candidates.flatMap((x) => x.c.reasons))];
  const valid = status !== "NOT_COMPARABLE";
  const paceDeltaSecondsPerKm =
    valid && current.paceSecondsPerKm !== null && rows.every((p) => p.paceSecondsPerKm !== null)
      ? round(current.paceSecondsPerKm - median(rows.map((p) => p.paceSecondsPerKm!)))
      : null;
  const hrComparable =
    status === "DIRECT" &&
    known(current.heartRateMethod) &&
    rows.every((p) => p.heartRateMethod === current.heartRateMethod);
  const heartRateDeltaBpm =
    hrComparable && current.heartRateBpm !== null && rows.every((p) => p.heartRateBpm !== null)
      ? round(current.heartRateBpm - median(rows.map((p) => p.heartRateBpm!)))
      : null;
  const rpeDelta =
    valid &&
    current.rpe !== null &&
    known(current.rpeScale) &&
    rows.every((p) => p.rpe !== null && p.rpeScale === current.rpeScale)
      ? round(current.rpe - median(rows.map((p) => p.rpe!)))
      : null;
  const worse =
    paceDeltaSecondsPerKm !== null &&
    paceDeltaSecondsPerKm > 0 &&
    rpeDelta !== null &&
    rpeDelta > 0;
  const hasChange = [paceDeltaSecondsPerKm, heartRateDeltaBpm, rpeDelta].some(
    (v) => v !== null && v !== 0,
  );
  const text = `${current.date}对比此前${rows.length}个独立训练日：${status === "DIRECT" ? "记录条件匹配" : status === "LIMITED" ? "有限可比" : "不可直接比较"}，${paceDeltaSecondsPerKm === null ? "不计算配速变化" : `工作段均配速${paceDeltaSecondsPerKm > 0 ? "慢" : paceDeltaSecondsPerKm < 0 ? "快" : "变化"}${Math.abs(paceDeltaSecondsPerKm)}秒/公里`}${heartRateDeltaBpm === null ? "；心率不作跨次差值" : `；分段加权心率变化${heartRateDeltaBpm > 0 ? "+" : ""}${heartRateDeltaBpm}次/分`}${rpeDelta === null ? "" : `；同量表RPE变化${rpeDelta > 0 ? "+" : ""}${rpeDelta}`}。${reasons.length ? reasons.join("、") + "。" : ""}${rows.length === 1 ? "单次对照不是稳定个人基线。" : ""}不据此断言体能升降。`;
  return {
    current: current.ref,
    baselineRefs: refs,
    status,
    reasons,
    priorDays: rows.length,
    paceDeltaSecondsPerKm,
    heartRateDeltaBpm,
    rpeDelta,
    text,
    explanations: hasChange
      ? [
          {
            claim: worse
              ? "本次执行更吃力，可能与近期负荷或恢复变化有关"
              : "本次表现可能反映训练适应或当天状态变化",
            support: [],
            counter: [],
            missing: ["需要同期睡眠、疼痛及主观状态的关联观察，不能从相关性确认因果"],
          },
          {
            claim: "差异也可能来自配速策略、环境、间歇或测量变化",
            support: [],
            counter: [],
            missing: ["同路线天气与测量一致性；匹配字段仍不能排除未记录因素"],
          },
        ]
      : [],
  };
}
export function assessAthleteHistory(input: EvidenceSnapshot) {
  const snapshot = projectAnalysisEvidence({
      context: input.context,
      facts: input.facts,
      safetyConstraints: input.safetyConstraints,
    }),
    cutoff = Date.parse(snapshot.context.asOf) - 90 * 86400000;
  const training = snapshot.facts
    .filter((f): f is TrainingFact => f.kind === "TRAINING" && Date.parse(f.occurredAt) >= cutoff)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  const sessions = training
    .filter((t) => t.modality === "RUN")
    .map((t) => observation(t, snapshot.context.timeZone));
  const comparisons = sessions
    .slice(0, 12)
    .map((s, i) => compare(s, sessions.slice(i + 1)))
    .filter((c): c is HistoricalComparison => c !== null);
  const concerns = comparisons.filter(
    (c) =>
      c.status === "DIRECT" &&
      c.priorDays >= 2 &&
      c.paceDeltaSecondsPerKm !== null &&
      c.paceDeltaSecondsPerKm > 0 &&
      c.rpeDelta !== null &&
      c.rpeDelta > 0,
  );
  // Repeated descriptive concern is a review gate, not a fatigue score or physiological threshold.
  const recentConcern = concerns.filter((c) =>
    sessions.slice(0, 2).some((s) => s.ref.id === c.current.id),
  );
  const reviewExecution = recentConcern.length === 2 && sessions[0]?.date !== sessions[1]?.date;
  const strength = training
    .filter((t) => t.modality === "STRENGTH")
    .map((t) => ({
      ref: refOf(t),
      date: t.occurredAt.slice(0, 10),
      sets: t.strengthSets.filter((s) => s.completion === "COMPLETED"),
      source: [t.provider, t.accountRef, t.deviceId, t.protocolKey].join("/"),
    }));
  const actualStrengthSets = strength.reduce((n, t) => n + t.sets.length, 0);
  const days = new Set(
    training.map((t) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: snapshot.context.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(t.occurredAt)),
    ),
  ).size;
  const hold = snapshot.safetyConstraints.length > 0;
  const observations = [
    {
      text: `近90天读取到${days}个实际训练日，跑步${sessions.length}条分项、${actualStrengthSets ? `力量已记录${actualStrengthSets}个实际完成组` : "力量实际明细未知"}；仅代表记录覆盖，空白日期不认定休息或漏练。`,
      evidenceRefs: training.map(refOf),
    },
    ...sessions.slice(0, 1).map((s) => ({ text: s.text, evidenceRefs: [s.ref] })),
    ...comparisons
      .slice(0, 1)
      .map((c) => ({ text: c.text, evidenceRefs: [c.current, ...c.baselineRefs] })),
  ];
  const questions = [
    ...(comparisons[0]?.status !== "DIRECT" ? ["这些课的路线、间歇和设备是否一致？"] : []),
    "近期是否有疼痛、睡眠或主观吃力程度变化？",
  ].slice(0, 2);
  return {
    version: analysisDigest([snapshot.inputDigest, "R7_HISTORY_1"]),
    athleteId: snapshot.context.athleteId,
    asOf: snapshot.context.asOf,
    sessions,
    comparisons,
    strength,
    actualStrengthSets,
    observations,
    dimensions: {
      recordedRunning: sessions.some((s) => s.paceSecondsPerKm !== null) ? "OBSERVED" : "UNKNOWN",
      heartRateResponse: comparisons.some((c) => c.heartRateDeltaBpm !== null)
        ? "DESCRIPTIVE"
        : "INSUFFICIENT",
      strengthExecution: actualStrengthSets ? "OBSERVED" : "UNKNOWN",
      maximumCapacity: "REQUIRES_VERIFIED_PERFORMANCE",
      tolerance: "NOT_ESTABLISHED",
    } as const,
    planning: {
      reviewExecution,
      hold,
      allowAutomaticIncrease: false as const,
      reasons: [
        ...(hold ? ["已有疼痛或安全限制优先，不能由心率或设备分数解除"] : []),
        ...(reviewExecution
          ? ["最近两次匹配记录都较此前更慢且RPE更高：先复核执行与恢复，不提出递增"]
          : []),
      ],
    },
    questions,
    universalScore: null,
    automaticPrescription: false as const,
  };
}
export type AthleteHistory = ReturnType<typeof assessAthleteHistory>;
export function historySummary(h: AthleteHistory) {
  const c = h.comparisons[0];
  return [
    h.planning.reasons.join("；"),
    ...(c ? [c.text] : []),
    ...h.observations.filter(o=>o.text!==c?.text).map((o) => o.text),
    ...(c ? c.explanations.map((e) => `待检验解释：${e.claim}。目前缺少区分原因的直接证据。`) : []),
    "缺项仍保持未知；当前执行表现不能代替最大能力、组织恢复或医疗判断。",
    ...h.questions.map((q) => `待核对：${q}`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 950);
}
export function isHistoryQuestion(q: string) {
  return (
    !/朋友|同学|别人|学员|举例|假设/.test(q) &&
    /能力画像|历史训练|能力评估|配速.{0,5}心率|心率.{0,5}配速|最近.{0,6}(进步|退步|能力)/.test(q)
  );
}
