import './demo3d-node-register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const THREE = await import('../public/demo3d/vendor/three.module.min.js');
const { GLTFLoader } = await import('../public/demo3d/vendor/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('../public/demo3d/vendor/meshopt_decoder.module.js');
const { prepareAnatomyModel } = await import('../public/demo3d/anatomy3d.js');
const { muscleRole, matchesMuscle } = await import('../public/demo3d/anatomy-map.js');
const { fitAnatomyBounds } = await import('../public/demo3d/viewer-policy.js');
const bytes = await readFile(new URL('../public/demo3d/anatomy/ecorche.meshopt.glb', import.meta.url));
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const prepared = prepareAnatomyModel(gltf);

test('the pinned source contains genuine separate named muscle meshes, not a coloured skin model', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'cc43a8b4f218bee5da78d6c1746bd21470d1d93c6878e33b4ccdbcfc7a72b98e');
  assert.equal(prepared.muscles.length, 362);
  assert.equal(new Set(prepared.muscles.map(o => o.userData.fk.name)).size, 362);
  for (const name of ['Long head of left biceps femoris', 'Left semitendinosus', 'Left semimembranosus', 'Left soleus', 'Left flexor digitorum brevis']) {
    const mesh = prepared.muscles.find(o => o.userData.fk.name === name);
    assert.ok(mesh, name); assert.ok(mesh.geometry.getAttribute('position').count > 10); assert.ok(mesh.userData.fk.fma);
    assert.equal(mesh.isSkinnedMesh, undefined);
  }
  assert.equal(prepared.muscles.filter(o => o.userData.fk.k === 'foot_intrinsic').length >= 20, true);
});
test('the study model stands on y=0 without posing its feet, and quantized skeleton merging retains real dimensions', () => {
  assert.ok(Math.abs(prepared.bounds.min.y) < 1e-8);
  assert.ok(prepared.bounds.max.y > 1.5 && prepared.bounds.max.y < 2);
  assert.equal(prepared.skeleton.geometry.getAttribute('position').array.constructor.name, 'Float32Array');
  prepared.skeleton.geometry.computeBoundingBox();
  assert.ok(prepared.skeleton.geometry.boundingBox.max.y > 1.5);
  assert.ok(prepared.foci.foot.max.y < .23); assert.ok(prepared.foci.foot.min.y >= -1e-8);
  assert.ok(prepared.foci.calf.max.y > prepared.foci.foot.max.y);
  assert.equal(prepared.cover.material.transparent, false); assert.equal(prepared.cover.material.depthWrite, true);
  assert.equal(prepared.cover.userData.fkCover, true);
});
test('separate source muscle geometry supports direct ray intersections without a UV region lookup', () => {
  const mesh = prepared.muscles.find(o => o.userData.fk.name === 'Long head of left biceps femoris');
  prepared.root.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  const points = [0, 1, 2].map(i => new THREE.Vector3().fromBufferAttribute(pos, index.getX(i)).applyMatrix4(mesh.matrixWorld));
  const center = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3);
  const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
  const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, .02), normal.clone().negate());
  assert.ok(ray.intersectObject(mesh, false).length > 0);
});
test('the camera fit includes head and feet at all permitted angles and several phone aspect ratios', () => {
  for (const box of [prepared.bounds, prepared.foci.foot, prepared.foci.calf]) for (const aspect of [375 / 300, 430 / 480, 844 / 300]) for (const angle of [0, 90, -90, 180]) {
    const fit = fitAnatomyBounds(box.min.toArray(), box.max.toArray(), aspect, 30, angle);
    const target = new THREE.Vector3(...fit.center), cam = new THREE.PerspectiveCamera(30, aspect, .02, 30);
    for (const delta of [-30, -15, 0, 15, 30]) for (const elevation of [0, 14, 28]) {
      const yaw = (angle + delta) * Math.PI / 180, e = elevation * Math.PI / 180, distance = fit.distance * .97;
      cam.position.set(target.x + Math.sin(yaw) * Math.cos(e) * distance, target.y + Math.sin(e) * distance, target.z + Math.cos(yaw) * Math.cos(e) * distance);
      cam.lookAt(target); cam.updateMatrixWorld(true);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(cam);
        assert.ok(Math.abs(p.x) < .94 && Math.abs(p.y) < .94, JSON.stringify({ aspect, angle, delta, elevation, p }));
      }
    }
  }
});
test('muscle role aliases keep hamstrings and precise soleus distinct, including selections on a left/right mesh', () => {
  const hamstrings = prepared.muscles.filter(o => muscleRole(o.userData.fk, ['hamstrings']) === 'main');
  assert.equal(hamstrings.length, 8);
  assert.equal(prepared.muscles.filter(o => matchesMuscle(o.userData.fk, 'soleus')).length, 2);
  assert.ok(hamstrings.every(o => !matchesMuscle(o.userData.fk, 'quads')));
  const medialTriceps = prepared.muscles.find(o => /Medial head of left triceps/.test(o.userData.fk.name));
  assert.equal(matchesMuscle(medialTriceps.userData.fk, 'triceps_lat'), false);
});
test('the anatomy shader binds real material uniforms and substitutes an existing Three.js shader chunk', () => {
  const material = prepared.muscles[0].material;
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('uniform vec3 fkTint;'));
  assert.ok(shader.fragmentShader.includes('float tendon ='));
  assert.equal(shader.uniforms.fkAmount, material.userData.amount);
  // CPU contract check only; this intentionally makes no WebGL compilation claim.
});
