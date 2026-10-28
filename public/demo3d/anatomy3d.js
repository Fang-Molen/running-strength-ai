// Independent anatomical meshes, CC BY-SA 4.0. See anatomy/ATTRIBUTION.md.
// Study model only: it has no rig, and is never substituted for action animation.
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { mergeGeometries, mergeVertices } from './vendor/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { placeRestrictedView, fitAnatomyBounds } from './viewer-policy.js';
import { anatomyMeta, muscleRole, matchesMuscle, coveringGroups, keyZh } from './anatomy-map.js';

// v89.10.2: closest zoom = 0.35 × the fitted whole-body distance (was 0.97, i.e. almost no zoom).
export const ANATOMY_MIN_ZOOM = .35;
/** 0 at the fitted distance, 1 at the closest zoom: how far the orbit target slides from the
 * body centre toward the selected muscle, so a close zoom stays on that muscle (no free pan). */
export function focusBlend(distance, fitDistance, minRatio = ANATOMY_MIN_ZOOM) {
  const near = fitDistance * minRatio, far = fitDistance * .97;
  return far <= near ? 0 : Math.min(1, Math.max(0, (far - distance) / (far - near)));
}

const VIEWS = { front: 0, left: 90, right: -90, back: 180 };
// v89.5: 'r9' = 1021c R9 friendly muscle shell (Écorché/BodyParts3D/Z-Anatomy derivative, CC BY-SA 4.0),
// repaired + meshopt-compressed (1.9 MB vs 6.0 MB). Used by the 肌肉恢复 view; exercise cards keep Écorché.
const ASSETS = { ecorche: './anatomy/ecorche.meshopt.glb', r9: './anatomy/fk-muscle-r9.meshopt.glb' };
const modelTasks = {};
export function loadAnatomyModel(asset = 'ecorche') {
  const id = asset in ASSETS ? asset : 'ecorche';
  if (!modelTasks[id]) modelTasks[id] = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(new URL(ASSETS[id], import.meta.url).href)
    .catch(error => { modelTasks[id] = null; throw error; });
  return modelTasks[id];
}

// R1 friendly palette: low-saturation matte warm grey with low tendon contrast.
// Selection/role tints are unchanged in meaning; only the neutral base is softer.
const PALETTE = { muscle: '#b3b4b1', tendon: '#c6c5c0', bone: '#8e8e8a', head: '#bebdb8', shorts: '#4a5058' };
// v89.11.10 `look: 'natural'` (opt-in, used only by the 按部位选动作 sheet): soft warm-neutral muscle,
// near-flat tendon/bone contrast, dark clean sports shorts, painted face + short hair on the head shell.
// The muscle meshes, ids, names and picking are identical to the default look.
const NATURAL = { muscle: '#cdb2a3', tendon: '#d9c6b8', bone: '#bda99b', head: '#e6c2ac', shorts: '#363b44' };
const THEME_STAGE = {
  dark: { bg: '#23262b', floor: '#2f343a', hemiSky: 0xfff1e6, hemiGround: 0x454a52, hemi: 1.55, key: 1.75, fill: .55, rim: .7, exposure: .98 },
  light: { bg: '#e4e6ec', floor: '#d3d7df', hemiSky: 0xffffff, hemiGround: 0x9aa0ab, hemi: 1.7, key: 1.6, fill: .5, rim: .5, exposure: .92 }
};

/** Paints the pelvic region as integrated, opaque sports shorts in the shader, so
 * the glute/hip/thigh meshes underneath stay individually pickable and can still
 * be highlighted (a highlight is mixed on top of the shorts colour). */
function shortsUniforms(palette = PALETTE) {
  return { fkShorts: { value: new THREE.Vector4(0, 0, 0, 0) }, fkShortsX: { value: 0 }, fkShortsColor: { value: new THREE.Color(palette.shorts) }, fkLeg: { value: 0 } };
}
const SHORTS_GLSL = `uniform vec4 fkShorts; uniform float fkShortsX; uniform vec3 fkShortsColor; uniform float fkLeg; varying vec3 vFkPos;
float fkInShorts() {
  float ax = abs(vFkPos.x);
  float leg = mix(fkShorts.x, fkShorts.y, smoothstep(0.02, 0.15, ax));
  return smoothstep(leg - 0.002, leg + 0.002, vFkPos.y) * (1.0 - smoothstep(fkShorts.z - 0.002, fkShorts.z + 0.002, vFkPos.y))
    * (1.0 - smoothstep(fkShortsX - 0.004, fkShortsX, ax)) * fkShorts.w;
}`;
function injectShorts(shader, shorts) {
  Object.assign(shader.uniforms, shorts);
  if (shader.vertexShader) shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFkPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvFkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SHORTS_GLSL);
}

