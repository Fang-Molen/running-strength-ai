import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryStore } from '../core/storage'
import { shortHash } from './observation'

const api = await import('./garmin-progress-store').catch(() => ({})) as typeof import('./garmin-progress-store')
class Store implements MemoryStore {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
const receipt = { checkedDays: ['2026-10-22', '2026-10-21'], pendingDays: ['2026-07-01'], lastSyncAt: '2026-10-22T04:00:00Z', intradayCheckedDays: ['2026-10-20'] }

test('daily receipts are durable and scoped to both Garmin account and athlete', () => {
  assert.equal(typeof api.writeGarminDailyProgress, 'function')
  const store = new Store()
  api.writeGarminDailyProgress('cn:synthetic-a', 'athlete-a', receipt, store)
  assert.deepEqual(api.readGarminDailyProgress('cn:synthetic-a', 'athlete-a', store), receipt)
  assert.equal(api.readGarminDailyProgress('com:synthetic-a', 'athlete-a', store), null)
  assert.equal(api.readGarminDailyProgress('cn:synthetic-a', 'athlete-b', store), null)
  api.writeGarminDailyProgress('cn:synthetic-a', 'athlete-b', { ...receipt, checkedDays: [] }, store)
  assert.deepEqual(api.readGarminDailyProgress('cn:synthetic-a', 'athlete-a', store), receipt)
})

test('corrupt or mismatched receipts do not invent completed dates', () => {
  assert.equal(typeof api.readGarminDailyProgress, 'function')
  const store = new Store(), scope = 'cn:synthetic-a', subject = 'athlete-a'
  const key = `fk-garmin-daily-progress:${shortHash(scope)}:${encodeURIComponent(subject)}`
  for (const raw of ['{', JSON.stringify({ version: 1, scope, subjectId: subject, progress: { ...receipt, checkedDays: ['2026-02-30'] } }), JSON.stringify({ version: 1, scope: 'another-account', subjectId: subject, progress: receipt })]) {
    store.data.set(key, raw)
    assert.equal(api.readGarminDailyProgress(scope, subject, store), null)
  }
})

test('failed durable writes are reported instead of acknowledging new progress', () => {
  assert.equal(typeof api.writeGarminDailyProgress, 'function')
  const lost: MemoryStore = { getItem: () => null, setItem: () => {} }
  assert.throws(() => api.writeGarminDailyProgress('cn:synthetic-a', 'a', receipt, lost), /保存/)
  assert.throws(() => api.writeGarminDailyProgress('cn:synthetic-a', 'a', receipt, null), /保存/)
  assert.throws(() => api.writeGarminDailyProgress('cn:synthetic-a', 'a', { ...receipt, lastSyncAt: 'invalid' }, new Store()), /无效/)
})
