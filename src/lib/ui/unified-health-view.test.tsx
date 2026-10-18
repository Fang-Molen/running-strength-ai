import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HealthDashboard from '../../components/fangkun-ui/health-dashboard'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { saveVital } from '../nutrition/vitals'
import { saveHealthSource, loadHealthSnapshot } from '../health/snapshot'

test('diet health view uses the shared conflict/source selection and actual fiber subtotal', () => {
  const data = new Map<string, string>(), store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, keys: () => [...data.keys()] }
  setStoreBackend(store); setEventContext({ athleteId: 'synthetic-ui' })
  const noop = () => {}
  const render = () => renderToStaticMarkup(<HealthDashboard date="2026-10-18" rows={[{ id: 'synthetic-food', date: '2026-10-18', meal: '早餐', name: '合成纤维样本', kcal: 100, fiber: 8.5, source: 'MANUAL', athleteId: 'synthetic-ui', recordedAt: '2026-10-18T00:00:00Z' }]} checks={[]} gender="male" onGender={noop} onRecord={noop} onBody={noop} onHealth={noop} onCoach={noop} records={null} expanded={false} onExpandedChange={noop} activeMeal="早餐" onMeal={noop} />)
  try {
    assert.equal(saveVital({ kind: 'SLEEP', value: 6.5, observedOn: '2026-10-18', source: 'MANUAL', note: '自报' }).ok, true)
    assert.equal(saveVital({ kind: 'SLEEP', value: 7.5, observedOn: '2026-10-18', source: 'DEVICE_CONFIRMED', note: '合成设备' }).ok, true)
    const conflict = render(); assert.match(conflict, /来源待核对/); assert.match(conflict, /8.5 g/)
    const m = loadHealthSnapshot('2026-10-18').metrics.find(m => m.metric === 'SLEEP')!
    assert.equal(m.state, 'CONFLICT')
    assert.equal(saveHealthSource('SLEEP', m.candidates.find(p => p.value === 6.5)!.stream), true)
    const selected = render(); assert.doesNotMatch(selected, /来源待核对/); assert.match(selected, /6.5/); assert.doesNotMatch(selected, /7.5/)
  } finally { setStoreBackend(null); setEventContext({ athleteId: 'local' }) }
})
