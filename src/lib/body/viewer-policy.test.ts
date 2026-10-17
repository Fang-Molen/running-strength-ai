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
