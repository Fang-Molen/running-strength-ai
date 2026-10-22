import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS } from './first-run'
import { readOnboardingSyncDraft, saveOnboardingSyncDraft, clearOnboardingSyncDraft } from './onboarding-sync-draft'

const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) } } }
const draft = { step: 1, me: { nickname: '测试', sex: '' as const, birthYear: '', event: '400', pb: '58.1' }, answers: DEFAULTS, brand: 'polar' }
test('same-tab authorization can resume setup without generating any training or account state', () => {
  const s = memory(); saveOnboardingSyncDraft(s, 'a', draft, 1000)
  assert.deepEqual(readOnboardingSyncDraft(s, 'a', 2000), draft)
  assert.equal(readOnboardingSyncDraft(s, 'b', 2000), null)
  clearOnboardingSyncDraft(s, 'a'); assert.equal(readOnboardingSyncDraft(s, 'a', 2000), null)
})
test('expired, future and malformed setup drafts are discarded', () => {
  const s = memory(); saveOnboardingSyncDraft(s, 'a', draft, 1000)
  assert.equal(readOnboardingSyncDraft(s, 'a', 1000 + 31 * 60_000), null)
  saveOnboardingSyncDraft(s, 'a', draft, 1000); assert.equal(readOnboardingSyncDraft(s, 'a', 0), null)
  saveOnboardingSyncDraft(s, 'a', { ...draft, answers: { ...DEFAULTS, days: [12] } }, 1000)
  assert.equal(readOnboardingSyncDraft(s, 'a', 2000), null)
})
