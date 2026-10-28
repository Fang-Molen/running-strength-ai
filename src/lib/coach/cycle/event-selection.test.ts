import test from "node:test";
import assert from "node:assert/strict";
import { buildCycleDraft } from "./planner";
import { selectionFixture } from "./selection-fixture";
import { cycleFixture } from "./fixtures";
import { monthFixture, followup } from "../../../../evaluation/adaptive/fixture";
import type { TrainingFact } from "../../health/analysis-contract";
import { actualCourseSeeds } from "./actual-seeds";

for (const [meters, first] of [[400,"speed-repeats"],[800,"interval-repeats"],[1500,"rhythm-repeats"],[3000,"interval-repeats"],[5000,"continuous-tempo"],[10000,"continuous-long"]] as const)
  test(`${meters}m changes actual familiar-course selection using the same recorded history`, () => {
    const input = selectionFixture(), original = structuredClone(input); input.goal.eventMeters = meters;
    const draft = buildCycleDraft(input), session = draft.weeks[0].sessions.find(row => row.candidate)!;
    assert.ok(session);
    assert.equal(session.sourceEntryIds[0], first);
    const fit = (session as any).eventFit;
    assert.equal(fit?.status, "CONDITIONAL_TRANSFER");
    assert.ok(fit.sourceRefs.some((ref: any) => ref.id === first));
    assert.ok(fit.gaps.length);
    assert.match(session.reason, /课目的.*实际结构|实际结构.*课目的/);
    assert.equal(session.changedVariable, "NONE");
    assert.equal(session.candidate!.minutes, 20);
    assert.deepEqual(input.entries, original.entries);
    assert.deepEqual(input.snapshot.facts, original.snapshot.facts);
  });

test("incomplete preferred structure loses priority to a supported familiar alternative", () => {
  const input = selectionFixture(); input.goal.eventMeters = 800;
  const interval = input.snapshot.facts.find(fact => fact.id === "interval-repeats") as TrainingFact;
  interval.runSegments[0].restAfterSeconds = null;
  const draft = buildCycleDraft(input), session = draft.weeks[0].sessions.find(row => row.candidate)!;
  assert.ok(session);
  assert.notEqual(session.sourceEntryIds[0], "interval-repeats");
  assert.ok((draft as any).eventSelectionReview.some((row: any) => row.sourceEntryId === "interval-repeats" && row.evidenceState !== "SUPPORTED_ACTUAL"));
});

test("a continuous plan cannot claim complete structure evidence from several actual repetitions", () => {
  const input = selectionFixture(); input.goal.eventMeters = 5000;
  const tempo = input.snapshot.facts.find(fact => fact.id === "continuous-tempo") as TrainingFact;
  tempo.runSegments = structuredClone((input.snapshot.facts.find(fact => fact.id === "interval-repeats") as TrainingFact).runSegments);
  const draft = buildCycleDraft(input);
  assert.notEqual(draft.eventSelectionReview.find(row => row.sourceEntryId === "continuous-tempo")?.evidenceState, "SUPPORTED_ACTUAL");
  assert.notEqual(draft.weeks[0].sessions.find(row => row.candidate)?.sourceEntryIds[0], "continuous-tempo");
});

test("a known repeated actual cannot later become a continuous candidate when alternatives are exhausted", () => {
  const input = selectionFixture(); input.goal.eventMeters = 5000;
  const keep = new Set(["continuous-tempo", "interval-repeats"]);
  input.entries = input.entries.filter(entry => keep.has(entry.id));
  input.snapshot.facts = input.snapshot.facts.filter(fact => keep.has(fact.id));
  const tempo = input.snapshot.facts.find(fact => fact.id === "continuous-tempo") as TrainingFact;
  tempo.runSegments = structuredClone((input.snapshot.facts.find(fact => fact.id === "interval-repeats") as TrainingFact).runSegments);
  const draft = buildCycleDraft(input);
  assert.ok(draft.weeks[0].sessions.every(session => !session.candidate || !session.sourceEntryIds.includes("continuous-tempo")));
  assert.ok(draft.weeks[0].sessions.some(session => session.missing.some(reason => /重复.*连续|连续.*重复/.test(reason))));
});

test("fact-only familiar endurance seeds preserve the explicitly recorded LONG purpose", () => {
  const input = selectionFixture(), fact = input.snapshot.facts.find(fact => fact.id === "continuous-long") as TrainingFact;
  fact.observedType = "LONG"; fact.observedTypeBasis = [{ id: fact.id, revision: fact.revision }];
  const seed = actualCourseSeeds([fact], [])[0];
  assert.equal(seed.runComponents?.[0].modality === "RUNNING" && seed.runComponents[0].purpose, "LONG");
});

