import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalCoachPanel, PersonalPlanReview } from "./personal-coach-panel";
import { buildPersonalPlan, type PersonalDependencies } from "../lib/coach/personal/planner";
import { defaultPersonalProfile } from "../lib/coach/personal/host";
test("personal panel starts with explicit load and makes no persistence or paid call on render", () => {
  const html = renderToStaticMarkup(<PersonalCoachPanel />);
  assert.match(html, /私人教练/);
  assert.match(html, /读取我的目标/);
  assert.doesNotMatch(html, /确认采用/);
  assert.match(html, /饮食/);
  assert.match(html, /力量/);
});
test("a stale adopted plan is rendered as retained history with an unadopted conditional candidate", () => {
  const active = buildPersonalPlan(defaultPersonalProfile("SYN-PANEL"), "2026-10-28T10:00:00Z");
  const dependencies: PersonalDependencies = { schema: 1, athleteId: "SYN-PANEL", scope: "LIVE", domains: { MEALS: { version: "synthetic-current-meals", sources: ["synthetic-meals"] } } };
  const html = renderToStaticMarkup(<PersonalPlanReview review={{ status: "STALE", changed: ["MEALS"], unknown: [], active, candidate: { ...active, version: 2, dependencies } }} />);
  assert.match(html, /原方案保留，待复核/);
  assert.match(html, /餐食已变化/);
  assert.match(html, /条件性刷新候选（未采用）/);
  assert.doesNotMatch(html, /本版本已保存/);
});
test("unreadable dependencies are not rendered as a fresh plan or confirmed facts", () => {
  const active = buildPersonalPlan(defaultPersonalProfile("SYN-PANEL"), "2026-10-28T10:00:00Z");
  const html = renderToStaticMarkup(<PersonalPlanReview review={{ status: "UNKNOWN", changed: [], unknown: ["BODY"], active, candidate: null }} />);
  assert.match(html, /原依据缺失或来源暂不可读取/);
  assert.doesNotMatch(html, /确认采用/);
});
