import type { MemoryStore } from '../core/storage';

export const ONLINE_FEATURES_KEY = 'fk-online-features-v1';
export const COACH_ONLINE_KEY = 'fk-coach-online-v1';
const REFERENCES_KEY = 'fr255-coach-network-mode-v1';

export function savedOnlineRecord(store: MemoryStore | null, key: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(store?.getItem(key) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Read each preference independently. A damaged neighbour must not revoke a
 * user's explicit OFF choice, nor make changing another switch turn it ON. */
export function savedOnlineChoices(store: MemoryStore | null): { coach?: boolean; coachRefs?: boolean } {
  const record = savedOnlineRecord(store, ONLINE_FEATURES_KEY);
  const features = record?.features && typeof record.features === 'object' && !Array.isArray(record.features)
    ? record.features as Record<string, unknown> : {};
  const coach = savedOnlineRecord(store, COACH_ONLINE_KEY);
  let refs: string | null = null;
  try { refs = store?.getItem(REFERENCES_KEY) ?? null; } catch { /* keep other valid choices */ }
  const has = (value: Record<string, unknown> | null, key: string) => !!value && Object.prototype.hasOwnProperty.call(value, key);
  return {
    ...(typeof coach?.on === 'boolean' ? { coach: coach.on }
      : typeof features.coach === 'boolean' ? { coach: features.coach }
      : has(coach, 'on') || has(features, 'coach') ? { coach: false } : {}),
    ...(refs === 'local' ? { coachRefs: false } : refs === 'public-knowledge' ? { coachRefs: true }
      : typeof features.coachRefs === 'boolean' ? { coachRefs: features.coachRefs }
      : refs !== null || has(features, 'coachRefs') ? { coachRefs: false } : {}),
  };
}
