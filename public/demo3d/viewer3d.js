// 方坤 3D 动作演示渲染器 (three.js). 代码自制 MIT；人体模型 MakeHuman/MPFB2 CC0。
import * as THREE from '/demo3d/vendor/three.module.min.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from './vendor/jsm/utils/SkeletonUtils.js';
import MUS from './muscles.js';

const COL = { p: new THREE.Color('#ed7655'), s: new THREE.Color('#f0b08a') }; // Fieldwork: muted muscle overlay palette
let baseGLTF = null;
export async function loadModel() {
  if (!baseGLTF) {
    const [g, t] = await Promise.all([new GLTFLoader().loadAsync(new URL('./models/human.glb', import.meta.url).href), new THREE.TextureLoader().loadAsync(new URL('./models/regions.png', import.meta.url).href)]);
    t.flipY = false; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; REG = t; baseGLTF = g;
  }
  return baseGLTF;
}
// ---------- material with muscle overlay ----------
let REG = null;
function muscleMaterial(src, state) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: .73, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uHi = { value: state.hi }; sh.uniforms.uBorder = { value: state }; sh.uniforms.uReg = { value: REG };
    sh.uniforms.uP = { value: COL.p }; sh.uniforms.uS = { value: COL.s };
    Object.defineProperty(sh.uniforms.uBorder, 'value', { get: () => state.border });
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHi[40];uniform float uBorder;uniform vec3 uP;uniform vec3 uS;uniform sampler2D uReg;\nfloat hiOf(int id){ float h=0.0; for(int i=0;i<40;i++){ if(i==id) h=uHi[i]; } return h; }\nint idAt(vec2 uv){ return int(floor(texture2D(uReg,uv).r*255.0+0.5)); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec4 rg = texture2D(uReg, vMapUv); int id = int(floor(rg.r*255.0+0.5)); float h = hiOf(id);
        if (rg.g>0.75) diffuseColor.rgb = vec3(0.10,0.11,0.13); else if (rg.g>0.25) diffuseColor.rgb = vec3(0.11,0.15,0.22);
        if (id>0 && h>0.0) { vec3 c = h>1.5 ? uP : uS; float fab = rg.g>0.25 ? 0.78 : 1.0; diffuseColor.rgb = mix(diffuseColor.rgb, c, (h>1.5?0.74:0.48)*fab); }
        else if (id>0 && uBorder>0.5 && rg.g<0.25) { diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80,0.72,0.66), 0.22); }
        if (id>0 && (h>0.0 || uBorder>0.5)) {
          float o = 1.6/2048.0; float e = 0.0;
          e += float(idAt(vMapUv+vec2(o,0.))!=id); e += float(idAt(vMapUv-vec2(o,0.))!=id); e += float(idAt(vMapUv+vec2(0.,o))!=id); e += float(idAt(vMapUv-vec2(0.,o))!=id);
          float ln = clamp(e,0.,1.); if (h>0.0) ln = max(ln, rg.b*0.7);
          diffuseColor.rgb = mix(diffuseColor.rgb, h>0.0 ? vec3(0.32,0.02,0.03) : vec3(0.35,0.25,0.22), ln*0.68);
        } }`);
  };
  return m;
}
export function muscleIndexFor(primary, secondary, extraPrimary = [], extraSecondary = []) {
  const hi = new Array(40).fill(0);
  MUS.forEach((m, i) => {
    if (primary.includes(m.g) || extraPrimary.includes(m.k)) hi[i + 1] = 2;
    else if (secondary.includes(m.g) || extraSecondary.includes(m.k)) hi[i + 1] = Math.max(hi[i + 1], 1);
  });
  return hi;
}
// ---------- rig ----------
function makeRig(gltf, state) {
  const root = SkeletonUtils.clone(gltf.scene);
  const bones = {}; let body;
  root.traverse(o => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      o.frustumCulled = false; o.castShadow = true;
      if (/base|body/i.test(o.name) || o.material.name === 'Human.body') { o.material = muscleMaterial(o.material, state); body = o; }
      else { o.material = o.material.clone(); o.castShadow = true; o.material.transparent = o.material.alphaMode === 'BLEND' || /eyebrow|short/.test(o.name); o.material.alphaTest = .3; o.material.depthWrite = true; }
    }
  });
  root.updateMatrixWorld(true);
  const rest = {};
  for (const [n, b] of Object.entries(bones)) {
    const wq = new THREE.Quaternion(); b.getWorldQuaternion(wq);
    const wp = new THREE.Vector3(); b.getWorldPosition(wp);
    rest[n] = { q: b.quaternion.clone(), p: b.position.clone(), wq, wp };
  }
  for (const [n, b] of Object.entries(bones)) { // rest direction head->first child (or bone +Y)
    const c = b.children.find(x => x.isBone);
    const d = c ? rest[c.name].wp.clone().sub(rest[n].wp).normalize() : new THREE.Vector3(0, 1, 0).applyQuaternion(rest[n].wq);
    rest[n].dir = d;
  }
  return { root, bones, rest, body };
}
// direction from sagittal angle s (0 down, 90 forward, 180 up) and abduction a (deg, +outward), side +1 left / -1 right
export function dirOf(s, a = 0, side = 1) {
  const S = s * Math.PI / 180, A = a * Math.PI / 180;
  return new THREE.Vector3(Math.sin(A) * side, -Math.cos(S) * Math.cos(A), Math.sin(S) * Math.cos(A)).normalize();
}
const CHAIN = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(); const _v = new THREE.Vector3();
function aim(rig, name, dir, twist = 0) {
  const b = rig.bones[name], r = rig.rest[name]; if (!b) return;
  const R = rig.R || new THREE.Quaternion();
  const wq = new THREE.Quaternion().setFromUnitVectors(r.dir.clone().applyQuaternion(R), dir).multiply(R).multiply(r.wq);
  if (twist) wq.premultiply(_q.setFromAxisAngle(dir, twist * Math.PI / 180));
  b.parent.getWorldQuaternion(_pq);
  b.quaternion.copy(_pq.invert().multiply(wq));
  b.updateMatrixWorld(true);
}
function keepRest(rig, name) { // keep the bone's rest world orientation relative to parent rest
  const b = rig.bones[name]; b.quaternion.copy(rig.rest[name].q); b.updateMatrixWorld(true);
}
export function applyPose(rig, P0) {
  if (P0.plankH !== undefined) { // straight body line from toes; solve elevation e so shoulder height = plankH
    let lo = 0, hi = 60, P;
    for (let i = 0; i < 14; i++) { const e = (lo + hi) / 2; P = plankPose(P0, e); P.noIK = 1; applyPose1(rig, P);
      const y = new THREE.Vector3(); rig.bones.upperarm_l.getWorldPosition(y); if (y.y > P0.plankH) hi = e; else lo = e; }
    return applyPose1(rig, plankPose(P0, (lo + hi) / 2));
  }
  return applyPose1(rig, P0);
}
export function gpt(rig, s) { const a = new THREE.Vector3(), b = new THREE.Vector3(); rig.bones['middle_01_' + s].getWorldPosition(a); rig.bones['middle_03_' + s].getWorldPosition(b); return a.lerp(b, .5); }
function plankPose(P, e) { if (P.knees) return { ...P, trunk: 90 + e, thigh: -90 + e, shin: -105, foot: -100, anchor: 'knees', neck: 90 + e + 15, head: 90 + e + 5 };
  return { ...P, trunk: 90 + e + (P.hipSag || 0), thigh: -90 + e - (P.hipSag || 0) * .5, shin: -90 + e, foot: e + 8, anchor: 'toes', neck: 90 + e + 15, head: 90 + e + 5 }; }
function applyPose1(rig, P) {
  const { bones } = rig; const v = (k, d) => P[k] ?? d;
  bones.pelvis.quaternion.copy(rig.rest.pelvis.q); bones.pelvis.position.copy(rig.rest.pelvis.p);
  rig.root.position.set(0, 0, 0); rig.root.quaternion.identity();
  if (P.bodyRot) rig.root.quaternion.setFromEuler(new THREE.Euler(...P.bodyRot.map(x => x * Math.PI / 180), 'YXZ'));
  rig.root.updateMatrixWorld(true);
  const R = rig.root.quaternion; rig.R = R;
  const D = (s, a = 0, side = 1) => dirOf(s, a, side).applyQuaternion(R); const D3 = D;
  const trunk = v('trunk', 180), curve = v('curve', 0);
  aim(rig, 'pelvis', D(trunk - 12 + v('pelvisTilt', 0)));
  aim(rig, 'spine_01', D(trunk - curve)); const tw = v('trunkTw', 0); aim(rig, 'spine_02', D(trunk), tw * .5); aim(rig, 'spine_03', D(trunk + curve * .6), tw);
  aim(rig, 'neck_01', D(v('neck', trunk + 8)), tw); aim(rig, 'head', D(v('head', v('neck', trunk + 8) - 6)), tw);
  keepRest(rig, 'clavicle_l'); keepRest(rig, 'clavicle_r');
  if (P.shrug) for (const [s, sg] of [['l', 1], ['r', -1]]) { const d = rig.rest['clavicle_' + s].dir.clone().applyQuaternion(R).applyAxisAngle(new THREE.Vector3(0, 0, 1).applyQuaternion(R), sg * 28 * P.shrug * Math.PI / 180); aim(rig, 'clavicle_' + s, d); }
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    const g = k => P[k + '_' + s] ?? P[k];
    aim(rig, 'upperarm_' + s, D(g('uarm') ?? 0, g('uarmAb') ?? 8, sg), (g('uarmTw') ?? 0) * sg);
    aim(rig, 'lowerarm_' + s, D(g('farm') ?? 0, g('farmAb') ?? 6, sg), (g('farmTw') ?? 0) * sg);
    if (g('hand') !== undefined) aim(rig, 'hand_' + s, D(g('hand'), g('handAb') ?? 0, sg)); else keepRest(rig, 'hand_' + s);
    aim(rig, 'thigh_' + s, D(g('thigh') ?? 0, g('thighAb') ?? 4, sg), (g('thighTw') ?? 0) * sg);
    aim(rig, 'calf_' + s, D(g('shin') ?? 0, g('shinAb') ?? 2, sg));
    aim(rig, 'foot_' + s, D(g('foot') ?? 95, g('footAb') ?? 6, sg));
  }
  const grip = v('grip', 0), GA = new THREE.Vector3(...([0, 0, 1]));
  for (const [n, b] of Object.entries(bones)) {
    const m = n.match(/^(index|middle|ring|pinky|thumb)_0(\d)_/); if (!m) continue;
    const th = m[1] === 'thumb', TK = (globalThis.FK_TK || [0.5, 0.8, 0.8]);
    const a = (th ? TK[+m[2] - 1] : (m[2] === '1' ? 0.9 : 1)) * grip * Math.PI / 180;
    const ax = th ? _v.set(...(globalThis.FK_TA || [0, 0, -1])).normalize() : GA;
    b.quaternion.copy(rig.rest[n].q).multiply(_q.setFromAxisAngle(ax, a));
  }
  rig.root.updateMatrixWorld(true);
  // anchor
  const an = P.anchor || 'feet', at = new THREE.Vector3(...(P.at || [0, 0, 0]));
  var wp = n => { const x = new THREE.Vector3(); rig.bones[n].getWorldPosition(x); return x; };
  let cur;
  if (an === 'feet') { cur = wp('foot_l').add(wp('foot_r')).multiplyScalar(.5); cur.y -= 0.07; }
  else if (an === 'hands') { cur = gpt(rig, 'l').add(gpt(rig, 'r')).multiplyScalar(.5); }
  else if (an === 'toes') { cur = wp('ball_l').add(wp('ball_r')).multiplyScalar(.5); cur.y -= 0.02; }
  else if (an === 'hip') cur = wp('pelvis');
  else if (an.startsWith('b:')) { cur = wp(an.slice(2)); cur.y -= (P.anchorDy ?? (an.includes('foot') ? 0.07 : an.includes('ball') ? 0.02 : 0)); }
  else if (an === 'knees') { cur = wp('calf_l').add(wp('calf_r')).multiplyScalar(.5); cur.y -= 0.06; }
  rig.root.position.sub(cur).add(at); rig.root.updateMatrixWorld(true);
  // arm IK: P.handW = world target [x,y,z] for left hand (right mirrored in x), or P.handT relative to shoulder midpoint in torso frame
  if (!P.noIK && (P.handW || P.handT || P.handFloor)) for (const [s, sg] of [['l', 1], ['r', -1]]) {
    const sh = wp('upperarm_' + s); let tg;
    if (P.handFloor) { tg = sh.clone(); tg.x = P.handFloor[0] * sg; tg.y = P.handFloor[1]; if (rig._hz === undefined || P.plankH >= rig._hzH) { rig._hz = sh.z + P.handFloor[2]; rig._hzH = P.plankH; } tg.z = rig._hz; }
    else if (P.handW) tg = new THREE.Vector3(P.handW[0] * sg, P.handW[1], P.handW[2]);
    else { const mid = wp('upperarm_l').add(wp('upperarm_r')).multiplyScalar(.5); const tq = rig.bones.spine_03.getWorldQuaternion(new THREE.Quaternion()).multiply(rig.rest.spine_03.wq.clone().invert());
      tg = new THREE.Vector3(P.handT[0] * sg, P.handT[1], P.handT[2]).applyQuaternion(tq).add(mid); }
    const pole = new THREE.Vector3(...(P.elbowPole || [1, -1, -1])); pole.x *= sg; pole.applyQuaternion(R);
    const tg0 = tg.clone();
    for (let it = 0; it < (P.gripIK ? 4 : 1); it++) {
    const L1 = rig.rest['lowerarm_' + s].wp.distanceTo(rig.rest['upperarm_' + s].wp), L2 = rig.rest['hand_' + s].wp.distanceTo(rig.rest['lowerarm_' + s].wp) + (P.handLen ?? 0.06);
    const d = tg.clone().sub(sh); let D = Math.min(d.length(), (L1 + L2) * .999); const u = d.clone().normalize();
    const a = Math.acos(THREE.MathUtils.clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));
    const pp = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
    const e = sh.clone().add(u.clone().multiplyScalar(Math.cos(a) * L1)).add(pp.multiplyScalar(Math.sin(a) * L1));
    aim(rig, 'upperarm_' + s, e.clone().sub(sh).normalize()); aim(rig, 'lowerarm_' + s, tg.clone().sub(e).normalize(), (P.ikTw ?? 0) * sg);
    if (P.wrist !== undefined) aim(rig, 'hand_' + s, D3(P.wrist, P.wristAb ?? 0, sg)); else keepRest(rig, 'hand_' + s);
      if (P.gripIK) { const gq = gpt(rig, s); tg.add(tg0.clone().sub(gq)); }
    }
  }
  rig.root.updateMatrixWorld(true);
}
// ---------- props ----------
function barbell(len = 2.0, plates = true) {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: .85, roughness: .3 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, len, 16), steel); bar.rotation.z = Math.PI / 2; g.add(bar);
  if (plates) for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.225, .225, .035, 40), new THREE.MeshStandardMaterial({ color: i ? 0x2a6fd6 : 0x22252b, roughness: .6, transparent: true, opacity: .42, depthWrite: false }));
    p.rotation.z = Math.PI / 2; p.position.x = s * (.72 + i * .04); g.add(p);
  }
  return g;
}
function dumbbell() { const g = new THREE.Group(), st = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: .8, roughness: .35 }), hd = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: .6 });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .2, 12), st); h.rotation.z = Math.PI / 2; g.add(h);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .07, 20), hd); p.rotation.z = Math.PI / 2; p.position.x = s * .12; g.add(p); } return g; }
function kettlebell() { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: .5, metalness: .3 });
  const b = new THREE.Mesh(new THREE.SphereGeometry(.105, 24, 16), m); b.position.y = -.13; g.add(b);
  const h = new THREE.Mesh(new THREE.TorusGeometry(.065, .013, 10, 24, Math.PI), m); h.position.y = -.06; g.add(h);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .13, 10), m); c.rotation.z = Math.PI / 2; g.add(c); return g; }
function trapBar() { const g = new THREE.Group(), st = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: .85, roughness: .3 });
  const hex = new THREE.Mesh(new THREE.TorusGeometry(.42, .016, 8, 6), st); hex.rotation.x = Math.PI / 2; hex.rotation.z = Math.PI / 6; hex.scale.set(.82, 1, 1); g.add(hex);
  for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .28, 12), st); h.rotation.x = Math.PI / 2; h.position.x = s * .29; g.add(h);
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .4, 12), st); sl.rotation.z = Math.PI / 2; sl.position.x = s * .52; g.add(sl);
    for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(.225, .225, .035, 40), new THREE.MeshStandardMaterial({ color: i ? 0x2a6fd6 : 0x22252b, roughness: .6, transparent: true, opacity: .42, depthWrite: false })); p.rotation.z = Math.PI / 2; p.position.x = s * (.58 + i * .04); g.add(p); } }
  return g; }
function pullBar() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x777d86, metalness: .7, roughness: .35 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, 1.3, 16), m); bar.rotation.z = Math.PI / 2; g.add(bar);
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .5), m); post.position.set(s * .65, 0, -.25); g.add(post); }
  return g;
}
// ---------- motion ----------
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function lerpPose(A, B, k) {
  const o = {};
  for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[key] ?? B[key], y = B[key] ?? A[key];
    if (Array.isArray(x)) o[key] = x.map((v, i) => v + (y[i] - v) * k);
    else if (typeof x === 'number') o[key] = x + (y - x) * k; else o[key] = k < .5 ? x : y;
  }
  return o;
}
export function poseAt(mo, time) {
  const total = mo.frames.reduce((s, f) => s + f.dur, 0);
  let t = (time % total + total) % total, i = 0;
  while (t > mo.frames[i].dur && i < mo.frames.length - 1) { t -= mo.frames[i].dur; i++; }
  const A = { ...mo.base, ...mo.frames[i].pose }, B = { ...mo.base, ...mo.frames[(i + 1) % mo.frames.length].pose };
  if (mo.travel && i === mo.frames.length - 1 && B.at) B.at = B.at.map((v, k) => v + mo.travel[k]);
  return { pose: lerpPose(A, B, ease(Math.min(1, t / mo.frames[i].dur))), phase: mo.frames[i].phase || 'hold' };
}
// ---------- stage ----------
export async function createStage(canvas, mo, opt = {}) {
  const gltf = await loadModel();
  const state = { hi: opt.hi || new Array(40).fill(0), border: opt.border ? 1 : 0 };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opt.capture });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.98;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(opt.bg || '#171a1e');
  const cam = new THREE.PerspectiveCamera(32, 1, .05, 50);
  scene.add(new THREE.HemisphereLight(0xf2eee6, 0x363b40, 1.35));
  const key = new THREE.DirectionalLight(0xfff1e4, 2.15); key.position.set(2.2, 4, 3); scene.add(key.target); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1.5 }); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd4e4eb, 0.82); rim.position.set(-3, 2.5, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.4, 64), new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const rig = makeRig(gltf, state); scene.add(rig.root); applyPose(rig, { ...mo.base, ...mo.frames[0].pose });
  const props = {};
  if (mo.props?.includes('barbell')) { props.bar = barbell(); scene.add(props.bar); props.bar.traverse(o => o.castShadow = true); }
  if (mo.props?.includes('block')) { const b = new THREE.Mesh(new THREE.BoxGeometry(.6, .12, .16), new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: .8 })); b.position.set(0, .06, .035); b.castShadow = b.receiveShadow = true; scene.add(b); }
  for (const bx of (mo.boxes || [])) { const b = new THREE.Mesh(new THREE.BoxGeometry(bx[3], bx[4], bx[5]), new THREE.MeshStandardMaterial({ color: bx[6] ?? 0x4a4f58, roughness: .8 })); b.position.set(bx[0], bx[1] + bx[4] / 2, bx[2]); if (bx[7]) { b.rotation.x = bx[7] * Math.PI / 180; } b.castShadow = b.receiveShadow = true; scene.add(b); }
  if (mo.props?.includes('kb')) { props.kb = kettlebell(); scene.add(props.kb); }
  if (mo.props?.includes('trapbar')) { props.trap = trapBar(); scene.add(props.trap); }
  if (mo.props?.includes('db2')) { props.dbs = [dumbbell(), dumbbell()]; props.dbs.forEach(d => { scene.add(d); d.traverse(o => o.castShadow = true); }); }
  if (mo.props?.includes('db1')) { props.db1 = dumbbell(); props.db1.rotation.z = Math.PI / 2; scene.add(props.db1); }
  if (mo.props?.includes('pullbar')) { props.pull = pullBar(); scene.add(props.pull); }
  const MS = c => new THREE.MeshStandardMaterial({ color: c, roughness: .6, metalness: .3 });
  props.cab = (mo.cables || []).map(([pp]) => { const pul = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .03, 20), MS(0x9aa0a8)); pul.rotation.z = Math.PI / 2; pul.position.set(...pp); scene.add(pul);
    const ln = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, 1, 6), MS(0x111111)); scene.add(ln); return ln; });
  if (mo.hbar) { const [len, col] = mo.hbar; const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, len, 16), MS(col ?? 0xb8bcc2)); r.rotation.z = Math.PI / 2; g.add(r); scene.add(g); props.hbar = g; }
  props.trk = (mo.track || []).map(t => { const g0 = t.cyl ? new THREE.CylinderGeometry(t.cyl[0], t.cyl[0], t.cyl[1], 20).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(t.box[0], t.box[1], t.box[2]); const m = new THREE.Mesh(g0, new THREE.MeshStandardMaterial({ color: (t.box || t.cyl)[t.cyl ? 2 : 3] ?? 0x3b2a22, roughness: .8 })); m.castShadow = m.receiveShadow = true; scene.add(m); return m; });
  if (mo.props?.includes('bench')) { const b = new THREE.Mesh(new THREE.BoxGeometry(.3, .42, 1.2), new THREE.MeshStandardMaterial({ color: 0x3b2a22 })); b.position.y = .21; scene.add(b); props.bench = b; }
  const ctl = new OrbitControls(cam, canvas); ctl.enableDamping = true; ctl.enablePan = false; ctl.minDistance = 0.4; ctl.maxDistance = 7;
  const tgt = new THREE.Vector3(...(mo.camTarget || [0, .9, 0])); ctl.target.copy(tgt);
  const dist = mo.camDist || 3.6;
  const VIEWS = { front: 0, side: 90, back: 180, three: 40 };
  function setView(v) { if (props.bar) props.bar.traverse(o => { if (o.material && o.material.transparent) o.material.opacity = (v === 'side') ? 0.12 : 0.42; });
    const a = (VIEWS[v] ?? v) * Math.PI / 180; cam.position.set(tgt.x + Math.sin(a) * dist, tgt.y + .35, tgt.z + Math.cos(a) * dist); ctl.target.copy(tgt); ctl.update(); }
  setView(opt.view || mo.view || 'three');
  let speed = 1, playing = true, t = 0, last = performance.now(), raf, phaseCb = opt.onPhase, lastPhase;
  const wp = n => { const x = new THREE.Vector3(); rig.bones[n].getWorldPosition(x); return x; };
  function frame(time) {
    const { pose, phase } = poseAt(mo, time); applyPose(rig, pose);
    if (mo.follow) { if (rig._fz0 === undefined) { applyPose(rig, poseAt(mo, 0).pose); rig._fz0 = wp('pelvis').z; applyPose(rig, pose); } const dz = tgt.z + wp('pelvis').z - rig._fz0 - ctl.target.z;
      cam.position.z += dz; ctl.target.z += dz; const oz = ctl.target.z - tgt.z; floor.position.z = oz; key.position.z = 3 + oz; key.target.position.z = oz; key.target.updateMatrixWorld(); }
    if (props.bar) {
      if (mo.barAt === 'front') { const mid = wp('upperarm_l').add(wp('upperarm_r')).multiplyScalar(.5); const tq = rig.bones.spine_03.getWorldQuaternion(new THREE.Quaternion()).multiply(rig.rest.spine_03.wq.clone().invert()); props.bar.position.copy(mid).add(new THREE.Vector3(0, 0.0, 0.085).applyQuaternion(tq)); }
      else if (mo.barAt === 'back') { const mid = wp('upperarm_l').add(wp('upperarm_r')).multiplyScalar(.5); const tq = rig.bones.spine_03.getWorldQuaternion(new THREE.Quaternion()).multiply(rig.rest.spine_03.wq.clone().invert()); props.bar.position.copy(mid).add(new THREE.Vector3(0, -0.015, -0.125).applyQuaternion(tq)); }
      else { const p = gpt(rig, 'l').lerp(gpt(rig, 'r'), .5); props.bar.position.copy(p).add(new THREE.Vector3(...(mo.barOffset || [0, 0, 0]))); }
    }
    if (props.dbs) for (const [i, s] of [[0, 'l'], [1, 'r']]) { const hq = rig.bones['hand_' + s].getWorldQuaternion(new THREE.Quaternion()); props.dbs[i].position.copy(gpt(rig, s)); props.dbs[i].visible = !mo.dbHands || mo.dbHands.includes(s); if (mo.dbRot !== undefined) { props.dbs[i].quaternion.copy(rig.R || new THREE.Quaternion()); props.dbs[i].rotateY(mo.dbRot * Math.PI / 180); } else { const ax = wp('pinky_01_' + s).sub(wp('index_01_' + s)).normalize(); props.dbs[i].quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ax); } }
    if (props.db1) { props.db1.position.copy(wp('hand_l').lerp(wp('hand_r'), .5)).add(new THREE.Vector3(...(mo.db1Off || [0, -0.04, 0.03]))); }
    if (props.kb) { const p = gpt(rig, 'l').lerp(gpt(rig, 'r'), .5), w = wp('hand_l').lerp(wp('hand_r'), .5); const d = p.clone().sub(w).normalize(); props.kb.position.copy(p); props.kb.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d); }
    if (props.trap) { props.trap.position.copy(gpt(rig, 'l').lerp(gpt(rig, 'r'), .5)); props.trap.quaternion.copy(rig.R || new THREE.Quaternion()); }
    const sideP = k => k === 'mid' ? gpt(rig, 'l').lerp(gpt(rig, 'r'), .5) : gpt(rig, k);
    if (props.hbar) { props.hbar.position.copy(sideP('mid')); const ax = gpt(rig, 'r').sub(gpt(rig, 'l')); if (ax.length() > .02) props.hbar.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), ax.normalize()); else props.hbar.quaternion.copy(rig.R || new THREE.Quaternion()); }
    (mo.cables || []).forEach(([pp, at, off], i) => { const a = new THREE.Vector3(...pp), b = sideP(at).add(new THREE.Vector3(...(off || [0, 0, 0]))); const ln = props.cab[i]; ln.position.copy(a).lerp(b, .5); ln.scale.set(1, a.distanceTo(b), 1); ln.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize()); });
    (mo.track || []).forEach((t, i) => { const m = props.trk[i]; const c = new THREE.Vector3(); t.at.forEach(n => c.add(wp(n))); c.multiplyScalar(1 / t.at.length).add(new THREE.Vector3(...(t.off || [0, 0, 0]))); if (t.fix) t.fix.forEach((v, k) => { if (v !== null) c.setComponent(k, v); }); m.rotation.set((t.rot || 0) * Math.PI / 180, 0, 0); if (t.rel) { const q = rig.bones[t.rel].getWorldQuaternion(new THREE.Quaternion()).multiply(rig.rest[t.rel].wq.clone().invert()); c.add(new THREE.Vector3(...t.roff).applyQuaternion(q)); if (t.orient) m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(m.rotation)); } m.position.copy(c); });
    if (props.pull) props.pull.position.set(0, (mo.barY || 2.25), mo.barZ || 0);
    if (phase !== lastPhase) { lastPhase = phase; phaseCb && phaseCb(phase); }
  }
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  function loop(now) { const dt = (now - last) / 1000; last = now; if (playing) t += dt * speed; frame(t); ctl.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop); }
  raf = requestAnimationFrame(loop);
  return {
    setView, toggle() { playing = !playing; return playing; }, setSpeed(s) { speed = s; },
    setShoes(mode) { rig.root.traverse(o => { if (o.isMesh && /shoe/i.test(o.name + (o.material?.name || ''))) { o.visible = mode !== 'off'; o.material.transparent = mode === 'clear'; o.material.opacity = mode === 'clear' ? 0.28 : 1; o.material.depthWrite = mode !== 'clear'; o.material.needsUpdate = true; } }); },
    seek(x) { t = x; frame(t); renderer.render(scene, cam); }, setHi(h) { state.hi.splice(0, 40, ...h); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose(); renderer.dispose(); },
    render() { frame(t); renderer.render(scene, cam); }, renderer, rig
  };
}
// ---------- anatomy map (front/back static, labelled) ----------
export async function createAnatomy(canvas, labelsEl, hi) {
  const gltf = await loadModel();
  const state = { hi, border: 1 };
  const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = new URL('./models/regions.png', import.meta.url).href; });
  const RS = 512, cv = document.createElement('canvas'); cv.width = cv.height = RS; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, RS, RS);
  const regPix = cx.getImageData(0, 0, RS, RS).data;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2)); const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(0, 2, 3); scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0xffffff, 1.2); dl2.position.set(0, 2, -3); scene.add(dl2); const dl3 = new THREE.DirectionalLight(0xffffff, 2.2); dl3.position.set(0, -3, 0.5); scene.add(dl3);
  const rigs = [makeRig(gltf, state), makeRig(gltf, state)];
  rigs.forEach(r => r.root.traverse(o => { if (o.isMesh && /shoe/i.test(o.name + (o.material?.name || ''))) o.visible = false; }));
  const cs = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 3.07); cs.up.set(0, 0, 1); cs.position.set(-0.46, -3, 0.06); cs.lookAt(-0.46, 0, 0.06);
  const MF = 0.8;
  rigs.forEach((r, i) => { scene.add(r.root); applyPose(r, { uarm: 0, uarmAb: 16, farm: 8, farmAb: 14, farmTw: i ? 0 : 0, thighAb: 6, shinAb: 4, bodyRot: [0, i ? 180 : 0, 0], at: [i ? 0.46 : -0.46, 0, 0] }); });
  const cam = new THREE.OrthographicCamera(-1.05, 1.05, 1.82, -0.04, -10, 10); cam.position.set(0, 0, 5);
  function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); const sa = (0.5 * w) / (0.2 * h), sh2 = 0.17; cs.left = -sh2 * sa; cs.right = sh2 * sa; cs.top = sh2 + 0.03; cs.bottom = -sh2 + 0.03; cs.updateProjectionMatrix(); const a = w / (h * MF); let ww = 2.5, hh = ww / a; if (hh < 1.95) { hh = 1.95; ww = hh * a; } cam.left = -ww / 2; cam.right = ww / 2; cam.top = 0.93 + hh / 2; cam.bottom = 0.93 - hh / 2; cam.updateProjectionMatrix(); }
  resize();
    const anchors = []; // {id, view, x, y} in 0..1 canvas coords for ALL muscles
  function computeAnchors() {
    anchors.length = 0;
    rigs.forEach((r, vi) => {
      const g = r.body.geometry, uv = g.attributes.uv, pos = new THREE.Vector3(), nrm = g.attributes.normal, acc = {};
      for (let i = 0; i < uv.count; i++) {
        const id = regPix[(Math.min(RS - 1, Math.floor(uv.getY(i) * RS)) * RS + Math.min(RS - 1, Math.floor(uv.getX(i) * RS))) * 4]; if (!id) continue;
        r.body.getVertexPosition(i, pos); pos.applyMatrix4(r.body.matrixWorld);
        const n = new THREE.Vector3().fromBufferAttribute(nrm, i).applyQuaternion(r.root.quaternion); if (n.z < .35) continue;
        const lx = (pos.x - r.root.position.x) * (vi ? -1 : 1); if (lx <= 0) continue; // body-left side only
        (acc[id] ||= []).push(pos.clone());
      }
      for (const [id, ps] of Object.entries(acc)) { if (ps.length < 3) continue;
        const c = ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length), sp = c.project(cam);
        anchors.push({ id: +id, view: vi, x: (sp.x + 1) / 2, y: MF * (1 - sp.y) / 2 }); }
    });
    { const r = rigs[0], g = r.body.geometry, uv = g.attributes.uv, pos = new THREE.Vector3(), nrm = g.attributes.normal, acc = {};
      for (let i = 0; i < uv.count; i++) {
        const id = regPix[(Math.min(RS - 1, Math.floor(uv.getY(i) * RS)) * RS + Math.min(RS - 1, Math.floor(uv.getX(i) * RS))) * 4]; if (!id) continue;
        const n = new THREE.Vector3().fromBufferAttribute(nrm, i).applyQuaternion(r.root.quaternion); if (n.y > -.35 || MUS[id - 1]?.g !== 'feet') continue;
        r.body.getVertexPosition(i, pos); pos.applyMatrix4(r.body.matrixWorld); if (pos.x > r.root.position.x) continue;
        (acc[id] ||= []).push(pos.clone()); }
      for (const [id, ps] of Object.entries(acc)) { if (ps.length < 3) continue;
        const c = ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length), sp = c.project(cs);
        anchors.push({ id: +id, view: 2, x: 0.25 + 0.5 * (sp.x + 1) / 2, y: MF + (1 - MF) * (1 - sp.y) / 2 }); } }
  }
  const NS = 'http://www.w3.org/2000/svg';
  function layout(extra) {
    labelsEl.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'aleads'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); labelsEl.appendChild(svg);
    const H = labelsEl.clientHeight || 1, gap = 23 / H; // min vertical gap (fraction)
    for (const vi of [0, 1, 2]) {
      const its = anchors.filter(a => a.view === vi && (hi[a.id] || a.id === extra)).sort((a, b) => a.y - b.y);
      // spread in column, keep order, avoid collisions
      let last = -1; for (const it of its) { it.ly = Math.max(it.y, last + gap); last = it.ly; }
      const over = last - 0.97; if (over > 0) for (const it of its) it.ly -= over * (it.ly / last);
      for (let i = its.length - 2; i >= 0; i--) its[i].ly = Math.min(its[i].ly, its[i + 1].ly - gap);
      const colX = vi ? 0.985 : 0.015; if (vi === 2) { for (const it of its) it.ly = Math.max(it.ly, MF + 0.02); }
      for (const it of its) {
        const m = MUS[it.id - 1], el = document.createElement('span');
        el.className = 'alab ' + (hi[it.id] > 1 ? 'p' : hi[it.id] ? 's' : 'x') + (vi ? ' rt' : ' lt'); el.textContent = m.zh;
        el.style.top = (it.ly * 100) + '%'; el.style.left = (colX * 100) + '%'; labelsEl.appendChild(el);
        const ln = document.createElementNS(NS, 'polyline'), ex = vi ? 0.80 : 0.20;
        ln.setAttribute('points', `${ex * 100},${it.ly * 100} ${(ex + (vi ? -0.03 : 0.03)) * 100},${it.ly * 100} ${it.x * 100},${it.y * 100}`);
        ln.setAttribute('class', hi[it.id] > 1 ? 'p' : 's'); svg.appendChild(ln);
        const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', it.x * 100); dot.setAttribute('cy', it.y * 100); dot.setAttribute('r', .7); svg.appendChild(dot);
      }
    }
  }
  const draw = () => { const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setScissorTest(true); renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.setViewport(0, h * (1 - MF), w, h * MF); renderer.setScissor(0, h * (1 - MF), w, h * MF); renderer.render(scene, cam);
    renderer.setViewport(w * 0.25, 0, w * 0.5, h * (1 - MF)); renderer.setScissor(w * 0.25, 0, w * 0.5, h * (1 - MF)); renderer.render(scene, cs); renderer.setScissorTest(false);
    computeAnchors(); layout(); };
  canvas.addEventListener('click', ev => { // tap-to-show any muscle
    const r = canvas.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    let best = null, bd = 1e9; for (const a of anchors) { const d = (a.x - x) ** 2 + (a.y - y) ** 2; if (d < bd) { bd = d; best = a; } }
    if (best && bd < 0.006) layout(best.id);
  });
  draw();
  const ro = new ResizeObserver(() => { resize(); draw(); }); ro.observe(canvas);
  return { destroy() { ro.disconnect(); renderer.dispose(); } };
}
