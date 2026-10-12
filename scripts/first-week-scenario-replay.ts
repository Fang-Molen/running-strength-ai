/** Synthetic end-to-end intake/kernel replay; does not claim browser or personal validation. */
import { writeFileSync } from "node:fs";
import {
  buildFirstWeek,
  appendIntakeAnswer,
  loadIntake,
  INTAKE_FIELDS,
  type IntakeInputs,
} from "../src/lib/core/coach-first-week.ts";
import {
  firstWeekInputs,
  firstWeekRecords,
  firstWeekMemory,
  FIRST_WEEK_TEST_DAY as today,
} from "../src/lib/core/coach-first-week.fixtures.ts";
import { setStoreBackend } from "../src/lib/core/storage.ts";
const cases: {
  id: string;
  mutate: (i: IntakeInputs) => void;
  expected: string;
  maxSessions: number;
  noQuality?: boolean;
}[] = [
  {
    id: "NOVICE_NO_PERFORMANCE_2_DAYS",
    mutate: (i) => {
      i.ability.current400Seconds = null;
      i.ability.measuredOn = null;
      i.ability.timing = "unknown";
      i.ability.experienceMonths = 0;
      i.ability.continuousEasyMinutes = 8;
      i.recent.sessionsPerWeek = 0;
      i.availability.weekdays = [1, 4];
    },
    expected: "READY_CANDIDATE",
    maxSessions: 2,
    noQuality: true,
  },
  {
    id: "INTERMEDIATE_SIX_AVAILABLE_TWO_ACTUAL",
    mutate: (i) => {
      i.ability.experienceMonths = 6;
      i.recent.sessionsPerWeek = 2;
      i.availability.weekdays = [1, 2, 3, 4, 5, 6];
    },
    expected: "READY_CANDIDATE",
    maxSessions: 2,
    noQuality: true,
  },
  { id: "EXPERIENCED_TWO_ROUNDS", mutate: () => {}, expected: "READY_CANDIDATE", maxSessions: 3 },
  {
    id: "EXPERIENCED_ONE_DAY",
    mutate: (i) => {
      i.availability.weekdays = [4];
    },
    expected: "READY_CANDIDATE",
    maxSessions: 1,
  },
  {
    id: "ONLY_15_MINUTES",
    mutate: (i) => {
      i.availability.minutes = 15;
    },
    expected: "READY_CANDIDATE",
    maxSessions: 3,
    noQuality: true,
  },
  {
    id: "PLAN_NOT_ACTUAL",
    mutate: (i) => {
      i.recent.actual = false;
    },
    expected: "NEEDS_INFO",
    maxSessions: 0,
  },
  {
    id: "NO_SAFETY_DATA",
    mutate: (i) => {
      i.limits.pain = "UNKNOWN";
      i.limits.sleepHours = null;
    },
    expected: "NEEDS_INFO",
    maxSessions: 0,
  },
  {
    id: "PAIN_BEATS_GOAL",
    mutate: (i) => {
      i.limits.pain = "PRESENT";
      i.goal.targetSeconds = 45;
    },
    expected: "BLOCKED",
    maxSessions: 0,
  },
  {
    id: "MEDICAL_RESTRICTION",
    mutate: (i) => {
      i.limits.medicalRestriction = "PRESENT";
    },
    expected: "BLOCKED",
    maxSessions: 0,
  },
  {
    id: "TEXT_CHEST_PAIN",
    mutate: (i) => {
      i.limits.note = "运动时胸痛";
    },
    expected: "BLOCKED",
    maxSessions: 0,
  },
  {
    id: "LOW_RECOVERY",
    mutate: (i) => {
      i.recent.recovery48 = 2;
    },
    expected: "BLOCKED",
    maxSessions: 0,
  },
  {
    id: "NEAR_COMPETITION",
    mutate: (i) => {
      i.deadline.targetDate = "2026-10-23";
    },
    expected: "READY_CANDIDATE",
    maxSessions: 3,
    noQuality: true,
  },
  {
    id: "STALE_PERSONAL_RESULT",
    mutate: (i) => {
      i.ability.measuredOn = "2026-01-01";
    },
    expected: "READY_CANDIDATE",
    maxSessions: 3,
    noQuality: true,
  },
  {
    id: "UNKNOWN_ROUND_REST",
    mutate: (i) => {
      i.recent.roundRestSeconds = null;
    },
    expected: "READY_CANDIDATE",
    maxSessions: 3,
    noQuality: true,
  },
];
const results = cases.map((c) => {
  setStoreBackend(firstWeekMemory());
  const inputs = firstWeekInputs();
  c.mutate(inputs);
  const r = buildFirstWeek(firstWeekRecords(inputs), today),
    sessions = r.draft?.sessions ?? [];
  const pass =
    r.status === c.expected &&
    sessions.filter((s) => s.kind !== "REST").length <= c.maxSessions &&
    (!c.noQuality || sessions.every((s) => s.kind !== "FAMILIAR_REPETITION")) &&
    sessions.every((s) => s.estimatedMinutes <= inputs.availability.minutes);
  return {
    id: c.id,
    status: pass ? "PASS" : "FAIL",
    expected: c.expected,
    actual: r.status,
    nextField: r.nextField,
    issues: r.issues,
    draft: r.draft,
  };
});
setStoreBackend(firstWeekMemory());
const inputs = firstWeekInputs(),
  id = "replay-correction";
for (const f of INTAKE_FIELDS) appendIntakeAnswer(id, f, inputs[f]);
const original = loadIntake(id).find((r) => r.field === "ability")!;
appendIntakeAnswer(id, "ability", { ...inputs.ability, current400Seconds: 58 });
const conflicted = buildFirstWeek(loadIntake(id), today);
appendIntakeAnswer(
  id,
  "ability",
  { ...inputs.ability, current400Seconds: 56 },
  loadIntake(id)
    .filter((r) => r.field === "ability")
    .map((r) => r.id),
);
const corrected = buildFirstWeek(loadIntake(id), today);
const correction = {
  id: "PERFORMANCE_CONFLICT_AND_EXPLICIT_CORRECTION",
  status:
    conflicted.draft === null &&
    corrected.draft?.currentAbilitySeconds === 56 &&
    loadIntake(id).some((r) => r.id === original.id)
      ? "PASS"
      : "FAIL",
  before: conflicted.status,
  after: corrected.status,
  retainedRawAnswers: loadIntake(id).filter((r) => r.field === "ability").length,
  draft: corrected.draft,
};
setStoreBackend(firstWeekMemory());
const goalOnly = buildFirstWeek(firstWeekRecords().slice(0, 1), today);
const goal = {
  id: "GOAL_ONLY_NEXT_ABILITY",
  status: goalOnly.nextField === "ability" && goalOnly.draft === null ? "PASS" : "FAIL",
  actual: goalOnly.status,
  nextField: goalOnly.nextField,
};
const report = {
  version: "R2",
  scope: "SYNTHETIC_CONFIRMED_INTAKE_KERNEL_NOT_BROWSER",
  personalDataUsed: false,
  total: results.length + 2,
  passed:
    results.filter((x) => x.status === "PASS").length +
    Number(correction.status === "PASS") +
    Number(goal.status === "PASS"),
  results: [goal, ...results, correction],
};
writeFileSync(
  process.argv[2] ?? "evidence/round2/first-week-scenarios.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.total - report.passed,
  }),
);
process.exitCode = report.total === report.passed ? 0 : 1;
setStoreBackend(null);
