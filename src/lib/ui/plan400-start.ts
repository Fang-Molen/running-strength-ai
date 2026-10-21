import { mainTrainingLines } from '../plan/plan-main';
import type { ScheduleEntry } from './day-schedule-rules'
type Ex = NonNullable<ScheduleEntry['exercises']>[number]
type Dose = { unit: 'reps' | 'sec' | 'm'; perSide: boolean }
/** 把 400m 计划当天「我的力量安排」变成可执行的力量课（同一 id，可重复打开继续）。缺组间休息时用 75 秒默认值；负重留空按自重 0。 */
export function plan400StrengthEntry(date: string, title: string, o: { parts: string[]; exercises: Ex[]; betweenRestSec?: number | null }, doseOf: (name: string) => Dose): ScheduleEntry {
  return {
    id: `plan400:${date}:strength`, date, kind: 'strength', modality: 'strength', trainingType: 'strength', title: `${title} · 力量与核心`,
    focus: o.parts.length ? o.parts : ['力量'], minutes: 30, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: null, status: 'planned',
    ...(o.betweenRestSec != null ? { betweenRestSec: o.betweenRestSec } : {}),
    exercises: o.exercises.filter(e => e.name.trim()).map((e, i) => {
      const d = doseOf(e.name), perSide = e.perSide ?? d.perSide
      return { ...e, id: e.id ?? `plan400:${date}:move:${i + 1}`, unit: e.unit ?? d.unit, perSide, ...(perSide && !e.counting ? { counting: 'perSide' as const } : {}), weight: e.weight?.trim() ? e.weight : '0', restSec: e.restSec ?? 75 }
    }),
  } as ScheduleEntry
}

/* v81（用户 t510–t512）：首页「计时」/「开始今日训练」直接打开今天这节的逐组引导（同一条 plan400:<date>:strength 日程条目，同一套执行记录）。
 * 原课表文字解析：×、x、X、星号、✕ 都认；组数/次数区间（2—3、2-3、2~3）取下限；“/腿”“/侧”“每侧”= 单侧计次；“秒”= 计时；RPE 段丢弃。 */
export type ParsedMove = { name: string; sets: string; reps: string; unit: 'reps' | 'sec'; perSide: boolean }
const RANGE = '\\d+(?:\\s*[—–\\-~～]\\s*\\d+)?'
const low = (s: string) => s.split(/[—–\-~～]/)[0].trim()
export function parseV4StrengthText(text: string): ParsedMove[] {
  const body = text.replace(/\s+/g, '').replace(/^[A-Z]\d?[：:]/, '').replace(/[；;，,]?RPE.*$/i, '')
  const out: ParsedMove[] = []
  const re = new RegExp(`([^、；;，,：:\\d]+?)(${RANGE})[×xX*✕](${RANGE})(秒|次|触地)?((?:\\/|每)(?:腿|侧|边))?`, 'g')
  for (const m of body.matchAll(re)) {
    const name = m[1].replace(/^(?:和|及|与|\+|＋)/, '').trim()
    if (!name || /^(组间|休息)/.test(name)) continue
    out.push({ name, sets: low(m[2]), reps: low(m[3]), unit: m[4] === '秒' ? 'sec' : 'reps', perSide: !!m[5] })
  }
  return out
}
/** 正式主课跑步文字 → 分段结构。只看第一句（到“；”“。”“观察”为止），认“距离m×组数”（可多段用＋连接）＋“组间N分钟/秒”；写不清就返回 null，不猜。 */
export function parseV4RunText(text: string): { steps: { distanceM: number; reps: number }[]; restSec: number | null } | null {
  const t = text.replace(/\s+/g, '').replace(/^正式主课[：:]/, '')
  const clause = t.split(/[；;。]|观察/)[0]
  const steps = [...clause.matchAll(new RegExp(`(?<![\\d(（])(\\d{2,4})(?:m|米)[×xX*✕](${RANGE})`, 'g'))].map(m => ({ distanceM: Number(m[1]), reps: Number(low(m[2])) }))
  if (!steps.length || /[(（]/.test(clause.split(/[×xX*✕]/)[0])) return null
  const rest = new RegExp(`组间(${RANGE})(分钟|分|秒)`).exec(t.split(/。|观察/)[0])
  return { steps, restSec: rest ? Number(low(rest[1])) * (rest[2] === '秒' ? 1 : 60) : null }
}

type DayLike = { date: string; title: string; main: string[]; strength: string[] }
const NO_LIFT = /^无|^可做|^仅活动度|^仅臀桥|^核心.*可选|^核心低量/
/** 今天 V4 课 → 一条可执行日程条目（id 固定 plan400:<date>:strength，可重复打开继续）。
 * 有力量：按“我的力量安排”或原课表文字；有分段跑：trainingType=mixed + runComponents（同一节、同一个执行入口）。两样都解析不出 → null（不猜）。 */
export function plan400TodayEntry(d: DayLike, override: { parts: string[]; exercises: Ex[]; betweenRestSec?: number | null } | null, doseOf: (name: string) => Dose): ScheduleEntry | null {
  const liftText = d.strength.join('')
  const exercises: Ex[] = override?.exercises?.length ? override.exercises : NO_LIFT.test(liftText) ? [] : parseV4StrengthText(liftText).map(m => ({ name: m.name, sets: m.sets, reps: m.reps, weight: '', rpe: '', unit: m.unit === 'sec' ? 'sec' : undefined, perSide: m.perSide || undefined }) as Ex)
  const run = /休息/.test(d.title) ? null : parseV4RunText(mainTrainingLines(d).join(''))
  if (!exercises.length && !run) return null
  const runComponents = run ? [{ componentId: 'v4-main', modality: 'RUNNING' as const, purpose: 'INTERVAL' as const, structure: { kind: 'REPEATED' as const, blocks: [{ blockId: 'v4-main', roundCount: 1, recoveryAfterRoundSeconds: null, steps: run.steps.map((s, i) => ({ stepId: `v4-${i + 1}`, plannedDistanceMeters: s.distanceM, plannedDurationSeconds: null, repeatCount: s.reps, recoveryAfterRepeatSeconds: run.restSec, recoveryBeforeNextStepSeconds: i < run.steps.length - 1 ? run.restSec : null })) }] } }] : null
  const base = plan400StrengthEntry(d.date, d.title, { parts: override?.parts ?? [], exercises, betweenRestSec: override?.betweenRestSec ?? null }, doseOf)
  if (!exercises.length) return { ...base, title: `${d.title} · 跑步部分`, kind: 'run', modality: 'run', trainingType: 'run', focus: ['跑步'], exercises: [], runComponents: runComponents! } as ScheduleEntry
  return { ...base, title: run ? `${d.title} · 跑步＋力量` : base.title, ...(runComponents ? { trainingType: 'mixed' as const, runComponents } : {}) } as ScheduleEntry
}
