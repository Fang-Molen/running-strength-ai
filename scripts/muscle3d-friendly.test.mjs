// R1 friendly-appearance contract for the anatomy study model (CPU only, no WebGL).
import './demo3d-node-register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const THREE = await import('../public/demo3d/vendor/three.module.min.js');
const { GLTFLoader } = await import('../public/demo3d/vendor/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('../public/demo3d/vendor/meshopt_decoder.module.js');
const { prepareAnatomyModel, isHeadSkeleton, isFaceMuscle } = await import('../public/demo3d/anatomy3d.js');
const { anatomyMeta, matchesMuscle } = await import('../public/demo3d/anatomy-map.js');
const bytes = await readFile(new URL('../public/demo3d/anatomy/ecorche.meshopt.glb', import.meta.url));
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const P = prepareAnatomyModel(gltf); P.root.updateMatrixWorld(true);
const H = P.bounds.max.y;
const source = []; gltf.scene.traverse(o => { if (o.isMesh) source.push(o); });

// Same rule as pickAt(): nearest visible hit among muscles + blockers; only muscles are picks.
const selectable = () => [...P.muscles, P.skeleton, P.head, P.cover].filter(o => o.visible);
function firstHit(origin, dir) {
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
  return ray.intersectObjects(selectable(), false)[0]?.object || null;
}

test('skull, teeth, eyes, nose/ear cartilage are excluded before the supporting skeleton is merged', () => {
  const head = source.filter(o => !anatomyMeta(o.userData) && isHeadSkeleton(o.userData));
  const names = head.map(o => o.userData.name);
  for (const n of ['Frontal bone', 'Mandible', 'Left maxilla', 'Occipital bone', 'Left sclera', 'External ear']) assert.ok(names.includes(n), n);
  assert.equal(head.filter(o => o.userData.tissue === 'tooth').length, 28);
  const kept = source.filter(o => !anatomyMeta(o.userData) && !isHeadSkeleton(o.userData));
  for (const n of ['Atlas', 'Axis', 'Left clavicle', 'Left hip bone', 'Left femur', 'Left calcaneus']) assert.ok(kept.some(o => o.userData.name === n), n);
  const expected = kept.reduce((sum, o) => sum + o.geometry.getAttribute('position').count, 0);
  assert.equal(P.skeleton.geometry.getAttribute('position').count, expected);
});

test('facial expression muscles are hidden and unpickable, but all 362 muscle meshes and catalogue muscles remain', () => {
  assert.equal(P.muscles.length, 362);
  const face = P.muscles.filter(o => o.userData.fk.hiddenHead);
  assert.ok(face.length >= 20 && face.every(o => isFaceMuscle(o.userData) && !o.visible));
  // No catalogue (exercise-mapped) muscle is hidden.
  assert.ok(face.every(o => o.userData.fk.g === null));
  for (const k of ['trap_upper', 'pec_upper', 'delt_front', 'lats', 'abs', 'glutes', 'quads', 'hamstrings', 'calves', 'feet', 'erectors'])
    assert.ok(P.muscles.some(o => !o.userData.fk.hiddenHead && matchesMuscle(o.userData.fk, k)), k);
});

test('a neutral, opaque head encloses the removed skull and blocks picks from front, sides and back', () => {
  const box = new THREE.Box3().setFromObject(P.head), c = box.getCenter(new THREE.Vector3());
  assert.equal(P.head.userData.fkHead, true); assert.equal(P.head.material.transparent, false);
  assert.ok(box.max.y > H * .985 && box.min.y < H * .9, JSON.stringify(box));
  assert.ok(P.head.geometry.getAttribute('position').count / 3 < 3000, 'low-detail: under 3k triangles');
  for (const [o, d] of [[[0, c.y, 2], [0, 0, -1]], [[0, c.y, -2], [0, 0, 1]], [[2, c.y, c.z], [-1, 0, 0]], [[-2, c.y, c.z], [1, 0, 0]]])
    assert.equal(firstHit(o, d), P.head, JSON.stringify(o));
});

test('the crotch panel is no longer a protruding sphere and is coloured like the integrated shorts', () => {
  const box = new THREE.Box3().setFromObject(P.cover);
  assert.ok(box.max.z < .06, 'front no longer bulges: ' + box.max.z);   // old sphere: +0.123
  assert.ok(box.max.x - box.min.x < .08);
  assert.equal(P.cover.material.transparent, false); assert.equal(P.cover.material.depthWrite, true);
  assert.equal(P.cover.material.color.getHexString(), P.shorts.fkShortsColor.value.getHexString());
  const [bottom, outer, top, on] = P.shorts.fkShorts.value.toArray();
  assert.equal(on, 1); assert.ok(bottom < outer && outer < top);
  // Leg opening leaves most of the thigh exposed: quads/hamstrings span ~0.23H..0.56H.
  assert.ok(bottom > H * .44 && top < H * .6);
  // Front ray through the pubic gap is stopped by an opaque blocker, never a far-side muscle.
  const hit = firstHit([0, H * .47, 2], [0, 0, -1]);
  const nearSide = (o, front) => o === P.cover || o === P.skeleton || (o?.userData.fk && ['adductors', 'glutes', 'hamstrings', 'quads', 'hip_flexors'].includes(o.userData.fk.g)
    && new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z * (front ? 1 : -1) > -0.06);
  assert.ok(nearSide(hit, true), String(hit?.name));
  for (const dy of [-.02, 0, .02]) {
    const back = firstHit([0, H * (.47 + dy), -2], [0, 0, 1]);
    assert.ok(nearSide(back, false), String(back?.name));
  }
});

test('major muscles are still pickable under the shorts paint and on the thighs', () => {
  const pick = (o, d) => firstHit(o, d)?.userData.fk || null;
  const cx = side => { const m = P.muscles.find(o => o.userData.fk.name === `${side} rectus femoris`); return new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()); };
  const rf = cx('Left');
  assert.equal(pick([rf.x, rf.y, 2], [0, 0, -1])?.g, 'quads');
  const gl = new THREE.Box3().setFromObject(P.muscles.find(o => o.userData.fk.name === 'Left gluteus maximus')).getCenter(new THREE.Vector3());
  assert.equal(pick([gl.x, gl.y, -2], [0, 0, 1])?.k, 'glutes');
  const bf = new THREE.Box3().setFromObject(P.muscles.find(o => o.userData.fk.name === 'Long head of left biceps femoris')).getCenter(new THREE.Vector3());
  assert.equal(pick([bf.x, bf.y, -2], [0, 0, 1])?.g, 'hamstrings');
});

