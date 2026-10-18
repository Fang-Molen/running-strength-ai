import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCAL_MUSCLE_ACTIONS, externalActions, findMuscleActions, type ExternalCatalogue } from './muscle-actions';
import { muscleSession, type MuscleDraft } from './muscle-workout';
const externalRaw = readFileSync(new URL('../../../public/exercise-sources/free-exercise-db/catalog.json', import.meta.url), 'utf8');
const external = externalActions(JSON.parse(externalRaw) as ExternalCatalogue);
test('the extended text catalogue preserves 876 separate source IDs and contains no copied image or animation references', () => {
  assert.equal(external.length, 876); assert.equal(new Set(external.map(e => e.id)).size, 876);
  assert.doesNotMatch(externalRaw, /"images"|\.jpg|\.gif|\.webp|media\//i);
  for (const e of external) { assert.equal(e.media3d, false); assert.equal(e.catalogId, null); assert.equal(e.unit, null); assert.equal(e.restSec, null); }
});
test('a muscle selection lists related local actions and equipment/level filters do not invent matches', () => {
  const hamstrings = findMuscleActions(LOCAL_MUSCLE_ACTIONS, { k: 'biceps_fem', g: 'hamstrings' });
  assert.ok(hamstrings.some(e => e.catalogId === 'leg-curl'));
  assert.ok(hamstrings.some(e => e.catalogId === 'rdl'));
  assert.equal(findMuscleActions(LOCAL_MUSCLE_ACTIONS, { k: 'unknown', g: null }).length, 0);
  for (const e of findMuscleActions(external, null, '', '哑铃', '入门')) { assert.ok(e.equipment.includes('哑铃')); assert.equal(e.level, '入门'); }
  const chinese = findMuscleActions(external, null, '杠铃深蹲');
  assert.ok(chinese.length > 0); assert.ok(chinese.every(e => /barbell/i.test(e.name) && /squat/i.test(e.name)));
});
test('foot muscles lead to actual foot exercises, including entries without animation', () => {
  const feet = findMuscleActions(LOCAL_MUSCLE_ACTIONS, { k: 'foot_intrinsic', g: 'feet' });
  assert.ok(feet.some(e => e.name.includes('短足'))); assert.ok(feet.some(e => e.name.includes('毛巾')));
  assert.equal(feet.find(e => e.name.includes('短足'))?.media3d, false);
});
const action = external[0]!;
const draft: MuscleDraft = { name: '新课程', sets: '3', amount: '12', weight: '0', rest: '60', mode: 'reps', side: '双侧一起', equipment: '无' };
test('adding an external action requires explicit parameters; absent rest/units never become zero or repetitions', () => {
  for (const key of ['sets', 'amount', 'weight', 'rest', 'mode', 'side', 'equipment'] as const) assert.equal(muscleSession(action, { ...draft, [key]: '' }, 's', 'm').ok, false);
  for (const change of [{ sets: '3.5' }, { amount: '-1' }, { amount: '2.5' }, { weight: 'Infinity' }, { rest: '-1' }, { mode: 'm' }]) assert.equal(muscleSession(action, { ...draft, ...change }, 's', 'm').ok, false);
  assert.equal(muscleSession(action, { ...draft, rest: '0' }, 's', 'm').ok, true);
});
test('a confirmed draft preserves side count, source, stable IDs and time-based quantity without recording completion', () => {
  const result = muscleSession(action, { ...draft, mode: 'seconds', amount: '30', side: '仅左' }, 'session-id', 'move-id');
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.session.id, 'session-id'); const move = result.session.moves[0]!;
  assert.equal(move.id, 'move-id'); assert.equal(move.catalogId, null); assert.equal(move.mode, 'seconds'); assert.equal(move.amount, 30);
  assert.match(move.executionNote || '', /仅左/); assert.match(move.executionNote || '', /free-exercise-db/);
  assert.equal('completed' in result.session, false);
});
