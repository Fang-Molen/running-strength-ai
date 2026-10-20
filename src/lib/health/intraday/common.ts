/** Independent read-only candidate. All identities/permissions must come from a trusted host. */
export type MinuteRange = Readonly<{ low: number; high: number | null }>;
export function ensure(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
export const epoch = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 500;
export function validRange(v: MinuteRange): boolean {
  return v !== null && typeof v === 'object' && Number.isFinite(v.low) && v.low >= 0 &&
    (v.high === null || Number.isFinite(v.high) && v.high >= v.low);
}
/** Comparison encoding; not a hash, signed approval, or security boundary. */
export function stable(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { ensure(Number.isFinite(v), 'NONFINITE_VALUE'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  ensure(v && typeof v === 'object', 'NON_JSON_VALUE');
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
export type Window = Readonly<{ start: number; end: number }>;
export function validateWindow(w: Window): void { ensure(epoch(w.start) && epoch(w.end) && w.start < w.end, 'BAD_WINDOW'); }
export const overlaps = (a: Window, b: Window): boolean => a.start < b.end && b.start < a.end;
export const READ_ONLY = Object.freeze({ planWriteAuthorized: false as const, deliveryAuthorized: false as const,
  diagnosis: null, fatigueScore: null });
