import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CyclePhaseEvidence } from "./coach-cycle-panel";
import { buildCycleDraft } from "../lib/coach/cycle/planner";
import { selectionFixture } from "../lib/coach/cycle/selection-fixture";

test("stage evidence visibly separates observed history and unknown future feedback with source versions", () => {
  const review = buildCycleDraft(selectionFixture()).weeks[0].phaseReview;
  const html = renderToStaticMarkup(<CyclePhaseEvidence review={review} />);
  assert.match(html, /阶段条件依据/);
  assert.match(html, /熟悉课程实际完成.*已满足记录条件/);
  assert.match(html, /可比后续反馈.*待核对/);
  assert.match(html, /当周实际执行与复盘.*待核对/);
  assert.match(html, /calendar.*c1/);
  assert.match(html, /interval-repeats@1/);
  assert.match(html, /不代表阶段能力达标/);
});

test("old saved drafts without condition evidence ask for review rather than invent satisfied checks", () => {
  const html = renderToStaticMarkup(<CyclePhaseEvidence review={undefined} />);
  assert.match(html, /旧草案.*重新生成/);
  assert.doesNotMatch(html, /已满足记录条件/);
});