// Natural look: inside the shorts area the muscle/bone relief underneath is shaded with a smooth
// waist/leg-tube normal, so the garment reads as one clean surface (colour only; geometry untouched).
const SHORTS_NORMAL_GLSL = `{ float pantsN = fkInShorts();
  if (pantsN > 0.001) {
    float h = max(fkLeg, 0.001); float legBlend = 1.0 - smoothstep(0.50*h, 0.55*h, vFkPos.y);
    float cx = sign(vFkPos.x) * min(abs(vFkPos.x), 0.055*h) * legBlend;
    vec2 r = vec2(vFkPos.x - cx, (vFkPos.z + 0.012*h) * 1.25);
    vec3 nw = normalize(vec3(r.x, 0.12, r.y) + vec3(0.0001));
    vec3 nv = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
    normal = normalize(mix(normal, nv, 0.9 * pantsN));
  } }`;
const fkToken = (name, fallback) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; } };

function muscleMaterial(shorts = shortsUniforms(), palette = PALETTE, natural = false) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: natural ? .82 : .9, metalness: 0, side: THREE.DoubleSide });
  const tint = { value: new THREE.Color(fkToken('--fk-brand-orange', '#ff6a1a')) }, amount = { value: 0 }, dim = { value: 1 };
  const base = { value: new THREE.Color(palette.muscle) }, tendonColor = { value: new THREE.Color(palette.tendon) };
  material.userData.tint = tint; material.userData.amount = amount; material.userData.dim = dim;
  material.onBeforeCompile = shader => {
    injectShorts(shader, shorts);
    shader.uniforms.fkTint = tint; shader.uniforms.fkAmount = amount; shader.uniforms.fkBase = base; shader.uniforms.fkTendonColor = tendonColor; shader.uniforms.fkDim = dim;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 fkTint; uniform float fkAmount; uniform vec3 fkBase; uniform vec3 fkTendonColor; uniform float fkDim;')
      .replace('#include <color_fragment>', natural ? `#include <color_fragment>
      { float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float tendon = (1.0-smoothstep(0.08,0.20,hi-lo)) * 0.7;
        float shade = mix(0.85, 1.0, clamp(hi*1.3, 0.0, 1.0));
        float pants = fkInShorts();
        vec3 skin = mix(fkBase, fkTendonColor, tendon) * shade * fkDim;
        diffuseColor.rgb = mix(skin, fkShortsColor, pants);
        diffuseColor.rgb = mix(diffuseColor.rgb, fkTint*mix(shade, 1.0, pants), fkAmount*(1.0-0.15*tendon*(1.0-pants))); }
      ` : `#include <color_fragment>
      { float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float tendon = 1.0-smoothstep(0.08,0.20,hi-lo);
        float shade = mix(0.82, 1.0, clamp(hi*1.3, 0.0, 1.0));
        float pants = fkInShorts();
        diffuseColor.rgb = mix(mix(fkBase, fkTendonColor, tendon) * shade, fkShortsColor, pants);
        diffuseColor.rgb = mix(diffuseColor.rgb, fkTint*mix(shade, 1.0, pants), fkAmount*(1.0-0.25*tendon*(1.0-pants))); }
      `);
    // Natural look: the shorts read as one clean garment. Inside the shorts area the muscle
    // relief underneath is shaded with a smooth waist/leg-tube normal (colour paint only; geometry,
    // ids and picking are untouched).
    if (natural) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SHORTS_NORMAL_GLSL);
  };
  material.customProgramCacheKey = () => natural ? 'fangkun-anatomy-natural-r1' : 'fangkun-anatomy-r1';
  return material;
}

function skeletonMaterial(shorts, palette = PALETTE) {
  const material = new THREE.MeshStandardMaterial({ color: palette.bone, roughness: .95, metalness: 0 });
  material.onBeforeCompile = shader => {
    injectShorts(shader, shorts);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, fkShortsColor, fkInShorts());');
    if (palette !== PALETTE) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SHORTS_NORMAL_GLSL);
  };
  material.customProgramCacheKey = () => palette === PALETTE ? 'fangkun-anatomy-bone-r1' : 'fangkun-anatomy-bone-natural-r1';
  return material;
}

// Cranial/facial skeleton, teeth, eyes, nose/ear cartilage and facial expression
// muscles are replaced by one smooth neutral head. They are filtered out BEFORE
// the supporting skeleton is merged, because a merged mesh cannot be hidden per part.
const SKULL = /\b(frontal bone|parietal bone|occipital bone|temporal bone|sphenoid|ethmoid|nasal bone|nasal concha|nasal cartilage|alar cartilage|lacrimal|zygomatic bone|maxilla|mandible|palatine|vomer|external ear|sclera|cornea)\b/i;
const FACE_MUSCLE = /(corrugator|masseter|pterygoid|depressor anguli|depressor labii|frontalis|levator labii|mentalis|nasalis|orbicularis o(ris|culi)|procerus|risorius|temporalis|zygomaticus)/i;
export const isHeadSkeleton = data => /tooth|eye/.test(data.tissue || '') || SKULL.test(data.name || '');
export const isFaceMuscle = data => FACE_MUSCLE.test(data.name || '');

