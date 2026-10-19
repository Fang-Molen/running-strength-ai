import { currentAthleteId, loadEvents } from "./events.ts";
import { ownedByCurrent } from "./ownership.ts";
import { appendJournal, readJournal } from "./storage-journal.ts";
import { classifyLocalSafety } from "./coach-local-safety.ts";
import { retrieveCognitionKnowledge } from "./coach-cognition-knowledge.ts";
import { explainRunningFeedback, runningFeedback } from "./running-transaction.ts";
import { listTrainingOccurrences } from "./occurrence.ts";
import {
  getRunningPlan,
  validateRunningComponents,
  type RunningPlan,
  type SessionComponent,
} from "./running-plan.ts";
import { startTrackSession, withRunningWriteLock } from "../ui/running-workouts.ts";
import { evaluateLearning, loadLearning } from "./coach-cognition-learning.ts";
import { daysBetweenCalendarDates } from "./coach-cognition-tools.ts";

export const INTAKE_PREFIX = "fr255-coach-intake-r2:";
export const FIRST_WEEK_VERSION = "FK-FIRST-WEEK-R2-20261011";
export type IntakeInputs = {
  goal: { event: "400米"; targetSeconds: number | null };
  ability: {
    age: number | null;
    experienceMonths: number | null;
    current400Seconds: number | null;
    measuredOn: string | null;
    timing: "electronic" | "hand" | "unknown";
    continuousEasyMinutes: number | null;
    note: string;
  };
  recent: {
    actual: boolean | null;
    sessionsPerWeek: number | null;
    easyMinutes: number | null;
    distanceMeters: number | null;
    repsPerRound: number | null;
    rounds: number | null;
    fastestSeconds: number | null;
    slowestSeconds: number | null;
    restSeconds: number | null;
    roundRestSeconds: number | null;
    measuredOn: string | null;
    rpe: number | null;
    recovery48: number | null;
    note: string;
  };
  deadline: { targetDate: string | null; noDeadline: boolean };
  availability: { weekdays: number[]; minutes: number; startDate: string };
  limits: {
    pain: "UNKNOWN" | "NONE_REPORTED" | "PRESENT";
    medicalRestriction: "UNKNOWN" | "NONE_REPORTED" | "PRESENT";
    sleepHours: number | null;
    recoveryNow: number | null;
    note: string;
  };
};
export type IntakeField = keyof IntakeInputs;
export type IntakeRecord = {
  /** Missing means unassigned historical data, not the current athlete. */
  athleteId?: string;
  id: string;
  sessionId: string;
  createdAt: string;
  kind: "ANSWER" | "CHOICE" | "EDIT";
  field: IntakeField | null;
  value: unknown;
  supersedes: string | null;
  supersedesIds?: string[];
  confirmed: true;
};
export const INTAKE_FIELDS: IntakeField[] = [
  "goal",
  "ability",
  "recent",
  "deadline",
  "availability",
  "limits",
];
export const INTAKE_QUESTIONS: Record<IntakeField, string> = {
  goal: "你希望400米达到什么目标？目标只作未来愿望，不作为当前能力。",
  ability:
    "先确认当前基础：年龄、训练经验、近期实际400米成绩及日期/计时；没有成绩也可以说明能轻松连续走跑多久。不要填写目标成绩。",
  recent:
    "过去4周实际练了什么？每周次数、轻松走跑时长；如有重复跑，填写原轮数、组次、实际秒数范围、休息、RPE和48小时恢复。计划过但没练不算实际。",
  deadline: "何时达成目标或比赛？没有固定期限可以明确选择；不能据期限反推出你的能力。",
  availability: "首周从哪天开始？哪几天能练、每次有多少分钟？可练天数不等于必须全部安排。",
  limits:
    "目前是否有疼痛、运动限制或异常症状？最近睡眠及当前主观恢复多少？未知保持未知，不能据未填写判断正常。",
};
const n = (x: unknown, lo: number, hi: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const nullable = (x: unknown, lo: number, hi: number) => x === null || n(x, lo, hi);
const date = (x: unknown) => typeof x === "string" && daysBetweenCalendarDates(x, x) === 0;
export function validateIntake(field: IntakeField, value: unknown): string | null {
  if (!value || typeof value !== "object") return "请填写本步骤的信息";
  const v = value as Record<string, unknown>;
  if (field === "goal" && (v.event !== "400米" || !nullable(v.targetSeconds, 10, 240)))
    return "目标必须是400米及有效秒数，或明确暂不填写成绩目标";
  if (
    field === "ability" &&
    (!nullable(v.age, 1, 110) ||
      !nullable(v.experienceMonths, 0, 720) ||
      !nullable(v.current400Seconds, 10, 240) ||
      !nullable(v.continuousEasyMinutes, 1, 180) ||
      !(v.measuredOn === null || date(v.measuredOn)) ||
      !["electronic", "hand", "unknown"].includes(String(v.timing)))
  )
    return "能力字段无效；不知道的值请留空，不要填0";
  if (
    field === "recent" &&
    (!nullable(v.sessionsPerWeek, 0, 7) ||
      !nullable(v.easyMinutes, 1, 180) ||
      !nullable(v.distanceMeters, 50, 400) ||
      !nullable(v.repsPerRound, 1, 20) ||
      !nullable(v.rounds, 1, 4) ||
      !nullable(v.fastestSeconds, 5, 240) ||
      !nullable(v.slowestSeconds, 5, 240) ||
      !nullable(v.restSeconds, 15, 1800) ||
      !nullable(v.roundRestSeconds, 15, 1800) ||
      !nullable(v.rpe, 1, 10) ||
      !nullable(v.recovery48, 1, 10) ||
      !(v.measuredOn === null || date(v.measuredOn)) ||
      ![true, false, null].includes(v.actual as boolean | null))
  )
    return "近期训练字段无效，实际/计划及缺失值需明确区分";
  if (
    field === "deadline" &&
    (typeof v.noDeadline !== "boolean" ||
      !(v.targetDate === null || date(v.targetDate)) ||
      (v.noDeadline && v.targetDate !== null))
  )
    return "请选择有效期限，或明确无固定期限";
  if (
    field === "availability" &&
    (!Array.isArray(v.weekdays) ||
      !v.weekdays.length ||
      v.weekdays.some((d) => !Number.isInteger(d) || !n(d, 0, 6)) ||
      new Set(v.weekdays).size !== v.weekdays.length ||
      !n(v.minutes, 15, 120) ||
      !date(v.startDate))
  )
    return "请选择不重复的可练日期、15–120分钟及有效首周日期";
  if (
    field === "limits" &&
    (!["UNKNOWN", "NONE_REPORTED", "PRESENT"].includes(String(v.pain)) ||
      !["UNKNOWN", "NONE_REPORTED", "PRESENT"].includes(String(v.medicalRestriction)) ||
      !nullable(v.sleepHours, 0, 24) ||
      !nullable(v.recoveryNow, 1, 10))
  )
    return "请明确疼痛、限制和恢复；未知不能填成正常";
  if ("note" in v && (typeof v.note !== "string" || v.note.length > 1200)) return "说明过长或无效";
  return null;
}
// 生成/采纳新课只认显式归属当前运动员的回答（安全相关，按 C03/R14 原样）；旧无归属回答对 local 仅可读。
const ownsIntake = (r: IntakeRecord) => r.athleteId === currentAthleteId();
const ownedStartIds = () => new Set(loadEvents().filter(e => e.event_type === "TRAINING_STARTED" && (e.athlete_id ?? "local") === currentAthleteId()).map(e => e.event_id));
const explainOwnedRunningFeedback = () => {
  const starts = ownedStartIds();
  const ids = [...new Set(runningFeedback().filter(x => starts.has(x.trainingOccurrenceId)).map(x => x.trainingOccurrenceId))];
  return ids.length ? ids.map(id => explainRunningFeedback(id)).join("；") : "当前运动员训练反馈未知；缺失不代表恢复正常。";
};
export function loadIntake(sessionId: string): IntakeRecord[] {
  return readJournal<IntakeRecord>(INTAKE_PREFIX)
    .map((x) => x.data)
    .filter((x) => x.sessionId === sessionId && (ownsIntake(x) || ownedByCurrent(x)));
}
export function appendIntakeAnswer<K extends IntakeField>(
  sessionId: string,
  field: K,
  value: IntakeInputs[K],
  supersedes: string | string[] | null = null,
): { ok: boolean; error: string | null } {
  const error = validateIntake(field, value);
  if (error) return { ok: false, error };
  if (!sessionId) return { ok: false, error: "缺少首次使用编号" };
  const ids = Array.isArray(supersedes) ? supersedes : supersedes ? [supersedes] : [];
  if (
    ids.some(
      (id) =>
        !loadIntake(sessionId).some((x) => ownsIntake(x) && x.id === id && x.kind === "ANSWER" && x.field === field),
    )
  )
    return { ok: false, error: "更正必须指向本次同一字段的原记录" };
  const record: IntakeRecord = {
    athleteId: currentAthleteId(),
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    kind: "ANSWER",
    field,
    value,
    supersedes: ids[0] ?? null,
    supersedesIds: ids,
    confirmed: true,
  };
  const ok = appendJournal(INTAKE_PREFIX, record.id, record);
  return { ok, error: ok ? null : "保存失败，未进入下一步" };
}
export function intakeState(records: IntakeRecord[]) {
  const inputs: Partial<IntakeInputs> = {},
    evidenceIds: string[] = [],
    conflicts: IntakeField[] = [],
    errors: string[] = [];
  const superseded = new Set(
    records.flatMap((x) => [...(x.supersedes ? [x.supersedes] : []), ...(x.supersedesIds ?? [])]),
  );
  for (const field of INTAKE_FIELDS) {
    const active = records.filter(
      (r) => r.kind === "ANSWER" && r.field === field && !superseded.has(r.id),
    );
    if (active.some((r) => validateIntake(field, r.value))) {
      errors.push(`${field}输入无效`);
      continue;
    }
    if (new Set(active.map((r) => JSON.stringify(r.value))).size > 1) {
      conflicts.push(field);
      continue;
    }
    if (active[0]) {
      Object.assign(inputs, { [field]: active[0].value });
      evidenceIds.push(...active.map((r) => r.id));
    }
  }
  return { inputs, evidenceIds, conflicts, errors };
}
export type FirstWeekSession = {
  id: string;
  date: string;
  weekday: number;
  kind: "REST" | "FOUNDATION" | "FAMILIAR_REPETITION";
  purpose: string;
  mainMinutes: number;
  distanceMeters: number | null;
  repsPerRound: number | null;
  rounds: number | null;
  targetSeconds: [number, number] | null;
  restSeconds: number | null;
  roundRestSeconds: number | null;
  warmupMinutes: number;
  cooldownMinutes: number;
  estimatedMinutes: number;
  intensity: string;
  stop: string;
  reason: string;
};
export type FirstWeekDraft = {
  id: string;
  version: string;
  status: "CANDIDATE_ONLY";
  sessions: FirstWeekSession[];
  evidenceIds: string[];
  currentAbilitySeconds: number | null;
  goalSeconds: number | null;
  confidence: "LOW";
  executable: false;
  knowledge: ReturnType<typeof retrieveCognitionKnowledge>;
  sources: { title: string; url: string; limitation: string }[];
  hypotheses: { explanation: string; counterEvidence: string; check: string }[];
  warnings: string[];
  editOf: string | null;
};
type FirstWeekResult = {
  status: "NEEDS_INFO" | "BLOCKED" | "READY_CANDIDATE";
  nextField: IntakeField | null;
  question: string;
  issues: string[];
  draft: FirstWeekDraft | null;
};
export function buildFirstWeek(records: IntakeRecord[], today: string): FirstWeekResult {
  // Historical/foreign answers remain stored and readable, but cannot authorize a new dose.
  records = records.filter(ownsIntake);
  const { inputs: i, evidenceIds, conflicts, errors } = intakeState(records);
  const ask = (f: IntakeField, issues: string[]): FirstWeekResult => ({
    status: "NEEDS_INFO",
    nextField: f,
    question: INTAKE_QUESTIONS[f],
    issues,
    draft: null,
  });
  const block = (issues: string[]): FirstWeekResult => ({
    status: "BLOCKED",
    nextField: "limits",
    question: "先核对安全与冲突，不生成训练剂量；症状或限制请由专业人员评估。",
    issues,
    draft: null,
  });
  const safetyText = records
    .filter((r) => r.kind === "ANSWER")
    .map((r) => String((r.value as { note?: string })?.note ?? ""))
    .join("。");
  if (
    classifyLocalSafety(safetyText) !== "NONE" ||
    i.limits?.pain === "PRESENT" ||
    i.limits?.medicalRestriction === "PRESENT"
  )
    return block(["出现风险或运动限制，性能目标不能覆盖安全；旧风险说明也需核实评估"]);
  const limitConfirmation = records
    .filter((x) => x.kind === "ANSWER" && x.field === "limits" && evidenceIds.includes(x.id))
    .at(-1);
  const starts = ownedStartIds();
  const recentFeedback = runningFeedback().filter(
    (x) => starts.has(x.trainingOccurrenceId) && Date.parse(x.recordedAt) > Date.parse(limitConfirmation?.createdAt ?? "1970-01-01"),
  );
  if (
    recentFeedback.some(
      (x) => (x.pain ?? 0) > 0 || (x.rpe ?? 0) >= 8 || (x.recovery !== null && x.recovery <= 3),
    )
  )
    return ask("limits", [
      "已绑定训练反馈出现高RPE、疼痛或低恢复；先更新当前症状与恢复，不能沿用训练前正常自报。",
      explainOwnedRunningFeedback(),
    ]);
  if (conflicts.length)
    return ask(conflicts[0], [
      `同一字段有冲突：${conflicts.join("、")}；请显式更正，不能自动选最新或平均`,
    ]);
  if (errors.length) return block(errors);
  for (const f of INTAKE_FIELDS) if (!i[f]) return ask(f, []);
  const {
    goal: g,
    ability: a,
    recent: r,
    deadline: d,
    availability: v,
    limits: l,
  } = i as IntakeInputs;
  if (a.age === null || a.experienceMonths === null) return ask("ability", ["年龄或训练经验未知"]);
  if (a.age < 18) return block(["本轮首周规则仅覆盖成年人；未成年人需监护人与专业教练共同评估"]);
  if (a.continuousEasyMinutes === null)
    return ask("ability", [
      "请确认当前可耐受的轻松走跑时长；仅400米目标或成绩不足以确定首周基础量",
    ]);
  if (a.current400Seconds !== null && (!a.measuredOn || a.timing === "unknown"))
    return ask("ability", ["成绩日期及计时方式未知，不能当作已确认当前能力"]);
  if (
    a.measuredOn &&
    daysBetweenCalendarDates(a.measuredOn, today) !== null &&
    daysBetweenCalendarDates(a.measuredOn, today)! < 0
  )
    return ask("ability", ["实际成绩日期不能在未来"]);
  if (r.actual !== true || r.sessionsPerWeek === null)
    return ask("recent", ["请确认实际近期训练；计划或未知不作为完成量。没有规律训练可明确填0次"]);
  if (
    !Number.isInteger(r.sessionsPerWeek) ||
    (r.repsPerRound !== null && !Number.isInteger(r.repsPerRound)) ||
    (r.rounds !== null && !Number.isInteger(r.rounds))
  )
    return ask("recent", ["次数与轮数必须是整数"]);
  if (r.measuredOn && daysBetweenCalendarDates(r.measuredOn, today)! < 0)
    return ask("recent", ["实际训练日期不能在未来"]);
  if (!d.noDeadline && !d.targetDate) return ask("deadline", ["期限未知"]);
  const days = d.targetDate ? daysBetweenCalendarDates(today, d.targetDate) : null;
  if (days !== null && days < 0) return ask("deadline", ["目标期限已过去，请更正"]);
  const acceptedWeek = savedFirstWeekDraft(records);
  const withinAcceptedWeek =
    acceptedWeek &&
    daysBetweenCalendarDates(v.startDate, today)! >= 0 &&
    daysBetweenCalendarDates(v.startDate, today)! <= 6;
  if (!date(today) || (daysBetweenCalendarDates(today, v.startDate)! < 0 && !withinAcceptedWeek))
    return ask("availability", ["首周起始日期不能早于今天"]);
  if (
    l.pain === "UNKNOWN" ||
    l.medicalRestriction === "UNKNOWN" ||
    l.sleepHours === null ||
    l.recoveryNow === null
  )
    return ask("limits", ["疼痛、运动限制、睡眠或当前恢复未知；暂不把缺数据当正常"]);
  if (
    l.sleepHours < 6 ||
    l.recoveryNow <= 3 ||
    (r.rpe !== null && r.rpe >= 8) ||
    (r.recovery48 !== null && r.recovery48 <= 3)
  )
    return block([
      "存在短睡眠、高RPE或低恢复线索，先恢复与核实，不新增首周专项刺激；这不是疲劳诊断",
    ]);
  if (r.fastestSeconds !== null && r.slowestSeconds !== null && r.fastestSeconds > r.slowestSeconds)
    return ask("recent", ["实际秒数范围反向，请更正"]);
  const dates = Array.from({ length: 7 }, (_, k) => {
    const x = new Date(v.startDate + "T12:00:00Z");
    x.setUTCDate(x.getUTCDate() + k);
    return { date: x.toISOString().slice(0, 10), weekday: x.getUTCDay() };
  });
  const available = dates.filter((x) => v.weekdays.includes(x.weekday));
  const count = Math.min(available.length, r.sessionsPerWeek === 0 ? 2 : r.sessionsPerWeek);
  const selected = available.filter((_, k) => k < count);
  const recentAge = r.measuredOn ? daysBetweenCalendarDates(r.measuredOn, today) : null;
  const abilityAge = a.measuredOn ? daysBetweenCalendarDates(a.measuredOn, today) : null;
  let familiar =
    a.experienceMonths >= 12 &&
    a.current400Seconds !== null &&
    abilityAge !== null &&
    abilityAge <= 56 &&
    recentAge !== null &&
    recentAge <= 28 &&
    r.rpe !== null &&
    r.rpe <= 7 &&
    r.recovery48 !== null &&
    r.recovery48 >= 5 &&
    r.distanceMeters !== null &&
    r.repsPerRound !== null &&
    r.rounds !== null &&
    r.fastestSeconds !== null &&
    r.slowestSeconds !== null &&
    r.restSeconds !== null &&
    (days === null || days > 28);
  const warmup = 12,
    cooldown = 5,
    rest = r.restSeconds ?? 0,
    rounds = r.rounds ?? 1,
    roundRest = r.roundRestSeconds ?? 0;
  if (rounds > 1 && r.roundRestSeconds === null) familiar = false;
  let reps = Math.max(1, Math.floor((r.repsPerRound ?? 1) * 0.75));
  const estimate = () =>
    warmup +
    cooldown +
    (reps * rounds * (r.slowestSeconds ?? 0) * 1.05 +
      rounds * Math.max(0, reps - 1) * rest +
      Math.max(0, rounds - 1) * roundRest) /
      60;
  while (reps > 1 && estimate() > v.minutes) reps--;
  if (estimate() > v.minutes) familiar = false;
  const easy = Math.max(
    1,
    Math.min(10, Math.floor(a.continuousEasyMinutes * 0.5), r.easyMinutes ?? 10, v.minutes - 10),
  );
  const stop =
    "新疼痛、胸痛、晕厥感或异常呼吸立即停止并按风险评估；重复跑若连续两次超出候选上限或动作失控，停止主课，不补做；次日恢复明显差先反馈再调整。";
  let usedQuality = false;
  const sessions: FirstWeekSession[] = dates.map((x, k) => {
    const active = selected.some((y) => y.date === x.date),
      quality = active && familiar && !usedQuality;
    if (quality) usedQuality = true;
    const base = { id: `day-${k + 1}`, date: x.date, weekday: x.weekday, stop };
    if (!active)
      return {
        ...base,
        kind: "REST",
        purpose: "恢复与观察",
        mainMinutes: 0,
        distanceMeters: null,
        repsPerRound: null,
        rounds: null,
        targetSeconds: null,
        restSeconds: null,
        roundRestSeconds: null,
        warmupMinutes: 0,
        cooldownMinutes: 0,
        estimatedMinutes: 0,
        intensity: "不安排额外主课",
        reason: "首周不因可练天数多而填满；休息并记录恢复",
      };
    if (quality)
      return {
        ...base,
        kind: "FAMILIAR_REPETITION",
        purpose: "重现已有重复跑的可控质量，收集恢复反馈",
        mainMinutes: Number((estimate() - warmup - cooldown).toFixed(2)),
        distanceMeters: r.distanceMeters,
        repsPerRound: reps,
        rounds,
        targetSeconds: [r.slowestSeconds!, Number((r.slowestSeconds! * 1.05).toFixed(2))],
        restSeconds: rest,
        roundRestSeconds: rounds > 1 ? roundRest : null,
        warmupMinutes: warmup,
        cooldownMinutes: cooldown,
        estimatedMinutes: Number(estimate().toFixed(2)),
        intensity: "不快于近期自报最慢一组；主观用力上限候选7/10，不全速冲刺",
        reason: `使用近期实际${r.distanceMeters}米×${r.repsPerRound}×${rounds}轮、组间${rest}秒/轮间${roundRest}秒，首周仅保留较少组次；不由目标${g.targetSeconds ?? "未定"}秒反推速度`,
      };
    return {
      ...base,
      kind: "FOUNDATION",
      purpose: "轻松走跑与适应观察",
      mainMinutes: easy,
      distanceMeters: null,
      repsPerRound: null,
      rounds: null,
      targetSeconds: null,
      restSeconds: null,
      roundRestSeconds: null,
      warmupMinutes: 5,
      cooldownMinutes: 5,
      estimatedMinutes: easy + 10,
      intensity: "可完整交谈、主观用力约2–3/10；走路也可，不做全速测试",
      reason: `由当前可轻松走跑${a.continuousEasyMinutes}分钟保守取${easy}分钟，匹配每次${v.minutes}分钟；暂不推算200/400米训练秒数`,
    };
  });
  const memory = loadLearning();
  const learning = evaluateLearning({ ...memory, records: memory.records.filter(r => ownedByCurrent(r)) }, "400米", currentAthleteId());
  const draft: FirstWeekDraft = {
    id: crypto.randomUUID(),
    version: FIRST_WEEK_VERSION,
    status: "CANDIDATE_ONLY",
    sessions,
    evidenceIds,
    currentAbilitySeconds: a.current400Seconds,
    goalSeconds: g.targetSeconds,
    confidence: "LOW",
    executable: false,
    knowledge: retrieveCognitionKnowledge(["400米"]),
    sources: [
      {
        title: "CDC：从少量开始、逐步增加活动",
        url: "https://www.cdc.gov/healthy-weight-growth/physical-activity/getting-started.html",
        limitation: "面向一般成人活动；不是400米处方试验，不证明本候选剂量最优",
      },
    ],
    hypotheses: [
      {
        explanation: "当前表现可能与配速或专项经验相关",
        counterEvidence: "当前成绩与单次重复跑不足以定位短板",
        check: "收集同条件实际分段和技术观察，保留竞争解释",
      },
      {
        explanation: "恢复条件可能影响首周耐受",
        counterEvidence: "自报睡眠和一次评分不能确认疲劳原因",
        check: "记录主课RPE、24h/48h恢复与反例，复核而非自动加量",
      },
    ],
    warnings: [
      explainOwnedRunningFeedback(),
      "目标可行性UNKNOWN，不承诺达标；输入为用户确认自报，未写入训练事实",
      "组次75%、秒数5%容差、时长折半、56/28天新鲜度是保守候选产品规则，不是已批准科学阈值",
      "首次周不自动增加近期训练频率，不自动复制精英剂量",
      ...(days !== null && days <= 28
        ? ["距目标≤28天，仅生成基础/恢复候选，不由一次表现增加专项负荷"]
        : []),
      ...(!familiar
        ? ["缺少合格同课证据或当前不适合专项候选，本周不生成400米全速/长间歇剂量"]
        : []),
      `反馈记忆可核对${learning.outcomes.length}条配对、${learning.patterns.length}组低置信响应；未确认与本周同条件，不迁移剂量或授权增加负荷`,
    ],
    editOf: null,
  };
  return {
    status: "READY_CANDIDATE",
    nextField: null,
    question: "请检查首周候选，可修改、接受或拒绝；仍未替换正式课表。",
    issues: [],
    draft,
  };
}
export function editFirstWeek(
  draft: FirstWeekDraft,
  sessionId: string,
  patch: { mainMinutes?: number; repsPerRound?: number },
): FirstWeekDraft {
  const s = draft.sessions.find((x) => x.id === sessionId);
  if (!s || s.kind === "REST") throw Error("不可修改休息为新增主课");
  if (
    patch.mainMinutes !== undefined &&
    (!n(patch.mainMinutes, 1, s.mainMinutes) || s.kind !== "FOUNDATION")
  )
    throw Error("候选仅支持在已评估范围内减少时长；加量需重新评估");
  if (
    patch.repsPerRound !== undefined &&
    (!Number.isInteger(patch.repsPerRound) ||
      !n(patch.repsPerRound, 1, s.repsPerRound ?? 0) ||
      s.kind !== "FAMILIAR_REPETITION")
  )
    throw Error("候选仅支持减少已有组次；加量需重新评估");
  const changed = { ...s, ...patch };
  changed.mainMinutes =
    s.kind === "FOUNDATION"
      ? changed.mainMinutes
      : Number(
          (
            (changed.repsPerRound! * changed.rounds! * changed.targetSeconds![1] +
              changed.rounds! * Math.max(0, changed.repsPerRound! - 1) * changed.restSeconds! +
              Math.max(0, changed.rounds! - 1) * (changed.roundRestSeconds ?? 0)) /
            60
          ).toFixed(2),
        );
  changed.estimatedMinutes = Number(
    (changed.mainMinutes + changed.warmupMinutes + changed.cooldownMinutes).toFixed(2),
  );
  return {
    ...draft,
    id: crypto.randomUUID(),
    editOf: draft.id,
    sessions: draft.sessions.map((x) => (x.id !== sessionId ? x : changed)),
    warnings: [...draft.warnings, "用户主动修改候选；原版本保留，未自动执行"],
  };
}
/** Resume the saved modified candidate only while all its intake evidence remains current. */
export function savedFirstWeekDraft(records: IntakeRecord[]): FirstWeekDraft | null {
  records = records.filter(ownsIntake);
  const current = intakeState(records);
  if (current.conflicts.length || current.errors.length) return null;
  const saved = records.filter((r) => r.kind === "EDIT" || r.kind === "CHOICE").at(-1)?.value as
    { draft?: FirstWeekDraft } | undefined;
  const d = saved?.draft;
  return d?.version === FIRST_WEEK_VERSION &&
    d.evidenceIds.length === current.evidenceIds.length &&
    d.evidenceIds.every((id) => current.evidenceIds.includes(id))
    ? d
    : null;
}
export function recordFirstWeekChoice(
  sessionId: string,
  draft: FirstWeekDraft,
  choice: "ACCEPT" | "REJECT" | "MODIFY",
) {
  const current = intakeState(loadIntake(sessionId).filter(ownsIntake));
  if (
    !["ACCEPT", "REJECT", "MODIFY"].includes(choice) ||
    draft.version !== FIRST_WEEK_VERSION ||
    current.conflicts.length || current.errors.length ||
    INTAKE_FIELDS.some(f => !current.inputs[f]) ||
    !current.evidenceIds.length ||
    current.evidenceIds.length !== draft.evidenceIds.length ||
    !current.evidenceIds.every((id) => draft.evidenceIds.includes(id))
  )
    return false;
  const record: IntakeRecord = {
    athleteId: currentAthleteId(),
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    kind: choice === "MODIFY" ? "EDIT" : "CHOICE",
    field: null,
    value: { choice, draft },
    supersedes: null,
    confirmed: true,
  };
  return appendJournal(INTAKE_PREFIX, record.id, record);
}
export function firstWeekGoalFromText(q: string): IntakeInputs["goal"] | null {
  if (!/400\s*(?:米|m)/i.test(q) || !/目标|跑到|跑进|希望|计划|安排|怎么练/.test(q)) return null;
  const m = q.match(
    /(?:目标|跑到|跑进|希望)\s*(?:400\s*(?:米|m)\s*)?(?:跑到|跑进)?\s*(\d+(?:\.\d+)?)\s*秒/i,
  );
  return { event: "400米", targetSeconds: m ? Number(m[1]) : null };
}

/** A confirmed candidate creates its own running plan and frozen start in one commit.
 * It never replaces a formal plan. Date, stale evidence and latest rejection are checked under the write lock. */
export function startFirstWeekSession(
  sessionId: string,
  draftId: string,
  sessionDayId: string,
  today: string,
) {
  const records = loadIntake(sessionId).filter(ownsIntake),
    draft = savedFirstWeekDraft(records);
  const latest = records.filter((x) => x.kind === "CHOICE" || x.kind === "EDIT").at(-1)?.value as
    { choice?: string; draft?: FirstWeekDraft } | undefined;
  if (!draft || draft.id !== draftId || latest?.choice !== "ACCEPT")
    return { ok: false as const, reason: "请先接受当前候选；已修改、拒绝或失效的候选不能开练。" };
  const day = draft.sessions.find((x) => x.id === sessionDayId);
  if (!day || day.kind === "REST") return { ok: false as const, reason: "这天是休息或不存在。" };
  const planId = `candidate-${draft.id}-${day.id}`;
  const starts = ownedStartIds();
  const existing = listTrainingOccurrences()
    .filter((x) => starts.has(x.startEventId) && x.planSlotId === planId)
    .at(-1);
  if (existing) return { ok: true as const, trainingOccurrenceId: existing.trainingOccurrenceId };
  if (buildFirstWeek(records, today).status !== "READY_CANDIDATE")
    return { ok: false as const, reason: "当前条件已失效，请重新核对。" };
  if (day.date !== today)
    return { ok: false as const, reason: "仅能开始当天候选；不能提前生成训练事实。" };
  const continuous = (
    id: string,
    purpose: "WARMUP" | "EASY_AEROBIC" | "COOLDOWN",
    minutes: number,
  ): SessionComponent => ({
    componentId: id,
    modality: "RUNNING",
    purpose,
    structure: {
      kind: "CONTINUOUS",
      plannedDistanceMeters: null,
      plannedDistanceMaxMeters: null,
      plannedDurationSeconds: minutes * 60,
    },
  });
  const components: SessionComponent[] = [continuous("warmup", "WARMUP", day.warmupMinutes)];
  if (day.kind === "FOUNDATION")
    components.push(continuous("main", "EASY_AEROBIC", day.mainMinutes));
  else
    components.push({
      componentId: "main",
      modality: "RUNNING",
      purpose: "REPETITION_SPEED",
      structure: {
        kind: "REPEATED",
        blocks: [
          {
            blockId: "main",
            roundCount: day.rounds!,
            recoveryAfterRoundSeconds: day.rounds! > 1 ? day.roundRestSeconds : null,
            steps: [
              {
                stepId: "rep",
                repeatCount: day.repsPerRound!,
                plannedDistanceMeters: day.distanceMeters,
                plannedDurationSeconds: null,
                recoveryAfterRepeatSeconds: day.repsPerRound! > 1 ? day.restSeconds : null,
                recoveryBeforeNextStepSeconds: null,
              },
            ],
          },
        ],
      },
    });
  components.push(continuous("cooldown", "COOLDOWN", day.cooldownMinutes));
  const validated = validateRunningComponents(components);
  if (!validated.ok || getRunningPlan(planId))
    return { ok: false as const, reason: "结构冲突，请核对候选。" };
  const plan: RunningPlan = {
    runningPlanSchemaVersion: 1,
    planId,
    planSlotId: planId,
    components: validated.components,
  };
  return startTrackSession(planId, plan);
}
export const startFirstWeekSessionSafely = (
  sessionId: string,
  draftId: string,
  dayId: string,
  today: string,
) => withRunningWriteLock(() => startFirstWeekSession(sessionId, draftId, dayId, today));

export function firstWeekOccurrences(records: IntakeRecord[]) {
  const starts = ownedStartIds();
  const draftIds = records.filter(ownsIntake)
    .filter((x) => x.kind === "CHOICE" || x.kind === "EDIT")
    .flatMap((x) => {
      const d = (x.value as { draft?: FirstWeekDraft })?.draft;
      return d ? [d.id] : [];
    });
  return listTrainingOccurrences().filter((o) => starts.has(o.startEventId) &&
    draftIds.some((id) => o.planSlotId.startsWith(`candidate-${id}-`)),
  );
}
