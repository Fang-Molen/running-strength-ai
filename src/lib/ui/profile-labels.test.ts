import test from 'node:test'
import assert from 'node:assert/strict'
import { athleteLines, athleteSummary } from './profile-labels.ts'
const base = { sex: '', age: '', heightCm: '', weightKg: '', bodyFat: '', aim: '', targetKg: '', weeks: 12, activity: 'run', days: 7, minutes: 60, marks: [], limit: '', note: '' } as any
test('SET-04 empty → 未设置, no invented numbers', () => {
  assert.equal(athleteSummary(base), '未设置，填写后热量和教练才能读取')
  assert.ok(athleteLines(base).includes('当前体重：未设置'))
})
test('SET-05/007 goal vs current vs available time; no PB claim', () => {
  const p = { ...base, aim: 'gain', weightKg: '56', marks: [{ meters: 400, goal: '53', recent: '', deadline: '' }] }
  assert.equal(athleteSummary(p), '目标增重 · 当前 56 kg · 400米目标 53 秒')
  const lines = athleteLines(p).join('\n')
  assert.match(lines, /体重目标：增重（目标体重未设置）/); assert.match(lines, /400米：目标 53 秒/); assert.match(lines, /可用时间，不是训练处方/)
  assert.doesNotMatch(lines, /最好成绩|PB/)
})
