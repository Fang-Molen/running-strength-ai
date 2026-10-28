import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { personalStore, personalAnswer, defaultPersonalProfile } from "./host";
import { setEventContext, EVENT_JOURNAL_PREFIX } from "../../core/events";
import { setStoreBackend } from "../../core/storage";
import { upsertCheck } from "../../nutrition/body";
import { recordManualFood, updateEntry } from "../../nutrition/log";
import type { PersonalProfile } from "./planner";
import { emptyProfile, saveProfile as saveAthleteProfile } from "../../strength/profile";
import { bindTrainingStart, closeTrainingOccurrence } from "../../core/occurrence";

function setup(t: TestContext) {
  const map = new Map<string, string>();
  const box = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); }, keys: () => [...map.keys()] };
  const saved = ["window", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(target, { localStorage: box }) });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: box });
  setStoreBackend(box); setEventContext({ athleteId: "SYN-PERSONAL" });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T08:00:00Z") });
  t.after(() => { setEventContext({ athleteId: "local" }); setStoreBackend(null); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  const profile: PersonalProfile = { ...defaultPersonalProfile("SYN-PERSONAL"), services: ["NUTRITION"], goal: "FAT_LOSS", age: 30, sex: "female", weightKg: 70, heightCm: 165, activity: "LOW", screen: "CLEAR", days: [1, 4] };
  const adopt = () => { const store = personalStore(); store.saveProfile(profile); const proposal = store.prepare()!; return store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN"); };
  return { map, box, profile, adopt };
}

test("new measured weight makes the adopted nutrition plan stale without rewriting it", t => {
  const { adopt } = setup(t), adopted = adopt();
  t.mock.timers.setTime(new Date("2026-10-28T10:00:00Z").getTime());
  assert.ok(upsertCheck({ date: "2026-10-28", weight: 80 }));
  const answer = personalAnswer("我的饮食方案", new Date().toISOString())!;
  assert.match(answer, /待复核|待刷新/);
  assert.match(answer, /候选/);
  assert.deepEqual(personalStore().read().active, adopted);
});

test("meal correction invalidates nutrition and never becomes a full-day deficit", t => {
  const { adopt } = setup(t); adopt();
  const food = recordManualFood({ date: "2026-10-27", meal: "午餐", name: "合成餐食", kcal: 600, grams: 200 })!;
  assert.ok(food);
  assert.ok(updateEntry(food.id, { kcal: 300, grams: 100 }, food.revisionId));
  const answer = personalAnswer("我的饮食方案", new Date().toISOString())!;
  assert.match(answer, /待复核|待刷新/);
  assert.match(answer, /完整性未知|完整度.*未知/);
  assert.match(answer, /已知热量小计\s*300\s*千卡/);
  assert.doesNotMatch(answer, /全天赤字\s*\d|摄入不足\s*\d/);
});

test("dependent changes between preview and confirmation preserve the adopted version", t => {
  const { adopt } = setup(t), adopted = adopt(), store = personalStore(), next = store.prepare()!;
  t.mock.timers.setTime(new Date("2026-10-27T08:01:00Z").getTime());
  assert.ok(upsertCheck({ date: "2026-10-27", weight: 80 }));
  assert.throws(() => store.confirm(next.token, "CONFIRM_PERSONAL_PLAN"), /变化|过期|重新/);
  assert.deepEqual(store.read().active, adopted);
});

test("legacy adopted plans without dependencies cannot be described as current", t => {
  const { adopt, map } = setup(t); adopt();
  const key = "fk:personal-coach:v1:SYN-PERSONAL", state = JSON.parse(map.get(key)!);
  delete state.active.dependencies; map.set(key, JSON.stringify(state));
  assert.match(personalAnswer("我的饮食方案", new Date().toISOString())!, /依据.*未知|待复核/);
});

test("nutrition edits do not invalidate an independent strength answer", t => {
  const { profile } = setup(t), store = personalStore();
  store.saveProfile({ ...profile, services: ["STRENGTH"] });
  const p = store.prepare()!; store.confirm(p.token, "CONFIRM_PERSONAL_PLAN");
  assert.ok(recordManualFood({ date: "2026-10-27", meal: "午餐", name: "合成餐食", kcal: 300 }));
  const review = (store as any).reviewActive("STRENGTH");
  assert.equal(review.status, "FRESH");
  assert.doesNotMatch(personalAnswer("我的力量方案", new Date().toISOString())!, /待复核|待刷新/);
});

test("unreadable source makes freshness unknown and cannot be confirmed", t => {
  const { map, adopt } = setup(t), active = adopt();
  map.set("fr255-food-log-v1", "{broken");
  const store = personalStore(), review = (store as any).reviewActive("NUTRITION");
  assert.equal(review.status, "UNKNOWN");
  assert.deepEqual(store.read().active, active);
  const candidate = store.prepare()!;
  assert.throws(() => store.confirm(candidate.token, "CONFIRM_PERSONAL_PLAN"), /读取|未知|核对/);
});

test("an unreadable current-athlete symptom journal cannot clear restrictions as if it were empty", t => {
  const { map, adopt } = setup(t), active = adopt(), store = personalStore();
  map.set("fk-symptoms-r5:SYN-PERSONAL:broken", "{broken");
  const review = store.reviewActive();
  assert.equal(review.status, "UNKNOWN");
  assert.ok(review.unknown.includes("RESTRICTIONS"));
  assert.equal(review.candidate?.nutrition?.energyKcal, null);
  const proposal = store.prepare()!;
  assert.throws(() => store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN"), /读取|未知|核对/);
  assert.deepEqual(store.read().active, active);
});

test("refusing a refreshed proposal keeps the adopted plan and clears the confirmation token", t => {
  const { adopt } = setup(t), active = adopt(), store = personalStore(), proposal = store.prepare()!;
  (store as any).reject(proposal.token);
  assert.deepEqual(store.read().active, active);
  assert.equal(store.read().proposal, null);
  assert.throws(() => store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN"));
});

test("a changed shared goal invalidates the adopted plan and its pending confirmation", t => {
  const { adopt } = setup(t), active = adopt(), store = personalStore(), proposal = store.prepare()!;
  assert.ok(saveAthleteProfile({ ...emptyProfile(), aim: "keep", targetKg: "70" }));
  const review = store.reviewActive("NUTRITION");
  assert.equal(review.status, "STALE");
  assert.ok(review.changed.includes("GOAL"));
  assert.throws(() => store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN"), /变化|核对/);
  assert.deepEqual(store.read().active, active);
});

test("new actual training is a dependency even when the saved personal profile is unchanged", t => {
  const { adopt, map } = setup(t), active = adopt(), store = personalStore();
  const id = "synthetic-completed-strength", start = "2026-10-27T07:00:00Z", end = "2026-10-27T07:30:00Z";
  bindTrainingStart({ startEventId: id, startedAt: start, sessionId: id, planSlotId: id,
    plan: { id, name: "合成力量", moves: [{ id: "squat", catalogId: "back-squat", customName: "", sets: 2, mode: "reps", amount: 8, restSec: 90, weightKg: 50 }] } });
  const events = [
    { event_id: id, event_type: "TRAINING_STARTED", timestamp: start, payload: { sessionId: id, trainingOccurrenceId: id } },
    { event_id: id + ":set", event_type: "TRAINING_SET_COMPLETED", timestamp: "2026-10-27T07:10:00Z", payload: { sessionId: id, trainingOccurrenceId: id, moveId: "squat", catalogId: "back-squat", setIndex: 1, completed: true, skipped: false, actualAmount: 8, actualWeight: 50 } },
    { event_id: id + ":end", event_type: "TRAINING_COMPLETED", timestamp: end, payload: { sessionId: id, trainingOccurrenceId: id, setsCompleted: 1 } },
  ].map(event => ({ ...event, athlete_id: "SYN-PERSONAL" }));
  for (const event of events) map.set(EVENT_JOURNAL_PREFIX + event.event_id, JSON.stringify({ schemaVersion: 1, id: event.event_id, order: Date.parse(event.timestamp), recordedAt: event.timestamp, data: event }));
  closeTrainingOccurrence(events.at(-1)!);
  const review = store.reviewActive();
  assert.equal(review.status, "STALE");
  assert.ok(review.changed.includes("TRAINING"));
  assert.deepEqual(store.read().active, active);
});

test("a new active restriction withholds specific nutrition numbers in the conditional candidate", t => {
  const { adopt } = setup(t), active = adopt(), store = personalStore();
  assert.ok(saveAthleteProfile({ ...emptyProfile(), limit: "左膝当前疼痛，暂时不能跑跳" }));
  const review = store.reviewActive();
  assert.equal(review.status, "STALE");
  assert.ok(review.changed.includes("RESTRICTIONS"));
  assert.equal(review.candidate?.nutrition?.energyKcal, null);
  assert.deepEqual(store.read().active, active);
});

test("another athlete's meals do not invalidate the current athlete's confirmation", t => {
  const { adopt } = setup(t); adopt();
  const store = personalStore(), proposal = store.prepare()!;
  setEventContext({ athleteId: "SYN-OTHER" });
  assert.ok(recordManualFood({ date: "2026-10-27", meal: "午餐", name: "另一位合成用户餐食", kcal: 500 }));
  setEventContext({ athleteId: "SYN-PERSONAL" });
  assert.equal(store.reviewActive().status, "FRESH");
  assert.equal(store.reviewProposal(proposal.token).status, "FRESH");
  assert.equal(store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN").version, 2);
});

test("a new weight-gain goal cannot silently reuse the previous fat-loss candidate", t => {
  const { adopt } = setup(t), active = adopt(), store = personalStore();
  t.mock.timers.setTime(new Date("2026-10-27T08:01:00Z").getTime());
  assert.ok(saveAthleteProfile({ ...emptyProfile(), aim: "gain", targetKg: "75" }));
  const answer = personalAnswer("我的饮食方案", new Date().toISOString())!;
  assert.match(answer, /增重/);
  assert.match(answer, /核对目标/);
  assert.doesNotMatch(answer, /1530–1620/);
  assert.throws(() => store.prepare(), /增重.*核对/);
  assert.deepEqual(store.read().active, active);
});
