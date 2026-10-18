// 方坤 人体肌群 3D 与 体型/姿势查看器。人体模型 MakeHuman/MPFB2 CC0（human.glb）；肌群为 regions.png 区域着色，不是独立肌肉网格。
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { loadModel, makeRig, applyPose, applyAppearance } from './viewer3d.js';
export { APPEARANCE_CHANNELS, normalizeAppearance } from './viewer3d.js';
import MUS from './muscles.js';
import { placeRestrictedView } from './viewer-policy.js';

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
  rig.root.traverse(o => { if (!o.isSkinnedMesh || !o.visible) return; const n = o.geometry.attributes.position.count; for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); if (v.y < min) min = v.y; } });
  rig.root.position.y -= min; rig.root.updateMatrixWorld(true); return -min;
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

// The muscle atlas now uses independent anatomical meshes, not human.glb UV colour regions.
export { createMuscleExplorer } from './anatomy3d.js';
export const EXPLORER_VIEWS = { front: 0, left: 90, right: -90, back: 180 };

// ---------- t428 C / t432 姿势与体型 ----------
export const POSES = {
  stand: { label: '标准站姿', p: { uarmAb: 10, farmAb: 8 } },
  relax: { label: '自然休闲', p: { uarmAb: 5, farm: 16, farmAb: 2, thigh_l: 8, thighAb_l: 1, shin_l: -12, thighAb_r: 8, trunkTw: 6, head: 172 } },
  hips: { label: '叉腰', p: { uarm: -12, uarmAb: 44, farm: -30, farmAb: -62, farmTw: 0 } },
  arms: { label: '轻抱臂', p: { uarm: 22, uarmAb: 14, farm: 92, farmAb: -72 } },
  flex: { label: '屈肘展示', p: { uarm: 0, uarmAb: 84, farm: 165, farmAb: 6, farmTw: 60 } },
  run: { label: '跑步定格', p: { uarm_l: -35, farm_l: 70, uarm_r: 40, farm_r: 128, thigh_l: 42, shin_l: -35, thigh_r: -18, shin_r: -75, trunk: 184, uarmAb: 6, farmAb: 4 } },
};
export function figurePose(key, model = 'human') {
  const pose = POSES[key]?.p || POSES.stand.p;
  // The original rig's resting foot axis is 62.85 degrees; the animation default (95)
  // visibly tilts the shoe sole upward in a static comparison. Keep legacy/motion poses intact.
  return model.startsWith('athlete') && key === 'stand' ? { ...pose, foot: 62.85, footAb: 1.36 } : pose;
}
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
  const model = ['athlete','athlete-male','athlete-female'].includes(opt.model) ? opt.model : 'human';
  const gltf = await loadModel(model); const n = Math.min(4, Math.max(1, Math.floor(opt.count || 1)));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const items = Array.from({ length: n }, (_, i) => {
    const scene = baseScene(opt.bg);
    const rig = makeRig(gltf, { hi: new Array(40).fill(0), border: 0, appearance: opt.appearance?.[i] });
    scene.add(rig.root);
    return { scene, rig, setG: model === 'human' ? shapeRig(rig) : null };
  });
  let dirty = true; const invalidate = () => { dirty = true; };
  const cam = new THREE.PerspectiveCamera(28, 1, .05, 30); const ctl = makeControls(cam, canvas, invalidate);
  ctl.minPolarAngle = deg(70); ctl.maxPolarAngle = deg(90);
  const T = new THREE.Vector3(0, 1.0, 0), D = 5.3; ctl.minDistance = D * .6; ctl.maxDistance = D * 1.3;
  let pose = 'stand';
  function setPose(k) { invalidate(); pose = POSES[k] ? k : 'stand'; for (const it of items) { applyPose(it.rig, figurePose(pose, model)); it.rig.root.position.set(0, 0, 0); ground(it.rig); } }
  function setView(v) { placeRestrictedView(ctl, cam, FIG_VIEWS[v] ?? 0, T, D, .85); }
  setPose('stand'); setView('front');
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = (w / n) / h; cam.updateProjectionMatrix(); invalidate(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  const draw = () => { ctl.update(); if (!dirty) return; dirty = false; const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setScissorTest(true);
    items.forEach((it, i) => { renderer.setViewport(i * w / n, 0, w / n, h); renderer.setScissor(i * w / n, 0, w / n, h); renderer.render(it.scene, cam); }); renderer.setScissorTest(false); };
  const stop = loopOnScreen(canvas, draw);
  return { setPose, setView, reset() { setPose('stand'); setView('front'); },
    setShape(i, girth) { if (!items[i]?.setG) return false; items[i].setG(girth); invalidate(); return true; },
    setAppearance(i, channels) {
      const item = items[i]; if (!item) return null;
      const value = applyAppearance(item.rig, channels); ground(item.rig); invalidate(); return value;
    },
    getAppearance(i = 0) { return items[i] ? { ...items[i].rig.appearance } : null; },
    get model() { return model; }, get pose() { return pose; },
    get state() { return { azimuth: ctl.getAzimuthalAngle() * 180 / Math.PI, polar: ctl.getPolarAngle() * 180 / Math.PI }; },
    destroy() { stop(); ro.disconnect(); ctl.dispose(); renderer.dispose(); } };
}
