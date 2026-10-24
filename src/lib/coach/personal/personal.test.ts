import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalPlan,
  routePersonalIntent,
  reviewFeedback,
  type PersonalProfile,
} from "./planner";
import { createPersonalStore } from "./store";
const profile: PersonalProfile = {
  schema: 1,
  athleteId: "a",
  revision: 1,
  goal: "FAT_LOSS",
  services: ["NUTRITION"],
  age: 30,
  sex: "female",
  heightCm: 165,
  weightKg: 70,
  activity: "LOW",
  screen: "CLEAR",
  experience: "BEGINNER",
  days: [1, 4],
  minutes: 35,
  equipment: "NONE",
  diet: "OMNIVORE",
};
const now = "2026-10-23T08:00:00.000Z";
test("nutrition-only has no exercise prescription and explicit estimate", () => {
  const p = buildPersonalPlan(profile, now);
  assert.equal(p.strength.length, 0);
  assert.equal(p.running, null);
  assert.ok(p.nutrition?.energyKcal);
  assert.equal(p.nutrition?.basis, "INITIAL_ESTIMATE");
  assert.ok(p.nutrition!.energyKcal![1] < p.nutrition!.maintenanceKcal![1]);
});
test("missing activity never assumes running; minor and underweight never get fat-loss calories", () => {
  assert.equal(buildPersonalPlan({ ...profile, activity: null }, now).nutrition?.energyKcal, null);
  assert.equal(buildPersonalPlan({ ...profile, age: 16 }, now).nutrition?.energyKcal, null);
  assert.equal(buildPersonalPlan({ ...profile, weightKg: 45 }, now).nutrition?.energyKcal, null);
});
test("screen unknown and pain hold strength and numeric energy prescriptions", () => {
  for (const screen of ["UNKNOWN", "PAIN", "MEDICAL"] as const) {
    const p = buildPersonalPlan({ ...profile, services: ["NUTRITION", "STRENGTH"], screen }, now);
    assert.equal(p.strength.length, 0);
    assert.equal(p.nutrition?.energyKcal, null);
    assert.ok(p.cautions.length);
  }
});
test("hypertrophy follows selected equipment and schedule; unknown loads stay unknown", () => {
  const p = buildPersonalPlan(
    { ...profile, goal: "HYPERTROPHY", services: ["STRENGTH"], equipment: "DUMBBELLS" },
    now,
  );
  assert.equal(p.nutrition, null);
  assert.equal(p.strength.length, 2);
  assert.deepEqual(
    p.strength.map((s) => s.day),
    [1, 4],
  );
  assert.ok(
    p.strength.every((s) => s.moves.every((m) => m.loadKg === null || m.loadKg === "BODYWEIGHT")),
  );
  assert.ok(p.strength.every((s) => s.moves.some((m) => m.id === "db-row")));
});
test("bodyweight plan discloses missing pulling equipment and short/adjacent availability is not inflated", () => {
  const p = buildPersonalPlan(
    { ...profile, services: ["STRENGTH"], days: [1, 2], minutes: 15 },
    now,
  );
  assert.ok(p.cautions.some((x) => x.includes("拉")));
  assert.equal(p.strength.length, 1);
  assert.ok(p.strength[0].minutes <= 15);
});
test("running mode links existing workbench without invented speed; mixed goal protects running fuel", () => {
  const p = buildPersonalPlan({ ...profile, services: ["NUTRITION", "RUNNING"] }, now);
  assert.ok(p.running);
  assert.equal(p.nutrition?.energyKcal?.[0], p.nutrition?.maintenanceKcal?.[0]);
  assert.ok(p.cautions.some((x) => x.includes("减脂")));
});
test("intent routing handles negation and selected domains", () => {
  assert.equal(routePersonalIntent("不要训练，只看饮食", profile), "NUTRITION");
  assert.equal(routePersonalIntent("不要减肥，今天练腿", profile), null);
  assert.equal(routePersonalIntent("整体方案", profile), "ALL");
  assert.equal(routePersonalIntent("复盘昨天800米", profile), null);
});
test("feedback cannot silently increase or use incomplete one-day scale changes", () => {
  assert.equal(
    reviewFeedback(buildPersonalPlan(profile, now), {
      planVersion: 1,
      completedSessions: 0,
      effort: "EASY",
      pain: false,
      adherenceDays: 1,
      weightTrend: "UP",
      completeWeightWindows: false,
    }).change,
    null,
  );
});
test("pain feedback holds training; persistent hard work suggests one-variable reduction", () => {
  const p = buildPersonalPlan({ ...profile, services: ["STRENGTH"] }, now);
  assert.equal(
    reviewFeedback(p, {
      planVersion: 1,
      completedSessions: 2,
      effort: "HARD",
      pain: true,
      adherenceDays: 14,
      weightTrend: "UNKNOWN",
      completeWeightWindows: false,
    }).status,
    "HOLD",
  );
  const r = reviewFeedback(p, {
    planVersion: 1,
    completedSessions: 2,
    effort: "HARD",
    pain: false,
    adherenceDays: 14,
    weightTrend: "UNKNOWN",
    completeWeightWindows: false,
  });
  assert.equal(r.change?.field, "strengthSets");
  assert.equal(r.requiresConfirmation, true);
});
test("confirmation binds actor/profile/revision, persists active plan, rejects stale and replay", () => {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
  const s = createPersonalStore(
    storage,
    () => "a",
    () => now,
  );
  s.saveProfile({ ...profile, revision: 0 });
  const p = s.prepare();
  assert.ok(p);
  assert.equal(s.confirm(p!.token, "CONFIRM_PERSONAL_PLAN").version, 1);
  assert.throws(() => s.confirm(p!.token, "CONFIRM_PERSONAL_PLAN"));
  assert.equal(s.read().active?.athleteId, "a");
  const q = s.prepare()!;
  s.saveProfile({ ...profile, goal: "WEIGHT_MAINTENANCE" });
  assert.throws(() => s.confirm(q.token, "CONFIRM_PERSONAL_PLAN"));
  assert.equal(
    createPersonalStore(
      storage,
      () => "b",
      () => now,
    ).read().active,
    null,
  );
});
test("out-of-range values and duplicate weekdays rejected", () => {
  assert.throws(() => buildPersonalPlan({ ...profile, weightKg: NaN }, now));
  assert.throws(() => buildPersonalPlan({ ...profile, days: [1, 1] }, now));
});
test("pain feedback blocks replacement and confirmation until newer explicit no-pain feedback", () => {
  const m = new Map<string, string>(),
    s = createPersonalStore(
      {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => {
          m.set(k, v);
        },
      },
      () => "a",
      () => now,
    );
  s.saveProfile({ ...profile, revision: 0, services: ["STRENGTH"] });
  s.confirm(s.prepare()!.token, "CONFIRM_PERSONAL_PLAN");
  s.feedback({
    planVersion: 1,
    completedSessions: 2,
    effort: "HARD",
    pain: true,
    adherenceDays: 3,
    weightTrend: "UNKNOWN",
    completeWeightWindows: false,
  });
  assert.throws(() => s.prepare());
  assert.throws(() => s.prepareReduction());
});
test("stale profile cannot be confirmed or regenerated without explicit profile update", () => {
  const m = new Map<string, string>();
  let clock = now;
  const s = createPersonalStore(
    {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        m.set(k, v);
      },
    },
    () => "a",
    () => clock,
  );
  s.saveProfile({ ...profile, revision: 0 });
  const p = s.prepare()!;
  clock = "2026-12-01T08:00:00.000Z";
  assert.throws(() => s.confirm(p.token, "CONFIRM_PERSONAL_PLAN"));
  assert.throws(() => s.prepare());
});
test("record review and knowledge questions are not replaced by generic personal plan", () => {
  assert.equal(routePersonalIntent("昨天记录的饮食热量多少", profile), null);
  assert.equal(routePersonalIntent("什么是蛋白质", profile), null);
  assert.equal(routePersonalIntent("不要减脂，只看饮食方案", profile), "NUTRITION");
});
test("conservative energy targets withheld outside formula support; trained template differs within time", () => {
  assert.equal(
    buildPersonalPlan({ ...profile, age: 85, heightCm: 120, weightKg: 35 }, now).nutrition
      ?.energyKcal,
    null,
  );
  assert.ok(
    buildPersonalPlan(
      { ...profile, services: ["STRENGTH"], experience: "TRAINED", minutes: 45 },
      now,
    ).strength[0].moves.some((m) => m.sets === 3),
  );
});
test("reduction adoption changes only sets, version and time, preserving loads and nutrition", () => {
  const m = new Map<string, string>();
  const s = createPersonalStore(
    {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        m.set(k, v);
      },
    },
    () => "a",
    () => now,
  );
  s.saveProfile({ ...profile, revision: 0, services: ["NUTRITION", "STRENGTH"] });
  const before = s.confirm(s.prepare()!.token, "CONFIRM_PERSONAL_PLAN");
  s.feedback({
    planVersion: 1,
    completedSessions: 2,
    effort: "HARD",
    pain: false,
    adherenceDays: 7,
    weightTrend: "UNKNOWN",
    completeWeightWindows: false,
  });
  const p = s.prepareReduction();
  assert.deepEqual(p.plan.nutrition, before.nutrition);
  for (let i = 0; i < before.strength.length; i++)
    for (let j = 0; j < before.strength[i].moves.length; j++) {
      const a = before.strength[i].moves[j],
        b = p.plan.strength[i].moves[j];
      assert.deepEqual({ ...b, sets: a.sets }, a);
      assert.equal(b.sets, Math.max(1, a.sets - 1));
    }
  assert.equal(s.read().active?.version, 1);
  assert.equal(s.confirm(p.token, "CONFIRM_PERSONAL_PLAN").version, 2);
  assert.throws(() =>
    s.feedback({
      planVersion: 1,
      completedSessions: 1,
      effort: "OK",
      pain: false,
      adherenceDays: 1,
      weightTrend: "UNKNOWN",
      completeWeightWindows: false,
    }),
  );
});
test("feedback remains writable after profile update and earlier feedback survives adoption", () => {
  const m = new Map<string, string>(),
    s = createPersonalStore(
      {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => {
          m.set(k, v);
        },
      },
      () => "a",
      () => now,
    );
  const saved = s.saveProfile({ ...profile, revision: 0, services: ["STRENGTH"] });
  s.confirm(s.prepare()!.token, "CONFIRM_PERSONAL_PLAN");
  s.feedback({
    planVersion: 1,
    completedSessions: 1,
    effort: "HARD",
    pain: true,
    adherenceDays: 1,
    weightTrend: "UNKNOWN",
    completeWeightWindows: false,
  });
  s.saveProfile(saved);
  assert.doesNotThrow(() =>
    s.feedback({
      planVersion: 1,
      completedSessions: 1,
      effort: "OK",
      pain: false,
      adherenceDays: 2,
      weightTrend: "UNKNOWN",
      completeWeightWindows: false,
    }),
  );
  s.confirm(s.prepare()!.token, "CONFIRM_PERSONAL_PLAN");
  assert.equal(s.read().feedback.length, 2);
  assert.throws(() => s.prepareReduction());
});
test("only-strength request excludes nutrition even when exclusion mentions diet", () => {
  assert.equal(
    routePersonalIntent("只做力量，不要说饮食建议", {
      ...profile,
      services: ["NUTRITION", "STRENGTH"],
    }),
    "STRENGTH",
  );
  assert.equal(
    routePersonalIntent("只看饮食，不做力量", { ...profile, services: ["NUTRITION", "STRENGTH"] }),
    "NUTRITION",
  );
});
