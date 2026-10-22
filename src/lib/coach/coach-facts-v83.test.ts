// v83 整改包 P1-10：方坤事实里 V4 一天只有一行统一投影；旧整课标“仅参考”；候选手表跑步不当作练过
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { setStoreBackend, type MemoryStore } from '../core/storage.ts'
import { setEventContext } from '../core/events.ts'
import { buildFacts } from './online-coach.ts'
let data: Map<string, string>
beforeEach(() => { data = new Map(); const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) }, keys: () => [...data.keys()] }; setStoreBackend(store as MemoryStore); setEventContext({ athleteId: 'local' }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store })
  // This boundary test needs an explicitly imported synthetic plan; the private user plan is not shipped.
  data.set('fk-plan-doc-v1', JSON.stringify({ schema: 'fangkun-plan-v1', tag: 'V4', label: '合成测试计划', plan: { name: '合成测试计划', shiftDays: 0, weeks: [], days: [{ date: '2026-10-19', orig: '2026-10-19', weekday: '一', week: '1', title: '速度耐力＋力量A', main: ['合成跑步安排'], aux: [], strength: ['分腿蹲3×8'] }] } }))
})
test('P1-10：分项 + 旧整课 → 一行；分项为准，旧整课只作参考；不再出现单独的“V4 分项反馈”行', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ '2026-10-19': { done: 'done', rpe: '7', reps: '150m: 21.3/21.0/21.6' } }))
  data.set('fk-plan400-v4-components-v1', JSON.stringify({ schemaVersion: 1, days: { '2026-10-19': { running: { status: 'done', rpe: 8 } } } }))
  const f = buildFacts('2026-10-19', null, null)
  const lines = f.split('\n').filter(l => l.includes('2026-10-19') && /V4/.test(l))
  assert.equal(lines.length, 1, f); assert.match(lines[0], /跑步 完成（完成，RPE 8）/); assert.match(lines[0], /力量 未记录/); assert.match(lines[0], /旧整课字段（仅参考）/)
  assert.doesNotMatch(f, /V4 分项反馈/)
})
test('P1-10：只有同日手表跑步（未确认）→ 写明待确认、不要当作练过', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ '2026-10-19': { strength: '分腿蹲 3×8' } }))
  data.set('fk-garmin-acts-v1', JSON.stringify({ a: { id: 9, name: 'x', type: 'running', start: '2026-10-19T01:00:00Z', dist: 3000, dur: 900 } }))
  const f = buildFacts('2026-10-19', null, null)
  assert.match(f, /V4 计划记录（2026-10-19 速度耐力＋力量A）：跑步 有同日手表跑步·待用户确认/)
})
