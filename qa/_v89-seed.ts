// v89 QA 种子（合成夹具，不是用户数据）：10 天日内样本（个人参考区间需≥7天）；今天到 15 点；日指标 2 天（较昨日）；一条自报疼痛。
import { buildIntradayDay } from '../src/lib/health/garmin-intraday'
import { fixtureHeartRate, fixtureStress, fixtureSleep } from '../src/lib/health/garmin-intraday.fixture'
const ok = (body: unknown) => ({ status: 200, body })
const days: Record<string, unknown> = {}
for (let i = 9; i >= 0; i--) {
  const d = `2026-10-${String(20 - i).padStart(2, '0')}`, h = i === 0 ? 15 : 24
  const st = (fixtureStress(d, h) as any); st.stressValuesArray = (st.bodyBatteryValuesArray as any[]).filter((_: unknown, j: number) => j % 2 === 0).map((e: any[]) => [e[0], Math.max(0, Math.min(100, 100 - e[2] + ((e[0] / 6e4) % 17)))])
  const acts = i === 0 ? [{ startIso: `${d}T01:30:00.000Z`, durationSec: 2700, sportLabel: '跑步' }] : i % 2 ? [{ startIso: `${d}T10:00:00.000Z`, durationSec: 2400, sportLabel: '跑步' }] : []
  days[d] = buildIntradayDay({ day: d, now: i === 0 ? `${d}T07:05:00Z` : `${d}T23:00:00Z`, hr: ok(fixtureHeartRate(d, h)), stress: ok(st), sleep: ok(fixtureSleep(d)), activities: acts }).day
}
const rec = (id: string, kind: string, value: number, unit: string, day: string) => ({ id, athleteId: 'local', kind, value, unit, observedOn: day, observedAt: null, source: 'MANUAL', note: '佳明账号同步', hrvMethod: kind === 'HRV' ? 'RMSSD' : null, createdAt: `${day}T08:00:00.000Z` })
const vitals = { schemaVersion: 1, records: [
  rec('s1', 'SLEEP', 7.8, 'hours', '2026-10-19'), rec('s2', 'SLEEP', 6.35, 'hours', '2026-10-20'),
  rec('r1', 'RHR', 52, 'bpm', '2026-10-19'), rec('r2', 'RHR', 55, 'bpm', '2026-10-20'),
  rec('h1', 'HRV', 48, 'ms', '2026-10-19'), rec('h2', 'HRV', 42, 'ms', '2026-10-20'),
] }
const pain = [{ id: 'qa1', date: '2026-10-20', part: '股四头肌', score: 3, note: 'QA 合成', athleteId: 'local', occurredAt: '2026-10-20T03:00:00.000Z', recordedAt: '2026-10-20T03:05:00.000Z' }]
console.log(JSON.stringify({ intraday: { schemaVersion: 1, days }, vitals, pain }))
