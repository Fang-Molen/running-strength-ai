import test from "node:test";
import assert from "node:assert/strict";
import { cycleFixture } from "./fixtures";
import { buildAthletePortrait } from "./portrait";
import { metric } from "../../health/analysis-fixtures";

const hrv = (id: string, day: string, deviceId = "watch-a") => metric({ id, sourceRecordId: id, metric: "HRV_RMSSD", value: 50, unit: "ms", accountRef: "synthetic-account", deviceId, protocolKey: "NIGHT_RMSSD_V1", statistic: "DAILY_MEAN", providerDate: day, isFinal: true, occurredAt: day + "T06:00:00Z", knownAt: day + "T08:00:00Z", receivedAt: day + "T08:00:00Z" });

test("one reference day is descriptive rather than an established personal baseline", () => {
  const input = cycleFixture(); input.snapshot.context.asOf = "2026-10-28T10:00:00Z";
  input.snapshot.facts.push(hrv("prior", "2026-10-27"), hrv("current", "2026-10-28"));
  const portrait = buildAthletePortrait(input) as any;
  const reference = portrait.metricReferences?.find((row: any) => row.current.id === "current");
  assert.ok(reference, "metric evidence coverage missing from the portrait");
  assert.equal(reference.sampleCount, 1);
  assert.equal(reference.coverage, "SINGLE_DAY_DESCRIPTION");
  assert.equal(reference.stability, "NOT_ESTABLISHED");
});

test("a device change creates a separate reference instead of borrowing the former watch baseline", () => {
  const input = cycleFixture(); input.snapshot.context.asOf = "2026-10-28T10:00:00Z";
  input.snapshot.facts.push(hrv("old1", "2026-10-26"), hrv("old2", "2026-10-27"), hrv("new", "2026-10-28", "watch-b"));
  const portrait = buildAthletePortrait(input) as any;
  const reference = portrait.metricReferences?.find((row: any) => row.current.id === "new");
  assert.ok(reference);
  assert.equal(reference.sampleCount, 0);
  assert.equal(reference.coverage, "NO_COMPARABLE_REFERENCE");
  assert.equal(reference.deviceId, "watch-b");
  assert.equal(reference.segmented, true);
});

test("a trained cycle background is not silently assigned to every sport", () => {
  const input = cycleFixture(); input.goal.experience = "TRAINED"; input.goal.targetSeconds = 90;
  delete input.goal.runningExperience; delete input.goal.strengthExperience;
  const portrait = buildAthletePortrait(input) as any;
  assert.deepEqual(portrait.experience, { cycleGoal: "TRAINED", running: "NOT_SEPARATELY_CONFIRMED", strength: "NOT_SEPARATELY_CONFIRMED" });
  assert.equal(portrait.performances.length, 0);
  assert.equal(portrait.goalIsMeasurement, false);
  assert.ok(portrait.unknowns.some((text: string) => /跑步.*力量.*经验/.test(text)));
});
test('C01 separately confirmed running and strength experience stay separate from measured capability',()=>{
 const input=cycleFixture();input.goal.runningExperience='TRAINED';input.goal.strengthExperience='NOVICE';
 const portrait=buildAthletePortrait(input);
 assert.equal(portrait.experience.running,'TRAINED');
 assert.equal(portrait.experience.strength,'NOVICE');
 assert.equal(portrait.performances.length,0);
 assert.ok(!portrait.unknowns.some(text=>/跑步与力量经验尚未分别确认/.test(text)));
});

test('C01 existing strength profile is reused with provenance, never assigned to running',()=>{
 const input=cycleFixture();
 delete input.goal.runningExperience; delete input.goal.strengthExperience;
 input.training.strengthExperience={value:'NOVICE',source:'PERSONAL_COACH',at:'2026-10-24T10:00:00Z',version:'personal:r2'};
 const portrait=buildAthletePortrait(input);
 assert.equal(portrait.experience.strength,'NOVICE');
 assert.equal(portrait.experience.running,'NOT_SEPARATELY_CONFIRMED');
 assert.equal(portrait.experienceSources.strength?.version,'personal:r2');
 input.training.strengthExperience.at='2026-10-26T10:00:00Z';
 assert.equal(buildAthletePortrait(input).experience.strength,'NOT_SEPARATELY_CONFIRMED');
});
