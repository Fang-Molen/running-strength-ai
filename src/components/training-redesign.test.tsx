import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrainingEditorSheet } from './training-editor-sheet';
import { ExerciseDetailBody } from './exercise-editor';
import { ExerciseContent } from './exercise-content';
import { BodyFigureSheet } from './body-figure-sheet';
import { SchedulePicker } from './scheduled-training';
import { setStoreBackend } from '@/lib/core/storage';
import { saveSchedule } from '@/lib/ui/day-schedule';
import { newTrainingDraft, draftEntry } from '@/lib/ui/training-editor';
beforeEach(() => {
  const data = new Map<string, string>(); const store = { keys: () => [...data.keys()], getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  setStoreBackend(store); Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});
test('new training exposes a date, two primary types, and a fixed form submit target', () => {
  const html = renderToStaticMarkup(<TrainingEditorSheet date="2026-10-17" onClose={() => {}} onSave={async () => ({ ok: true })} />);
  for (const label of ['训练日期', '跑步运动', '力量训练', '肌肉图选择', '预计时长']) assert.ok(html.includes(label));
  assert.match(html, /type="date"/); assert.match(html, /type="submit" form="[^"]+"/); assert.match(html, /role="dialog"/);
});
test('the timer picker renders only the selected date calendar courses', () => {
  const a = draftEntry({ ...newTrainingDraft('2026-10-17', 'my-run'), type: 'run', name: '我的8公里', distance: '8000', minutes: '40' }); assert.ok(a.ok);
  saveSchedule({ entries: [a.entry, { ...a.entry, id: 'tomorrow', date: '2026-10-18', title: '明天的训练' }], acks: [] });
  const html = renderToStaticMarkup(<SchedulePicker date="2026-10-17" onClose={() => {}} onAdd={() => {}} onChoose={() => {}} />);
  assert.match(html, /我的8公里/); assert.doesNotMatch(html, /明天的训练|跑步·推进|先选择课程/);
});
test('execution and library details share the same 3D content renderer', () => {
  const direct = renderToStaticMarkup(<ExerciseDetailBody id="bss" />), execution = renderToStaticMarkup(<ExerciseContent catalogId="bss" />);
  assert.equal(direct, execution); assert.match(direct, /新版动作演示区域/); assert.match(direct, /未验收时显示今晚角色外观参考/); assert.doesNotMatch(direct, /athlete-male|athlete-female|viewer3d/); assert.match(direct, /独立肌肉/); assert.doesNotMatch(direct, /查看未审校示意/);
});
test('body targets compare recorded numbers and never claim the portrait is a finished personal 3D', () => {
  const html = renderToStaticMarkup(<BodyFigureSheet sex="male" kg={56} bf={9} targetKg={60} targetBf={null} onClose={() => {}} onData={() => {}} onSaved={() => {}} />);
  assert.match(html, /当前与目标/); assert.match(html, /新版人物3D待外观与动作验收/); assert.match(html, /女性参考/); assert.match(html, /不是通过体重、体脂自动计算的人体外形/); assert.doesNotMatch(html, /fangkun-atlas\/figure|fangkun-new-visual|demo3d\/models/); assert.match(html, /56/); assert.match(html, /60/);
  assert.match(html, /<canvas[^>]*visibility:hidden[^>]*aria-hidden="true"/);
  assert.match(html, /角色外观参考图（非3D）/);
  assert.equal((html.match(/<img[^>]+src="\/fangkun-character\/male-front.webp"/g) ?? []).length, 2);
});
