// Independent anatomical meshes, CC BY-SA 4.0. See anatomy/ATTRIBUTION.md.
// Study model only: it has no rig, and is never substituted for action animation.
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { placeRestrictedView, fitAnatomyBounds } from './viewer-policy.js';
import { anatomyMeta, muscleRole, matchesMuscle, coveringGroups } from './anatomy-map.js';

const VIEWS = { front: 0, left: 90, right: -90, back: 180 };
let modelTask;
export function loadAnatomyModel() {
  if (!modelTask) modelTask = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(new URL('./anatomy/ecorche.meshopt.glb', import.meta.url).href)
    .catch(error => { modelTask = null; throw error; });
  return modelTask;
}

// R1 friendly palette: low-saturation matte warm grey with low tendon contrast.
// Selection/role tints are unchanged in meaning; only the neutral base is softer.
const PALETTE = { muscle: '#b3b4b1', tendon: '#c6c5c0', bone: '#8e8e8a', head: '#bebdb8', shorts: '#4a5058' };

/** Paints the pelvic region as integrated, opaque sports shorts in the shader, so
 * the glute/hip/thigh meshes underneath stay individually pickable and can still
 * be highlighted (a highlight is mixed on top of the shorts colour). */
function shortsUniforms() {
  return { fkShorts: { value: new THREE.Vector4(0, 0, 0, 0) }, fkShortsX: { value: 0 }, fkShortsColor: { value: new THREE.Color(PALETTE.shorts) } };
}
const SHORTS_GLSL = `uniform vec4 fkShorts; uniform float fkShortsX; uniform vec3 fkShortsColor; varying vec3 vFkPos;
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

const fkToken = (name, fallback) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; } };

function muscleMaterial(shorts = shortsUniforms()) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .9, metalness: 0, side: THREE.DoubleSide });
  const tint = { value: new THREE.Color(fkToken('--fk-brand-orange', '#ff6a1a')) }, amount = { value: 0 };
  const base = { value: new THREE.Color(PALETTE.muscle) }, tendonColor = { value: new THREE.Color(PALETTE.tendon) };
  material.userData.tint = tint; material.userData.amount = amount;
  material.onBeforeCompile = shader => {
    injectShorts(shader, shorts);
    shader.uniforms.fkTint = tint; shader.uniforms.fkAmount = amount; shader.uniforms.fkBase = base; shader.uniforms.fkTendonColor = tendonColor;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 fkTint; uniform float fkAmount; uniform vec3 fkBase; uniform vec3 fkTendonColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float tendon = 1.0-smoothstep(0.08,0.20,hi-lo);
        float shade = mix(0.82, 1.0, clamp(hi*1.3, 0.0, 1.0));
        float pants = fkInShorts();
        diffuseColor.rgb = mix(mix(fkBase, fkTendonColor, tendon) * shade, fkShortsColor, pants);
        diffuseColor.rgb = mix(diffuseColor.rgb, fkTint*mix(shade, 1.0, pants), fkAmount*(1.0-0.25*tendon*(1.0-pants))); }
      `);
  };
  material.customProgramCacheKey = () => 'fangkun-anatomy-r1';
  return material;
}

function skeletonMaterial(shorts) {
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.bone, roughness: .95, metalness: 0 });
  material.onBeforeCompile = shader => {
    injectShorts(shader, shorts);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, fkShortsColor, fkInShorts());');
  };
  material.customProgramCacheKey = () => 'fangkun-anatomy-bone-r1';
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

/** Kept independent of WebGL for asset/grounding/selection contract checks. */
export function prepareAnatomyModel(source) {
  const root = source.scene.clone(true), muscles = [], boneGeometry = [], hiddenHead = [];
  const shorts = shortsUniforms(), headBox = new THREE.Box3();
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  root.traverse(object => {
    if (!object.isMesh) return;
    const meta = anatomyMeta(object.userData);
    if (meta) {
      object.userData.fk = meta; object.material = muscleMaterial(shorts);
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
  const skeleton = new THREE.Mesh(skeletonGeometry, skeletonMaterial(shorts));
  skeleton.name = 'Fangkun supporting skeleton'; root.add(skeleton);
  // Slightly larger than the removed skull so no facial structure can show through.
  headBox.expandByVector(headBox.getSize(new THREE.Vector3()).multiplyScalar(.02));
  const head = new THREE.Mesh(neutralHeadGeometry(headBox), new THREE.MeshStandardMaterial({ color: PALETTE.head, roughness: .92, metalness: 0 }));
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
  shorts.fkShorts.value.set(height * .447, height * .468, height * .57, 1); shorts.fkShortsX.value = height * .118;
  const cover = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: PALETTE.shorts, roughness: .95, metalness: 0 }));
  cover.name = 'Fangkun opaque pelvic guard'; cover.scale.set(height * .02, height * .036, height * .034);
  cover.position.set(0, height * .477, -height * .012); cover.userData.fkCover = true; root.add(cover);
  return { root, muscles, skeleton, head, cover, hiddenHead, shorts, bounds: grounded, foci };
}

