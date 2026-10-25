import { writeFileSync, mkdirSync } from "node:fs";
import { monthFixture, followup } from "./fixture";
import { buildCycleDraft } from "../../src/lib/coach/cycle/planner";
import { evaluateRecoveryEvidence } from "../../src/lib/health/recovery-assessment";
import { historySummary } from "../../src/lib/coach/assessment/history";
import { adaptiveSummary } from "../../src/lib/health/adaptive-review";
import { metric } from "../../src/lib/health/analysis-fixtures";
import type { ResponseFact, TrainingFact } from "../../src/lib/health/analysis-contract";
const base = () => {
  const x = monthFixture();
  for (const measure of ["PAIN", "FUNCTION"] as const)
    x.snapshot.facts.push({
      ...metric({
        id: "current:" + measure,
        sourceRecordId: "current:" + measure,
        occurredAt: x.snapshot.context.asOf,
        knownAt: x.snapshot.context.asOf,
        receivedAt: x.snapshot.context.asOf,
      }),
      kind: "RESPONSE",
      measure,
      value: 0,
      scale: measure === "PAIN" ? "0-10_HIGH_WORSE" : "FUNCTION_LIMITATION_0_1",
      region: "glutes",
      side: "BILATERAL",
      relatedTrainingRefs: [],
      observationProtocol: "SELF_REPORT_" + measure,
      elapsedHours: null,
      functionTaskId: null,
      notes: null,
    } satisfies ResponseFact);
  x.recovery = evaluateRecoveryEvidence(x.snapshot);
  return x;
};
const views = (x: ReturnType<typeof base>) => {
  const d = buildCycleDraft(x);
  return {
    ability: historySummary(d.portrait.history),
    personalResponse: adaptiveSummary(d.portrait.adaptive),
    hold: d.hold,
    weeks: d.weeks.map((w) => ({
      start: w.start,
      strengthFocus: w.strengthFocus,
      confirmable: w.canConfirm,
      minutes: w.plannedMinutes,
      courses: w.sessions.map((s) => ({
        date: s.date,
        title: s.candidate?.title ?? s.purpose,
        modality: s.candidate?.modality ?? null,
        minutes: s.candidate?.minutes ?? null,
        exercises: s.candidate?.exercises ?? [],
        run: s.candidate?.runComponents ?? [],
        reason: s.reason,
        missing: s.missing,
      })),
    })),
  };
};
const initial = base(),
  baseline = views(initial),
  feedback = base();
for (const f of feedback.snapshot.facts.slice())
  if (f.kind === "TRAINING" && ["strength-1", "strength-3"].includes(f.id))
    feedback.snapshot.facts.push(followup(f, "SORENESS", 4));
feedback.recovery = evaluateRecoveryEvidence(feedback.snapshot);
const pain = base();
pain.snapshot.safetyConstraints.push({
  id: "pain",
  version: "1",
  scope: "PAIN_REVIEW",
  evidenceRefs: [],
});
pain.recovery = evaluateRecoveryEvidence(pain.snapshot);
const missing = base();
for (const f of missing.snapshot.facts)
  if (f.kind === "TRAINING" && f.modality === "STRENGTH")
    f.strengthSets.forEach((s) => (s.loadKg = null));
const corrected = structuredClone(feedback);
corrected.snapshot.facts = corrected.snapshot.facts.map((f) =>
  f.id === "strength-3" ? { ...f, revision: f.revision + 1 } : f,
);
corrected.recovery = evaluateRecoveryEvidence(corrected.snapshot);
const target = base();
target.goal.targetSeconds = 90;
const outputs = {
  synthetic: true,
  notUserData: true,
  baseline,
  cases: [
    { name: "重复课后酸痛反馈", before: baseline, after: views(feedback) },
    { name: "疼痛限制优先", before: baseline, after: views(pain) },
    { name: "力量负重缺失", before: baseline, after: views(missing) },
    { name: "更正实际记录使旧随访失配", before: views(feedback), after: views(corrected) },
    { name: "目标改成800米90秒不能改变实测能力", before: baseline, after: views(target) },
  ],
};
mkdirSync("docs/r8/evidence", { recursive: true });
writeFileSync("docs/r8/evidence/examples.json", JSON.stringify(outputs, null, 2));
console.log(
  JSON.stringify(
    {
      cases: outputs.cases.length,
      weeks: baseline.weeks.length,
      firstWeek: baseline.weeks[0].courses.map((c) => ({
        date: c.date,
        type: c.modality,
        sets: c.exercises.map((e) => e.sets),
      })),
      ability: baseline.ability,
      feedback: outputs.cases[0].after.weeks[0].courses
        .filter((c) => c.modality === "strength")
        .map((c) => c.exercises.map((e) => e.sets)),
    },
    null,
    2,
  ),
);
