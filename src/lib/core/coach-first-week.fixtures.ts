import type { IntakeInputs, IntakeRecord } from "./coach-first-week.ts";
export const FIRST_WEEK_TEST_DAY = "2026-10-11";
export function firstWeekInputs(): IntakeInputs {
  return {
    goal: { event: "400米", targetSeconds: 55 },
    ability: {
      age: 25,
      experienceMonths: 18,
      current400Seconds: 57,
      measuredOn: "2026-10-01",
      timing: "electronic",
      continuousEasyMinutes: 30,
      note: "",
    },
    recent: {
      actual: true,
      sessionsPerWeek: 3,
      easyMinutes: 20,
      distanceMeters: 200,
      repsPerRound: 4,
      rounds: 2,
      fastestSeconds: 28,
      slowestSeconds: 30,
      restSeconds: 120,
      roundRestSeconds: 300,
      measuredOn: "2026-10-08",
      rpe: 6,
      recovery48: 7,
      note: "",
    },
    deadline: { targetDate: "2026-12-20", noDeadline: false },
    availability: { weekdays: [1, 3, 5], minutes: 45, startDate: "2026-10-12" },
    limits: {
      pain: "NONE_REPORTED",
      medicalRestriction: "NONE_REPORTED",
      sleepHours: 8,
      recoveryNow: 7,
      note: "",
    },
  };
}
export function firstWeekRecords(
  inputs = firstWeekInputs(),
  sessionId = "synthetic-first-week",
): IntakeRecord[] {
  return (Object.keys(inputs) as (keyof IntakeInputs)[]).map((field, k) => ({
    id: "intake-" + field,
    sessionId,
    createdAt: `2026-10-11T01:0${k}:00Z`,
    kind: "ANSWER",
    field,
    value: inputs[field],
    supersedes: null,
    confirmed: true,
  }));
}
export function firstWeekMemory() {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    keys: () => [...data.keys()],
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
