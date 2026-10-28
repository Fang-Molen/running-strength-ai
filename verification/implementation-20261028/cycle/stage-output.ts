import { writeFileSync } from "node:fs";
import { buildCycleDraft } from "../../../src/lib/coach/cycle/planner";
import { cycleFixture } from "../../../src/lib/coach/cycle/fixtures";
const output = [400, 800, 1500, 3000, 5000, 10000, 21097].map(meters => {
  const input = cycleFixture(); input.goal.eventMeters = meters; input.goal.horizonWeeks = 8;
  const draft = buildCycleDraft(input);
  return { eventMeters: meters, eventFocus: draft.eventFocus, displayedWeekSummary: draft.weeks[0].purpose,
    futureWeekSummary: draft.weeks[1].purpose, phaseReview: draft.weeks[0].phaseReview,
    unknowns: draft.unknowns, futureCanConfirm: draft.weeks.slice(1).some(week => week.canConfirm),
    sourceFactsUnchanged: JSON.stringify(input.snapshot.facts) === JSON.stringify(cycleFixture().snapshot.facts),
  };
});
writeFileSync(new URL("./stage-output.json", import.meta.url), JSON.stringify({ synthetic: true, doseRulesChanged: false, outputs: output }, null, 2) + "\n");
console.log("Synthetic per-event displayed summaries written.");
