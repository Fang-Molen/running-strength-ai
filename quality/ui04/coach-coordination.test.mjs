import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coachCoordinationView } from '../../src/lib/ui/coach-coordination-view.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(resolve(appRoot, path), 'utf8');
const app = read('src/components/strength-app.tsx');
const coach = read('src/components/coach-sheet.tsx');
const hub = read('src/components/coach-coordination-hub.tsx');
const css = read('src/styles.css');

const sample = { loaded: true, todayPlanned: 2, todayMarkedDone: 1, strengthSessions: 3 };

test('coach hub joins existing four destinations without inventing an engine', () => {
  const rows = coachCoordinationView(sample);
  assert.deepEqual(rows.map(item => item.id), ['plan', 'today', 'log', 'body']);
  assert.equal(rows.find(item => item.id === 'today').readout, '1/2 项完成标记');
  assert.equal(rows.find(item => item.id === 'plan').readout, '当前显示 3 节力量课');
  assert.ok(rows.every(item => item.readout && item.role));
});

test('unknown or invalid counters cannot imply actual training completion', () => {
  const values = coachCoordinationView({loaded:false, todayPlanned:100, todayMarkedDone:200, strengthSessions:99});
  assert.equal(values[1].readout, '读取中');
  assert.equal(values[0].readout, '读取中');
  const bad = coachCoordinationView({loaded:true, todayPlanned:-1, todayMarkedDone:NaN, strengthSessions:Infinity});
  assert.equal(bad[1].readout, '尚无已确认课程');
  assert.equal(bad[0].readout, '力量课未安排');
  const capped = coachCoordinationView({loaded:true, todayPlanned:2, todayMarkedDone:99, strengthSessions:1});
  assert.equal(capped[1].readout, '2/2 项完成标记');
});

test('real coach scroll includes the hub and routes to existing five-tab state', () => {
  assert.match(app, /coordinationPanel=\{<CoachCoordinationHub/);
  assert.match(app, /onNavigate=\{\(next\) => setTab\(next\)\}/);
  assert.match(coach, /\{coordinationPanel \?\? null\}/);
  assert.match(hub, /onClick=\{\(\) => onNavigate\(id\)\}/);
  assert.match(app, /\["coach", "方坤", MessageCircle\]/);
});

test('hub communicates user authority and does not mutate or call a model', () => {
  assert.match(hub, /未经确认不改计划/);
  assert.match(hub, /未记录不等于正常/);
  assert.doesNotMatch(hub, /localStorage|sessionStorage|fetch\(|askCoach\(|savePlan\(|dispatchEvent\(/);
  const view = read('src/lib/ui/coach-coordination-view.ts');
  assert.doesNotMatch(view, /localStorage|fetch\(|dispatchEvent\(|savePlan\(/);
});

test('small-screen, dark-theme and keyboard styling remain available', () => {
  assert.match(css, /\.fangkun-hub/);
  assert.match(css, /\.ui04-coach-tab/);
  assert.match(css, /@media \(max-width: 365px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /data-theme="dark"/);
});
