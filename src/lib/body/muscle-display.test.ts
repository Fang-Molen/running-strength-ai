import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { muscleDisplay } from './muscle-display';
import { MUSCLE_FN } from './muscle-info';

test('both iliotibial meshes retain side and the supplied fascia explanation', async () => {
  const structures = JSON.parse(readFileSync(new URL('../../../public/demo3d/anatomy/structures.json', import.meta.url), 'utf8')) as { name: string; side: string; layer: string }[];
  const anatomy = await import(new URL('../../../public/demo3d/anatomy-map.js', import.meta.url).href);
  const entries = structures.filter(entry => /iliotibial tract/i.test(entry.name));
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    const pick = anatomy.anatomyMeta(entry);
    assert.ok(pick);
    const display = muscleDisplay(pick);
    assert.equal(display.name, `${entry.side === 'left' ? '左侧' : '右侧'}髂胫束（筋膜结构，非肌肉）`);
    assert.match(display.effect ?? '', /被动结构，不主动收缩/);
    assert.deepEqual(display.related, ['阔筋膜张肌', '臀大肌']);
    assert.equal(pick.name, entry.name);
  }
});

test('existing muscle effects remain the recorded data', () => {
  const display = muscleDisplay({ k: 'rectus_fem', zh: '股直肌', g: 'quads', side: 'left' });
  assert.equal(display.name, '左侧股直肌');
  assert.equal(display.effect, MUSCLE_FN.rectus_fem);
  assert.deepEqual(display.related, ['股外侧肌', '股内侧肌']);
});

test('unknown structures do not gain a made-up effect or related muscle', () => {
  const display = muscleDisplay({ k: 'unknown', zh: '未命名部位', g: null });
  assert.equal(display.effect, null);
  assert.deepEqual(display.related, []);
});
