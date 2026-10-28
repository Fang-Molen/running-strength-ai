import { writeFileSync } from "node:fs";
import { buildCycleDraft } from "../../../src/lib/coach/cycle/planner";
import { selectionFixture } from "../../../src/lib/coach/cycle/selection-fixture";
import { monthFixture, followup } from "../../../evaluation/adaptive/fixture";
import type { TrainingFact } from "../../../src/lib/health/analysis-contract";

const shared = selectionFixture();
const before = JSON.stringify([shared.entries, shared.snapshot.facts]);
const outputs = [400, 800, 1500, 3000, 5000, 10000].map(eventMeters => {
  const input = structuredClone(shared); input.goal.eventMeters = eventMeters;
  const draft = buildCycleDraft(input), first = draft.weeks[0].sessions.find(session => session.candidate)!;
  return { eventMeters, phase: draft.weeks[0].phase, selected: first.sourceEntryIds[0], purpose: first.eventFit?.purpose,
    structure: first.eventFit?.structure, evidenceState: first.eventFit?.evidenceState, transfer: first.eventFit?.status,
    sourceRefs: first.sourceRefs, actualVisibleReason: first.reason, gaps: first.eventFit?.gaps,
    proposedMinutes: first.candidate?.minutes, changedVariable: first.changedVariable,
    futureCanConfirm: draft.weeks.slice(1).some(week => week.canConfirm),
    sourceFactsUnchanged: JSON.stringify([input.entries, input.snapshot.facts]) === before,
  };
});
const supported = buildCycleDraft(shared).weeks[0];
const blocked = structuredClone(shared); blocked.snapshot.safetyConstraints.push({ id: "synthetic-restriction", version: "1", scope: "PAIN", evidenceRefs: [] });
const contrary = monthFixture();
const rows = contrary.snapshot.facts.filter((fact): fact is TrainingFact => fact.kind === "TRAINING" && ["strength-1", "strength-3"].includes(fact.id));
contrary.snapshot.facts.push(...rows.map(row => followup(row, "SORENESS", 4)));
const incomplete = structuredClone(shared);
(incomplete.snapshot.facts.find(fact => fact.id === "interval-repeats") as TrainingFact).runSegments[0].restAfterSeconds = null;
const alternate = buildCycleDraft(incomplete).weeks[0].sessions.find(session => session.candidate)!;
writeFileSync(new URL("./selection-output.json", import.meta.url), JSON.stringify({ syntheticOnly: true, sameFactsAcrossEvents: true,
  policy: "EVENT_RETRIEVAL_1", professionallyValidated: false, newDoseOrPhysiologyFormula: false, outputs,
  incompletePreferredAlternative: { sourceEntryId: alternate.sourceEntryIds[0], reason: alternate.reason, minutes: alternate.candidate?.minutes },
  conditions: { actualsWithUnknownFeedback: supported.phaseReview, visibleSummary: supported.purpose,
    independentRestriction: buildCycleDraft(blocked).weeks[0].phaseReview,
    repeatedContraryFeedback: buildCycleDraft(contrary).weeks[0].phaseReview.entryChecks.find(check => check.id === "RESPONSE") },
}, null, 2) + "\n");
console.log("Same-fact event choices and phase-condition outputs written.");
