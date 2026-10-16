// 方坤 动作演示渲染器 — framework-agnostic ES module, no deps. Self-made, MIT.
// Pose: angles in degrees, direction proximal->distal. 0=down, 90=forward(right), 180=up, -90=back(left).
export const L = { trunk: 50, neck: 8, head: 8, thigh: 42, shin: 40, foot: 13, uarm: 28, farm: 26 };
const D = a => [Math.sin(a * Math.PI / 180), Math.cos(a * Math.PI / 180)];
const add = (p, a, l) => { const d = D(a); return [p[0] + d[0] * l, p[1] + d[1] * l]; };
const sub = (p, a, l) => add(p, a, -l);
export const BASE = { trunk: 180, neck: 180, thigh: 0, shin: 0, foot: 90, uarm: 0, farm: 0, sh: 0 };

export function solve(p0) {
  const p = { ...BASE, ...p0 };
  const front = p.view === 'front';
  for (const k of ['thigh', 'shin', 'foot', 'uarm', 'farm']) if (p[k + '2'] === undefined) p[k + '2'] = front ? (['uarm', 'farm'].includes(k) ? 2 * p.trunk - p[k] : -p[k]) : p[k];
  let hip, sho;
  const a = p.anchor || 'hip', at = p.at || [100, 100];
  const shoFromHip = h => { const s = add(h, p.trunk, L.trunk); return [s[0], s[1] - p.sh]; };
  if (a === 'hip') hip = at;
  else if (a === 'ankle') hip = sub(sub(at, p.shin, L.shin), p.thigh, L.thigh);
  else if (a === 'toe') { const an = sub(at, p.foot, L.foot); hip = sub(sub(an, p.shin, L.shin), p.thigh, L.thigh); }
  else if (a === 'knee') hip = sub(at, p.thigh, L.thigh);
  else if (a === 'wrist' || a === 'elbow') {
    sho = a === 'wrist' ? sub(sub(at, p.farm, L.farm), p.uarm, L.uarm) : sub(at, p.uarm, L.uarm);
    hip = sub([sho[0], sho[1] + p.sh], p.trunk, L.trunk);
  } else if (a === 'shoulder') { sho = at; hip = sub([at[0], at[1] + p.sh], p.trunk, L.trunk); }
  sho = sho || shoFromHip(hip);
  const neckTop = add(sho, p.neck, L.neck), head = add(neckTop, p.neck, L.head);
  const J = { hip, sho, neckTop, head, front };
  const lat = front ? 10 : 0, hl = front ? 6 : 0, perp = p.trunk - 90;
  for (const s of ['', '2']) {
    const sg = s ? -1 : 1, H = add(hip, perp, hl * sg), S = add(sho, perp, lat * sg);
    J[s ? 'hip2' : 'hip1'] = H; J[s ? 'sho2' : 'sho1'] = S;
    J['knee' + s] = add(H, p['thigh' + s], L.thigh);
    J['ankle' + s] = add(J['knee' + s], p['shin' + s], L.shin);
    J['toe' + s] = add(J['ankle' + s], p['foot' + s], L.foot);
    J['elbow' + s] = add(S, p['uarm' + s], L.uarm);
    J['wrist' + s] = add(J['elbow' + s], p['farm' + s], L.farm);
  }
  return J;
}
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function lerpAng(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
export function poseAt(anim, time) {
  // anim.frames: [{pose,dur}] loops; returns {pose, phase:'con'|'ecc'|'hold', idx}
  const total = anim.frames.reduce((s, f) => s + f.dur, 0);
  let t = (time % total + total) % total, i = 0;
  while (t > anim.frames[i].dur) { t -= anim.frames[i].dur; i++; }
  const A = { ...anim.base, ...anim.frames[i].pose }, B = { ...anim.base, ...anim.frames[(i + 1) % anim.frames.length].pose };
  const k = ease(t / anim.frames[i].dur), out = {};
  for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = A[key] ?? B[key], y = B[key] ?? A[key];
    if (Array.isArray(x)) out[key] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k];
    else if (typeof x === 'number') out[key] = /^(sh|z)/.test(key) ? x + (y - x) * k : lerpAng(x, y, k);
    else out[key] = x;
  }
  return { pose: out, phase: anim.frames[i].phase || 'hold', idx: i };
}
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const seg = (g, a, b, w, c, extra = {}) => el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', ...extra }, g);
// which figure segment glows for which muscle (side view)
export const SEG_MUSCLE = {
  trunk: ['chest', 'abs', 'obliques', 'lats', 'erectors', 'rhomboids', 'traps'], thigh: ['quads', 'hamstrings', 'glutes', 'adductors', 'hip_flexors', 'glute_med'],
  shin: ['calves'], uarm: ['delt_front', 'delt_side', 'delt_rear', 'biceps', 'triceps'], farm: ['forearm']
};
export function drawFrame(svg, anim, time, opt = {}) {
  const { pose, phase } = poseAt(anim, time); const J = solve(pose);
  const C = opt.colors || { body: '#cfd6df', far: '#6b7480', p: '#ff5a3c', s: '#ffb199', prop: '#8a93a0', ground: '#2a3038' };
  const pri = new Set(opt.primary || []), sec = new Set(opt.secondary || []);
  const active = phase !== 'ecc' || opt.always; const glow = m => (SEG_MUSCLE[m] || []).some(x => pri.has(x)) ? C.p : (SEG_MUSCLE[m] || []).some(x => sec.has(x)) ? C.s : null;
  svg.textContent = '';
  const g = el('g', {}, svg);
  seg(g, [-200, 180], [400, 180], 1.5, C.ground);
  for (const pr of anim.props || []) drawProp(g, pr, J, C);
  const W = 7, col = (m, far) => { const c = glow(m); return c ? c : (far && !J.front ? C.far : C.body); };
  g.setAttribute('data-phase', phase);
  // far limbs
  const fo = J.front ? 1 : .55; seg(g, J.hip2, J.knee2, W, col('thigh', 1), { opacity: fo }); seg(g, J.knee2, J.ankle2, W - 1, col('shin', 1), { opacity: fo }); seg(g, J.ankle2, J.toe2, 4, C.far);
  seg(g, J.sho2, J.elbow2, W - 1, col('uarm', 1), { opacity: fo }); seg(g, J.elbow2, J.wrist2, W - 2, col('farm', 1), { opacity: fo });
  if (J.front) { seg(g, J.hip2, J.hip, W + 2, col('trunk')); seg(g, J.sho2, J.sho, W + 2, col('trunk')); }
  g.style.setProperty('--a', active ? 1 : .55);
  seg(g, J.hip, J.sho, W + 4, col('trunk')); seg(g, J.sho, J.neckTop, 5, C.body);
  el('circle', { cx: J.head[0], cy: J.head[1], r: L.head, fill: C.body }, g);
  seg(g, J.hip1 || J.hip, J.knee, W + 1, col('thigh')); seg(g, J.knee, J.ankle, W, col('shin')); seg(g, J.ankle, J.toe, 4, C.body);
  for (const pr of anim.held || []) drawHeld(g, pr, J, C);
  seg(g, J.sho1 || J.sho, J.elbow, W - 1, col('uarm')); seg(g, J.elbow, J.wrist, W - 2, col('farm'));
  for (const pr of anim.heldFront || []) { drawHeld(g, pr, J, C); if (pr.at === 'wrist' && pr.type !== 'barbell') drawHeld(g, { ...pr, at: 'wrist2' }, J, C); }
  return { phase, J };
}
function drawProp(g, pr, J, C) {
  const c = C.prop;
  if (pr.type === 'bench') el('rect', { x: pr.x, y: pr.y, width: pr.w, height: 5, rx: 2, fill: c }, g), seg(g, [pr.x + 6, pr.y + 5], [pr.x + 6, 180], 3, c), seg(g, [pr.x + pr.w - 6, pr.y + 5], [pr.x + pr.w - 6, 180], 3, c);
  if (pr.type === 'box') el('rect', { x: pr.x, y: pr.y, width: pr.w, height: 180 - pr.y, rx: 2, fill: 'none', stroke: c, 'stroke-width': 2 }, g);
  if (pr.type === 'bar') seg(g, [pr.x1, pr.y], [pr.x2, pr.y], 3, c), seg(g, [pr.x1, pr.y], [pr.x1, 180], 2, c);
  if (pr.type === 'cable') { const w = J[pr.to || 'wrist']; seg(g, [pr.x, pr.y], w, 1.2, '#7fb6ff'); el('circle', { cx: pr.x, cy: pr.y, r: 3, fill: c }, g); }
  if (pr.type === 'mat') seg(g, [pr.x1, 179], [pr.x2, 179], 3, '#3a4250');
}
function drawHeld(g, pr, J, C) {
  const p = J[pr.at || 'wrist'], o = pr.off || [0, 0], x = p[0] + o[0], y = p[1] + o[1], c = '#e7c35a';
  if (pr.type === 'barbell') el('circle', { cx: x, cy: y, r: 11, fill: 'none', stroke: c, 'stroke-width': 3 }, g), el('circle', { cx: x, cy: y, r: 2.5, fill: c }, g);
  if (pr.type === 'dumbbell') el('rect', { x: x - 6, y: y - 3, width: 12, height: 6, rx: 2, fill: c }, g);
  if (pr.type === 'kettlebell') el('circle', { cx: x, cy: y + 6, r: 6, fill: c }, g), el('path', { d: `M${x - 3} ${y + 1} Q${x} ${y - 5} ${x + 3} ${y + 1}`, stroke: c, fill: 'none', 'stroke-width': 2 }, g);
  if (pr.type === 'handle') el('rect', { x: x - 4, y: y - 2, width: 8, height: 4, rx: 1, fill: c }, g);
}
// Player: requestAnimationFrame loop with play/pause/speed
export function fitBox(anim, pad = 8) {
  const tot = anim.frames.reduce((s, f) => s + f.dur, 0); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let t = 0; t < tot; t += tot / 24) { const J = solve(poseAt(anim, t).pose); for (const k in J) { if (!Array.isArray(J[k])) continue; const [x, y] = J[k]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  for (const pr of anim.props || []) { if (pr.y != null) y0 = Math.min(y0, pr.y); if (pr.x != null) { x0 = Math.min(x0, pr.x); x1 = Math.max(x1, pr.x + (pr.w || 0)); } }
  y0 -= L.head + 2; y1 = Math.max(y1, 180); const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad, s = Math.max(w, h, 110), cx = (x0 + x1) / 2;
  return `${cx - s / 2} ${y1 + pad - s + 4} ${s} ${s}`;
}
export function createPlayer(svg, anim, opt = {}) {
  svg.setAttribute('viewBox', fitBox(anim));
  let speed = 1, playing = true, t = 0, last = null, raf, onPhase = opt.onPhase, lastPhase;
  const tick = ts => { if (last != null && playing) t += (ts - last) / 1000 * speed; last = ts;
    const r = drawFrame(svg, anim, t, opt); if (r.phase !== lastPhase) { lastPhase = r.phase; onPhase && onPhase(r.phase); } raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  return { play() { playing = true }, pause() { playing = false }, toggle() { playing = !playing; return playing }, setSpeed(s) { speed = s }, get playing() { return playing }, destroy() { cancelAnimationFrame(raf) } };
}