/** Low-detail, featureless head: a rounded cranium with a softly narrower jaw,
 * a tapered neck core, and no eyes, nose, mouth, teeth or skull detail. */
function neutralHeadGeometry(box) {
  const geometry = new THREE.SphereGeometry(1, 40, 28), position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const low = Math.max(0, -y), jaw = 1 - .28 * low * low;
    // The chin sits slightly forward of the cranium, as in a natural profile.
    position.setXYZ(i, x * jaw, y, z * jaw * (z < 0 ? 1 - .12 * low : 1) + .1 * low);
  }
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  geometry.scale(size.x * .47, size.y * .47, size.z * .44); geometry.translate(center.x, center.y, center.z - size.z * .07);
  // The neck core starts inside the head so no rim is visible; neck muscles stay outside it.
  const neckTop = center.y, neckBottom = box.min.y - size.y * .38, neck = new THREE.CylinderGeometry(1, 1.12, 1, 24, 1, true);
  neck.scale(size.x * .26, neckTop - neckBottom, size.z * .21); neck.translate(center.x, (neckTop + neckBottom) / 2, center.z - size.z * .12);
  const merged = mergeGeometries([geometry.toNonIndexed(), neck.toNonIndexed()]);
  geometry.dispose(); neck.dispose(); merged.computeVertexNormals();
  return merged;
}