export async function createMuscleExplorer(canvas, opt = {}) {
  const source = await loadAnatomyModel(), prepared = prepareAnatomyModel(source);
  const { root, muscles, skeleton, head, cover, foci } = prepared;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(opt.bg || '#171a1e'); scene.add(root);
  scene.add(new THREE.HemisphereLight(0xe9edf4, 0x333a43, 1.7));
  const key = new THREE.DirectionalLight(0xffe8d6, 2.1); key.position.set(2, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd1e4ff, 1.0); rim.position.set(-3, 2, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(.62, 64), new THREE.MeshStandardMaterial({ color: '#262d34', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.003; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 1, .02, 30), controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.enablePan = false; controls.autoRotate = false;
  // Horizontal drag changes the view; ordinary vertical movement scrolls the sheet.
  canvas.style.touchAction = 'pan-y'; controls.rotateSpeed = .55;
  let view = 'front', focus = 'body', selected = null, selectedMesh = null, deep = false;
  let disposed = false, raf = 0, visible = true, lastFit = null;
  // The neutral head, skeleton and crotch panel are opaque blockers, never selectable.
  const selectable = [...muscles, skeleton, head, cover], selectedTint = opt.selectedTint || '#62a6ff';
  // R5: main/aux overlay = FIELDWORK brand orange token (was one-off red #f17650).
  const mainTint = opt.mainTint || fkToken('--fk-brand-orange', '#ff6a1a'), auxTint = opt.auxTint || fkToken('--fk-brand-orange-soft', '#ffb084');
  function invalidate() { if (!disposed && !raf && visible && !document.hidden) raf = requestAnimationFrame(draw); }
  function draw() { raf = 0; if (disposed) return; controls.update(); renderer.render(scene, camera); }
  controls.addEventListener('change', invalidate);
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) invalidate(); }); io.observe(canvas);
  const visibility = () => invalidate(); document.addEventListener('visibilitychange', visibility);
  function updateMaterials() {
    const hide = coveringGroups(selected);
    for (const object of muscles) {
      const meta = object.userData.fk, picked = selectedMesh ? object === selectedMesh : matchesMuscle(meta, selected);
      const role = muscleRole(meta, opt.primary || [], opt.secondary || []);
      const overlay = (opt.overlays || []).find(item => item.keys.some(key => matchesMuscle(meta, key)));
      object.visible = !meta.hiddenHead && !(deep ? meta.layer === 'superficial muscles' && !picked : meta.layer === 'deep muscles' && !picked);
      if (hide.some(k => matchesMuscle(meta, k))) object.visible = false;
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
    placeRestrictedView(controls, camera, VIEWS[view], new THREE.Vector3(...lastFit.center), lastFit.distance, .97);
    invalidate();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); place();
  }
  function select(object) {
    selectedMesh = object; selected = object?.userData.fk.k || null;
    updateMaterials(); opt.onPick?.(object ? { ...object.userData.fk, id: object.uuid } : null);
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
  const ro = new ResizeObserver(resize); ro.observe(canvas); updateMaterials(); resize();
  return {
    setOverlays(overlays) { opt.overlays = Array.isArray(overlays) ? overlays : []; updateMaterials(); },
    setView(next) { if (!(next in VIEWS)) return; view = next; place(); },
    setFocus(next) { if (!['body', 'calf', 'foot'].includes(next)) return; focus = next; place(); },
    setDeep(value) { deep = !!value; updateMaterials(); },
    reset() { view = 'front'; focus = 'body'; deep = false; selected = null; selectedMesh = null; updateMaterials(); place(); opt.onPick?.(null); },
    selectKey(key) {
      selected = key; selectedMesh = null; updateMaterials();
      const object = key && muscles.find(object => matchesMuscle(object.userData.fk, key));
      opt.onPick?.(object ? { ...object.userData.fk, zh: object.userData.fk.g === key ? ({ quads: '股四头肌', hamstrings: '腘绳肌', calves: '小腿肌群', feet: '足部内在肌群' }[key] || object.userData.fk.zh) : object.userData.fk.zh, id: object.uuid } : null);
    },
    pickAt,
    get state() { return { view, focus, deep, meshCount: muscles.length, polar: controls.getPolarAngle() * 180 / Math.PI, azimuth: controls.getAzimuthalAngle() * 180 / Math.PI, distance: camera.position.distanceTo(controls.target), fit: lastFit }; },
    destroy() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      muscles.forEach(object => object.material.dispose()); skeleton.geometry.dispose(); skeleton.material.dispose(); head.geometry.dispose(); head.material.dispose(); cover.geometry.dispose(); cover.material.dispose(); floor.geometry.dispose(); floor.material.dispose(); renderer.dispose();
    }
  };
}