test("phase conditions distinguish observed actuals, unknown followup and a confirmed calendar", () => {
  const input = selectionFixture(), draft = buildCycleDraft(input), review = draft.weeks[0].phaseReview as any;
  assert.equal(review.entryChecks?.find((row: any) => row.id === "ACTUAL_COURSES")?.state, "SATISFIED");
  assert.ok(review.entryChecks.find((row: any) => row.id === "ACTUAL_COURSES").evidenceRefs.length);
  assert.equal(review.entryChecks?.find((row: any) => row.id === "CALENDAR")?.state, "SATISFIED");
  assert.equal(review.entryChecks?.find((row: any) => row.id === "RESPONSE")?.state, "UNKNOWN");
  assert.equal(review.entryState, "UNKNOWN");
  assert.ok(review.exitChecks.every((row: any) => row.state !== "SATISFIED"));
  assert.match(draft.weeks[0].purpose, /待核对.*反馈|反馈.*待核对/);
});

test("a calendar date cannot override contradictory restrictions or missing execution", () => {
  const input = cycleFixture(); input.snapshot.safetyConstraints.push({ id: "independent-pain", version: "1", scope: "PAIN", evidenceRefs: [] });
  input.entries = []; input.snapshot.facts = [];
  const draft = buildCycleDraft(input), review = draft.weeks[0].phaseReview as any;
  assert.equal(review.entryChecks?.find((row: any) => row.id === "RESTRICTIONS")?.state, "CONTRADICTED");
  assert.equal(review.entryChecks?.find((row: any) => row.id === "ACTUAL_COURSES")?.state, "UNKNOWN");
  assert.equal(review.entryState, "CONTRADICTED");
  assert.equal(draft.weeks[0].canConfirm, false);
});

test("repeated linked contrary feedback is cited as a contradicted phase condition", () => {
  const input = monthFixture();
  const rows = input.snapshot.facts.filter((fact): fact is TrainingFact => fact.kind === "TRAINING" && ["strength-1", "strength-3"].includes(fact.id));
  input.snapshot.facts.push(...rows.map(row => followup(row, "SORENESS", 4)));
  const review = buildCycleDraft(input).weeks[0].phaseReview as any;
  const feedback = review.entryChecks?.find((row: any) => row.id === "RESPONSE");
  assert.equal(feedback?.state, "CONTRADICTED");
  assert.ok(feedback.evidenceRefs.some((ref: any) => ref.id.includes("SORENESS")));
});

test("repeated positive same-dose feedback satisfies only that observed response condition", () => {
  const input = monthFixture();
  input.entries = input.entries.filter(entry => entry.modality === "strength");
  input.snapshot.facts = input.snapshot.facts.filter(fact => fact.kind === "TRAINING" && fact.modality === "STRENGTH");
  const rows = input.snapshot.facts as TrainingFact[];
  input.snapshot.facts.push(...rows.flatMap(row => [followup(row, "PAIN", 0), followup(row, "FUNCTION", 0)]));
  const draft = buildCycleDraft(input), review = draft.weeks[0].phaseReview;
  assert.equal(review.entryChecks.find(row => row.id === "RESPONSE")?.state, "SATISFIED");
  assert.match(review.entryChecks.find(row => row.id === "RESPONSE")!.reason, /不推广强度或自动加量/);
  assert.equal(review.exitChecks.find(row => row.id === "WEEK_EXECUTION")?.state, "UNKNOWN");
  assert.equal(draft.automaticExecution, false);
});

test("a fully occupied calendar is contradicted while missing time remains unknown", () => {
  const input = selectionFixture();
  const originals = [...input.entries];
  input.entries = [...input.entries, ...["2026-10-26", "2026-10-28", "2026-10-30"].map((date, index) => ({ ...originals[index], id: "future:" + index, date, status: "planned" as const, actual: undefined }))];
  let review = buildCycleDraft(input).weeks[0].phaseReview;
  assert.equal(review.entryChecks.find(row => row.id === "CALENDAR")?.state, "CONTRADICTED");
  input.training.minutes = null;
  review = buildCycleDraft(input).weeks[0].phaseReview;
  assert.equal(review.entryChecks.find(row => row.id === "CALENDAR")?.state, "UNKNOWN");
});
