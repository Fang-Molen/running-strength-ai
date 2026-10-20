// 生成 QA 种子（合成夹具，不是用户数据）：最近 3 天日内样本；今天只到 15 点。
import { buildIntradayDay } from '../src/lib/health/garmin-intraday'
import { fixtureHeartRate, fixtureStress, fixtureSleep } from '../src/lib/health/garmin-intraday.fixture'
const ok = (body: unknown) => ({ status: 200, body })
const days: Record<string, unknown> = {}
for (const [d, h] of [['2026-10-18', 24], ['2026-10-19', 24], ['2026-10-20', 15]] as const) {
  const acts = d === '2026-10-19' ? [{ startIso: '2026-10-19T10:00:00.000Z', durationSec: 2700, sportLabel: '跑步' }] : []
  days[d] = buildIntradayDay({ day: d, now: d === '2026-10-20' ? '2026-10-20T07:05:00Z' : `${d}T23:00:00Z`, hr: ok(fixtureHeartRate(d, h)), stress: ok(fixtureStress(d, h)), sleep: ok(fixtureSleep(d)), activities: acts }).day
}
console.log(JSON.stringify({ schemaVersion: 1, days }))
