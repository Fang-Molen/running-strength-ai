import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_KEY, CHANNELS, normalizeAppearance, defaultAvatar, saveAvatar, loadAvatar } from './avatar-appearance';
test('visual blends remain finite and convex, with no implied body-composition calculation', () => {
  assert.deepEqual(normalizeAppearance({ slender: -1, muscular: 2, adipose: NaN }), { slender: 0, lean: 0, muscular: 1, adipose: 0 });
  const a = normalizeAppearance({ slender: 1, lean: 1, muscular: 1, adipose: 1 }); assert.equal(Object.values(a).reduce((a, b) => a + b), 1); assert.deepEqual(CHANNELS.map(k => a[k]), [.25,.25,.25,.25]);
});
test('appearance persists independently and cannot overwrite measured weight or numeric goals', () => {
  const map = new Map([['fr255-profile-v1', '{"weightKg":56,"targetKg":60}']]); const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } }; Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  const a = saveAvatar(defaultAvatar()); assert.deepEqual(loadAvatar(), a); assert.equal(map.get('fr255-profile-v1'), '{"weightKg":56,"targetKg":60}'); assert.ok(map.has(AVATAR_KEY));
  storage.setItem = () => {}; assert.throws(() => saveAvatar({ ...a, target: normalizeAppearance({ adipose: 1 }) }), /未保存/);
});
