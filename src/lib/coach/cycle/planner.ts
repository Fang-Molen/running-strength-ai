import { supportsRepeatedCourse } from './actual-structure';
import { actualCourseSeeds } from './actual-seeds';
import { analysisDigest, refOf } from "../../health/analysis-evidence";
import { addDays, weekOf, type ScheduleEntry } from "../../ui/day-schedule-rules";
import { localDay } from "../../health/observation";
import { plannedRunDose } from "../r5/commands";
import { exerciseContent } from "../../strength/exercise-content";
import { buildAthletePortrait, validActualEntries } from "./portrait";
import {
  validateCycleGoal,
  phaseLabels,
  priorityLabels,
  type CycleInput,
  type CyclePhase,
  type CycleSession,
  type CycleEventFocus,
  type CyclePhaseReview,
  type CycleConditionCheck,
  type CycleConditionState,
  type CycleCourseFit,
} from "./types";
const distanceFamily = (meters: number | null) =>
  meters === null ? "GENERAL" : meters <= 400 ? "SPRINT" : meters <= 1500 ? "MIDDLE" : "DISTANCE";
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const keyCourse = (e: ScheduleEntry) => e.intensity === "HARD" || e.lowerHeavy;
/** Event-specific output structure from the approved specification; no dose or race prediction. */
function describeEventFocus(eventMeters: number | null): CycleEventFocus {
  const specific: Record<number, Omit<CycleEventFocus, "eventMeters">> = {
    400: { objective: "400米专项速度、技术与恢复条件", evidenceNeeds: ["同结构分段、轮次与实际恢复方式", "完整测试的完成质量与技术观察来源"], limitation: "末段冲刺不能推断完整比赛能力；普通慢跑不等于最大速度证据" },
    800: { objective: "800米速度与专项耐力两类目标及比赛时间线", evidenceNeeds: ["速度课与专项耐力课各自的目的、分段和恢复", "同协议可比测试及跑力冲突"], limitation: "不能直接套400米或长跑课表；缺可比测试时相关能力未知" },
    1500: { objective: "1500米专项节奏、速度与耐力分别核对", evidenceNeeds: ["同结构节奏课的分段、恢复和完成质量", "比赛或最大努力测试的独立记录"], limitation: "训练均速不能直接作为比赛配速或最大能力" },
    3000: { objective: "3000米比赛准备、速度与耐力任务", evidenceNeeds: ["近期同结构可比训练及比赛日期", "各段目的、实际质量与恢复条件"], limitation: "单次间歇或另一项目成绩不能直接给出确定赛速" },
    5000: { objective: "5000米可比耐力表现、节奏任务与可用时间", evidenceNeeds: ["近期同条件耐力表现与目标比赛", "当前可用时间、课型和实际完成"], limitation: "历史PB不直接代表当前状态，不由目标倒推处方配速" },
    10000: { objective: "10000米专项耐力、节奏、已承受暴露与补给条件", evidenceNeeds: ["赛事时间与近期可比耐力暴露", "已完成课程、后续反应和补给可用条件"], limitation: "不机械设定周跑量；5公里成绩不等于真实10公里能力" },
  };
  return { eventMeters, ...(eventMeters !== null && specific[eventMeters] ? specific[eventMeters] : eventMeters !== null && eventMeters > 1500
    ? { objective: "其他长跑的目标赛事、可用时间与近期可比耐力暴露", evidenceNeeds: ["该目标赛事的独立要求", "关键课、实际耐力暴露与恢复"], limitation: "不用中短跑指标替代耐力基础，不套用其他项目的实测能力" }
    : { objective: "已确认目标下的一般体能与熟悉动作", evidenceNeeds: ["明确项目与任务目的", "本人实际课程与完成质量"], limitation: "项目未确认或未有专用输出结构，专项能力与处方仍需核对" }) };
}
/** A transparent retrieval order over familiar labels/structures, not a dose model or
 * evidence that the selected course is optimal for the event. Transfer stays conditional. */
