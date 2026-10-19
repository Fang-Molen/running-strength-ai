import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPONENTS_KEY, saveComponent, setRunDevice, loadComponents } from './plan400-components-store'
import { currentAthleteId, setEventContext } from '../core/events'

const date = '2026-10-19'
const memory = (data: unknown) => { const values = new Map([[COMPONENTS_KEY, JSON.stringify(data)]]); return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } } }
test('HOST-03 legacy unowned component days stay byte-identical for a named athlete; local edits in place without owner stamping', () => {
  const prior = currentAthleteId()
  try {
    setEventContext({ athleteId: 'local' })
    const l = memory({ schemaVersion: 1, days: { [date]: { running: { status: 'done', rpe: 7 }, strength: { status: 'done' } } } })
    assert.equal(saveComponent(date, 'running', { rpe: 8 }, l), true)
    const day = loadComponents(l).days[date] as { athleteId?: string; running?: { rpe?: number | null } }
    assert.equal(day.running?.rpe, 8); assert.equal('athleteId' in day, false)
  } finally { setEventContext({ athleteId: prior }) }
  try { for (const athleteId of ['synthetic-named']) {
    setEventContext({ athleteId })
    const s = memory({ schemaVersion: 1, days: { [date]: { running: { status: 'done', rpe: 7 }, strength: { status: 'done' } } } })
    const before = s.getItem(COMPONENTS_KEY)
    assert.equal(saveComponent(date, 'running', { rpe: 8 }, s), false)
    assert.equal(setRunDevice(date, { sourceIdentity: 'same-day-device', source: 'garmin', linkedBy: 'user' }, undefined, s), false)
    assert.equal(s.getItem(COMPONENTS_KEY), before)
  } } finally { setEventContext({ athleteId: prior }) }
})
test('HOST-03 component writes reject other owners and preserve every original field', () => {
  const prior = currentAthleteId(); setEventContext({ athleteId: 'synthetic-A' })
  try {
    const s = memory({ schemaVersion: 1, days: { [date]: { athleteId: 'synthetic-B', running: { status: 'done', note: 'keep' } } } })
    const before = s.getItem(COMPONENTS_KEY)
    assert.equal(saveComponent(date, 'strength', { status: 'done' }, s), false)
    assert.equal(setRunDevice(date, null, 'old-device', s), false)
    assert.equal(s.getItem(COMPONENTS_KEY), before)
  } finally { setEventContext({ athleteId: prior }) }
})
test('HOST-03 new component days carry an explicit owner; later corrections retain independent components', () => {
  const prior = currentAthleteId(); setEventContext({ athleteId: 'synthetic-A' })
  try {
    const s = memory({ schemaVersion: 1, days: {} })
    assert.equal(saveComponent(date, 'running', { status: 'done', rpe: 7 }, s), true)
    assert.equal((loadComponents(s).days[date] as { athleteId?: string }).athleteId, 'synthetic-A')
    assert.equal(saveComponent(date, 'strength', { status: 'done', rpe: 6 }, s), true)
    assert.equal(saveComponent(date, 'running', { rpe: 8 }, s), true)
    const d = loadComponents(s).days[date]
    assert.equal(d.running?.rpe, 8); assert.equal(d.strength?.rpe, 6)
    assert.deepEqual(d.running?.corrections?.map(x => [x.field, x.from, x.to]), [['rpe', 7, 8]])
  } finally { setEventContext({ athleteId: prior }) }
})
