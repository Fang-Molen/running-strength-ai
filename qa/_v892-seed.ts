// v89.2 QA 种子（合成夹具，不是用户数据）：10-19 V4「速度耐力＋力量A」走真实执行流程逐组记 10 组；10-19 手表跑步已关联这节课；10-20 一条未关联手表跑步。
import { writeFileSync } from 'node:fs'
const RealDate = Date; let t = Date.parse('2026-10-19T11:00:00Z')
class FakeDate extends RealDate { constructor(...a: unknown[]) { if (a.length) super(...(a as [string])); else super(t) } static now() { return t } }
globalThis.Date = FakeDate as DateConstructor
const map = new Map<string, string>(), box = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) }, key: (i: number) => [...map.keys()][i] ?? null, get length() { return map.size }, clear: () => map.clear() }
Object.defineProperty(globalThis, 'localStorage', { value: box, configurable: true })
const { setStoreBackend } = await import('../src/lib/core/storage'); setStoreBackend(box)
const { setEventContext } = await import('../src/lib/core/events'); setEventContext({ athleteId: 'local' })
const { bindTrainingStart, closeTrainingOccurrence } = await import('../src/lib/core/occurrence')
const { startTraining, completeTraining } = await import('../src/lib/core/training-decision')
const { emptySets, recordSet } = await import('../src/lib/core/execution')
const { plan400TodayEntry } = await import('../src/lib/ui/plan400-start')
const { resolveScheduledCourse } = await import('../src/lib/ui/scheduled-execution')
const { setRunDevice } = await import('../src/lib/ui/plan400-components-store')
const V4 = (await import('../src/lib/plan400-v4.json', { with: { type: 'json' } })).default as { days: any[] }
const d = V4.days.find(x => x.date === '2026-10-19')
const entry = plan400TodayEntry(d, null, () => ({ unit: 'reps', perSide: false }))!
const s = resolveScheduledCourse(entry, { sessions: [] }, []).strength!
const st = startTraining({ decisionId: 'qa-v4', sessionId: s.id, action: 'ORIGINAL_PLAN' })!
bindTrainingStart({ startEventId: st.event_id, startedAt: st.timestamp, sessionId: s.id, planSlotId: entry.id, plan: s })
for (const set of emptySets(s)) { t += 150e3; recordSet(s.id, 'qa-v4', { ...set, actualWeight: set.plannedWeight, actualAmount: set.plannedAmount, completed: true, source: 'user_confirmed_plan', timestamp: new Date().toISOString() }) }
t += 60e3; closeTrainingOccurrence(completeTraining({ decisionId: 'qa-v4', sessionId: s.id, planned: null, actualSets: 10, actualAmount: null, actualWeightKg: null, rpe: null, pain: false, modified: false, interrupted: false }) as never)
map.set('fk-garmin-acts-v1', JSON.stringify({ a: { id: 9101, start: '2026-10-19T09:00:00.000Z', type: 'running', dist: 3200, dur: 1680, athleteId: 'local', name: '跑步' }, b: { id: 9102, start: '2026-10-20T07:00:00.000Z', type: 'running', dist: 5000, dur: 1800, athleteId: 'local', name: '跑步' } }))
setRunDevice('2026-10-19', { sourceIdentity: 'garmin:9101', source: 'garmin', linkedBy: 'user' }, undefined, box)
writeFileSync('/tmp/v892-train.json', JSON.stringify(Object.fromEntries(map)))
console.log('keys', [...map.keys()].length)
