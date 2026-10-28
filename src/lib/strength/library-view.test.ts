import test from 'node:test';
import assert from 'node:assert/strict';
import { demoStatusOf, groupByPattern, EXTERNAL_GROUP } from './library-view';
import { LOCAL_MUSCLE_ACTIONS } from '../body/muscle-actions';
import { POSE_CARD_IDS } from './pose-cards-r8';

const local = LOCAL_MUSCLE_ACTIONS.filter(a => a.source === 'local');
test('status: an approved manifest entry is the only way to get 已审核视频; pose card is 待审核示意; otherwise 暂无演示', () => {
  const withCard = local.find(a => POSE_CARD_IDS.includes(a.catalogId!))!;
  assert.equal(demoStatusOf(withCard, 'male', new Set()), 'pose');
  assert.equal(demoStatusOf(withCard, 'male', new Set([`male:${withCard.catalogId}`])), 'video');
  assert.equal(demoStatusOf(withCard, 'female', new Set([`male:${withCard.catalogId}`])), 'pose', 'approval is per character');
  assert.equal(demoStatusOf({ id: 'external:x', catalogId: null, source: 'external' }, 'male', new Set(['male:external:x'])), 'none');
  assert.equal(demoStatusOf({ id: 'local:nope', catalogId: 'nope-zzz', source: 'local' }, 'male', new Set()), 'none');
});
test('grouping keeps every action exactly once, in fixed pattern order, external last', () => {
  const rows = [...LOCAL_MUSCLE_ACTIONS, { id: 'external:a', name: 'a', catalogId: null, source: 'external' as const }];
  const groups = groupByPattern(rows as never);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), rows.length);
  assert.equal(new Set(groups.flatMap(g => g.items.map(i => i.id))).size, rows.length);
  assert.equal(groups.at(-1)!.name, EXTERNAL_GROUP);
  assert.ok(groups.every(g => g.items.length > 0));
  assert.deepEqual(groupByPattern([]), []);
});
