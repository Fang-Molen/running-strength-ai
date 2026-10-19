// v79：V4 分项（附加 key fk-plan400-v4-components-v1）
process.env.TZ = 'Asia/Shanghai'
import test from 'node:test'
import assert from 'node:assert/strict'
import { saveComponent, loadComponents, setRunDevice, COMPONENTS_KEY } from './plan400-components-store.ts'
import { phoneRows, garminRows, linkRuns, lastRunMatch } from './training-read-model.ts'
import { summarize } from './log-range.ts'
import { restoreAnyBackup } from './backup-center.ts'
const mem = (o: Record<string, string> = {}) => { const m = new Map(Object.entries(o)); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, keys: () => [...m.keys()] } }
const NOW = Date.parse('2026-10-19T12:30:00Z') // 上海 10-19 20:30（V4 第一课 10-19 速度耐力＋力量A）
test('跑步 RPE 8、力量 RPE 6 分开保存，互不覆盖；改值留修改记录', () => {
  const s = mem()
  assert.ok(saveComponent('2026-10-19', 'running', { status: 'done', rpe: 8 }, s))
  assert.ok(saveComponent('2026-10-19', 'strength', { status: 'done', rpe: 6, pain: { area: '膝', score: 2 } }, s))
  assert.ok(saveComponent('2026-10-19', 'running', { rpe: 7 }, s))
  const d = loadComponents(s).days['2026-10-19']
  assert.equal(d.running!.rpe, 7); assert.equal(d.strength!.rpe, 6); assert.equal(d.strength!.pain!.area, '膝')
  assert.deepEqual(d.running!.corrections!.map(c => [c.field, c.from, c.to]), [['rpe', 8, 7]]); assert.equal(d.strength!.corrections, undefined)
  assert.equal(s.m.get('fk-plan400-v4-log'), undefined, '旧整课 key 不动')
})
test('跳过一项：跑步跳过、力量完成 → 日志一条力量记录', () => {
  const s = mem(); saveComponent('2026-10-19', 'running', { status: 'skipped' }, s); saveComponent('2026-10-19', 'strength', { status: 'done', rpe: 6 }, s)
  const rows = phoneRows(s, NOW); assert.equal(rows.length, 1); assert.equal(rows[0].sport, 'STRENGTH'); assert.equal(rows[0].status, 'incomplete')
})
const garmin = () => JSON.stringify({ a: { id: 41019, name: '操场 150m×3', type: 'track_running', start: '2026-10-19T10:00:00Z', dist: 3200, dur: 1500, avgHr: 150 } })
test('V4 同日唯一佳明跑步仍是候选；用户确认归属后合并一次，力量不会因此完成', () => {
  const s = mem({ 'fk-plan400-v4-components-v1': JSON.stringify({ schemaVersion: 1, days: { '2026-10-19': { running: { rpe: 8, status: 'done' } } } }) })
  const rows = linkRuns([...phoneRows(s, NOW), ...garminRows(JSON.parse(garmin()))], s, NOW)
  assert.equal(rows.length, 2, JSON.stringify(rows.map(r => r.id)))
  assert.equal(lastRunMatch().links.length, 0); assert.equal(lastRunMatch().suggestions.length, 1)
  const id = garminRows(JSON.parse(garmin()))[0].id
  setRunDevice('2026-10-19', { sourceIdentity: id, source: 'garmin', linkedBy: 'user' }, undefined, s)
  const confirmed = linkRuns([...phoneRows(s, NOW), ...garminRows(JSON.parse(garmin()))], s, NOW)
  assert.equal(confirmed.length, 1); assert.equal(confirmed[0].distanceM, 3200); assert.equal(confirmed[0].runLink?.entryId, 'plan400:2026-10-19:running'); assert.equal(confirmed[0].sport, 'RUNNING'); assert.equal(confirmed[0].status, 'incomplete')
  const sm = summarize(confirmed, '4w', 'all', '2026-10-19'); assert.equal(sm.count, 1); assert.equal(sm.lift, 0); assert.equal(Math.round(sm.distanceM), 3200)
  assert.equal(lastRunMatch().links[0].by, 'user')
  // 没有任何分项记录：也只有那一条佳明跑步，力量不出现
  const only = linkRuns(garminRows(JSON.parse(garmin())), mem(), NOW); assert.equal(only.length, 1); assert.equal(only[0].sport, 'RUNNING'); assert.equal(only[0].runLink, undefined)
})
test('解除关联后不再自动关联；用户可重新确认', () => {
  const s = mem(); const id = garminRows(JSON.parse(garmin()))[0].id
  setRunDevice('2026-10-19', null, id, s)
  assert.equal(linkRuns(garminRows(JSON.parse(garmin())), s, NOW)[0].runLink, undefined)
  setRunDevice('2026-10-19', { sourceIdentity: id, source: 'garmin', linkedBy: 'user' }, undefined, s)
  assert.equal(linkRuns(garminRows(JSON.parse(garmin())), s, NOW)[0].runLink?.by, 'user')
})
test('备份恢复带上分项与关联 key', () => {
  const s = mem(); const raw = JSON.stringify({ format: 'fangkun-vault-backup', schema: 1, exportedAt: '2026-10-19T00:00:00Z', data: { [COMPONENTS_KEY]: JSON.stringify({ schemaVersion: 1, days: { '2026-10-19': { running: { rpe: 8 } } } }), 'fk-run-links-v1': '{"x":{"garminId":"garmin:1","by":"user"}}', 'fk-schedule-v1': '{"entries":[]}' } })
  const r = restoreAnyBackup(raw, s); assert.ok(r.ok, JSON.stringify(r))
  assert.equal(loadComponents(s).days['2026-10-19'].running!.rpe, 8); assert.ok(s.m.get('fk-run-links-v1'))
})
