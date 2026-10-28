/** Reproducible local synthetic output examples; no account, database, or network. */
import { mock } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { personalStore, personalAnswer, defaultPersonalProfile } from "../../../src/lib/coach/personal/host";
import { setEventContext } from "../../../src/lib/core/events";
import { setStoreBackend } from "../../../src/lib/core/storage";
import { upsertCheck } from "../../../src/lib/nutrition/body";
import { recordManualFood, updateEntry } from "../../../src/lib/nutrition/log";
import { emptyProfile, saveProfile } from "../../../src/lib/strength/profile";
import { buildAthletePortrait } from "../../../src/lib/coach/cycle/portrait";
import { cycleFixture } from "../../../src/lib/coach/cycle/fixtures";
import { metric } from "../../../src/lib/health/analysis-fixtures";

const map = new Map<string, string>();
const box = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, keys: () => [...map.keys()] };
Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: box }) });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: box });
setStoreBackend(box); setEventContext({ athleteId: "SYN-PERSONAL" });
mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-27T08:00:00Z") });
const store = personalStore();
store.saveProfile({ ...defaultPersonalProfile("SYN-PERSONAL"), services: ["NUTRITION"], goal: "FAT_LOSS", age: 30, sex: "female", weightKg: 70, heightCm: 165, activity: "LOW", screen: "CLEAR", days: [1, 4] });
const proposal = store.prepare()!, adopted = store.confirm(proposal.token, "CONFIRM_PERSONAL_PLAN");
const original = JSON.stringify(adopted), before = personalAnswer("我的饮食方案", new Date().toISOString());
mock.timers.setTime(new Date("2026-10-28T10:00:00Z").getTime());
upsertCheck({ date: "2026-10-28", weight: 80 });
const weightReview = store.reviewActive(), afterWeight = personalAnswer("我的饮食方案", new Date().toISOString());
const food = recordManualFood({ date: "2026-10-28", meal: "午餐", name: "合成餐食", kcal: 600, grams: 200 })!;
updateEntry(food.id, { kcal: 300, grams: 100 }, food.revisionId);
const afterMeal = personalAnswer("我的饮食方案", new Date().toISOString());
const pending = store.prepare()!; store.reject(pending.token);
const rejected = { adoptedUnchanged: JSON.stringify(store.read().active) === original, pendingProposal: store.read().proposal };
saveProfile({ ...emptyProfile(), aim: "gain", targetKg: "85" });
const goalConflict = personalAnswer("我的饮食方案", new Date().toISOString());
const input = cycleFixture(); input.snapshot.context.asOf = new Date().toISOString();
input.snapshot.facts.push(...["2026-10-27", "2026-10-28"].map(day => metric({ id: day, sourceRecordId: day, metric: "HRV_RMSSD", value: 50, unit: "ms", accountRef: "synthetic", deviceId: "watch-a", protocolKey: "NIGHT_RMSSD_V1", statistic: "DAILY_MEAN", providerDate: day, isFinal: true, occurredAt: day + "T06:00:00Z", knownAt: day + "T08:00:00Z", receivedAt: day + "T08:00:00Z" })));
const portrait = buildAthletePortrait(input);
const red = readFileSync(new URL("./red.log", import.meta.url), "utf8");
const baselineActual = red.match(/  actual: \|-\n([\s\S]*?)\n  operator:/)?.[1].split("\n").map(line => line.replace(/^    /, "")).join("\n");
writeFileSync(new URL("./examples.json", import.meta.url), JSON.stringify({
  syntheticOnly: true,
  baselineAfterMeasuredWeightChange: { source: "red.log:first failure actual output", output: baselineActual },
  adoptedBeforeDataChange: before,
  measuredWeight70To80: { status: weightReview.status, changed: weightReview.changed, output: afterWeight, adoptedEnergyKcal: adopted.nutrition?.energyKcal, candidateEnergyKcal: weightReview.candidate?.nutrition?.energyKcal },
  mealCorrection600To300: { output: afterMeal, expectedKnownSubtotal: 300, dailyCompleteness: "UNKNOWN", inferredDailyDeficit: null },
  rejected,
  gainGoalConflict: goalConflict,
  oneDayPortrait: { experience: portrait.experience, references: portrait.metricReferences, unknowns: portrait.unknowns },
}, null, 2) + "\n");
mock.timers.reset(); setStoreBackend(null); setEventContext({ athleteId: "local" });
console.log("Synthetic examples written to personal/examples.json");
