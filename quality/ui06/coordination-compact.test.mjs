import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coachCoordinationNext } from '../../src/lib/ui/coach-coordination-view.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const hub = read('src/components/coach-coordination-hub.tsx');
const logic = read('src/lib/ui/coach-coordination-view.ts');
const style = read('src/styles.css');
test('next action derives only from existing readouts', () => {
  assert.match(logic, /coachCoordinationNext/);
  assert.match(logic, /未标记不等于未训练/);
  assert.match(logic, /尚未读取完成/);
});
test('action uses existing navigation; no AI or storage write', () => {
  assert.match(hub, /onNavigate\(next\.target\)/);
  assert.doesNotMatch(hub, /savePlan\(|localStorage|fetch\(|askCoach\(/);
});
test('training mechanism is collapsed by default and remains findable', () => {
  assert.match(hub, /<details className="fangkun-mechanism-rail"/);
  assert.doesNotMatch(hub, /<details[^>]*open/);
  assert.match(hub, /训练刺激.*身体响应.*恢复与适应.*专项表现/s);
});
test('UI retains keyboard focus and small-screen layout', () => {
  assert.match(style, /fangkun-next-action:focus-visible/);
  assert.match(style, /max-width: 390px/);
});

test('navigation hint cannot invent completion or assessment', () => {
  const pending = coachCoordinationNext({loaded:true,todayPlanned:3,todayMarkedDone:1,strengthSessions:1});
  assert.equal(pending.target,'today');
  assert.match(pending.detail,/1\/3/);
  const unread = coachCoordinationNext({loaded:false,todayPlanned:20,todayMarkedDone:20,strengthSessions:0});
  assert.equal(unread.target,'today');
  assert.match(unread.detail,/不能判断/);
  const none = coachCoordinationNext({loaded:true,todayPlanned:0,todayMarkedDone:0,strengthSessions:0});
  assert.equal(none.target,'log');
  assert.doesNotMatch(none.detail,/已恢复|已完成训练/);
});