/** v89.11.10 natural head (look: 'natural'): same footprint as the neutral head (a non-selectable
 * blocker, so no new picking surface), now with a gently modelled nose/brow/chin, two small ears and a
 * short-hair volume. Eyes, brows, mouth and the hair colour are painted in the fragment shader from the
 * per-vertex unit direction `fkDir` (front = +z) and the signed hairline field `fkHair`. */
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const hairlineY = aa => .45 - .4 * smooth01(.4, 1.45, aa) - .38 * smooth01(1.8, 2.8, aa);
function naturalHeadGeometry(box) {
  const head = new THREE.SphereGeometry(1, 72, 52); head.deleteAttribute('uv'); head.deleteAttribute('normal');
  const position = head.getAttribute('position'), count = position.count, dir = new Float32Array(count * 3), hair = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i), aa = Math.abs(Math.atan2(x, z));
    dir[i * 3] = x; dir[i * 3 + 1] = y; dir[i * 3 + 2] = z;
    const field = y - hairlineY(aa) + .012 * Math.sin(aa * 23) * smooth01(.3, 1, aa); hair[i] = field;
    const hm = smooth01(-.02, .08, field), front = z > 0 ? 1 : 0;
    const nose = front * Math.exp(-((x / .11) ** 2 + ((y + .26) / .26) ** 2)) * smooth01(.1, .5, z);
    const brow = front * .022 * Math.exp(-(((y - .17) / .07) ** 2)) * smooth01(.3, .7, z);
    const crown = .03 * smooth01(.55, 1, y) * hm;
    const r = 1 + .065 * hm + crown + .12 * nose + brow;
    const low = Math.max(0, -y), jaw = 1 - .28 * low * low;
    position.setXYZ(i, x * r * jaw, y * r, z * r * jaw * (z < 0 ? 1 - .12 * low : 1) + .1 * low);
  }
  head.setAttribute('fkDir', new THREE.BufferAttribute(dir, 3)); head.setAttribute('fkHair', new THREE.BufferAttribute(hair, 1));
  const parts = [head];
  for (const side of [-1, 1]) {
    const ear = new THREE.SphereGeometry(1, 20, 14); ear.deleteAttribute('uv'); ear.deleteAttribute('normal');
    ear.scale(.07, .2, .11); ear.translate(side * .975, -.06, -.02);
    const n = ear.getAttribute('position').count, d = new Float32Array(n * 3), h = new Float32Array(n).fill(-.5);
    for (let i = 0; i < n; i++) { d[i * 3] = side; d[i * 3 + 1] = -.1; d[i * 3 + 2] = 0; }
    ear.setAttribute('fkDir', new THREE.BufferAttribute(d, 3)); ear.setAttribute('fkHair', new THREE.BufferAttribute(h, 1)); parts.push(ear);
  }
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scaled = mergeGeometries(parts); parts.forEach(g => g.dispose());
  scaled.scale(size.x * .47, size.y * .47, size.z * .44); scaled.translate(center.x, center.y, center.z - size.z * .07);
  const neckTop = center.y, neckBottom = box.min.y - size.y * .38, neck = new THREE.CylinderGeometry(1, 1.12, 1, 24, 1, true);
  neck.deleteAttribute('uv'); neck.deleteAttribute('normal');
  neck.scale(size.x * .26, neckTop - neckBottom, size.z * .21); neck.translate(center.x, (neckTop + neckBottom) / 2, center.z - size.z * .12);
  const nn = neck.getAttribute('position').count, nd = new Float32Array(nn * 3), nh = new Float32Array(nn).fill(-.9);
  for (let i = 0; i < nn; i++) { nd[i * 3 + 1] = -.95; nd[i * 3 + 2] = .2; }
  neck.setAttribute('fkDir', new THREE.BufferAttribute(nd, 3)); neck.setAttribute('fkHair', new THREE.BufferAttribute(nh, 1));
  const merged = mergeVertices(mergeGeometries([scaled, neck]), 1e-5);
  scaled.dispose(); neck.dispose(); merged.computeVertexNormals();
  return merged;
}
const FACE_GLSL = `
  vec3 fd = normalize(vFkDir); vec2 fp = fd.xy; float fa = abs(atan(fd.x, fd.z));
  float strand = .006 * sin(fa * 70.0 + fd.y * 12.0) * smoothstep(.2, 1.0, fa + fd.y);
  float hairM = smoothstep(-.012, .012, vFkHair + strand);
  vec3 skinC = diffuseColor.rgb;
  float faceM = smoothstep(.12, .3, fd.z) * (1.0 - hairM);
  // cheeks / forehead warmth
  skinC = mix(skinC, skinC * vec3(1.04, .93, .92), faceM * (1.0 - smoothstep(.0, .22, length(abs(fp - vec2(0., -.3)) * vec2(2.6, 1.0) - vec2(1.0, 0.)))) * 0.35);
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? -1.0 : 1.0; vec2 ec = vec2(s * .32, .0);
    float e = length((fp - ec) / vec2(.165, .078));
    float eyeM = (1.0 - smoothstep(.82, 1.0, e)) * faceM;
    float ir = length((fp - ec - vec2(0., .004)) * vec2(1.0, 1.05));
    vec3 eyeC = mix(vec3(.94, .90, .87), vec3(.27, .17, .12), 1.0 - smoothstep(.055, .068, ir));
    eyeC = mix(eyeC, vec3(.06, .04, .035), 1.0 - smoothstep(.026, .034, ir));
    float lid = smoothstep(.78, .96, e) * (1.0 - smoothstep(1.0, 1.18, e)) * step(ec.y - .012, fp.y) * faceM;
    float tx = (fp.x - s * .32) / .18;
    float browY = .185 + .03 * (1.0 - tx * tx) + .016 * (s * tx);
    float brow = (1.0 - smoothstep(.0, .012, abs(fp.y - browY) - .024 * (1.0 - .45 * abs(tx)))) * (1.0 - smoothstep(.85, 1.0, abs(tx))) * faceM;
    skinC = mix(skinC, skinC * vec3(.9, .82, .8), (1.0 - smoothstep(.5, 1.5, length((fp - ec - vec2(0., .02)) / vec2(.2, .12)))) * faceM * .55);
    skinC = mix(skinC, eyeC, eyeM);
    skinC = mix(skinC, vec3(.17, .1, .08), clamp(lid, 0.0, 1.0) * .85);
    skinC = mix(skinC, vec3(.20, .13, .10), brow * .9);
    float nostril = (1.0 - smoothstep(.016, .034, length((fp - vec2(s * .075, -.395)) * vec2(1.0, 1.7)))) * faceM;
    skinC = mix(skinC, vec3(.55, .33, .29), nostril * .55);
  }
  float mx = abs(fp.x) / .27; float mw = 1.0 - smoothstep(.75, 1.0, mx);
  float myc = -.62 + .02 * mx * mx;
  float lipU = (1.0 - smoothstep(.0, .014, abs(fp.y - (myc + .018)) - .016)) * mw * faceM;
  float lipL = (1.0 - smoothstep(.0, .016, abs(fp.y - (myc - .03)) - .024)) * mw * faceM;
  float seam = (1.0 - smoothstep(.0, .006, abs(fp.y - myc) - .004)) * mw * faceM;
  skinC = mix(skinC, vec3(.72, .38, .36), lipU * .85);
  skinC = mix(skinC, vec3(.8, .45, .42), lipL * .85);
  skinC = mix(skinC, vec3(.42, .2, .19), seam * .85);
  vec3 hairC = mix(vec3(.105, .075, .062), vec3(.2, .145, .115), smoothstep(.1, 1.0, fd.y) * .6);
  hairC *= .88 + .12 * sin(fa * 90.0 + fd.y * 34.0);
  diffuseColor.rgb = mix(skinC, hairC, hairM);
`;
function naturalHeadMaterial(palette) {
  const material = new THREE.MeshStandardMaterial({ color: palette.head, roughness: .78, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 fkDir; attribute float fkHair; varying vec3 vFkDir; varying float vFkHair;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFkDir = fkDir; vFkHair = fkHair;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFkDir; varying float vFkHair;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACE_GLSL);
  };
  material.customProgramCacheKey = () => 'fangkun-natural-head-r1';
  return material;
}

