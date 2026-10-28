import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { parseR5Intent, currentMessageSafety } from "./intents";
import { prepareR5Command, readR5Context } from "./host";
import { detectRedFlags } from "../../core/coach-red-flags";
import { setStoreBackend } from "../../core/storage";
import { currentAthleteId, setEventContext } from "../../core/events";
import { profileStorageKey } from "../../strength/profile";
import { readEffectiveTrainingProfile } from "../loop/effective-training";
import { appendSymptom, readSymptoms, type SymptomInput } from "../../health/symptom-store";
import { reviewSymptoms } from "../../health/symptom-review";
import { readAnalysis } from "../../health/analysis-host";
import { parseCoachUtterance, interpretProfileLimit } from "../utterance-semantics";

const now = "2026-10-28T10:00:00.000Z";
test('relative course dates resolve once; conflicting dates never expand into a whole-week change',()=>{
 assert.deepEqual(parseR5Intent('把明天的强度课改成轻松跑',now),{kind:'EASY_RUN',day:'2026-10-29'});
 assert.deepEqual(parseR5Intent('后天力量训练减少一组',now),{kind:'REDUCE_SETS',days:['2026-10-30']});
 for(const q of ['明天后天力量训练减少一组','把2026-10-30明天改成轻松跑','把明天和周五改成轻松跑'])assert.equal(parseR5Intent(q,now).kind,'CLARIFY');
});
const oldPain: SymptomInput = {
  kind: "PAIN",
  region: "小腿",
  side: "LEFT",
  severity: 3,
  durationHours: 2,
  trigger: "跑步",
  functionImpact: "NORMAL",
  trend: "UNKNOWN",
  notes: "左小腿跑步时疼",
  occurredAt: "2026-09-01T10:00:00.000Z",
  trainingRefs: [],
};
function setup(t: TestContext) {
  const owner = currentAthleteId(),
    values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    keys: () => [...values.keys()],
  };
  setStoreBackend(store);
  setEventContext({ athleteId: "SYN-SEMANTICS" });
  t.after(() => {
    setStoreBackend(null);
    setEventContext({ athleteId: owner });
  });
  return {
    values,
    limit: (limit: string) =>
      values.set(profileStorageKey(), JSON.stringify({ limit, _savedAt: now })),
  };
}

for (const q of [
  "我没有腿疼，解释一下RPE",
  "我没有小腿疼，解释一下RPE",
  "我没有疼痛，解释一下RPE",
  "昨天腿疼，现在完全不疼了，解释一下RPE",
  "朋友腿疼，我想了解RPE",
  "不用保存，只解释一下RPE",
])
  test("read-only question is not consumed by a symptom proposal: " + q, () =>
    assert.equal(parseR5Intent(q, now).kind, "NONE"),
  );

test("mixed denied chest and asserted leg pain select only the asserted region", () => {
  const result = parseR5Intent("没有胸痛但腿正在疼", now);
  assert.equal(result.kind, "SYMPTOM");
  if (result.kind === "SYMPTOM") assert.equal(result.input.region, "腿");
  assert.ok(detectRedFlags("没有胸痛但腿正在疼").classes.includes("PAIN"));
  assert.equal(detectRedFlags("没有胸痛但腿正在疼").classes.includes("CARDIOVASCULAR"), false);
});
test("double negation cannot erase a current leg symptom", () => {
  const result = parseR5Intent("不是没有腿疼", now);
  assert.equal(result.kind, "SYMPTOM");
  if (result.kind === "SYMPTOM") assert.equal(result.input.region, "腿");
});
test("mixed current pain and education keeps the educational route without authorizing activity", () => {
  assert.equal(parseR5Intent("我小腿正在疼，解释一下RPE", now).kind, "NONE");
  assert.ok(detectRedFlags("我小腿正在疼，解释一下RPE").classes.includes("PAIN"));
  assert.ok(currentMessageSafety("我小腿正在疼，把明天的间歇跑改成轻松跑"));
});
test("ordinary weight control is not a medical-energy signal", () => {
  for (const q of ["如何合理控制体重", "我想控制体重，如何合理安排饮食？", "为了比赛合理控体重"]) {
    assert.equal(detectRedFlags(q).level, "NONE", q);
    assert.equal(currentMessageSafety(q), null, q);
  }
});
test("dangerous intake behavior and current severe symptoms retain their safety response", () => {
  for (const q of [
    "我每天只吃500大卡，还要每天跑步",
    "我最近催吐，月经已经停了",
    "我极端少吃，训练后一直头晕",
  ])
    assert.notEqual(detectRedFlags(q).level, "NONE", q);
  for (const q of ["我现在胸痛，解释一下RPE", "朋友现在胸痛呼吸困难", "我正在跑步，突然晕倒了"])
    assert.equal(detectRedFlags(q).level, "EMERGENCY", q);
});
test("third-party symptoms do not become personal snapshot restrictions", (t) => {
  setup(t);
  const analysis = readAnalysis(now.slice(0, 10), now, "朋友小腿疼，我没有不舒服，解释一下RPE");
  assert.equal(
    analysis.snapshot.safetyConstraints.some((c) => c.id === "existing-red-flags"),
    false,
  );
  const mixed = readAnalysis(now.slice(0, 10), now, "朋友没有腿疼，但我现在小腿正在疼");
  assert.equal(
    mixed.snapshot.safetyConstraints.some((c) => c.id === "existing-red-flags"),
    true,
  );
});
for (const limit of ["无", "没有不舒服", "目前没有身体限制", "没有疼痛"])
  test("explicit absence stays scoped and does not manufacture a restriction: " + limit, (t) => {
    const f = setup(t);
    f.limit(limit);
    assert.equal(readR5Context(now).hold, false);
    assert.deepEqual(readEffectiveTrainingProfile().restrictions, []);
    assert.equal(JSON.parse(f.values.get(profileStorageKey())!).limit, limit);
  });
