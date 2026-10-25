/** Deterministic product replay; no model inference, no professional scoring. */
import { writeFileSync, mkdirSync } from "node:fs";
import { cycleFixture, cycleCases } from "../../src/lib/coach/cycle/fixtures";
import { buildCycleDraft } from "../../src/lib/coach/cycle/planner";
const out = process.argv[2] ?? "evidence/r6-replay";
mkdirSync(out, { recursive: true });
const results = cycleCases.map((c) => {
  const input = cycleFixture(),
    before = buildCycleDraft(input),
    changed = c.change(structuredClone(input)),
    after = buildCycleDraft(changed);
  let passed = true,
    error: string | null = null;
  try {
    c.verify(before, after, changed);
  } catch (e) {
    passed = false;
    error = String(e);
  }
  const view = (d: typeof before) => ({
    family: d.family,
    goal: d.goal,
    hold: d.hold,
    questions: d.questions,
    weeks: d.weeks.map((w) => ({
      start: w.start,
      phase: w.phase,
      canConfirm: w.canConfirm,
      minutes: w.plannedMinutes,
      courses: w.sessions.map((s) => ({
        day: s.date,
        title: s.candidate?.title ?? s.purpose,
        minutes: s.candidate?.minutes ?? null,
        change: s.changedVariable,
        missing: s.missing,
      })),
    })),
  });
  return { name: c.name, passed, error, before: view(before), after: view(after) };
});
writeFileSync(
  out + "/results.json",
  JSON.stringify(
    {
      type: "DETERMINISTIC_ENGINEERING_REPLAY",
      modelCalls: 0,
      professionalValidation: "NOT_PROVEN",
      pass: results.filter((x) => x.passed).length,
      fail: results.filter((x) => !x.passed).length,
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    pass: results.filter((x) => x.passed).length,
    fail: results.filter((x) => !x.passed).length,
  }),
);
process.exitCode = results.some((x) => !x.passed) ? 1 : 0;
