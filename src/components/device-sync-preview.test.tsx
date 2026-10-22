import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setStoreBackend } from '@/lib/core/storage'
import { setEventContext } from '@/lib/core/events'
import { saveDeviceRows } from '@/lib/ui/device-store'
import type { DeviceActivity, DeviceHealthRow } from '@/lib/ui/device-parse'
import type { PlatformPreview } from '@/lib/ui/platform-sync-runtime'
import { DeviceSyncPreview } from './device-sync-preview'

const owner = 'synthetic-preview-review'
function setup() {
  const data = new Map<string, string>()
  setStoreBackend({ getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), keys: () => [...data.keys()] })
  setEventContext({ athleteId: owner })
  return data
}
afterEach(() => setStoreBackend(null))
function activity(overrides: Partial<DeviceActivity> = {}): DeviceActivity {
  return { key: 'synthetic-workout', sourceIdentity: 'polar:synthetic-account:synthetic-workout', source: 'Polar · 合成运动手表', sport: 'RUNNING', sportLabel: '跑步', startIso: '2026-01-01T08:00:00Z', durationSec: 28.1, distanceM: 200, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [], ...overrides }
}
function preview(activities: DeviceActivity[] = [], health: DeviceHealthRow[] = []): PlatformPreview {
  return { kind: '官方账号', brand: 'Polar', activities, health, notes: [], fetchedAt: '2026-10-22T01:00:00Z' }
}
const render = (value: PlatformPreview) => renderToStaticMarkup(createElement(DeviceSyncPreview, { provider: 'polar', owner, preview: value, disabled: false, onSaved: () => {} }))
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '')
const checkbox = (html: string) => html.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0] ?? ''

test('a repeated activity with unchanged source totals is disabled without a false conflict', () => {
  const data = setup(), a = activity()
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const before = [...data], html = render(preview([a]))
  assert.match(visibleText(html), /已保存/)
  assert.match(checkbox(html), /disabled=""/)
  assert.doesNotMatch(checkbox(html), /checked=""/)
  assert.doesNotMatch(visibleText(html), /来源数据已变化/)
  assert.match(visibleText(html), /保存选中的 0 条/)
  assert.deepEqual([...data], before, 'previewing must not write or revise a confirmed activity')
})

test('a tenth-second source correction is identified as a conflict and cannot be selected for overwrite', () => {
  const data = setup(), a = activity()
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const before = [...data], html = render(preview([{ ...a, durationSec: 28.2 }]))
  const text = visibleText(html)
  assert.match(text, /来源数据已变化/)
  assert.match(text, /0:28\.1/)
  assert.match(text, /0:28\.2/)
  assert.match(text, /未覆盖/)
  assert.match(checkbox(html), /disabled=""/)
  assert.doesNotMatch(checkbox(html), /checked=""/)
  assert.match(text, /保存选中的 0 条/)
  assert.deepEqual([...data], before)
})

test('a source distance correction keeps the original and new raw values distinguishable', () => {
  const data = setup(), a = activity({ distanceM: 200.1 })
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  const before = [...data], html = render(preview([{ ...a, distanceM: 200.2 }]))
  assert.match(visibleText(html), /来源数据已变化/)
  assert.match(visibleText(html), /200\.1 m/)
  assert.match(visibleText(html), /200\.2 m/)
  assert.match(checkbox(html), /disabled=""/)
  assert.deepEqual([...data], before)
})

test('a missing source total and an explicit zero remain different when reviewing a later read', () => {
  for (const field of ['durationSec', 'distanceM'] as const) {
    const data = setup(), a = activity({ [field]: null })
    assert.equal(saveDeviceRows([], [a]).saved, 1)
    const before = [...data], html = render(preview([{ ...a, [field]: 0 }]))
    assert.match(visibleText(html), /来源数据已变化/)
    assert.match(checkbox(html), /disabled=""/)
    if (field === 'durationSec') {
      assert.match(visibleText(html), /已保存：—/)
      assert.match(visibleText(html), /本次：0:00/)
    } else {
      assert.match(visibleText(html), /已保存：0:28\.1 · 距离未提供/)
      assert.match(visibleText(html), /本次：0:28\.1 · 0 m/)
    }
    assert.deepEqual([...data], before)
  }
})

test('activity and health origins, measurement time, and statistic can be inspected without writing records', () => {
  const data = setup(), at = '2026-10-21T06:07:08Z'
  const health: DeviceHealthRow[] = [
    { key: 'synthetic-health-a', source: '苹果健康 · 合成 App A', metric: 'HRV', hrvMethod: 'SDNN', day: '2026-10-21', value: 50, observation: { key: 'synthetic-health-a', sourceId: 'synthetic-origin-a', statistic: '合成原始样本（未做日均）', measuredAt: at, syncedAt: '2026-10-22T01:00:00Z' } },
    { key: 'synthetic-health-b', source: '苹果健康 · 合成 App B', metric: 'HRV', hrvMethod: 'SDNN', day: '2026-10-21', value: 50, observation: { key: 'synthetic-health-b', sourceId: 'synthetic-origin-b', statistic: '合成日汇总', measuredAt: null, syncedAt: '2026-10-22T02:00:00Z' } },
  ]
  const before = [...data], html = render(preview([activity()], health)), text = visibleText(html)
  assert.match(text, /Polar · 合成运动手表/)
  assert.match(text, /苹果健康 · 合成 App A/)
  assert.match(text, /苹果健康 · 合成 App B/)
  assert.match(text, /合成原始样本（未做日均）/)
  assert.match(text, /合成日汇总/)
  assert.ok(html.includes(`dateTime="${at}"`), 'the measurement timestamp must remain the actual source timestamp')
  assert.match(text, /测量时间未提供/)
  assert.ok(!html.includes('dateTime="2026-10-22T02:00:00Z"'), 'receipt time must not be presented as measurement time')
  assert.deepEqual([...data], before)
})

test('a source ID saved under one athlete remains new for a different athlete', () => {
  setup(); const a = activity()
  assert.equal(saveDeviceRows([], [a]).saved, 1)
  setEventContext({ athleteId: 'synthetic-preview-other' })
  const html = renderToStaticMarkup(createElement(DeviceSyncPreview, { provider: 'polar', owner: 'synthetic-preview-other', preview: preview([a]), disabled: false, onSaved: () => {} }))
  assert.doesNotMatch(checkbox(html), /disabled=""/)
  assert.match(checkbox(html), /checked=""/)
  assert.match(visibleText(html), /保存选中的 1 条/)
})