/** Kept independent of WebGL for asset/grounding/selection contract checks. */
export function prepareAnatomyModel(source, look = 'default') {
  const natural = look === 'natural', palette = natural ? NATURAL : PALETTE;
  const root = source.scene.clone(true), muscles = [], boneGeometry = [], hiddenHead = [];
  const shorts = shortsUniforms(palette), headBox = new THREE.Box3();
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  root.traverse(object => {
    if (!object.isMesh) return;
    const meta = anatomyMeta(object.userData);
    if (meta) {
      object.userData.fk = meta; object.material = muscleMaterial(shorts, palette, natural);
      // Facial muscles stay in the list (names/ids unchanged) but are never shown or picked.
      if (isFaceMuscle(object.userData)) { meta.hiddenHead = true; object.visible = false; hiddenHead.push(object); }
      object.frustumCulled = false; muscles.push(object);
    } else if (isHeadSkeleton(object.userData)) {
      object.geometry.computeBoundingBox();
      headBox.union(object.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)));
      object.visible = false; hiddenHead.push(object);
    } else {
      // The supporting skeleton needs one draw call instead of hundreds.
      // Quantized positions/normals must be expanded before applying matrices.
      const geometry = object.geometry.clone();
      for (const key of ['position', 'normal']) {
        const attr = geometry.getAttribute(key); if (!attr) continue;
        const values = new Float32Array(attr.count * 3);
        for (let i = 0; i < attr.count; i++) { values[i * 3] = attr.getX(i); values[i * 3 + 1] = attr.getY(i); values[i * 3 + 2] = attr.getZ(i); }
        geometry.setAttribute(key, new THREE.BufferAttribute(values, 3));
      }
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      boneGeometry.push(geometry); object.visible = false;
    }
  });
  const skeletonGeometry = mergeGeometries(boneGeometry);
  boneGeometry.forEach(geometry => geometry.dispose());
  const skeleton = new THREE.Mesh(skeletonGeometry, skeletonMaterial(shorts, palette));
  skeleton.name = 'Fangkun supporting skeleton'; root.add(skeleton);
  // Slightly larger than the removed skull so no facial structure can show through.
  headBox.expandByVector(headBox.getSize(new THREE.Vector3()).multiplyScalar(.02));
  const head = new THREE.Mesh(natural ? naturalHeadGeometry(headBox) : neutralHeadGeometry(headBox), natural ? naturalHeadMaterial(palette) : new THREE.MeshStandardMaterial({ color: PALETTE.head, roughness: .92, metalness: 0 }));
  head.name = 'Fangkun neutral head'; head.userData.fkHead = true; root.add(head);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true), center = bounds.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z)); root.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(root, true), height = grounded.max.y;
  const foci = { body: grounded, calf: new THREE.Box3(), foot: new THREE.Box3() }, point = new THREE.Vector3();
  for (const object of [...muscles, skeleton]) {
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (point.y <= height * .32) foci.calf.expandByPoint(point);
      if (point.y <= height * .13) foci.foot.expandByPoint(point);
    }
  }
  // The asset includes no skin, genitalia or organs. The pelvic region is shown as
  // integrated sports shorts (shader paint on the real muscle/bone surfaces), and a
  // small opaque crotch panel of the same matte colour fills the pubic/perineal gap
  // between the thighs. It still blocks picking through the opening.
  shorts.fkShorts.value.set(height * .447, height * .468, height * .57, 1); shorts.fkShortsX.value = height * .118; shorts.fkLeg.value = height;
  const cover = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: palette.shorts, roughness: .95, metalness: 0 }));
  cover.name = 'Fangkun opaque pelvic guard'; cover.scale.set(height * .02, natural ? height * .03 : height * .036, height * .034);
  cover.position.set(0, height * (natural ? .483 : .477), -height * .012); cover.userData.fkCover = true; root.add(cover);
  return { root, muscles, skeleton, head, cover, hiddenHead, shorts, bounds: grounded, foci, look };
}

function r9MuscleMaterial(base) {
  const material = new THREE.MeshStandardMaterial({ color: base, roughness: .9, metalness: 0, side: THREE.DoubleSide });
  const tint = { value: new THREE.Color(fkToken('--fk-brand-orange', '#ff6a1a')) }, amount = { value: 0 };
  material.userData.tint = tint; material.userData.amount = amount;
  material.onBeforeCompile = shader => {
    shader.uniforms.fkTint = tint; shader.uniforms.fkAmount = amount;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 fkTint; uniform float fkAmount;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, fkTint, fkAmount);');
  };
  material.customProgramCacheKey = () => 'fangkun-anatomy-r9';
  return material;
}

