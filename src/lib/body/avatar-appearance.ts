/** Visual controls, independent from measured body values. */
export const AVATAR_KEY = 'fk-personal-avatar-v72';
export const CHANNELS = ['slender', 'lean', 'muscular', 'adipose'] as const;
export type Appearance = Record<typeof CHANNELS[number], number>;
export type AvatarAppearance = { version: 1; base: Appearance; target: Appearance };
export function normalizeAppearance(input: Partial<Appearance>): Appearance {
  const result = Object.fromEntries(CHANNELS.map(k => [k, Number.isFinite(input[k]) ? Math.max(0, Math.min(1, input[k]!)) : 0])) as Appearance;
  const total = Object.values(result).reduce((a, b) => a + b, 0);
  if (total > 1) CHANNELS.forEach(k => result[k] /= total);
  return result;
}
export const defaultAvatar = (): AvatarAppearance => ({ version: 1, base: normalizeAppearance({ slender: .25 }), target: normalizeAppearance({ muscular: .3 }) });
export function loadAvatar(sex:'male'|'female'='male'): AvatarAppearance {
  try { const p = JSON.parse(localStorage.getItem(sex==='female'?AVATAR_KEY+'-female':AVATAR_KEY) ?? 'null'); if (p?.version === 1 && p.base && p.target) return { version: 1, base: normalizeAppearance(p.base), target: normalizeAppearance(p.target) }; } catch { /* reference defaults */ }
  return defaultAvatar();
}
export function saveAvatar(p: AvatarAppearance, sex:'male'|'female'='male') {
  const safe: AvatarAppearance = { version: 1, base: normalizeAppearance(p.base), target: normalizeAppearance(p.target) };
  const raw = JSON.stringify(safe); localStorage.setItem(sex==='female'?AVATAR_KEY+'-female':AVATAR_KEY, raw);
  if (localStorage.getItem(sex==='female'?AVATAR_KEY+'-female':AVATAR_KEY) !== raw) throw Error('外形参考未保存，请保留当前调整并重试。');
  return safe;
}
