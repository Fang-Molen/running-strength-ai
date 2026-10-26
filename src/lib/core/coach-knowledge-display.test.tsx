import { LearningLibrary } from "../../components/learning-library.tsx";
import { authorizeNetworkAction } from "./coach-network-policy.ts";
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CoachKnowledgePanel } from "../../components/coach-knowledge-panel.tsx"
import { setStoreBackend } from "./storage.ts"

test("knowledge UI separates general sources from athlete facts and writes nothing", () => {
  const writes: string[] = []
  setStoreBackend({ getItem: () => null, setItem: (key) => { writes.push(key) } })
  const html = renderToStaticMarkup(<CoachKnowledgePanel mode="PLAN" />)
  assert.match(html, /一般研究与执教原则/)
  assert.match(html, /研究范围/)
  assert.match(html, /不能证明已经恢复/)
  assert.match(html, /https:\/\/pmc.ncbi.nlm.nih.gov\/articles\/PMC12965823\//)
  assert.match(html, /普通对话和后续恢复反馈尚未统一接入/)
  assert.deepEqual(writes, [])
})

test("review shows energy and sleep knowledge with population and inference limitations", () => {
  const html = renderToStaticMarkup(<CoachKnowledgePanel mode="REVIEW" />)
  assert.match(html, /部分饮食记录不等于全天摄入/)
  assert.match(html, /一晚睡眠不能诊断/)
  assert.match(html, /应用限制/)
  assert.match(html, /noreferrer noopener/)
})


test("learning sources respect existing local and offline network policy", () => {
  for (const setting of [{ mode: "local" as const, online: true }, { mode: "public-knowledge" as const, online: false }]) {
    const allowed = authorizeNetworkAction({ ...setting, action: "open-public-reference" }).allowed;
    const html = renderToStaticMarkup(<LearningLibrary publicReferencesAllowed={allowed} />);
    assert.doesNotMatch(html, /href="https?:/);
    assert.match(html, /详细说明与来源/);
    assert.match(html, /适用范围：/);
    assert.match(html, /id="fk-reader-reading" aria-selected="true"/);
    assert.match(html, /id="fk-reader-references" aria-selected="false"/);
  }
  const html = renderToStaticMarkup(<LearningLibrary publicReferencesAllowed={authorizeNetworkAction({ mode: "public-knowledge", online: true, action: "open-public-reference" }).allowed} />);
  assert.match(html, /href="https?:/);
});