const eventRetrieval: Record<number, { order: string[]; why: string; gap: string }> = {
  400: { order: ["REPETITION_SPEED:REPEATED", "HILL:REPEATED", "INTERVAL:REPEATED"], why: "先核对速度重复中的每段质量和实际恢复", gap: "尚需完整专项表现及技术观察；短段质量不证明全程能力" },
  800: { order: ["INTERVAL:REPEATED", "REPETITION_SPEED:REPEATED", "TEMPO_THRESHOLD:REPEATED"], why: "从分段及间歇核对专项耐力任务，并另看速度储备", gap: "单节间歇不能同时证明速度与耐力；仍需独立速度任务和比赛条件对照" },
  1500: { order: ["TEMPO_THRESHOLD:REPEATED", "INTERVAL:REPEATED", "REPETITION_SPEED:REPEATED"], why: "先查看可分段复核的节奏任务，再分别核对速度和耐力", gap: "分段节奏向连续比赛的迁移未验证；独立速度和耐力证据仍需核对" },
  3000: { order: ["INTERVAL:REPEATED", "TEMPO_THRESHOLD:CONTINUOUS", "TEMPO_THRESHOLD:REPEATED"], why: "用同结构间歇观察比赛准备中的执行一致性，再核对连续耐力", gap: "间歇完成不能给出确定赛速；还需连续耐力表现与赛事时间线" },
  5000: { order: ["TEMPO_THRESHOLD:CONTINUOUS", "INTERVAL:REPEATED", "LONG:CONTINUOUS"], why: "先查看连续节奏的已完成表现与可用训练时间", gap: "连续节奏不等于当前比赛能力；需近期同条件耐力表现，历史PB不能替代" },
  10000: { order: ["LONG:CONTINUOUS", "TEMPO_THRESHOLD:CONTINUOUS", "INTERVAL:REPEATED"], why: "先核对已标为耐力暴露的连续课及后续恢复，再讨论节奏与补给", gap: "LONG标签不证明距离足够或补给可行；需该赛事暴露与进食条件，不能由5公里成绩推定" },
};
const conditionLabels: Record<CycleConditionState, string> = { SATISFIED: "已满足记录条件", UNKNOWN: "待核对", CONTRADICTED: "现有证据不支持" };
export function cycleBasis(input: CycleInput) {
  return analysisDigest([
    input.snapshot.context.athleteId,
    localDay(new Date(input.snapshot.context.asOf)),
    input.snapshot.facts,
    input.snapshot.safetyConstraints,
    [
      input.recovery.safetyState,
      input.recovery.signalState,
      input.recovery.dataQuality,
      input.recovery.missingDecisionInputs,
    ],
    input.entries,
    input.goal,
    input.request ?? null,
    input.profileVersion,
    input.training.version,
    input.calendarVersion,
    input.importedDates,
  ]);
}
export function buildCycleDraft(input: CycleInput) {
  validateCycleGoal(input.goal);
  if(input.request && (![14,28,42].includes(input.request.historyDays)||!Number.isInteger(input.request.horizonWeeks)||input.request.horizonWeeks<1||input.request.horizonWeeks>52))throw Error("规划窗口无效");
  const portrait = buildAthletePortrait(input),
    g = input.request ? {...input.goal,horizonWeeks:input.request.horizonWeeks} : input.goal,
    owner = portrait.athleteId,
    today = localDay(new Date(input.snapshot.context.asOf));
  if (g.athleteId !== owner) throw Error("周期目标不属于当前用户");
  const now = Date.parse(input.snapshot.context.asOf),
    family = distanceFamily(g.eventMeters),
    eventFocus = describeEventFocus(g.eventMeters),
    start = addDays(weekOf(today)[0], 7),
    weeksLeft = g.raceDate ? Math.ceil((daysBetween(start, g.raceDate) + 1) / 7) : g.horizonWeeks;
  const weekCount = Math.min(g.horizonWeeks, Math.max(1, weeksLeft)),
    hold =
      ["HOLD_ACTIVE", "ESCALATION_REQUIRED"].includes(input.recovery.safetyState) ||
      input.training.restrictions.length > 0 ||
      input.snapshot.safetyConstraints.length > 0;
  const concerns = input.recovery.signalState !== "NO_ADVERSE_SIGNAL_OBSERVED" || portrait.history.planning.reviewExecution;
  const warnings = [
    ...portrait.history.planning.reasons,
    ...(!g.raceDate ? ["比赛日期未知，生成滚动规划，不假设赛期"] : []),
    ...(g.raceDate && g.raceDate < start
      ? ["比赛位于本周或已过期：下周只做恢复与复核，不补造备赛期"]
      : []),
    ...(weeksLeft > g.horizonWeeks ? ["比赛在当前规划窗口之后；仅展示本窗口，临近后重算"] : []),
    "阶段划分和单变量门槛是可复核产品策略；没有经过个人效果验证。",
  ];
  const entries = input.entries.filter((e) => (e.athleteId ?? "local") === owner),
    actual = [...validActualEntries(input, portrait.training), ...actualCourseSeeds(portrait.training, input.entries)].filter(
      (e) =>
        e.actual &&
        e.actual.outcome !== "missed" &&
        e.status === "done" &&
        e.date < start &&
        e.date <= today &&
        e.date >= addDays(today, -(input.request?.historyDays ?? 42)+1) &&
        Date.parse(e.actual.at) <= now &&
        !e.actual.reasons.includes("pain") &&
        !e.actual.reasons.includes("tired") &&
        (e.actual.rpe === null || e.actual.rpe === undefined || e.actual.rpe < 9) &&
        e.actual.executionState !== "PARTIAL" &&
        e.actual.executionState !== "INTERRUPTED",
    );
  const recentWindows=portrait.adaptive.windows;
  const manualWeeks=[0,1].map(i=>{
    const end=addDays(today,-7*i),start=addDays(end,-6);
    const rows=actual.filter(e=>e.date>=start&&e.date<=end&&!e.actual?.occurrenceIds?.length);
    return {minutes:rows.length&&rows.every(e=>e.actual?.minutes!==null)?rows.reduce((n,e)=>n+e.actual!.minutes!,0):null,sessionCount:rows.length};
  });
  const budgetRows=input.request?.historyDays===14?recentWindows.map((w,i)=>({...w,minutes:w.minutes===null?manualWeeks[i].minutes:w.minutes+(manualWeeks[i].minutes??0),sessionCount:w.sessionCount+manualWeeks[i].sessionCount})):portrait.weeks;
  const maxWeeklyMinutes = Math.max(0, ...budgetRows.map(w => w.minutes ?? 0)) || null;
  const modalityLimit={run:Math.max(0,...recentWindows.map(w=>w.runSessions)),strength:Math.max(0,...recentWindows.map(w=>w.strengthSessions))};
  const strengthSetLimit=Math.max(0,...recentWindows.map(w=>w.strengthSets??0));
  const runDistanceLimit=Math.max(0,...recentWindows.map(w=>w.runDistanceM??0));
  const historicalKeyWeeks = new Map<string, number>();
  for (const e of actual) {
    if (e.actual?.intensity === "HARD" || e.lowerHeavy) {
      const week = weekOf(e.date)[0];
      historicalKeyWeeks.set(week, (historicalKeyWeeks.get(week) ?? 0) + 1);
    }
  }
  const maxKeySessions = Math.max(0, ...historicalKeyWeeks.values());
  const maxWeeklySessions = Math.max(0, ...budgetRows.map(w => "sessionCount" in w ? w.sessionCount : w.observedSessions)) || null;
  const days = input.training.days?.value ?? [],
    limit = input.training.minutes?.value ?? null;
  const allowed = new Set(days),
    familiar = actual.filter((e) =>
      e.modality === "run" ? !!e.runComponents?.length : !!e.exercises?.length,
    );
  const familyPurpose = eventFocus.objective;
  const courseFits = new Map<string, CycleCourseFit>();
  for (const course of familiar.filter(course => course.modality === "run")) {
    const components = course.runComponents?.filter(component => component.modality === "RUNNING") ?? [];
    const component = components[0], facts = portrait.training.filter(fact => fact.modality === "RUN" && course.actual?.occurrenceIds?.includes(fact.occurrenceId));
    const completed = facts.length > 0 && facts.every(fact => fact.runSegments.length > 0 && fact.runSegments.every(segment => segment.completion === "COMPLETED"));
    const exactStructure = components.length === 1 && facts.length === 1 && components.every(component => {
      if (component.structure.kind === "REPEATED") return supportsRepeatedCourse(component, facts);
      const segment = facts[0].runSegments[0], structure = component.structure;
      return facts[0].runSegments.length === 1 && segment?.kind === "CONTINUOUS" &&
        structure.plannedDurationSeconds !== null && segment.durationSeconds === structure.plannedDurationSeconds &&
        (structure.plannedDistanceMeters === null || segment.distanceM === structure.plannedDistanceMeters);
    });
    const evidenceState: CycleCourseFit["evidenceState"] = !facts.length ? "UNKNOWN" : completed && exactStructure ? "SUPPORTED_ACTUAL" : "INCOMPLETE";
    const purpose = component?.purpose ?? "UNSPECIFIED", structure = component?.structure.kind ?? "UNKNOWN";
    const policy = g.eventMeters === null ? undefined : eventRetrieval[g.eventMeters];
    const index = policy?.order.indexOf(`${purpose}:${structure}`) ?? -1;
    const gaps = [policy?.gap ?? eventFocus.limitation,
      ...(index < 0 ? ["当前标签/结构未列入该项目的优先检索；保留为一般熟悉活动，专项迁移未知"] : []),
      ...(evidenceState !== "SUPPORTED_ACTUAL" ? ["实际结构、完成或恢复记录尚不完整；不能仅凭原计划标签复制"] : []),
    ];
    courseFits.set(course.id, {
      policy: "EVENT_RETRIEVAL_1", status: "CONDITIONAL_TRANSFER", evidenceState, sourceEntryId: course.id,
      sourceRefs: facts.map(refOf), purpose, structure, rank: index < 0 ? 99 : index,
      reason: `已存课目的${purpose}与实际结构${structure}：${policy?.why ?? "按熟悉任务核对"}。这是已有课程的检索顺序，不证明专项最佳或允许加量`, gaps,
    });
  }
  const phaseFor = (from: string, to: string, i: number): CyclePhase => {
    if (hold || (g.raceDate && g.raceDate < from)) return "REVIEW";
    if (g.raceDate && daysBetween(to, g.raceDate) < g.taperDays) return "TAPER";
    if (!g.raceDate) return i === 0 ? "BASE" : "BUILD";
    const before = daysBetween(to, g.raceDate);
    return before > 28 && i < Math.max(1, Math.floor(weekCount / 3))
      ? "BASE"
      : before > 14
        ? "BUILD"
        : "SPECIFIC";
  };
  const phasePurposes: Record<CyclePhase, string> = {
    BASE: `保留熟悉活动，围绕${priorityLabels[g.priority]}建立可持续安排并核对动作`,
    BUILD: `围绕${priorityLabels[g.priority]}发展；一次只讨论一个变量`,
    SPECIFIC: `围绕${g.eventMeters ?? "未确认"}米目标衔接熟悉专项课，不用目标成绩反推实测配速`,
    TAPER: "减少执行量，保留熟悉节奏；不临时补课或引入新刺激",
    REVIEW: "暂停诱发症状的训练，先复核功能、限制与实际反馈",
  };
  const phaseConditions: Record<CyclePhase, { entry: string; exit: string }> = {
    BASE: { entry: "核对熟悉课程的实际剂量、可用时间与限制", exit: "有可核实的完成记录及后续反馈，再复核下一阶段" },
    BUILD: { entry: "先核对既有课程可执行性及当前反馈，不由阶段名自动加量", exit: "核对目标时间线、同条件执行及反证，再决定维持或调整" },
    SPECIFIC: { entry: "有目标专项的熟悉课程和同结构实际依据", exit: "按赛事安排及最新反应复核，不以训练均速证明目标已达成" },
    TAPER: { entry: "已确认赛事日期与所选减量窗口，逐课核对熟悉剂量", exit: "比赛或日期变化后按实际结果重审，不把减量等同恢复完成" },
    REVIEW: { entry: "明确当前限制或已过期赛事的来源及影响范围", exit: "相应限制经既有流程复核、目标日期核对后再生成候选" },
  };
  const proposedKeyDates:string[]=[];
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const from = addDays(start, index * 7),
      to = addDays(from, 6),
      phase = phaseFor(from, to, index),
      sessions: CycleSession[] = [];
    const phaseReview: CyclePhaseReview = {
      status: "PROVISIONAL_NOT_PHYSIOLOGICAL_CLEARANCE",
      selectionReason: hold ? "现有有效限制触发复核"
        : g.raceDate && g.raceDate < from ? "赛事已过期或已在本周，后续只复核，不补造备赛期"
        : !g.raceDate ? "赛期未知：滚动窗口的暂定阶段，不能证明身体已进入该阶段"
        : phase === "TAPER" ? `按已确认赛期与${g.taperDays}天窗口暂列赛前阶段`
        : "按已确认赛期与当前规划窗口暂列方向，实际进入仍需复核证据",
      entryConditions: [phaseConditions[phase].entry, "本人、目标及来源版本仍一致；课程变更仍需确认"],
      exitConditions: [phaseConditions[phase].exit, "新疼痛、功能变化、目标或来源更正时重新评估"],
      reviewAt: to,
      entryState: "UNKNOWN",
      entryChecks: [],
      exitChecks: [],
    };
    const existing = entries.filter(
      (e) =>
        e.date >= from &&
        e.date <= to &&
        !["rejected", "skipped"].includes(e.status) &&
        e.modality !== "rest",
    );
    const existingUnknown =
      input.importedDates.some((day) => day >= from && day <= to) ||
      existing.some((e) => !Number.isFinite(e.minutes) || e.minutes <= 0);
    const keyDates = [...proposedKeyDates,...entries
      .filter(
        (e) =>
          e.date >= addDays(from, -1) &&
          e.date <= addDays(to, 1) &&
          !["rejected", "skipped"].includes(e.status) &&
          keyCourse(e),
      )
      .map((e) => e.date)];
    let spent = existing.reduce((sum, e) => sum + (Number.isFinite(e.minutes) ? e.minutes : 0), 0),
      keyCount = existing.filter(keyCourse).length,
      proposedExtra = 0;
    const candidates = familiar.slice().sort((a, b) => {
      const rank = (e: ScheduleEntry) => {
        if (phase === "BASE" || phase === "REVIEW") return keyCourse(e) ? 10 : 0;
        const purpose = JSON.stringify(e.runComponents);
        const specific =
          family === "SPRINT"
            ? /REPETITION_SPEED|SPRINT|ACCELERATION|HILL/.test(purpose)
            : family === "MIDDLE"
              ? /INTERVAL|RACE|REPETITION_SPEED/.test(purpose)
              : /TEMPO|THRESHOLD|LONG/.test(purpose);
        if (phase === "SPECIFIC" && specific) return 0;
        if (g.priority === "STRENGTH" && e.modality === "strength") return 1;
        if (keyCourse(e)) return 2;
        return 3;
      };
      const phaseRank = rank(a) - rank(b);
      if ((phase === "BASE" || phase === "REVIEW") && phaseRank) return phaseRank;
      if (a.modality === "run" && b.modality === "run") {
        const af = courseFits.get(a.id), bf = courseFits.get(b.id);
        const evidenceOrder = Number(af?.evidenceState !== "SUPPORTED_ACTUAL") - Number(bf?.evidenceState !== "SUPPORTED_ACTUAL");
        if (evidenceOrder) return evidenceOrder;
        const eventOrder = (af?.rank ?? 99) - (bf?.rank ?? 99);
        if (eventOrder) return eventOrder;
      }
      return phaseRank || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
    });
    const used = new Set<string>();
    const counts={run:existing.filter(e=>e.modality==='run').length,strength:existing.filter(e=>e.modality==='strength').length};
    let strengthSets=existing.flatMap(e=>e.exercises??[]).reduce((n,e)=>n+Number(e.sets||0),0);
    let runDistance=existing.filter(e=>e.modality==='run').reduce((n,e)=>n+(plannedRunDose(e).distanceM??0),0);
    for (const day of weekOf(from)) {
      if (g.raceDate && day >= g.raceDate) {
        sessions.push({
          date: day,
          informational: true,
          purpose: day === g.raceDate ? "比赛目标（不是完成记录）" : "赛后恢复与复核",
          reason: "比赛当天不叠加普通训练；赛后按实际反馈重算",
          observation: "记录实际结果与功能反应",
          withdrawWhen: "比赛日期或身体限制变化",
          candidate: null,
          before: null,
          sourceRefs: [],
          sourceEntryIds: [],
          missing: ["比赛及赛后安排需要单独核对"],
          changedVariable: "NONE",
        });
        continue;
      }
      if (!allowed.has(new Date(day + "T12:00:00Z").getUTCDay())) continue;
      if (
        maxWeeklySessions !== null &&
        existing.length + sessions.filter((s) => s.candidate).length >= maxWeeklySessions
      )
        continue;
      const sameDay = entries.filter(
        (e) => e.date === day && !["rejected", "skipped"].includes(e.status),
      );
      if (input.importedDates.includes(day) || sameDay.length) {
        warnings.push(`${day}已有原课表，周期草案不覆盖；请先在原课确认调整`);
        continue;
      }
      const ordered=candidates.slice().sort((a,b)=>{
        const rate=(e:ScheduleEntry)=>e.modality==='rest'?Infinity:counts[e.modality]/Math.max(1,modalityLimit[e.modality]);
        return rate(a)-rate(b);
      });
      let seed = ordered.find(
        (e) =>
          !used.has(e.id) &&
          (e.modality==='rest'||!modalityLimit[e.modality]||counts[e.modality]<modalityLimit[e.modality]) &&
          (!keyCourse(e) ||
            (keyCount < maxKeySessions &&
              keyDates.every((d) => Math.abs(daysBetween(d, day)) > 1))),
      );

      if (!seed || hold) {
        sessions.push({
          date: day,
          purpose: hold ? "安全复核与恢复观察" : familyPurpose,
          reason: phasePurposes[phase],
          observation: "补充当前功能与熟悉课程实际参数",
          withdrawWhen: "疼痛加重或功能受限时暂停相关训练",
          candidate: null,
          before: null,
          sourceRefs: [],
          sourceEntryIds: [],
          missing: hold ? ["安全限制尚未解除"] : ["缺本人近期实际支持的完整课程"],
          changedVariable: "EXECUTION",
        });
        continue;
      }
      used.add(seed.id);
      const source = structuredClone(seed);
      delete source.actual;
      delete source.movedFrom;
      delete source.unplanned;
      delete source.restLog;
      delete source.swapReason;
      delete source.overrideNote;
      delete source.reduced;
      let after: ScheduleEntry = {
        ...source,
        id: `cycle:${analysisDigest([g, from, seed.id, day])}`,
        athleteId: owner,
        date: day,
        status: "planned",
        source: "fangkun",
        refId: null,
        edited: true,
      };
      const refs = portrait.training
          .filter((t) => seed.actual?.occurrenceIds?.includes(t.occurrenceId))
          .map(refOf),
        missing: string[] = existingUnknown ? ["原课表本周剂量尚未完整核对，不能叠加候选"] : [];
      if (input.recovery.safetyState === "UNKNOWN")
        missing.push("当前疼痛与功能尚未核对；未知不等于已知限制");
      let changedVariable: CycleSession["changedVariable"] = "NONE",
        doseMinutes = seed.actual?.minutes ?? null;
      if ((after.runComponents?.filter((c) => c.modality === "RUNNING").length ?? 0) > 1)
        missing.push("多跑步部分需逐部分确认实际剂量");
      if (seed.trainingType === "mixed") {
        missing.push("组合课需分别确认实际跑步和力量剂量，暂不跨周期复制");
      }
      if (after.modality === "run") {
        const dose = plannedRunDose(after);
        const runFacts=portrait.training.filter(t=>t.modality==='RUN'&&refs.some(r=>r.id===t.id));
        if (after.runComponents?.some(component => component.modality === "RUNNING" && component.structure.kind === "CONTINUOUS") &&
          runFacts.some(fact => fact.runSegments.some(segment => segment.kind === "REPETITION")))
          missing.push("实际为重复分段，不能由相同总量复制为原计划的连续跑");
        if(after.runComponents?.some(c=>c.modality==='RUNNING'&&!supportsRepeatedCourse(c,runFacts)))
          missing.push('间歇原计划缺少逐段、轮次和实际间歇的一致证据，不能从总跑量复制');
        const pure = refs.length
          ? portrait.training
              .filter((t) => refs.some((r) => r.id === t.id) && t.modality === "RUN")
              .map((t) => t.actualDurationSeconds)
              .filter((v): v is number => v !== null)
          : [];
        const actualSeconds = pure.length
          ? pure.reduce((s, v) => s + v, 0)
          : doseMinutes !== null
            ? doseMinutes * 60
            : null;
        if (actualSeconds === null || dose.durationSeconds === null)
          missing.push("实际或原跑步结构时长未知");
        else if (dose.durationSeconds > actualSeconds) {
          if (
            after.runComponents?.every(
              (c) => c.modality !== "RUNNING" || c.structure.kind === "CONTINUOUS",
            )
          ) {
            for (const c of after.runComponents ?? [])
              if (c.modality === "RUNNING" && c.structure.kind === "CONTINUOUS") {
                c.structure.plannedDurationSeconds = actualSeconds;
                c.structure.plannedDistanceMeters = null;
                c.structure.plannedDistanceMaxMeters = null;
              }
            changedVariable = "DURATION";
          } else missing.push("实际未达到原间歇结构剂量，请先确认逐段结构");
        }
        if (
          dose.distanceM !== null &&
          seed.actual?.km != null &&
          dose.distanceM > seed.actual.km * 1000 &&
          changedVariable === "NONE"
        )
          missing.push("原跑量超过本次实际完成，需要先核对距离");
        if (seed.actual?.intensity !== after.intensity)
          missing.push("实际强度与原计划不一致，不能由计划补齐强度");
      } else if (after.modality === "strength") {
        const linked = portrait.training.filter(
          (t) => refs.some((r) => r.id === t.id) && t.modality === "STRENGTH",
        );
        for (const e of after.exercises ?? []) {
          const completed = linked
            .flatMap((t) => t.strengthSets)
            .filter(
              (s) => s.completion === "COMPLETED" && !!e.catalogId && s.catalogId?.replace(/^local:/,'') === e.catalogId.replace(/^local:/,''),
            );
          if (!completed.length || !/^\d+$/.test(e.sets) || completed.length < Number(e.sets))
            missing.push("原动作组数缺少同次已完成逐组依据");
          const reps = Number(e.reps),
            weight = e.weight.trim() === "" ? null : Number(e.weight);
          if (
            !Number.isFinite(reps) ||
            reps <= 0 ||
            completed.some(
              (s) =>
                (e.unit === "sec" ? s.holdSeconds : s.reps) === null ||
                (e.unit === "sec" ? s.holdSeconds! : s.reps!) < reps,
            )
          )
            missing.push("原动作次数或时长超过已确认实际，需核对");
          if (
            weight === null ||
            !Number.isFinite(weight) ||
            completed.some(
              (s) =>
                s.loadKg === null ||
                s.loadKg < weight ||
                (s.loadBasis !== "TOTAL_EXTERNAL" &&
                  !(weight === 0 && s.loadBasis === "BODYWEIGHT")),
            )
          )
            missing.push("原负重缺少同口径实际依据，需核对");
          const equipment = exerciseContent(e.catalogId?.replace(/^local:/,'') ?? null)?.equipment ?? ["器材要求待补全"];
          const available = String(input.training.equipment?.value ?? "UNKNOWN");
          if (
            equipment.some(
              (r) =>
                r === "器材要求待补全" ||
                (r !== "无器械" &&
                  available !== "GYM" &&
                  !(available === "DUMBBELLS" && r.split("或").includes("哑铃"))),
            )
          )
            missing.push("当前器材不支持原动作或动作器材要求尚未核定");
        }
        if (!input.training.equipment) missing.push("器材尚未确认");
      }
      const responseGroup=portrait.adaptive.groups.find(group=>group.trainingRefs.some(r=>refs.some(ref=>ref.id===r.id&&ref.revision===r.revision)));
      const feedbackReduction=after.modality==='strength'&&responseGroup?.state==='REVIEW_DOSE';
      const strengthReviewWeek=after.modality==='strength'&&index===3&&phase!=='TAPER';
      if (feedbackReduction&&changedVariable==='NONE') {
        if(after.exercises?.some(e=>Number(e.sets)>1)) {
          after.exercises=after.exercises.map(e=>({...e,sets:String(Math.max(1,Number(e.sets)-1))}));
          changedVariable='SETS';
        }else if(feedbackReduction)missing.push('已有单组且反复出现症状，需要另选动作或暂缓，不能凭空减至零组');
      }
      if (phase === "TAPER" && changedVariable === "NONE") {
        let cut = false;
        for (const c of after.runComponents ?? [])
          if (!cut && c.modality === "RUNNING") {
            if (c.structure.kind === "REPEATED") {
              const step = c.structure.blocks
                .flatMap((b) => b.steps)
                .find((s) => s.repeatCount > 1);
              if (step) {
                step.repeatCount--;
                changedVariable = "REPEAT_COUNT";
                cut = true;
              }
            } else if (c.structure.plannedDurationSeconds !== null) {
              c.structure.plannedDurationSeconds =
                Math.min(c.structure.plannedDurationSeconds, (doseMinutes ?? 0) * 60) / 2;
              c.structure.plannedDistanceMeters = null;
              c.structure.plannedDistanceMaxMeters = null;
              doseMinutes = c.structure.plannedDurationSeconds / 60;
              changedVariable = "DURATION";
              cut = true;
            }
          }
        if (
          !cut &&
          after.modality === "strength" &&
          after.exercises?.some((e) => Number(e.sets) > 1)
        ) {
          after.exercises = after.exercises.map((e) => ({
            ...e,
            sets: String(Math.max(1, Number(e.sets) - 1)),
          }));
          changedVariable = "SETS";
          cut = true;
        }
        if (!cut) missing.push("原课无法只改一个变量减量，暂缓执行并核对");
      }
      const sourceProtocol = (e: ScheduleEntry) => {
        const ts = portrait.training.filter(
          (t) => t.modality === "RUN" && e.actual?.occurrenceIds?.includes(t.occurrenceId),
        );
        return ts.length === 1 && ts[0].protocolKey
          ? JSON.stringify([ts[0].provider, ts[0].accountRef, ts[0].deviceId, ts[0].protocolKey])
          : null;
      };
      const seedProtocol = sourceProtocol(seed);
      const canConsiderProgression = input.recovery.signalState === "NO_ADVERSE_SIGNAL_OBSERVED" && !portrait.history.planning.reviewExecution && (!input.request || responseGroup?.state === "OBSERVED_TOLERANCE");
      let isProgression = false;
      const comparable = actual.filter(
        (e) =>
          e.title === seed.title &&
          !!seedProtocol &&
          sourceProtocol(e) === seedProtocol &&
          JSON.stringify(e.runComponents) === JSON.stringify(seed.runComponents) &&
          e.modality === seed.modality &&
          e.actual?.minutes === seed.actual?.minutes &&
          e.actual?.km === seed.actual?.km &&
          e.actual?.intensity === seed.actual?.intensity &&
          e.actual?.rpe !== null &&
          e.actual?.rpe !== undefined &&
          e.actual.rpe <= 7 &&
          !e.actual.reasons.length &&
          e.actual.executionState !== "PARTIAL" &&
          e.actual.executionState !== "INTERRUPTED",
      );
      if (
        phase === "BUILD" &&
        index === 0 &&
        changedVariable === "NONE" &&
        g.proposeExtraMinutes !== null &&
        portrait.experience.running === "TRAINED" &&
        canConsiderProgression &&
        proposedExtra === 0 &&
        comparable.length >= 2 &&
        after.modality === "run" &&
        after.runComponents?.length === 1
      ) {
        const c = after.runComponents[0];
        if (
          c.modality === "RUNNING" &&
          c.structure.kind === "CONTINUOUS" &&
          c.structure.plannedDurationSeconds !== null &&
          after.intensity === "EASY"
        ) {
          c.structure.plannedDurationSeconds += g.proposeExtraMinutes * 60;
          c.structure.plannedDistanceMeters = null;
          c.structure.plannedDistanceMaxMeters = null;
          doseMinutes = (doseMinutes ?? 0) + g.proposeExtraMinutes;
          changedVariable = "DURATION";
          isProgression = true;
        }
      }
      if (doseMinutes === null || limit === null) missing.push("实际或可用时长未知");
      else if (doseMinutes > limit) missing.push("原课程超过当前可用时间；需在原课程预览减量");
      const extra = proposedExtra + (isProgression ? (g.proposeExtraMinutes ?? 0) : 0);
      if (
        maxWeeklyMinutes === null ||
        doseMinutes === null ||
        spent + doseMinutes > maxWeeklyMinutes + extra
      )
        missing.push("本周累计剂量超过近期已记实际上限或上限未知");
      const relevantExperience=after.modality==='run'?portrait.experience.running:after.modality==='strength'?portrait.experience.strength:'UNKNOWN';
      if (relevantExperience !== "TRAINED" && keyCourse(after))
        missing.push("训练经验不足，先核对熟悉的低强度课程");
      if (input.training.conflicts.length) missing.push("个人条件来源有冲突，需先核对");
      if (concerns && keyCourse(after)) missing.push("当前恢复信息不足或存在担忧，暂不复制关键课");
      const proposedSets=(after.exercises??[]).reduce((n,e)=>n+Number(e.sets),0);
      const proposedDistance=after.modality==='run'?plannedRunDose(after).distanceM:null;
      if(after.modality==='strength'&&strengthSetLimit&&strengthSets+proposedSets>strengthSetLimit)missing.push('力量周组数超过近两周已记录剂量，先复核而非自动增加');
      if(after.modality==='run'&&runDistanceLimit&&proposedDistance!==null&&runDistance+proposedDistance>runDistanceLimit)missing.push('跑步周距离超过近两周已记录剂量，先复核而非自动增加');
      const candidate = missing.length ? null : { ...after, minutes: doseMinutes! };
      if (candidate) {
        spent += candidate.minutes;
        if(candidate.modality!=='rest')counts[candidate.modality]++;
        strengthSets+=proposedSets;runDistance+=proposedDistance??0;
        if (isProgression) proposedExtra = g.proposeExtraMinutes ?? 0;
        if (keyCourse(candidate)) {
          keyDates.push(day);
          proposedKeyDates.push(day);
          keyCount++;
        }
      }
      sessions.push({
        date: day,
        purpose: `${phaseLabels[phase]}：${priorityLabels[g.priority]}`,
        reason: phasePurposes[phase] + (courseFits.has(seed.id) ? `；${courseFits.get(seed.id)!.reason}；迁移待核对：${courseFits.get(seed.id)!.gaps.join("；")}` : "") + (feedbackReduction?'；同协议重复症状反馈：只减一组候选，负重次数保持，复核症状及完成情况':strengthReviewWeek?'；第四周仅提醒复核：暂维持已记录组数；若同协议重复反馈提示执行困难，再预览减组或替代候选，正式变更仍需确认':'') + (isProgression ? "；候选增时仍需逐周确认，不自动累加" : ""),
        observation: "记录实际剂量、RPE与次日疼痛/功能；一次成功不等于长期耐受",
        withdrawWhen: "疼痛/功能变化、执行困难、目标或来源更正时撤回并重算",
        candidate,
        before: null,
        sourceRefs: refs,
        sourceEntryIds: [seed.id],
        ...(courseFits.has(seed.id) ? { eventFit: courseFits.get(seed.id) } : {}),
        sourceCourses: [
          { date: seed.date, title: seed.title, minutes: seed.actual?.minutes ?? null },
        ],
        missing: [...new Set(missing)],
        changedVariable,
      });
    }
    const familiarRefs = [...new Map(familiar.flatMap(course => portrait.training.filter(fact => course.actual?.occurrenceIds?.includes(fact.occurrenceId)).map(refOf)).map(ref => [ref.id + "@" + ref.revision, ref])).values()];
    const selectedRefs = sessions.flatMap(session => session.sourceRefs);
    const relevantRefs = selectedRefs.length ? selectedRefs : familiarRefs;
    const responseGroups = portrait.adaptive.groups.filter(group => group.trainingRefs.some(ref => relevantRefs.some(current => current.id === ref.id && current.revision === ref.revision)));
    const responseState: CycleConditionState = responseGroups.some(group => group.state === "REVIEW_DOSE") ? "CONTRADICTED"
      : responseGroups.length > 0 && responseGroups.every(group => group.state === "OBSERVED_TOLERANCE") && relevantRefs.every(ref => responseGroups.some(group => group.trainingRefs.some(current => current.id === ref.id && current.revision === ref.revision))) ? "SATISFIED" : "UNKNOWN";
    const hasActual = familiar.some(course => course.modality === "run" ? courseFits.get(course.id)?.evidenceState === "SUPPORTED_ACTUAL" : portrait.training.some(fact => course.actual?.occurrenceIds?.includes(fact.occurrenceId) && fact.modality === "STRENGTH" && fact.strengthSets.some(set => set.completion === "COMPLETED")));
    const openDates = weekOf(from).filter(day => allowed.has(new Date(day + "T12:00:00Z").getUTCDay()) && !existing.some(entry => entry.date === day) && (!g.raceDate || day < g.raceDate));
    const calendarState: CycleConditionState = !days.length || limit === null || existingUnknown ? "UNKNOWN" : openDates.length ? "SATISFIED" : "CONTRADICTED";
    const check = (id: string, label: string, state: CycleConditionState, reason: string, evidenceRefs: CycleConditionCheck["evidenceRefs"], sourceEntryIds: string[], sourceVersions: CycleConditionCheck["sourceVersions"]): CycleConditionCheck => ({ id, label, state, reason, evidenceRefs, sourceEntryIds, sourceVersions });
    phaseReview.entryChecks = [
      check("GOAL_DATE", "赛事日期", !g.raceDate ? "UNKNOWN" : g.raceDate < from ? "CONTRADICTED" : "SATISFIED", !g.raceDate ? "无已确认赛期，滚动安排不证明准备完成" : g.raceDate < from ? "赛期已过，需复核目标" : "有用户确认的未来赛期，仅满足日期资料条件", [], [], [{ source: "cycle-goal", version: String(g.revision) }]),
      check("RESTRICTIONS", "现行限制", hold ? "CONTRADICTED" : input.recovery.safetyState === "UNKNOWN" ? "UNKNOWN" : "SATISFIED", hold ? "存在独立有效限制；阶段日历不能覆盖" : "仅表示当前限制资料状态，不是医学放行", input.snapshot.safetyConstraints.flatMap(constraint => constraint.evidenceRefs), [], [{ source: "effective-training", version: input.training.version }, ...input.snapshot.safetyConstraints.map(constraint => ({ source: constraint.id, version: constraint.version }))]),
      check("ACTUAL_COURSES", "熟悉课程实际完成", hasActual ? "SATISFIED" : "UNKNOWN", hasActual ? "存在可核实的已完成结构；只支持复用既有剂量，不代表阶段能力达标" : "缺少可核实完整结构，不用原计划代替实际完成", familiarRefs, familiar.map(course => course.id), []),
      check("CALENDAR", "可用时间与日历", calendarState, calendarState === "SATISFIED" ? "至少有一个已确认可用且未被原课占用的日期；逐课仍检查预算" : calendarState === "CONTRADICTED" ? "当前窗口无可新增日期，原课表保留" : "时间、原课剂量或导入课表尚未完整核对", [], existing.map(entry => entry.id), [{ source: "calendar", version: input.calendarVersion }, { source: "training-conditions", version: input.training.version }]),
      check("RESPONSE", "可比后续反馈", responseState, responseState === "CONTRADICTED" ? "既有同协议复核策略发现反复不利反馈，不能声称阶段条件已满足" : responseState === "SATISFIED" ? "既有策略仅支持已观察同剂量反应，不推广强度或自动加量" : "关联反馈、独立重复或无干扰对照不足，未知不作改善", [...new Map(responseGroups.flatMap(group => group.evidenceRefs).map(ref => [ref.id + "@" + ref.revision, ref])).values()], [], [{ source: "adaptive-review", version: portrait.adaptive.evidenceVersion }]),
    ];
    phaseReview.entryState = phaseReview.entryChecks.some(item => item.state === "CONTRADICTED") ? "CONTRADICTED" : phaseReview.entryChecks.some(item => item.state === "UNKNOWN") ? "UNKNOWN" : "SATISFIED";
    phaseReview.exitChecks = [
      check("WEEK_EXECUTION", "当周实际执行与复盘", "UNKNOWN", "未来周尚未发生，不能用计划或历史完成替代当周实际及反证", [], [], [{ source: "calendar", version: input.calendarVersion }]),
      check("REASSESSMENT", "到期目标与限制复核", hold ? "CONTRADICTED" : "UNKNOWN", hold ? "现行限制仍有效，必须经对应流程复核" : "到期用最新目标、来源版本和后续反馈重评；不按日历自动升级阶段", input.snapshot.safetyConstraints.flatMap(constraint => constraint.evidenceRefs), [], [{ source: "cycle-goal", version: String(g.revision) }]),
    ];
    const conditionSummary = phaseReview.entryChecks.map(item => `${item.label}：${conditionLabels[item.state]}`).join("；");
    return {
      index,
      start: from,
      end: to,
      phase,
      purpose: `${eventFocus.objective}。专项依据核对：${eventFocus.evidenceNeeds.join("；")}。${eventFocus.limitation}。${phasePurposes[phase]}。进入条件：${phaseReview.entryConditions[0]}；当前核对：${conditionSummary}；退出条件：${phaseReview.exitConditions[0]}，未来周执行待核对；${to}复核。${index > 0 ? "未来阶段为条件草案，不能直接确认。" : "本周仍需预览确认，不等于生理放行。"}`,
      phaseReview,
      strengthFocus: sessions.some(s=>s.candidate?.modality==='strength'&&s.changedVariable==='SETS')?'复核减组候选，逐课查看阶段或反馈依据；负重和次数保持，确认后才可变更':index===3?'复核周：没有支持调整的新反馈时维持已记录组数，补充逐组RIR及后续反应；不因周序号减组':index===0?'建立已完成剂量起点，记录逐组RIR及次日反馈':index===1?'重复同剂量观察可执行性，不自动加重量':'根据已发生反馈复核；无证据不增加组数或负重',
      doseBudget:{runSessions:modalityLimit.run,strengthSessions:modalityLimit.strength,runDistanceM:runDistanceLimit||null,strengthSets:strengthSetLimit||null},
      sessions,
      existingSessions: existing.map((e) => ({
        date: e.date,
        title: e.title,
        minutes: e.minutes,
        intensity: e.intensity,
      })),
      plannedMinutes: sessions.some((s) => s.candidate) ? spent : null,
      canConfirm:
        index === 0 &&
        !hold &&
        sessions.some((s) => s.candidate) &&
        sessions.every((s) => !!s.candidate || s.informational),
      conditional: index > 0,
    };
  });
  const unknowns = [
    ...portrait.unknowns,
    ...(!portrait.performances.some(performance => performance.meters === g.eventMeters) ? [`${g.eventMeters ?? "目标"}米缺近期可核实专项成绩；${eventFocus.limitation}`] : []),
    ...(!days.length ? ["没有已确认的具体训练星期"] : []),
    ...(limit === null ? ["单次可用时间未知"] : []),
  ];
  const hypotheses = [
    {
      claim: "近期训练剂量或专项安排可能参与当前执行反应",
      support: portrait.training.map(refOf),
      counter: portrait.snapshot.facts
        .filter((f) => f.kind === "RESPONSE" && f.value === 0)
        .map(refOf),
      discriminator: "在相同条件下核对实际分段、逐组完成和后续功能，不增加测试剂量",
    },
    {
      claim: "时间安排、恢复背景或测量协议变化也可能参与",
      support: portrait.snapshot.facts
        .filter((f) => f.kind === "METRIC" || f.kind === "RESPONSE")
        .map(refOf),
      counter: [],
      discriminator: "先核对生活时间、同设备协议与主观状态；不把关联当因果",
    },
  ];
  return {
    request: input.request,
    schema: 1 as const,
    version: "R8_CYCLE_2" as const,
    athleteId: owner,
    generatedAt: input.snapshot.context.asOf,
    start,
    family,
    eventFocus,
    eventSelectionReview: [...courseFits.values()],
    goal: g,
    portrait,
    weeks,
    hypotheses,
    unknowns: [...new Set(unknowns)],
    questions: [...new Set(unknowns)].slice(0, 2),
    warnings: [...new Set(warnings)],
    basisVersion: cycleBasis(input),
    hold,
    requiresConfirmation: true as const,
    automaticExecution: false as const,
    professionalValidation: "NOT_PROVEN" as const,
    sourceEntries: actual
      .filter((e) => input.entries.some(original=>original.id===e.id) && weeks.some((w) => w.sessions.some((s) => s.sourceEntryIds.includes(e.id))))
      .map((e) => ({ id: e.id, version: analysisDigest(e) })),
    sourceIds:
      family === "MIDDLE"
        ? ["HAUGEN_2021", "TAPER_2023"]
        : family === "SPRINT"
          ? ["HAUGEN_2019"]
          : ["HAUGEN_2022", "TAPER_2023"],
  };
}
export type CycleDraft = ReturnType<typeof buildCycleDraft>;