/** R9: 78 pre-merged muscle regions (39 keys, same k/g as anatomy-map) + smooth non-anatomical shells.
 * All regions are shown (no deep/superficial hiding: R9 regions are shells, not layered meshes).
 * The combined hands/feet shell is split so the existing `feet` region (running load / pain) can
 * still be coloured and picked; it is labelled as an outline, not a muscle mesh. */
export function prepareR9Model(source) {
  const root = source.scene.clone(true), muscles = [], blockers = [], owned = [];
  root.updateMatrixWorld(true);
  const bounds0 = new THREE.Box3().setFromObject(root, true), c0 = bounds0.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c0.x, bounds0.min.y, c0.z)); root.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(root, true), height = grounded.max.y;
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const object of meshes) {
    // gltfpack moves each mesh under a dequantisation child; node extras stay on the parent.
    const ud = object.userData?.fk || object.userData?.selectable ? object.userData : object.parent?.userData || {};
    const label = ud.name || object.parent?.name || object.name || '';
    if (ud.fk?.k && !ud.notAnatomicalMuscle) {
      object.userData.fk = { ...ud.fk, r9: true }; object.material = r9MuscleMaterial(PALETTE.muscle); owned.push(object.material);
      object.frustumCulled = false; muscles.push(object); continue;
    }
    const shorts = /short|waistband|hem/i.test(label);
    object.material = new THREE.MeshStandardMaterial({ color: shorts ? PALETTE.shorts : PALETTE.head, roughness: .92, metalness: 0, side: THREE.DoubleSide }); owned.push(object.material);
    object.userData.fkBlocker = true; blockers.push(object);
    if (shorts) {
      // R9 shorts sit slightly inside the glute/hip regions, so highlighted glutes poke through.
      // Expand a float copy of the shorts shell a little around its own centre (asset file unchanged).
      const g = object.geometry.clone();
      for (const key of ['position', 'normal']) {
        const attr = g.getAttribute(key); if (!attr) continue;
        const values = new Float32Array(attr.count * 3);
        for (let i = 0; i < attr.count; i++) { values[i * 3] = attr.getX(i); values[i * 3 + 1] = attr.getY(i); values[i * 3 + 2] = attr.getZ(i); }
        g.setAttribute(key, new THREE.BufferAttribute(values, 3));
      }
      g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-c.x, -c.y, -c.z); g.scale(1.06, 1.03, 1.12); g.translate(c.x, c.y, c.z);
      object.geometry = g; owned.push(g);
    }
    if (/hands_and_feet/i.test(label) && object.geometry.index) {
      const g = object.geometry, pos = g.getAttribute('position'), idx = g.index.array, feet = [], hands = [], v = new THREE.Vector3();
      const yOf = i => v.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld).y;
      for (let t = 0; t < idx.length; t += 3) ((yOf(idx[t]) + yOf(idx[t + 1]) + yOf(idx[t + 2])) / 3 < height * .1 ? feet : hands).push(idx[t], idx[t + 1], idx[t + 2]);
      if (feet.length) {
        const handsGeom = g.clone(); handsGeom.setIndex(hands); object.geometry = handsGeom; owned.push(handsGeom);
        const feetGeom = g.clone(); feetGeom.setIndex(feet); owned.push(feetGeom);
        const foot = new THREE.Mesh(feetGeom, r9MuscleMaterial(PALETTE.head)); owned.push(foot.material);
        foot.name = 'Fangkun R9 feet outline'; foot.position.copy(object.position); foot.quaternion.copy(object.quaternion); foot.scale.copy(object.scale);
        foot.userData.fk = { k: 'foot_intrinsic', g: 'feet', zh: '足部（外形示意，非肌肉网格）', name: 'feet outline', layer: 'superficial muscles', r9: true, outline: true };
        foot.frustumCulled = false; object.parent.add(foot); muscles.push(foot);
      }
    }
  }
  root.updateMatrixWorld(true);
  if (!muscles.length) throw new Error('R9 anatomy asset has no selectable muscle regions');
  const foci = { body: grounded, calf: new THREE.Box3(), foot: new THREE.Box3() }, point = new THREE.Vector3();
  for (const object of [...muscles, ...blockers]) {
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (point.y <= height * .32) foci.calf.expandByPoint(point);
      if (point.y <= height * .13) foci.foot.expandByPoint(point);
    }
  }
  if (foci.calf.isEmpty()) foci.calf.copy(grounded);
  if (foci.foot.isEmpty()) foci.foot.copy(grounded);
  return { root, muscles, blockers, foci, flat: true, bounds: grounded, dispose() { owned.forEach(x => x.dispose()); } };
}