test("explicit absence cannot erase independent historical pain", (t) => {
  const f = setup(t);
  f.limit("无");
  assert.equal(appendSymptom(oldPain, now, "synthetic-old-pain").ok, true);
  assert.equal(readR5Context(now).hold, true);
  assert.equal(readSymptoms(now).length, 1);
});
test("absence cannot replace an active profile restriction through a chat command", (t) => {
  const f = setup(t);
  f.limit("医生要求暂停跑步");
  const result = prepareR5Command("身体限制：无", now);
  assert.equal(result.kind, "ANSWER");
  assert.equal(JSON.parse(f.values.get(profileStorageKey())!).limit, "医生要求暂停跑步");
});
test("an old active restriction remains visible beyond the requested chart window", (t) => {
  setup(t);
  appendSymptom(oldPain, now, "synthetic-old-pain");
  const review = reviewSymptoms(readSymptoms(now), now.slice(0, 10), 14);
  assert.deepEqual(review.groups, []);
  assert.equal(review.safety, "HOLD_ACTIVE");
  const constraint = review.constraints[0] as (typeof review.constraints)[0] & {
    region?: string;
    occurredAt?: string;
    status?: string;
    reviewPath?: string;
  };
  assert.equal(constraint.region, "小腿");
  assert.equal(constraint.occurredAt, "2026-09-01T10:00:00.000Z");
  assert.equal(constraint.status, "REVIEW_PENDING");
  assert.ok(constraint.reviewPath);
});
test("task permission keeps knowledge and unrelated upper-body advice available under a leg restriction", (t) => {
  setup(t);
  appendSymptom(oldPain, now, "synthetic-old-pain");
  const context = (question: string) => (readR5Context as (...args: any[]) => any)(now, question);
  assert.equal(context("解释一下RPE").hold, true);
  assert.equal(context("解释一下RPE").permission?.answerAllowed, true);
  assert.equal(context("解释一下RPE").permission?.trainingRestricted, false);
  assert.equal(context("坐姿手臂训练怎么安排").permission?.trainingRestricted, false);
  assert.equal(context("带痛跑可以吗").permission?.trainingRestricted, true);
});
test("unscoped restrictions cannot be treated as permission for an unrelated-looking exercise", (t) => {
  const f = setup(t);
  f.limit("尚待医生复核，限制范围不确定");
  const c = (readR5Context as (...args: any[]) => any)(now, "今天上肢训练怎么安排");
  assert.equal(c.permission?.answerAllowed, true);
  assert.equal(c.permission?.trainingRestricted, true);
});
test("mixed subjects and denied symptoms cannot supply another region, side or severity", () => {
  const result = parseR5Intent("我没有左胸痛0分，但右小腿正在疼4分", now);
  assert.equal(result.kind, "SYMPTOM");
  if (result.kind === "SYMPTOM") {
    assert.equal(result.input.region, "小腿");
    assert.equal(result.input.side, "RIGHT");
    assert.equal(result.input.severity, 4);
    assert.doesNotMatch(result.input.notes, /胸痛/);
  }
});
test("uncertain and rhetorical pain reports request clarification instead of saving a current symptom", () => {
  for (const q of ["我不确定是不是小腿疼", "我好像小腿疼", "难道我没有小腿疼吗"])
    assert.equal(parseR5Intent(q, now).kind, "CLARIFY", q);
});
test("a recent historical report is not stamped as a new symptom today", () => {
  const semantic = parseCoachUtterance("昨天小腿疼，现在完全不疼了，解释一下RPE");
  assert.equal(
    semantic.mentions.some((m) => m.text.includes("小腿") && m.temporal === "HISTORY"),
    true,
  );
  const result = parseR5Intent("昨天小腿疼3分", now);
  assert.notEqual(result.kind, "SYMPTOM");
});
test("a friends low-intake report does not become the athletes personal energy restriction", (t) => {
  setup(t);
  const analysis = readAnalysis(now.slice(0, 10), now, "朋友每天吃500大卡还跑步，我想了解RPE");
  assert.equal(
    analysis.snapshot.safetyConstraints.some((c) => c.id === "existing-red-flags"),
    false,
  );
});
test("partial or conflicting absence stays reviewable and does not erase a restriction", () => {
  for (const text of ["没有胸痛但小腿疼", "好像没有身体限制", "朋友没有不舒服", "不是没有疼痛"])
    assert.equal(interpretProfileLimit(text).active, true, text);
  assert.equal(interpretProfileLimit("").status, "UNKNOWN");
});
test("ordinary calf soreness remains soreness instead of a new pain hold", () => {
  const q = "我小腿酸痛3分";
  const result = parseR5Intent(q, now);
  assert.equal(result.kind, "SYMPTOM");
  if (result.kind === "SYMPTOM") assert.equal(result.input.kind, "SORENESS");
  assert.equal(detectRedFlags(q).level, "NONE");
});
test("a local symptom mention does not turn an explicitly unrelated requested action into the same scope", (t) => {
  setup(t);
  assert.equal(
    readR5Context(now, "我小腿疼，坐姿手臂训练怎么安排").permission.trainingRestricted,
    false,
  );
  assert.equal(readR5Context(now, "我小腿疼，可以继续跑步吗").permission.trainingRestricted, true);
  assert.equal(
    readR5Context(now, "我胸痛，坐姿手臂训练怎么安排").permission.trainingRestricted,
    true,
  );
});
