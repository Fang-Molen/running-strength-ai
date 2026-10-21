import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseV4StrengthText, parseV4RunText, plan400TodayEntry } from './plan400-start';
import { resolveScheduledCourse, scheduleExecutionId } from './scheduled-execution';
import { loadSchedule, saveScheduledEntry } from './day-schedule';
import { syncScheduleProgress } from './schedule-progress';
import { loadTrainingActivities } from './training-read-model';
import { discardGuided, guidedLive } from './guided-discard';
import { recoveryVerdict } from './recovery-verdict';
import { recovery10, recoveryText } from '@/lib/health/legacy-inputs';
import { setStoreBackend, type MemoryStore } from '@/lib/core/storage';
import { listTrainingOccurrences, bindTrainingStart } from '@/lib/core/occurrence';
import { dispatchEvent } from '@/lib/core/events';
import { emptySets, recordSet, executionOf } from '@/lib/core/execution';
import { occurrenceVoided } from '@/lib/core/training-correction';
import { interruptFromRunner } from '@/components/training-runner';
import plan from '../../../test-fixtures/private/plan400-v4.json' with { type: 'json' };

const dose = (n: string) => ({ unit: /侧桥|平板/.test(n) ? 'sec' as const : 'reps' as const, perSide: /分腿|抗旋|侧桥|台阶/.test(n) });
function memory() { const map = new Map<string, string>(); return { keys: () => [...map.keys()], getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; }
beforeEach(() => { const store = memory(); setStoreBackend(store as MemoryStore); Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true }); Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true }); Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_: string, cb: () => unknown) => cb() } }, configurable: true }); });
const d1019 = (plan as { days: { date: string; title: string; main: string[]; strength: string[] }[] }).days.find(d => d.date === '2026-10-19')!;

