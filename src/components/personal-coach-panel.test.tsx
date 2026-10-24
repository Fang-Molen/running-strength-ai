import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalCoachPanel } from "./personal-coach-panel";
test("personal panel starts with explicit load and makes no persistence or paid call on render", () => {
  const html = renderToStaticMarkup(<PersonalCoachPanel />);
  assert.match(html, /私人教练/);
  assert.match(html, /读取我的目标/);
  assert.doesNotMatch(html, /确认采用/);
  assert.match(html, /饮食/);
  assert.match(html, /力量/);
});
