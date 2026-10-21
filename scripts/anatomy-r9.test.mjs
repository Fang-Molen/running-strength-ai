// @ts-nocheck
// v89.5 R9 肌群模型（肌肉恢复视图）：修复后的压缩资源可解析，39 键与 anatomy-map/肌肉恢复区域一致，足部可着色。
import './demo3d-node-register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { GLTFLoader } = await import('../public/demo3d/vendor/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('../public/demo3d/vendor/meshopt_decoder.module.js');
const { prepareR9Model } = await import('../public/demo3d/anatomy3d.js');
const { matchesMuscle } = await import('../public/demo3d/anatomy-map.js');
const bytes = await readFile(new URL('../public/demo3d/anatomy/fk-muscle-r9.meshopt.glb', import.meta.url));
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const p = prepareR9Model(gltf);
const MESH_KEYS = {quads:['rectus_fem','vastus_lat','vastus_med'],hamstrings:['biceps_fem','semitend'],glutes:['glutes','glute_med'],calves:['gastroc_med','gastroc_lat','soleus'],hip_flexors:['iliopsoas'],adductors:['adductors'],core:['abs','ext_oblique'],lower_back:['erectors'],chest:['pec_upper','pec_lower'],back:['lats','rhomboids','traps'],shoulders:['delt_front','delt_side','delt_rear'],arms:['biceps','triceps_long','triceps_lat'],feet:['foot_intrinsic','plantar_fascia']};
test('pinned compressed R9 asset, under 2.5 MB, 78 regions + feet outline', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'bf99c067e933b0c453855fe2bf7991327a15dbbeb7fb5573974518f036ccfb77');
  assert.ok(bytes.length < 2.5e6);
  assert.equal(p.muscles.filter(o => !o.userData.fk.outline).length, 78);
  assert.equal(new Set(p.muscles.filter(o => !o.userData.fk.outline).map(o => o.userData.fk.k)).size, 39);
  assert.equal(p.muscles.filter(o => o.userData.fk.outline).length, 1);
});
test('every 肌肉恢复 region maps to at least one R9 mesh (so real-log colouring has a target)', () => {
  for (const [region, keys] of Object.entries(MESH_KEYS)) assert.ok(p.muscles.some(o => keys.some(k => matchesMuscle(o.userData.fk, k))), region);
});
test('grounded at y=0, realistic height, blockers opaque and not muscles', () => {
  assert.ok(Math.abs(p.bounds.min.y) < 1e-6); assert.ok(p.bounds.max.y > 1.5 && p.bounds.max.y < 2);
  assert.ok(p.blockers.length >= 5); assert.ok(p.blockers.every(b => !b.material.transparent && !b.userData.fk?.k || b.userData.fkBlocker));
  const foot = p.muscles.find(o => o.userData.fk.outline); foot.geometry.computeBoundingBox();
  assert.ok(foot.geometry.index.count > 300);
});
