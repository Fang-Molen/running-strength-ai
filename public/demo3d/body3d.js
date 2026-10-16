// 方坤 人体肌群 3D 与 体型/姿势查看器。人体模型 MakeHuman/MPFB2 CC0（human.glb）；肌群为 regions.png 区域着色，不是独立肌肉网格。
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { loadModel, makeRig, applyPose, regionTexture } from './viewer3d.js';
import MUS from './muscles.js';

const deg = d => d * Math.PI / 180;
function baseScene(bg) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(bg || '#171a1e');
  scene.add(new THREE.HemisphereLight(0xf2eee6, 0x363b40, 1.45));
  const key = new THREE.DirectionalLight(0xfff1e4, 2.0); key.position.set(2.2, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd4e4eb, 0.9); rim.position.set(-3, 2.5, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  return scene;
}
function ground(rig) { // feet on the floor: lowest skinned vertex -> y=0
  rig.root.updateMatrixWorld(true); let min = Infinity; const v = new THREE.Vector3();
  rig.root.traverse(o => { if (!o.isSkinnedMesh) return; const n = o.geometry.attributes.position.count; for (let i = 0; i < n; i += 7) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < min) min = v.y; } });
  rig.root.position.y -= min; rig.root.updateMatrixWorld(true); return -min;
}
function regionPixels() {
  const img = regionTexture.image, RS = 1024, c = document.createElement('canvas'); c.width = c.height = RS;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, RS, RS); return { RS, px: x.getImageData(0, 0, RS, RS).data };
}
function makeControls(cam, canvas, onChange) {
  const ctl = new OrbitControls(cam, canvas); ctl.enableDamping = true; ctl.enablePan = false; ctl.autoRotate = false;
  canvas.style.touchAction = 'pan-y'; if (onChange) ctl.addEventListener('change', onChange); return ctl;
}
function loopOnScreen(canvas, draw) {
  let on = true, raf = 0; const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; }); io.observe(canvas);
  const tick = () => { if (on && !document.hidden) draw(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); io.disconnect(); };
}

// ---------- t431 人体肌群 3D ----------
export const EXPLORER_VIEWS = { front: 0, left: 90, right: -90, back: 180 };
export async function createMuscleExplorer(canvas, opt = {}) {
  const gltf = await loadModel();
  const state = { hi: new Array(40).fill(0), border: 1, shirt: 0 }; // bare torso so torso muscles are visible; opaque shorts stay
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = baseScene(opt.bg); const rig = makeRig(gltf, state); scene.add(rig.root);
  applyPose(rig, { uarmAb: 14, farmAb: 10, foot: 86 }); ground(rig);
  rig.root.traverse(o => { if (o.isMesh && /shoe/i.test(o.name + (o.material?.name || ''))) o.visible = false; }); // barefoot for foot/ankle muscles
  const cam = new THREE.PerspectiveCamera(30, 1, .03, 30);
  const ctl = makeControls(cam, canvas);
  // Clamp: polar from eye level (90°) to slight top-down (62°), ±30° azimuth around the chosen view.
  ctl.minPolarAngle = deg(62); ctl.maxPolarAngle = deg(90);
  const FOCUS = { body: { t: [0, .86, 0], d: 4.1 }, calf: { t: [0, .38, 0], d: 1.45 }, foot: { t: [0, .07, .04], d: 0.95 } };
  let view = 'front', focus = 'body';
  function place() {
    const f = FOCUS[focus], a = deg(EXPLORER_VIEWS[view]); ctl.enableDamping = false; ctl.update(); ctl.enableDamping = true;
    ctl.minAzimuthAngle = -Infinity; ctl.maxAzimuthAngle = Infinity; ctl.minDistance = 0; ctl.maxDistance = Infinity;
    ctl.target.set(...f.t); cam.position.set(f.t[0] + Math.sin(a) * f.d, f.t[1] + f.d * 0.12, f.t[2] + Math.cos(a) * f.d); ctl.update();
    const w = Math.atan2(Math.sin(a), Math.cos(a)); ctl.minAzimuthAngle = w - deg(30); ctl.maxAzimuthAngle = w + deg(30);
    ctl.minDistance = f.d * 0.5; ctl.maxDistance = f.d * 1.25; ctl.update();
  }
  place();
  const { RS, px } = regionPixels();
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); const hit = ray.intersectObject(rig.body, false)[0];
    if (!hit || !hit.uv) return null;
    const id = px[(Math.min(RS - 1, Math.floor(hit.uv.y * RS)) * RS + Math.min(RS - 1, Math.floor(hit.uv.x * RS))) * 4];
    return id ? id : null;
  }
  function select(id) { state.hi.fill(0); if (id) state.hi[id] = 2; const m = id ? MUS[id - 1] : null; opt.onPick?.(m ? { id, k: m.k, zh: m.zh, g: m.g } : null); }
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => { if (!down) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null; if (moved < 8) select(pickAt(e.clientX, e.clientY)); });
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const stop = loopOnScreen(canvas, () => { ctl.update(); renderer.render(scene, cam); });
  return {
    setView(v) { view = v; place(); }, setFocus(f) { focus = f; place(); }, reset() { view = 'front'; focus = 'body'; select(null); place(); },
    selectKey(k) { const i = MUS.findIndex(m => m.k === k); select(i >= 0 ? i + 1 : null); }, pickAt,
    get state() { return { view, focus, polar: ctl.getPolarAngle() * 180 / Math.PI, azimuth: ctl.getAzimuthalAngle() * 180 / Math.PI, dist: cam.position.distanceTo(ctl.target) }; },
    destroy() { stop(); ro.disconnect(); ctl.dispose(); renderer.dispose(); }
  };
}

