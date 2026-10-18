/** Exact rig sampling for all new preparation clips; no browser is used. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import * as THREE from '../../public/demo3d/vendor/three.module.min.js';
import MO from '../../public/demo3d/motions.js';
import { makeRig, applyMotionPose, poseAt } from '../../public/demo3d/viewer3d.js';
import { readGlb, parseGlb } from './asset-io.mjs';
const rig = makeRig(await parseGlb(await readGlb('athlete')), { hi: new Array(40).fill(0), border: 0 });
const point = new THREE.Vector3(), report = [];
for (const [key, mo] of Object.entries(MO).filter(([k]) => k.startsWith('warmup_'))) {
  const duration = mo.frames.reduce((s, f) => s + f.dur, 0);
  assert(duration > 0); let minFoot = Infinity, maxFoot = -Infinity;
  for (let sample = 0; sample < 20; sample++) {
    const { pose } = poseAt(mo, sample * duration / 20); applyMotionPose(rig, mo, pose);
    let low = Infinity; const bounds = new THREE.Box3();
    rig.root.traverse(o => { if (!o.isSkinnedMesh) return; for (let i = 0; i < o.geometry.attributes.position.count; i++) { o.getVertexPosition(i, point); point.applyMatrix4(o.matrixWorld); assert([point.x,point.y,point.z].every(Number.isFinite), key); bounds.expandByPoint(point); if (/shoe/i.test(o.name)) low = Math.min(low, point.y); } });
    assert(bounds.min.y > -.06 && bounds.max.y < 2.6, `${key}: invalid world height ${bounds.min.y}/${bounds.max.y}`);
    assert(bounds.max.x - bounds.min.x < 2.3 && bounds.max.z - bounds.min.z < 2.4, `${key}: invalid limb span`);
    assert(Math.abs(low - (pose.hop || 0)) < 1e-5, `${key}: outsole/floor mismatch`);
    minFoot = Math.min(minFoot, low); maxFoot = Math.max(maxFoot, low);
  }
  report.push({ key, samples: 20, duration, minFootY: minFoot, maxFootY: maxFoot });
}
assert.equal(report.length, 11);
const result = { model: 'athlete.glb', clips: report.length, sampledPoses: report.length * 20, finiteBoundedAndFootGrounded: true, method: 'actual GLB morph/skin/pose evaluation, not browser QA or biomechanical approval', report };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