test('V4 力量文字稳健解析：×/x、/腿、区间取下限、RPE 段丢弃、RDL 不被截断', () => {
  const p = parseV4StrengthText(d1019.strength.join(''));
  assert.deepEqual(p.map(m => `${m.name} ${m.sets}x${m.reps}${m.perSide ? '/侧' : ''}`), ['分腿蹲 2x5/侧', 'RDL 2x5', '臀推 2x6', '提踵 2x8', '抗旋 2x8']);
  assert.deepEqual(parseV4StrengthText('A2：分腿蹲 2—3x4/腿, RDL2X5、侧桥2×20秒/侧；RPE6').map(m => [m.name, m.sets, m.reps, m.unit, m.perSide]), [['分腿蹲', '2', '4', 'reps', true], ['RDL', '2', '5', 'reps', false], ['侧桥', '2', '20', 'sec', true]]);
});
test('V4 跑步主课解析：150m×3 组间6—8分钟 → 3×150m 休 360 秒；多段＋；写不清不猜', () => {
  assert.deepEqual(parseV4RunText(d1019.main.slice(1).join('')), { steps: [{ distanceM: 150, reps: 3 }], restSec: 360 });
  assert.deepEqual(parseV4RunText('正式主课：120m×2＋150m×2，组间7—10分钟'), { steps: [{ distanceM: 120, reps: 2 }, { distanceM: 150, reps: 2 }], restSec: 420 });
  assert.equal(parseV4RunText('正式主课：(250m＋150m)×1；两段间休10—12分钟。仅在此前200m×4完成良好时'), null);
  assert.equal(parseV4RunText('轻松跑20—30分钟，RPE 2—3'), null);
});
test('今天的 V4 课 → 一条可执行条目（同一 id），逐组力量 + 分段跑都能开始', () => {
  const e = plan400TodayEntry(d1019, null, dose)!;
  assert.equal(e.id, 'plan400:2026-10-19:strength'); assert.equal(e.trainingType, 'mixed');
  assert.equal(e.exercises!.length, 5); assert.ok(e.exercises!.every(x => x.restSec === 75 && x.weight === '0'));
  const c = resolveScheduledCourse(e, { sessions: [] }, []);
  assert.deepEqual(c.errors, []); assert.equal(c.strength!.moves.length, 5); assert.equal(c.strength!.moves[0].perSide, true);
  const step = (c.run!.components[0] as { structure: { blocks: { steps: { repeatCount: number; plannedDistanceMeters: number; recoveryAfterRepeatSeconds: number }[] }[] } }).structure.blocks[0].steps[0];
  assert.deepEqual([step.repeatCount, step.plannedDistanceMeters, step.recoveryAfterRepeatSeconds], [3, 150, 360]);
  const rest = (plan as { days: { date: string; title: string; main: string[]; strength: string[] }[] }).days.find(d => /休息/.test(d.title))!;
  assert.equal(plan400TodayEntry(rest, null, dose), null, '休息日没有可执行条目 → 普通计时器');
});
test('自定力量课的组间/动作间休息原样进入引导（75 秒/135 秒）', () => {
  const e = plan400TodayEntry(d1019, { parts: ['下肢'], exercises: [{ name: '杠铃深蹲', sets: '3', reps: '5', weight: '60', rpe: '', restSec: 75 }], betweenRestSec: 135 }, dose)!;
  const c = resolveScheduledCourse(e, { sessions: [] }, []);
  assert.equal(c.strength!.moves[0].restSec, 75); assert.equal(c.strength!.moves[0].betweenRestSec, 135);
});
async function startGuided(withSet: boolean) {
  const e = plan400TodayEntry(d1019, null, dose)!; assert.ok((await saveScheduledEntry(e)).ok);
  const s = resolveScheduledCourse(e, { sessions: [] }, []).strength!;
  const start = dispatchEvent('TRAINING_STARTED', { sessionId: s.id, decisionId: 'd1', selectedAction: 'ORIGINAL_PLAN' })!;
  assert.ok(bindTrainingStart({ startEventId: start.event_id, startedAt: start.timestamp, sessionId: s.id, planSlotId: e.id, plan: s }));
  if (withSet) { const set = { ...emptySets(s)[0], actualAmount: 5, actualWeight: 0, completed: true, source: 'user_entered' as const, timestamp: new Date().toISOString() }; assert.ok(recordSet(s.id, 'd1', set)); }
  return { e, s, occ: start.event_id };
}
test('放弃本次（进行中）：关闭课次、作废、没有日志行、力量回到未记录；再开是全新的一次', async () => {
  const { e, s, occ } = await startGuided(true);
  assert.equal(guidedLive(s.id), true);
  assert.ok(discardGuided(s.id));
  assert.equal(guidedLive(s.id), false); assert.equal(occurrenceVoided(occ), true);
  assert.equal(listTrainingOccurrences().find(o => o.trainingOccurrenceId === occ)!.lifecycle, 'INTERRUPTED');
  syncScheduleProgress();
  const entry = loadSchedule().entries.find(x => x.id === e.id)!; assert.equal(entry.actual, undefined); assert.equal(entry.status, 'planned');
  assert.equal(loadTrainingActivities().filter(r => r.date === '2026-10-19' || r.originIds.includes(occ)).length, 0, '日志/复盘不出现');
  assert.equal(executionOf(s.id).open, false);
});
test('放弃刚“结束”的那次（先记中断后又放弃）也会清掉已投影的结果；保存中断则仍是一条记录', async () => {
  const { e, s, occ } = await startGuided(true);
  assert.ok(interruptFromRunner('d1', s.id));
  syncScheduleProgress(); // 组合课：跑步部分还没做，日程条目不投影整节结果
  assert.ok(loadTrainingActivities().some(r => r.originIds.includes(occ)), '保存已做的组 → 有一条');
  assert.ok(discardGuided(s.id)); syncScheduleProgress();
  assert.equal(loadSchedule().entries.find(x => x.id === e.id)!.actual, undefined);
  assert.ok(!loadTrainingActivities().some(r => r.originIds.includes(occ)));
});
test('V4 当天的分段跑执行与 V4 行合并为一条（不重复计）', async () => {
  const e = plan400TodayEntry(d1019, null, dose)!;
  assert.equal(scheduleExecutionId(e.id, 'run'), 'scheduled:plan400:2026-10-19:strength:run');
  const src = readFileSync(new URL('./training-read-model.ts', import.meta.url), 'utf8');
  assert.match(src, /scheduled:plan400/); const rl = readFileSync(new URL('./run-link.ts', import.meta.url), 'utf8'); assert.match(rl, /plan400:.*:running/);
});
test('主观恢复统一 1–10：旧 1–5 记录读取 ×2、原值不改；阈值按 /10', () => {
  assert.equal(recovery10({ recovery: 4 }), 8); assert.equal(recovery10({ recovery: 4, recoveryScale: 5 }), 8); assert.equal(recovery10({ recovery: 4, recoveryScale: 10 }), 4);
  assert.equal(recovery10({ recovery: 8 }), 8); assert.equal(recovery10({ recovery: 0 }), null); assert.equal(recovery10({}), null);
  assert.equal(recoveryText({ recovery: 4 }), '8/10（原 1–5 量表 4/5）'); assert.equal(recoveryText({ recovery: 7, recoveryScale: 10 }), '7/10');
  const base = { readiness: null, bodyBattery: null, sleepH: null, sleepBase: null, hrv: null, hrvBase: null, rhr: null, rhrBase: null, stress: null };
  assert.equal(recoveryVerdict({ ...base, subjective: recovery10({ recovery: 4 }) }).level, 'go', '旧表单 4/5 = 8/10，不应降强度');
  assert.equal(recoveryVerdict({ ...base, subjective: 4 }).level, 'reduce'); assert.equal(recoveryVerdict({ ...base, subjective: 5 }).level, 'watch'); assert.equal(recoveryVerdict({ ...base, subjective: 6 }).level, 'go');
  const ui = readFileSync(new URL('../../components/home-dashboard.tsx', import.meta.url), 'utf8');
  assert.match(ui, /\["10", 10\]\] \}/); assert.match(ui, /recoveryScale: 10/); assert.ok(!/恢复状态", unit: "\/5"/.test(ui));
});

test('v82: decision card ignores voided (discarded) occurrence', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../components/training-decision-card.tsx', import.meta.url), 'utf8')
  assert.match(src, /item\.sessionId === session\.id && !occurrenceVoided\(item\.trainingOccurrenceId\)/)
})
