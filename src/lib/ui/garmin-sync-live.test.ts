import test from 'node:test'
import assert from 'node:assert/strict'
import { beginGarminSyncLive, clearGarminSyncLive, finishGarminSyncLive, readGarminSyncLive, subscribeGarminSyncLive, updateGarminSyncLive } from './garmin-sync-live'
import { currentAthleteId, setEventContext } from '../core/events'

test('late-mounted views observe the same running progress and completed message', () => {
  clearGarminSyncLive()
  const token = beginGarminSyncLive('synthetic-a', '2026-10-22T00:00:00Z')
  updateGarminSyncLive(token, '增量同步：健康 2/3 天')
  assert.equal(readGarminSyncLive('synthetic-a').running, true)
  assert.equal(readGarminSyncLive('synthetic-a').message, '增量同步：健康 2/3 天')
  let notifications = 0
  const stop = subscribeGarminSyncLive(() => { notifications++ })
  updateGarminSyncLive(token, '增量同步完成')
  finishGarminSyncLive(token)
  assert.equal(notifications, 2)
  assert.equal(readGarminSyncLive('synthetic-a').running, false)
  assert.equal(readGarminSyncLive('synthetic-a').message, '增量同步完成')
  stop()
  clearGarminSyncLive()
})

test('sync messages are scoped to the originating athlete', () => {
  clearGarminSyncLive()
  const token = beginGarminSyncLive('synthetic-a', '2026-10-22T00:00:00Z')
  updateGarminSyncLive(token, '活动 12 条')
  assert.equal(readGarminSyncLive('synthetic-b').running, false)
  assert.equal(readGarminSyncLive('synthetic-b').message, '')
  assert.equal(readGarminSyncLive('synthetic-b').startedAt, null)
  clearGarminSyncLive()
})

test('logout clears the view and late completion cannot replace a new account job', () => {
  clearGarminSyncLive()
  const old = beginGarminSyncLive('synthetic-a', '2026-10-22T00:00:00Z')
  clearGarminSyncLive()
  assert.equal(readGarminSyncLive('synthetic-a').message, '')
  const next = beginGarminSyncLive('synthetic-a', '2026-10-22T00:01:00Z')
  updateGarminSyncLive(next, '正在同步新连接')
  updateGarminSyncLive(old, '旧任务完成')
  finishGarminSyncLive(old)
  clearGarminSyncLive(old)
  assert.equal(readGarminSyncLive('synthetic-a').message, '正在同步新连接')
  assert.equal(readGarminSyncLive('synthetic-a').running, true)
  finishGarminSyncLive(next)
  updateGarminSyncLive(next, '迟到的进度')
  assert.equal(readGarminSyncLive('synthetic-a').message, '正在同步新连接')
  clearGarminSyncLive()
})

test('mounted subscriber immediately re-reads athlete scope without changing the original job', () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), priorAthlete = currentAthleteId()
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  let stop = () => {}
  try {
    clearGarminSyncLive(); setEventContext({ athleteId: 'synthetic-a' })
    const token = beginGarminSyncLive('synthetic-a', '2026-10-22T00:00:00Z')
    updateGarminSyncLive(token, '健康 2/3 天')
    const original = readGarminSyncLive(), snapshots: ReturnType<typeof readGarminSyncLive>[] = []
    stop = subscribeGarminSyncLive(() => { snapshots.push(readGarminSyncLive()) })
    setEventContext({ athleteId: 'synthetic-b' })
    assert.equal(snapshots.length, 1); assert.equal(snapshots[0].running, false); assert.equal(snapshots[0].message, '')
    assert.equal(readGarminSyncLive('synthetic-a'), original, 'scope notification must not clear or mutate the original job')
    setEventContext({ athleteId: 'synthetic-a' })
    assert.equal(snapshots.length, 2); assert.equal(snapshots[1], original)
    stop(); setEventContext({ athleteId: 'synthetic-b' }); updateGarminSyncLive(token, '健康 3/3 天')
    assert.equal(snapshots.length, 2, 'cleanup removes both scope and job listeners')
  } finally {
    stop(); clearGarminSyncLive(); setEventContext({ athleteId: priorAthlete })
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('completed auth result stays scoped until cleared and old tokens cannot replace a new result', () => {
  clearGarminSyncLive()
  assert.equal(readGarminSyncLive('synthetic-a').result, null)
  const token = beginGarminSyncLive('synthetic-a', '2026-10-22T00:00:00Z')
  assert.equal(readGarminSyncLive('synthetic-a').result, null)
  updateGarminSyncLive(token, '登录失效或身份不完整')
  finishGarminSyncLive(token, 'auth')
  assert.equal(readGarminSyncLive('synthetic-a').result, 'auth')
  assert.equal(readGarminSyncLive('synthetic-a').running, false)
  assert.equal(readGarminSyncLive('synthetic-a').message, '登录失效或身份不完整')
  assert.equal(readGarminSyncLive('synthetic-b').result, null)
  finishGarminSyncLive(token, 'ok')
  assert.equal(readGarminSyncLive('synthetic-a').result, 'auth', 'duplicate finish cannot rewrite a completed result')
  const next = beginGarminSyncLive('synthetic-a', '2026-10-22T00:01:00Z')
  assert.equal(readGarminSyncLive('synthetic-a').result, null)
  finishGarminSyncLive(token, 'fail')
  assert.equal(readGarminSyncLive('synthetic-a').running, true)
  assert.equal(readGarminSyncLive('synthetic-a').result, null)
  finishGarminSyncLive(next, 'ok')
  assert.equal(readGarminSyncLive('synthetic-a').result, 'ok')
  clearGarminSyncLive()
  assert.equal(readGarminSyncLive('synthetic-a').result, null)
})
