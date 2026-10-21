import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Public browser module intentionally has no app-side dependency.
import { muscleHighlights, placeRestrictedView, CAMERA_LIMITS } from "../../../public/demo3d/viewer-policy.js";
import MUS from "../../../public/demo3d/muscles.js";

test("a specific soleus key highlights the correct region without incorrectly highlighting every calf muscle", () => {
  const h = muscleHighlights(MUS, ["soleus"], []);
  assert.equal(h[MUS.findIndex(x => x.k === "soleus") + 1], 2);
  assert.equal(h[MUS.findIndex(x => x.k === "gastroc_med") + 1], 0);
});
test("selecting and clearing a group preserves unrelated primary and auxiliary roles", () => {
  const base = muscleHighlights(MUS, ["quads"], ["glutes"]);
  const selected = muscleHighlights(MUS, ["quads"], ["glutes"], "quads");
  for (const [i, m] of MUS.entries()) {
    if (m.g === "quads") assert.equal(selected[i + 1], 3);
    if (m.g === "glutes") assert.equal(selected[i + 1], 1);
  }
  assert.deepEqual(muscleHighlights(MUS, ["quads"], ["glutes"], null), base);
});
test("all camera presets bound yaw and zoom, prohibit a below-target camera, and clear old limits first", () => {
  for (const angle of [0, 90, -90, 180, 45]) {
    const snapshots: Record<string, number>[] = [];
    const c = { target: { copy: (_: unknown) => {} }, enableDamping: true, minAzimuthAngle: 1, maxAzimuthAngle: 2, minDistance: 1, maxDistance: 2,
      minPolarAngle: 0, maxPolarAngle: 100, enablePan: true, autoRotate: true, update: () => { snapshots.push({ min: c.minAzimuthAngle, max: c.maxAzimuthAngle }); } };
    let y = 0; const cam = { position: { set: (_x: number, newY: number, _z: number) => { y = newY; } } };
    placeRestrictedView(c, cam, angle, { x: 0, y: .9, z: 0 }, 4);
    assert.ok(c.maxPolarAngle <= Math.PI / 2); assert.ok(y >= .9);
    assert.ok(Math.abs(c.maxAzimuthAngle - c.minAzimuthAngle - Math.PI / 3) < 1e-8);
    assert.ok(c.minDistance > 0 && c.maxDistance > c.minDistance); assert.equal(c.enablePan, false); assert.equal(c.autoRotate, false);
    assert.ok(snapshots.some(x => x.min === -Infinity && x.max === Infinity));
  }
  assert.equal(CAMERA_LIMITS.maxPolar, 90);
});
test("v89.10.2: anatomy explorer zooms to 0.35× the fitted distance and glides the target to the selection only when close", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../../../public/demo3d/anatomy3d.js", import.meta.url), "utf8");
  assert.match(src, /export const ANATOMY_MIN_ZOOM = \.35;/);
  assert.match(src, /lastFit.distance, ANATOMY_MIN_ZOOM\);/);
  const c = { target: { copy: (_: unknown) => {} }, enableDamping: true, minAzimuthAngle: 0, maxAzimuthAngle: 0, minDistance: 0, maxDistance: 0,
    minPolarAngle: 0, maxPolarAngle: 0, enablePan: true, autoRotate: true, update: () => {} };
  placeRestrictedView(c, { position: { set: () => {} } }, 0, { x: 0, y: .9, z: 0 }, 4, .35);
  assert.ok(Math.abs(c.minDistance - 1.4) < 1e-9); assert.equal(c.maxDistance, 5.2); assert.equal(c.enablePan, false);
  assert.ok(Math.abs(c.maxAzimuthAngle - c.minAzimuthAngle - Math.PI / 3) < 1e-8);
  // focusBlend mirrors anatomy3d.js (that module needs the browser three.js import map).
  const body = src.match(/export function focusBlend\(([^)]*)\) \{([\s\S]*?)\n\}/)!;
  const focusBlend = new Function(...body[1].replace(/ = [^,]+/g, "").split(",").map(s => s.trim()), `const ANATOMY_MIN_ZOOM = .35;${body[2]}`) as (d: number, f: number, r?: number) => number;
  assert.equal(focusBlend(4, 4, .35), 0); assert.equal(focusBlend(4 * .97, 4, .35), 0); assert.equal(focusBlend(1.4, 4, .35), 1);
  const mid = focusBlend(2.64, 4, .35); assert.ok(mid > .4 && mid < .6);
});
