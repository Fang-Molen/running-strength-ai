import test from 'node:test'
import assert from 'node:assert/strict'
import { unmarkedEntries } from './unmarked'
const e = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, date, kind: 'strength', modality: 'strength', title: id, focus: [], minutes: 40, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: null, status: 'planned', ...extra }) as never
test('待标记：只列过去、没标记、没有记录的课；没练/已完成/今天/未来/已有记录的不列', () => {
  const list = [e('calf', '2026-10-18'), e('done', '2026-10-17', { status: 'done', actual: { outcome: 'as_planned' } }), e('missed', '2026-10-16', { actual: { outcome: 'missed' } }),
    e('today', '2026-10-19'), e('future', '2026-10-21'), e('touched', '2026-10-15'), e('run', '2026-10-14', { modality: 'run', kind: 'run' }), e('proposed', '2026-10-13', { status: 'proposed' })]
  const ids = (k: 'all' | 'run' | 'lift') => unmarkedEntries(list, '2026-09-28', '2026-10-25', '2026-10-19', k, new Set(['sched:touched'])).map(x => (x as { id: string }).id)
  assert.deepEqual(ids('all'), ['calf', 'run'])
  assert.deepEqual(ids('lift'), ['calf']); assert.deepEqual(ids('run'), ['run'])
})
