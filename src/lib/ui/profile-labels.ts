/** R1 FK-SET-007：档案摘要带语义与单位。只读，不改 profile 存储。目前没有 PB 字段，不写「最好成绩」。 */
import type { Profile } from '../strength/profile.ts'
const DIST: Record<number, string> = { 100: '100米', 200: '200米', 400: '400米', 800: '800米', 1500: '1500米', 3000: '3000米', 5000: '5公里', 10000: '10公里', 21097: '半马', 42195: '全马' }
const dist = (m: number) => DIST[m] ?? `${m}米`
const unitTime = (v: string) => (/^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()} 秒` : v.trim())
export function athleteLines(p: Profile): string[] {
  const out: string[] = []
  const aim = p.aim === 'gain' ? '增重' : p.aim === 'lose' ? '减重' : p.aim === 'keep' ? '保持体重' : ''
  if (aim) out.push(`体重目标：${aim}${p.targetKg?.trim() ? `至 ${p.targetKg.trim()} kg` : '（目标体重未设置）'}`)
  out.push(`当前体重：${p.weightKg?.trim() ? `${p.weightKg.trim()} kg（你填写）` : '未设置'}`)
  for (const m of p.marks ?? []) {
    if (!m.goal && !m.recent) continue
    out.push(`${dist(m.meters)}：目标 ${m.goal ? unitTime(m.goal) : '未设置'}${m.recent ? ` · 近期成绩 ${unitTime(m.recent)}` : ''}${m.deadline ? ` · 目标日期 ${m.deadline}` : ''}`)
  }
  out.push(`每周可安排训练：最多 ${p.days} 天，每次约 ${p.minutes} 分钟（可用时间，不是训练处方）`)
  return out
}
export function athleteSummary(p: Profile): string {
  const bits: string[] = []
  if (p.aim) bits.push(p.aim === 'gain' ? '目标增重' : p.aim === 'lose' ? '目标减重' : '保持体重')
  if (p.weightKg?.trim()) bits.push(`当前 ${p.weightKg.trim()} kg`)
  const m = (p.marks ?? []).find(x => x.goal)
  if (m) bits.push(`${dist(m.meters)}目标 ${unitTime(m.goal)}`)
  return bits.length ? bits.join(' · ') : '未设置，填写后热量和教练才能读取'
}
