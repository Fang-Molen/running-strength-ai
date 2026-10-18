// Exact model geometry export for an offline CPU render; not an app screenshot.
import '../../scripts/demo3d-node-register.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const THREE = await import('../../public/demo3d/vendor/three.module.min.js');
const { GLTFLoader } = await import('../../public/demo3d/vendor/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('../../public/demo3d/vendor/meshopt_decoder.module.js');
const { prepareAnatomyModel } = await import('../../public/demo3d/anatomy3d.js');
const { muscleRole } = await import('../../public/demo3d/anatomy-map.js');
const { fitAnatomyBounds } = await import('../../public/demo3d/viewer-policy.js');
const output = resolve(process.argv[2] || '../v70-qa'); await mkdir(output, { recursive: true });
const bytes = await readFile(new URL('../../public/demo3d/anatomy/ecorche.meshopt.glb', import.meta.url));
const model = prepareAnatomyModel(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
model.root.updateMatrixWorld(true);
const meshes = [...model.muscles.filter(o => o.userData.fk.layer === 'superficial muscles'), model.skeleton, model.cover];
let vertices = 0, triangles = 0;
for (const o of meshes) { vertices += o.geometry.getAttribute('position').count; triangles += o.geometry.index.count / 3; }
const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3), indices = new Uint32Array(triangles * 3);
const v = new THREE.Vector3(), n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
let vi = 0, ii = 0;
for (const o of meshes) {
  const g = o.geometry, p = g.getAttribute('position'), no = g.getAttribute('normal'), co = g.getAttribute('color');
  normalMatrix.getNormalMatrix(o.matrixWorld);
  const role = o.userData.fk ? muscleRole(o.userData.fk, ['hamstrings'], ['calves']) : 'none';
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); positions.set(v.toArray(), (vi + i) * 3);
    n.fromBufferAttribute(no, i).applyMatrix3(normalMatrix).normalize(); normals.set(n.toArray(), (vi + i) * 3);
    let color = [.52, .56, .61];
    if (co && o.userData.fk) {
      const rgb = [co.getX(i), co.getY(i), co.getZ(i)], hi = Math.max(...rgb), lo = Math.min(...rgb);
      const x = THREE.MathUtils.clamp((hi - lo - .08) / .12, 0, 1), tendon = 1 - x * x * (3 - 2 * x), shade = THREE.MathUtils.clamp(hi * 1.3, .4, 1);
      color = [.42 + .36 * tendon, .46 + .34 * tendon, .52 + .30 * tendon].map(c => c * shade);
      if (role !== 'none') {
        const tint = new THREE.Color(role === 'main' ? '#f17650' : '#f3b997').toArray();
        const amount = (role === 'main' ? .88 : .65) * (1 - .25 * tendon);
        color = color.map((c, j) => c * (1 - amount) + tint[j] * shade * amount);
      }
    }
    if (o === model.skeleton) color = [.46, .49, .49];
    if (o === model.cover) color = [.026, .035, .046];
    colors.set(color, (vi + i) * 3);
  }
  for (let i = 0; i < g.index.count; i++) indices[ii++] = vi + g.index.getX(i);
  vi += p.count;
}
for (const [name, a] of Object.entries({ positions, normals, colors, indices })) await writeFile(resolve(output, name + '.bin'), new Uint8Array(a.buffer));
const views = [{ name: 'front', angle: 0, focus: 'body' }, { name: 'back', angle: 180, focus: 'body' }, { name: 'foot', angle: 40, focus: 'foot' }].map(view => {
  const box = model.foci[view.focus], fit = fitAnatomyBounds(box.min.toArray(), box.max.toArray(), 480 / 620, 30, view.angle);
  return { ...view, ...fit };
});
await writeFile(resolve(output, 'geometry.json'), JSON.stringify({ vertices, triangles, views, origin: 'Exact v70 anatomical GLB; offline CPU rendering, not WebGL/browser acceptance.' }, null, 2));
console.log(JSON.stringify({ output, vertices, triangles, views }));
