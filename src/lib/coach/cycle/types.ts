import type {
  EvidenceSnapshot,
  RecoveryAssessment,
  EvidenceRef,
} from "../../health/analysis-contract";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
import type { readEffectiveTrainingProfile } from "../loop/effective-training";
export type CycleGoal = {
  schema: 1;
  athleteId: string;
  revision: number;
  savedAt: string;
  eventMeters: number | null;
  raceDate: string | null;
  targetSeconds: number | null;
  experience: "UNKNOWN" | "NOVICE" | "TRAINED";
  priority: "BALANCED" | "SPEED" | "ENDURANCE" | "STRENGTH";
  horizonWeeks: number;
  taperDays: number;
  /** Explicit permission to PROPOSE one duration change, never automatic execution. */
  proposeExtraMinutes: number | null;
  source: "USER_CONFIRMED_GOAL";
};
export type CycleRequest = { historyDays: 14 | 28 | 42; horizonWeeks: number };
export type CycleInput = {
  request?: CycleRequest;
  snapshot: EvidenceSnapshot;
  recovery: RecoveryAssessment;
  entries: readonly ScheduleEntry[];
  training: ReturnType<typeof readEffectiveTrainingProfile>;
  goal: CycleGoal;
  profileVersion: string;
  calendarVersion: string;
  importedDates: string[];
};
export type CyclePhase = "BASE" | "BUILD" | "SPECIFIC" | "TAPER" | "REVIEW";
export type CycleEventFocus = {
  eventMeters: number | null;
  objective: string;
  evidenceNeeds: string[];
  limitation: string;
};
/** Reviewable product conditions, never an achieved physiological state. */
export type CyclePhaseReview = {
  status: "PROVISIONAL_NOT_PHYSIOLOGICAL_CLEARANCE";
  selectionReason: string;
  entryConditions: string[];
  exitConditions: string[];
  reviewAt: string;
  entryState: CycleConditionState;
  entryChecks: CycleConditionCheck[];
  exitChecks: CycleConditionCheck[];
};
export type CycleConditionState = "SATISFIED" | "UNKNOWN" | "CONTRADICTED";
export type CycleConditionCheck = {
  id: string; label: string; state: CycleConditionState; reason: string;
  evidenceRefs: EvidenceRef[]; sourceEntryIds: string[]; sourceVersions: { source: string; version: string }[];
};
export type CycleCourseFit = {
  policy: "EVENT_RETRIEVAL_1";
  status: "CONDITIONAL_TRANSFER";
  evidenceState: "SUPPORTED_ACTUAL" | "INCOMPLETE" | "UNKNOWN";
  sourceEntryId: string; sourceRefs: EvidenceRef[];
  purpose: string; structure: string; rank: number; reason: string; gaps: string[];
};
export type CycleSession = {
  date: string;
  purpose: string;
  reason: string;
  observation: string;
  withdrawWhen: string;
  candidate: ScheduleEntry | null;
  before: ScheduleEntry | null;
  informational?: boolean;
  sourceRefs: EvidenceRef[];
  sourceEntryIds: string[];
  sourceCourses?: { date: string; title: string; minutes: number | null }[];
  eventFit?: CycleCourseFit;
  missing: string[];
  changedVariable: "NONE" | "DURATION" | "REPEAT_COUNT" | "SETS" | "EXECUTION";
};
export const phaseLabels: Record<CyclePhase, string> = {
  BASE: "基础与动作",
  BUILD: "能力发展",
  SPECIFIC: "专项衔接",
  TAPER: "赛前减量",
  REVIEW: "恢复与复核",
};
export const priorityLabels = {
  BALANCED: "综合发展",
  SPEED: "速度与技术",
  ENDURANCE: "专项耐力",
  STRENGTH: "力量发展",
};
export function validCycleDay(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s
  );
}
export function validateCycleGoal(g: CycleGoal) {
  if (
    g.schema !== 1 ||
    !g.athleteId ||
    !Number.isInteger(g.revision) ||
    g.revision < 0 ||
    !Number.isFinite(Date.parse(g.savedAt)) ||
    g.source !== "USER_CONFIRMED_GOAL"
  )
    throw Error("周期目标身份或版本无效");
  if (
    g.eventMeters !== null &&
    (!Number.isFinite(g.eventMeters) || g.eventMeters < 50 || g.eventMeters > 100000)
  )
    throw Error("请核对项目距离");
  if (
    g.targetSeconds !== null &&
    (!Number.isFinite(g.targetSeconds) || g.targetSeconds <= 0 || g.eventMeters === null)
  )
    throw Error("目标时间须对应明确项目，不能作为实测成绩");
  if (g.raceDate !== null && !validCycleDay(g.raceDate)) throw Error("比赛日期无效");
  if (
    !["UNKNOWN", "NOVICE", "TRAINED"].includes(g.experience) ||
    !["BALANCED", "SPEED", "ENDURANCE", "STRENGTH"].includes(g.priority)
  )
    throw Error("训练背景或重点无效");
  if (
    !Number.isInteger(g.horizonWeeks) ||
    g.horizonWeeks < 1 ||
    g.horizonWeeks > 52 ||
    !Number.isInteger(g.taperDays) ||
    g.taperDays < 1 ||
    g.taperDays > 21
  )
    throw Error("规划窗口须1–52周，减量窗口须1–21天");
  if (
    g.proposeExtraMinutes !== null &&
    (!Number.isFinite(g.proposeExtraMinutes) ||
      g.proposeExtraMinutes <= 0 ||
      g.proposeExtraMinutes > 10)
  )
    throw Error("单变量候选增时须大于0且不超过10分钟；这是产品边界");
}
