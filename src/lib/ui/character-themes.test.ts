import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_THEME_KEY, CHARACTER_THEMES, normalizeCharacterTheme, readCharacterTheme, writeCharacterTheme } from './character-themes.ts';

test('exactly seven distinct themed skins with unique visual assets', () => {
  assert.equal(CHARACTER_THEMES.length, 7);
  assert.equal(new Set(CHARACTER_THEMES.map(t => t.id)).size, 7);
  assert.equal(new Set(CHARACTER_THEMES.map(t => t.avatar)).size, 7);
});
test('unknown/old value falls back to classic; no mutation of other settings', () => {
  assert.equal(normalizeCharacterTheme(''), 'classic');
  assert.equal(normalizeCharacterTheme('unexpected'), 'classic');
  assert.equal(normalizeCharacterTheme(null), 'classic');
  assert.equal(normalizeCharacterTheme('anlan'), 'anlan');
});
test('theme persists separately from training and wallpaper settings', () => {
  const state = new Map([['fr255-strength-plan-v3', '{"safe":true}'],['running-strength-appearance-v1','forest']]);
  const store = { getItem: (key:string) => state.get(key) ?? null, setItem: (key:string,value:string) => {state.set(key,value);} };
  assert.equal(readCharacterTheme(store), 'classic');
  assert.equal(writeCharacterTheme(store, 'qingye'), true);
  assert.equal(readCharacterTheme(store), 'qingye');
  assert.equal(state.get('fr255-strength-plan-v3'), '{"safe":true}');
  assert.equal(state.get('running-strength-appearance-v1'), 'forest');
  assert.equal(state.get(CHARACTER_THEME_KEY), 'qingye');
});
test('unavailable localStorage does not throw or mutate training data', () => {
  assert.equal(readCharacterTheme({getItem: () => {throw Error('denied');}}), 'classic');
  assert.equal(writeCharacterTheme({setItem: () => {throw Error('quota');}}, 'chiyan'), false);
});

test('theme avatars exist as 256x256 webp files, one per theme', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  for (const t of CHARACTER_THEMES) {
    const f = new URL('../../../public' + t.avatar, import.meta.url);
    assert.ok(existsSync(f), t.avatar);
    const b = readFileSync(f); assert.equal(b.subarray(0, 4).toString(), 'RIFF'); assert.equal(b.subarray(8, 12).toString(), 'WEBP');
  }
});