test('materials are matte with no metallic sheen; the shorts shader keeps selection uniforms', () => {
  const m = P.muscles[0].material;
  assert.ok(m.roughness >= .85 && m.metalness === 0);
  assert.ok(P.skeleton.material.roughness >= .85 && !P.skeleton.material.vertexColors);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  m.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('fkInShorts()') && shader.fragmentShader.includes('uniform vec3 fkTint;'));
  assert.ok(shader.vertexShader.includes('vFkPos = (modelMatrix'));
  assert.equal(shader.uniforms.fkShorts, P.shorts.fkShorts);
  assert.equal(shader.uniforms.fkAmount, m.userData.amount);
  const bone = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  P.skeleton.material.onBeforeCompile(bone); assert.ok(bone.fragmentShader.includes('fkInShorts()'));
});

test('front abdomen tap reaches rectus abdominis under the external-oblique aponeurosis, and selecting it uncovers it', async () => {
  const { coveringGroups } = await import('../public/demo3d/anatomy-map.js');
  assert.deepEqual(coveringGroups('abs'), ['ext_oblique']);
  const absMesh = P.muscles.find(o => o.userData.fk.name === 'Left rectus abdominis');
  const c = new THREE.Box3().setFromObject(absMesh).getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(new THREE.Vector3(c.x, c.y, 2), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObjects(selectable(), false);
  assert.equal(hits[0].object.userData.fk.k, 'ext_oblique');   // the source aponeurosis lies on top
  const abs = hits.find(h => h.object.userData.fk?.k === 'abs');
  assert.ok(abs && abs.distance - hits[0].distance < .02, 'rectus within 2 cm under the aponeurosis (pickAt rule)');
});