export async function createMuscleExplorer(canvas, opt = {}) {
  const asset = opt.asset === 'r9' ? 'r9' : 'ecorche';
  const source = await loadAnatomyModel(asset), prepared = asset === 'r9' ? prepareR9Model(source) : prepareAnatomyModel(source, asset === 'ecorche' && opt.look === 'natural' ? 'natural' : 'default');
  const { root, muscles, skeleton, head, cover, foci } = prepared;
  canvas.dataset.asset = asset;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  const natural = prepared.look === 'natural';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(opt.bg || '#171a1e'); scene.add(root);
  const hemi = new THREE.HemisphereLight(0xe9edf4, 0x333a43, 1.7); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe8d6, 2.1); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd1e4ff, 1.0); rim.position.set(-3, 2, -3); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xfff0e4, 0); fill.position.set(-3, 1, 3); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(.62, 64), new THREE.MeshStandardMaterial({ color: '#262d34', roughness: 1 }));
  // Natural look: soft stage that follows the app's light/dark appearance (data-theme on the shell).
  const themeHost = natural ? canvas.closest('[data-theme]') : null;
  const stageTheme = () => themeHost?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  function applyStage() {
    if (!natural) return;
    const t = THEME_STAGE[opt.theme || stageTheme()];
    if (!opt.bg) scene.background.set(t.bg);
    floor.material.color.set(t.floor); hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); hemi.intensity = t.hemi;
    key.color.set(0xfff0e2); key.intensity = t.key; rim.intensity = t.rim; fill.intensity = t.fill; renderer.toneMappingExposure = t.exposure; invalidate();
  }
  const themeObserver = themeHost && typeof MutationObserver === 'function' ? new MutationObserver(applyStage) : null;
  themeObserver?.observe(themeHost, { attributes: true, attributeFilter: ['data-theme'] });
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.003; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, .02, 30), controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false; controls.autoRotate = false;
  // Horizontal drag changes the view; ordinary vertical movement scrolls the sheet.
  canvas.style.touchAction = 'pan-y'; controls.rotateSpeed = .55;
  let view = 'front', focus = 'body', selected = null, selectedMesh = null, deep = false;
  let disposed = false, raf = 0, visible = true, lastFit = null;
  // The neutral head, skeleton and crotch panel are opaque blockers, never selectable.
  const selectable = prepared.flat ? [...muscles, ...prepared.blockers] : [...muscles, skeleton, head, cover], selectedTint = opt.selectedTint || '#62a6ff';
  // R5: main/aux overlay = FIELDWORK brand orange token (was one-off red #f17650).
  const mainTint = opt.mainTint || fkToken('--fk-brand-orange', '#ff6a1a'), auxTint = opt.auxTint || fkToken('--fk-brand-orange-soft', '#ffb084');
  function invalidate() { if (!disposed && !raf && visible && !document.hidden) raf = requestAnimationFrame(draw); }
  function draw() { raf = 0; if (disposed) return; controls.update(); renderer.render(scene, camera); }
  controls.addEventListener('change', () => { follow(); invalidate(); });
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) invalidate(); }); io.observe(canvas);
  const visibility = () => invalidate(); document.addEventListener('visibilitychange', visibility);
  function updateMaterials() {
    const hide = prepared.flat ? [] : coveringGroups(selected);
    // Natural look: with a selection active, the other muscles step back slightly so the
    // theme-coloured highlight stays legible whatever the accent colour is.
    const dimOthers = natural && !!selected;
    for (const object of muscles) {
      const meta = object.userData.fk, picked = selectedMesh ? object === selectedMesh : matchesMuscle(meta, selected);
      const role = muscleRole(meta, opt.primary || [], opt.secondary || []);
      const overlay = (opt.overlays || []).find(item => item.keys.some(key => matchesMuscle(meta, key)));
      object.visible = prepared.flat ? true : !meta.hiddenHead && !(deep ? meta.layer === 'superficial muscles' && !picked : meta.layer === 'deep muscles' && !picked);
      if (hide.some(k => matchesMuscle(meta, k))) object.visible = false;
      if (object.material.userData.dim) object.material.userData.dim.value = dimOthers && !picked ? .88 : 1;
      object.material.userData.amount.value = overlay ? (picked ? .95 : .82) : picked ? .95 : role === 'main' ? .88 : role === 'aux' ? .65 : 0;
      object.material.userData.tint.value.set(overlay ? overlay.color : picked ? selectedTint : role === 'aux' ? auxTint : mainTint);
    }
    invalidate();
  }
  function focusBounds() {
    return foci[focus];
  }
  function place() {
    const box = focusBounds();
    lastFit = fitAnatomyBounds(box.min.toArray(), box.max.toArray(), camera.aspect, camera.fov, VIEWS[view]);
    placeRestrictedView(controls, camera, VIEWS[view], new THREE.Vector3(...lastFit.center), lastFit.distance, ANATOMY_MIN_ZOOM);
    follow(); invalidate();
  }
  // Close zoom keeps the selected muscle in view: the orbit target glides from the body centre
  // to the selection's centre as the camera approaches (camera moves by the same offset, so
  // yaw/polar limits are unchanged and there is still no free pan).
  const focusPoint = new THREE.Vector3(), wanted = new THREE.Vector3(), shift = new THREE.Vector3(); let hasFocus = false;
  function setFocusPoint() {
    const box = new THREE.Box3(); hasFocus = false;
    const objects = selectedMesh ? [selectedMesh] : selected ? muscles.filter(object => object.visible && matchesMuscle(object.userData.fk, selected)) : [];
    for (const object of objects) box.expandByObject(object, true);
    if (!box.isEmpty()) { box.getCenter(focusPoint); hasFocus = true; }
  }
  function follow() {
    if (!lastFit) return;
    const t = hasFocus ? focusBlend(camera.position.distanceTo(controls.target), lastFit.distance) : 0;
    wanted.fromArray(lastFit.center); if (t) wanted.lerp(focusPoint, t);
    shift.subVectors(wanted, controls.target); if (shift.lengthSq() < 1e-10) return;
    controls.target.add(shift); camera.position.add(shift);
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); place();
  }
  function select(object) {
    selectedMesh = object; selected = object?.userData.fk.k || null;
    updateMaterials(); setFocusPoint(); follow(); opt.onPick?.(object ? { ...object.userData.fk, id: object.uuid } : null);
  }
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let down = null, touches = new Set();
  function pickAt(x, y) {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera);
    // Include the opaque guard and skeleton as blockers; never pick through them.
    const hits = ray.intersectObjects(selectable.filter(object => object.visible), false), hit = hits[0];
    // A tap on the front abdomen lands on the external-oblique aponeurosis that overlies
    // the rectus sheath; prefer the rectus abdominis directly beneath it (≤2 cm).
    if (hit?.object.userData.fk?.k === 'ext_oblique') {
      const abs = hits.find(h => h.object.userData.fk?.k === 'abs' && h.distance - hit.distance < .02);
      if (abs) return abs.object;
    }
    return hit?.object.userData.fk ? hit.object : null;
  }
  const pointerDown = event => { touches.add(event.pointerId); down = touches.size === 1 ? [event.clientX, event.clientY] : null; };
  const pointerUp = event => {
    touches.delete(event.pointerId); const previous = down; down = null;
    if (previous && !touches.size && Math.hypot(event.clientX - previous[0], event.clientY - previous[1]) < 8) select(pickAt(event.clientX, event.clientY));
  };
  const pointerCancel = event => { touches.delete(event.pointerId); down = null; };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel);
  const ro = new ResizeObserver(resize); ro.observe(canvas); applyStage(); updateMaterials(); resize();
  return {
    setOverlays(overlays) { opt.overlays = Array.isArray(overlays) ? overlays : []; updateMaterials(); },
    setView(next) { if (!(next in VIEWS)) return; view = next; place(); },
    setFocus(next) { if (!['body', 'calf', 'foot'].includes(next)) return; focus = next; place(); },
    setDeep(value) { deep = !!value; updateMaterials(); },
    reset() { view = 'front'; focus = 'body'; deep = false; selected = null; selectedMesh = null; hasFocus = false; updateMaterials(); place(); opt.onPick?.(null); },
    selectKey(key) {
      selected = key; selectedMesh = null; updateMaterials(); setFocusPoint(); follow(); invalidate();
      const object = key && muscles.find(object => matchesMuscle(object.userData.fk, key));
      // A key selection covers both sides / a whole group, so it is named by key, not by one mesh.
      opt.onPick?.(object ? { ...object.userData.fk, side: null, zh: (object.userData.fk.r9 ? object.userData.fk.g === key && ({ quads: '股四头肌', hamstrings: '腘绳肌', calves: '小腿肌群', feet: '足部内在肌群' }[key]) : keyZh(key)) || object.userData.fk.base || object.userData.fk.zh, id: object.uuid } : null);
    },
    pickAt,
    get state() { return { asset, view, focus, deep, meshCount: muscles.length, polar: controls.getPolarAngle() * 180 / Math.PI, azimuth: controls.getAzimuthalAngle() * 180 / Math.PI, distance: camera.position.distanceTo(controls.target), fit: lastFit }; },
    destroy() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); themeObserver?.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      if (prepared.flat) prepared.dispose(); else { muscles.forEach(object => object.material.dispose()); skeleton.geometry.dispose(); skeleton.material.dispose(); head.geometry.dispose(); head.material.dispose(); cover.geometry.dispose(); cover.material.dispose(); }
      floor.geometry.dispose(); floor.material.dispose(); renderer.dispose();
    }
  };
}
