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

function muscleMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .62, metalness: .08, side: THREE.DoubleSide });
  const tint = { value: new THREE.Color('#ec7956') }, amount = { value: 0 };
  material.userData.tint = tint; material.userData.amount = amount;
  material.onBeforeCompile = shader => {
    shader.uniforms.fkTint = tint; shader.uniforms.fkAmount = amount;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 fkTint; uniform float fkAmount;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float lo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float tendon = 1.0-smoothstep(0.08,0.20,hi-lo);
        float shade = clamp(hi*1.3,0.4,1.0);
        diffuseColor.rgb = mix(vec3(0.42,0.46,0.52),vec3(0.78,0.80,0.82),tendon)*shade;
        diffuseColor.rgb = mix(diffuseColor.rgb,fkTint*shade,fkAmount*(1.0-0.25*tendon)); }
      `);
  };
  material.customProgramCacheKey = () => 'fangkun-anatomy-v70';
  return material;
}

/** Kept independent of WebGL for asset/grounding/selection contract checks. */
export function prepareAnatomyModel(source) {
  const root = source.scene.clone(true), muscles = [], boneGeometry = [];
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  root.traverse(object => {
    if (!object.isMesh) return;
    const meta = anatomyMeta(object.userData);
    if (meta) {
      object.userData.fk = meta; object.material = muscleMaterial();
      object.frustumCulled = false; muscles.push(object);
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
  const skeleton = new THREE.Mesh(skeletonGeometry, new THREE.MeshStandardMaterial({ color: '#a4aaa8', vertexColors: true, roughness: .8 }));
  skeleton.name = 'Fangkun supporting skeleton'; root.add(skeleton);
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
  // The asset includes no skin, genitalia or organs. This independent, opaque
  // central cover also blocks the pubic/perineal opening in the study view.
  const cover = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: '#252b32', roughness: .95, side: THREE.DoubleSide }));
  cover.name = 'Fangkun opaque pelvic guard'; cover.scale.set(height * .051, height * .061, height * .072);
  cover.position.set(0, height * .48, 0); cover.userData.fkCover = true; root.add(cover);
  return { root, muscles, skeleton, cover, bounds: grounded, foci };
}

export async function createMuscleExplorer(canvas, opt = {}) {
  const source = await loadAnatomyModel(), prepared = prepareAnatomyModel(source);
  const { root, muscles, skeleton, cover, foci } = prepared;
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
  const selectable = [...muscles, skeleton, cover];
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
      object.visible = !(deep ? meta.layer === 'superficial muscles' && !picked : meta.layer === 'deep muscles' && !picked);
      if (hide.some(k => matchesMuscle(meta, k))) object.visible = false;
      object.material.userData.amount.value = picked ? .95 : role === 'main' ? .88 : role === 'aux' ? .65 : 0;
      object.material.userData.tint.value.set(picked ? '#62a6ff' : role === 'aux' ? '#f3b997' : '#f17650');
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
    const hit = ray.intersectObjects(selectable.filter(object => object.visible), false)[0];
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
      muscles.forEach(object => object.material.dispose()); skeleton.geometry.dispose(); skeleton.material.dispose(); cover.geometry.dispose(); cover.material.dispose(); floor.geometry.dispose(); floor.material.dispose(); renderer.dispose();
    }
  };
}
