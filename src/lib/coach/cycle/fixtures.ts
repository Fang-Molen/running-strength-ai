/** Public synthetic contrast cases. No real athlete data or model calls. */
import assert from "node:assert/strict";
import { context, training } from "../../health/analysis-fixtures";
import type { CycleInput } from "./types";
import type { CycleDraft } from "./planner";
import type { ScheduleEntry } from "../../ui/day-schedule-rules";
export function cycleFixture(): CycleInput {
  const now = "2026-10-25T10:00:00Z",
    owner = "SYN-A";
  const course = (
    id: string,
    date: string,
    purpose: "EASY_AEROBIC" | "REPETITION_SPEED",
    intensity: "EASY" | "HARD",
  ): ScheduleEntry => ({
    id,
    athleteId: owner,
    date,
    kind: "run",
    modality: "run",
    title: purpose === "REPETITION_SPEED" ? "速度课" : "轻松跑",
    focus: [],
    minutes: 20,
    intensity,
    lowerHeavy: false,
    source: "custom",
    refId: null,
    status: "done",
    actual: {
      outcome: "as_planned",
      minutes: 20,
      km: 3,
      rpe: 5,
      intensity,
      reasons: [],
      note: "合成",
      at: date + "T10:00:00Z",
      occurrenceIds: [id],
    },
    runComponents: [
      {
        componentId: "run",
        modality: "RUNNING",
        purpose,
        structure: {
          kind: "CONTINUOUS",
          plannedDistanceMeters: 3000,
          plannedDistanceMaxMeters: null,
          plannedDurationSeconds: 1200,
        },
      },
    ],
  });
  const entries = [
    course("a", "2026-10-19", "EASY_AEROBIC", "EASY"),
    course("b", "2026-10-21", "REPETITION_SPEED", "HARD"),
    course("c", "2026-10-23", "EASY_AEROBIC", "EASY"),
    course("d", "2026-10-12", "EASY_AEROBIC", "EASY"),
    course("e", "2026-10-14", "REPETITION_SPEED", "HARD"),
    course("f", "2026-10-16", "EASY_AEROBIC", "EASY"),
  ];
  const facts = entries.map((e) =>
    training({
      id: e.id,
      athleteId: owner,
      sourceRecordId: e.id,
      canonicalActivityId: e.id,
      occurrenceId: e.id,
      modality: "RUN",
      strengthSets: [],
      startedAt: e.date + "T08:00:00Z",
      occurredAt: e.date + "T08:00:00Z",
      knownAt: e.date + "T10:00:00Z",
      receivedAt: e.date + "T10:00:00Z",
      protocolKey: "same-clock",
      actualDurationSeconds: 1200,
      runSegments: [
        {
          id: e.id,
          blockId: "b",
          roundIndex: null,
          stepIndex: 1,
          distanceM: 3000,
          durationSeconds: 1200,
          restAfterSeconds: null,
          rawResolutionSeconds: 1,
          gradePercent: 0,
          surface: "track",
          completion: "COMPLETED",
        },
      ],
    }),
  );
  const known = <T>(value: T) => ({
    value,
    source: "ATHLETE_PROFILE" as const,
    at: now,
    version: "p1",
  });
  return {
    snapshot: {
      context: { ...context, asOf: now },
      snapshotId: "s",
      inputDigest: "d",
      facts,
      excluded: [],
      gaps: [],
      conflicts: [],
      safetyConstraints: [],
    },
    recovery: {
      snapshotId: "s",
      dataQuality: "AVAILABLE",
      signalState: "NO_ADVERSE_SIGNAL_OBSERVED",
      safetyState: "NO_KNOWN_HOLD",
      observations: [],
      hypotheses: [],
      candidates: [],
      missingDecisionInputs: [],
      medicalClearance: false,
      automaticPrescription: false,
    },
    entries,
    training: {
      days: known([1, 3, 5]),
      daysPerWeek: known(3),
      minutes: known(60),
      equipment: known("NONE"),
      restrictions: [],
      notes: null,
      conflicts: [],
      version: "v1",
      sourceRule: "",
    },
    goal: {
      schema: 1,
      athleteId: owner,
      revision: 1,
      savedAt: now,
      eventMeters: 800,
      raceDate: "2026-12-20",
      targetSeconds: 120,
      experience: "TRAINED",
      priority: "BALANCED",
      horizonWeeks: 8,
      taperDays: 7,
      proposeExtraMinutes: null,
      source: "USER_CONFIRMED_GOAL",
    },
    profileVersion: "p1",
    calendarVersion: "c1",
    importedDates: [],
  };
}
type Case = {
  name: string;
  change: (input: CycleInput) => CycleInput;
  verify: (before: CycleDraft, after: CycleDraft, input: CycleInput) => void;
};
const vary = (run: (x: CycleInput) => void) => (x: CycleInput) => {
  run(x);
  return x;
};
export const cycleCases: Case[] = [
  {
    name: "event contrast: 400m and 800m retain different event context",
    change: vary((x) => {
      x.goal.eventMeters = 400;
    }),
    verify: (a, b) => assert.notEqual(a.family, b.family),
  },
  {
    name: "event contrast: 800m and 10km do not share a universal event label",
    change: vary((x) => {
      x.goal.eventMeters = 10000;
    }),
    verify: (a, b) => assert.notEqual(a.family, b.family),
  },
  {
    name: "same performance with novice background restricts hard-course copying",
    change: vary((x) => {
      x.goal.experience = "NOVICE";
    }),
    verify: (a, b) =>
      assert.ok(b.weeks[0].sessions.every((s) => !s.candidate || s.candidate.intensity !== "HARD")),
  },
  {
    name: "work schedule change never schedules outside confirmed days",
    change: vary((x) => {
      x.training.days!.value = [2, 4];
      x.training.version = "v2";
    }),
    verify: (a, b) =>
      assert.ok(
        b.weeks.every((w) =>
          w.sessions
            .filter((s) => !/比赛目标|赛后恢复/.test(s.purpose))
            .every((s) => [2, 4].includes(new Date(s.date + "T12:00:00Z").getUTCDay())),
        ),
      ),
  },
  {
    name: "near race moves first week to taper without invented build-up",
    change: vary((x) => {
      x.goal.raceDate = "2026-11-01";
    }),
    verify: (a, b) => assert.equal(b.weeks[0].phase, "TAPER"),
  },
  {
    name: "past race produces recovery/review, never compressed catch-up",
    change: vary((x) => {
      x.goal.raceDate = "2026-10-20";
    }),
    verify: (a, b) => assert.equal(b.weeks[0].phase, "REVIEW"),
  },
  {
    name: "pain hold outranks high device readiness",
    change: vary((x) => {
      x.recovery.safetyState = "HOLD_ACTIVE";
    }),
    verify: (a, b) => {
      assert.equal(b.hold, true);
      assert.equal(b.weeks[0].canConfirm, false);
      assert.ok(b.weeks.every((w) => w.sessions.every((s) => !s.candidate)));
    },
  },
  {
    name: "unknown recovery blocks key-course execution and progression",
    change: vary((x) => {
      x.recovery.signalState = "INSUFFICIENT";
      x.goal.proposeExtraMinutes = 2;
    }),
    verify: (a, b) =>
      assert.ok(b.weeks[0].sessions.every((s) => !s.candidate || s.candidate.intensity !== "HARD")),
  },
  {
    name: "no actual history still answers with conditional course purposes",
    change: vary((x) => {
      x.snapshot.facts = [];
      x.entries = [];
    }),
    verify: (a, b) => {
      assert.ok(b.weeks[0].sessions.length);
      assert.ok(b.weeks[0].sessions.every((s) => s.candidate === null));
      assert.equal(b.weeks[0].plannedMinutes, null);
    },
  },
  {
    name: "missing available days does not assume weekdays",
    change: vary((x) => {
      x.training.days = null;
    }),
    verify: (a, b) => {
      assert.equal(b.weeks[0].sessions.length, 0);
      assert.equal(b.weeks[0].canConfirm, false);
    },
  },
  {
    name: "new time limit never silently overflows a session",
    change: vary((x) => {
      x.training.minutes!.value = 10;
    }),
    verify: (a, b) =>
      assert.ok(b.weeks[0].sessions.every((s) => !s.candidate || s.candidate.minutes <= 10)),
  },
  {
    name: "V4 calendar conflict is preserved rather than overwritten",
    change: vary((x) => {
      x.importedDates = ["2026-10-26"];
    }),
    verify: (a, b) => assert.ok(b.weeks[0].sessions.every((s) => s.date !== "2026-10-26")),
  },
  {
    name: "changing goal changes basis while leaving measured ability untouched",
    change: vary((x) => {
      x.goal.targetSeconds = 100;
    }),
    verify: (a, b) => {
      assert.notEqual(a.basisVersion, b.basisVersion);
      assert.deepEqual(a.portrait.performances, b.portrait.performances);
    },
  },
  {
    name: "priority changes the proposed focus with existing evidence",
    change: vary((x) => {
      x.goal.priority = "SPEED";
    }),
    verify: (a, b) => assert.notEqual(a.weeks[0].purpose, b.weeks[0].purpose),
  },
  {
    name: "foreign actual sessions cannot contribute to the portrait",
    change: vary((x) => {
      x.snapshot.facts = x.snapshot.facts.map((f) => ({ ...f, athleteId: "OTHER" }));
      x.entries = x.entries.map((e) => ({ ...e, athleteId: "OTHER" }));
    }),
    verify: (a, b) => {
      assert.equal(b.portrait.training.length, 0);
      assert.ok(b.weeks[0].sessions.every((s) => !s.candidate));
    },
  },
  {
    name: "retracted actual facts cannot contribute ability",
    change: vary((x) => {
      x.snapshot.facts = x.snapshot.facts.map((f) => ({ ...f, status: "RETRACTED" }));
      x.entries = [];
    }),
    verify: (a, b) => assert.equal(b.portrait.training.length, 0),
  },
  {
    name: "later weeks cannot be confirmed in advance",
    change: (x) => x,
    verify: (a) => assert.ok(a.weeks.slice(1).every((w) => !w.canConfirm && w.conditional)),
  },
  {
    name: "default plans do not grow from week to week without confirmation",
    change: (x) => x,
    verify: (a) => assert.ok(a.weeks.every((w) => (w.plannedMinutes ?? 0) <= 60)),
  },
];