// ---------- t428 C / t432 姿势与体型 ----------
export const POSES = {
  stand: { label: '标准站姿', p: { uarmAb: 10, farmAb: 8 } },
  relax: { label: '自然休闲', p: { uarmAb: 5, farm: 16, farmAb: 2, thigh_l: 8, thighAb_l: 1, shin_l: -12, thighAb_r: 8, trunkTw: 6, head: 172 } },
  hips: { label: '叉腰', p: { uarm: -12, uarmAb: 44, farm: -30, farmAb: -62, farmTw: 0 } },
  arms: { label: '轻抱臂', p: { uarm: 22, uarmAb: 14, farm: 92, farmAb: -72 } },
  flex: { label: '屈肘展示', p: { uarm: 0, uarmAb: 84, farm: 165, farmAb: 6, farmTw: 60 } },
  run: { label: '跑步定格', p: { uarm_l: -35, farm_l: 70, uarm_r: 40, farm_r: 128, thigh_l: 42, shin_l: -35, thigh_r: -18, shin_r: -75, trunk: 184, uarmAb: 6, farmAb: 4 } },
};
// regional girth (metres along surface normal) per bone
export const REGION_BONES = { waist: ['pelvis', 'spine_01', 'spine_02'], chest: ['spine_03'], upperArm: ['upperarm_l', 'upperarm_r'], thigh: ['thigh_l', 'thigh_r'], calf: ['calf_l', 'calf_r'], shoulders: ['clavicle_l', 'clavicle_r'] };
function girthMaterial(m, gArr) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.uniforms.uG = { value: gArr };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uG[64];')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n#ifdef USE_SKINNING\n{ float g = uG[int(skinIndex.x)]*skinWeight.x + uG[int(skinIndex.y)]*skinWeight.y + uG[int(skinIndex.z)]*skinWeight.z + uG[int(skinIndex.w)]*skinWeight.w; transformed += normalize(objectNormal) * g; }\n#endif');
  };
  m.customProgramCacheKey = () => 'fk-girth|' + (prev ? 'm' : 'p'); m.needsUpdate = true;
}
function shapeRig(rig) {
  const meshes = [];
  rig.root.traverse(o => { if (!o.isSkinnedMesh) return; const g = new Float32Array(64); girthMaterial(o.material, g); meshes.push({ o, g, names: o.skeleton.bones.map(b => b.name) }); });
  return girth => { for (const { g, names } of meshes) { g.fill(0); names.forEach((n, i) => { for (const [reg, bs] of Object.entries(REGION_BONES)) if (bs.includes(n)) g[i] = girth[reg] || 0; }); } };
}
export const FIG_VIEWS = { front: 0, side: 90, back: 180, three: 45 };
/** One renderer, one camera, N viewports (same model/pose/camera → synced rotation). */
export async function createFigureViewer(canvas, opt = {}) {
  const gltf = await loadModel(); const n = opt.count || 1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const items = Array.from({ length: n }, () => { const scene = baseScene(opt.bg); const rig = makeRig(gltf, { hi: new Array(40).fill(0), border: 0 }); scene.add(rig.root); return { scene, rig, setG: shapeRig(rig) }; });
  const cam = new THREE.PerspectiveCamera(28, 1, .05, 30); const ctl = makeControls(cam, canvas);
  ctl.minPolarAngle = deg(70); ctl.maxPolarAngle = deg(92);
  const T = new THREE.Vector3(0, 1.0, 0), D = 5.3; ctl.minDistance = D * .6; ctl.maxDistance = D * 1.3;
  let pose = 'stand';
  function setPose(k) { pose = POSES[k] ? k : 'stand'; for (const it of items) { applyPose(it.rig, POSES[pose].p); it.rig.root.position.set(0, 0, 0); ground(it.rig); } }
  function setView(v) { const a = deg(FIG_VIEWS[v] ?? 0); ctl.enableDamping = false; ctl.update(); ctl.enableDamping = true; ctl.target.copy(T); cam.position.set(Math.sin(a) * D, T.y + .25, Math.cos(a) * D); ctl.update(); }
  setPose('stand'); setView('front');
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = (w / n) / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const draw = () => { ctl.update(); const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setScissorTest(true);
    items.forEach((it, i) => { renderer.setViewport(i * w / n, 0, w / n, h); renderer.setScissor(i * w / n, 0, w / n, h); renderer.render(it.scene, cam); }); renderer.setScissorTest(false); };
  const stop = loopOnScreen(canvas, draw);
  return { setPose, setView, reset() { setPose('stand'); setView('front'); }, setShape(i, girth) { items[i]?.setG(girth); }, get pose() { return pose; },
    get state() { return { azimuth: ctl.getAzimuthalAngle() * 180 / Math.PI, polar: ctl.getPolarAngle() * 180 / Math.PI }; },
    destroy() { stop(); ro.disconnect(); ctl.dispose(); renderer.dispose(); } };
}
