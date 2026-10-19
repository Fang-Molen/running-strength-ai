import { currentAthleteId } from '../core/events'
import { ownedBy } from '../core/ownership'
/* v79（用户 2026-10-19 批准交接 V2 数据结构）：V4 组合课分项记录，附加 key，不碰 fk-plan400-v4-log。
 * - 旧整课记录 fk-plan400-v4-log 原样保留，显示为“整课历史评价”，不迁移、不把一个分数复制给两项。
 * - running.device：关联的手表跑步（用户确认或同日唯一自动匹配后由用户保留；可解除）。deviceRejected：用户解除过的，不再自动关联。
 * - 每次改已有值都记一条 corrections（field/from/to/at）。
 * - 手表跑步只碰 running，永远不会改 strength。 */
export const COMPONENTS_KEY = 'fk-plan400-v4-components-v1'
export const COMPONENTS_EVT = 'fk-plan400-components'
export type CompStatus = 'done' | 'reduced' | 'skipped' | 'not_recorded'
export type Correction = { field: string; from: unknown; to: unknown; at: string }
export type PartFeedback = { status?: CompStatus; rpe?: number | null; pain?: { area: string; score: number | null } | null; feel?: string; note?: string; savedAt?: string; corrections?: Correction[] }
export type RunningPart = PartFeedback & { device?: { sourceIdentity: string; source: 'garmin' | 'import'; linkedAt: string; linkedBy: 'user' | 'auto' } | null; deviceRejected?: string[] }
export type RecoveryPart = { runLegs24?: string; runLegs48?: string; strengthSoreness24?: string; strengthSoreness48?: string; savedAt?: string; late?: boolean; corrections?: Correction[] }
export type DayComponents = { athleteId?: string; running?: RunningPart; strength?: PartFeedback; recovery?: RecoveryPart }
export type ComponentsDoc = { schemaVersion: 1; days: Record<string, DayComponents>; prompted?: string[] }
type KV = Pick<Storage, 'getItem' | 'setItem'>
const ls = (): KV | null => typeof localStorage === 'undefined' ? null : localStorage
export function loadComponents(store: Pick<Storage, 'getItem'> | null = ls()): ComponentsDoc {
  try { const v = JSON.parse(store?.getItem(COMPONENTS_KEY) ?? 'null'); if (v && v.schemaVersion === 1 && v.days && typeof v.days === 'object') return v } catch { /* 坏数据不覆盖：只读为空 */ }
  return { schemaVersion: 1, days: {} }
}
function write(doc: ComponentsDoc, store: KV | null): boolean {
  try { if (!store) return false; const raw = JSON.stringify(doc); store.setItem(COMPONENTS_KEY, raw); if (store.getItem(COMPONENTS_KEY) !== raw) return false
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMPONENTS_EVT)); return true } catch { return false }
}
const FIELDS = { running: ['status', 'rpe', 'pain', 'feel', 'note'], strength: ['status', 'rpe', 'pain', 'feel', 'note'], recovery: ['runLegs24', 'runLegs48', 'strengthSoreness24', 'strengthSoreness48'] } as const
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const blank = (v: unknown) => v == null || v === '' || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(x => x == null || x === ''))
/** 存一个分项；只写这个分项，另一项不动。改已有值 → corrections 记一条。 */
export function saveComponent(date: string, part: 'running' | 'strength' | 'recovery', patch: Record<string, unknown>, store: KV | null = ls(), now = new Date()): boolean {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return false
  const doc = loadComponents(store), original = doc.days[date], athleteId = currentAthleteId()
  // 其他运动员的天只读；旧无归属天属于本机 local，可原地编辑但不补写 athleteId（不迁移）。
  if (original && !ownedBy(original, athleteId)) return false
  const day = { ...(original ?? { athleteId }) }, prev = { ...((day as Record<string, unknown>)[part] as Record<string, unknown> ?? {}) }, at = now.toISOString()
  const corrections = [...((prev.corrections as Correction[] | undefined) ?? [])]
  for (const f of FIELDS[part]) if (f in patch && !same(prev[f], patch[f]) && !blank(prev[f])) corrections.push({ field: f, from: prev[f], to: patch[f] ?? null, at })
  const next: Record<string, unknown> = { ...prev, ...patch, savedAt: at, ...(corrections.length ? { corrections } : {}) }
  ;(day as Record<string, unknown>)[part] = next
  return write({ ...doc, days: { ...doc.days, [date]: day } }, store)
}
/** 关联 / 解除 V4 跑步分项的手表跑步。解除时记入 deviceRejected，之后不再自动关联这一条。 */
export function setRunDevice(date: string, dev: { sourceIdentity: string; source: 'garmin' | 'import'; linkedBy: 'user' | 'auto' } | null, rejectId?: string, store: KV | null = ls(), now = new Date()): boolean {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return false
  const doc = loadComponents(store), original = doc.days[date], athleteId = currentAthleteId()
  if (original && !ownedBy(original, athleteId)) return false
  const day = { ...(original ?? { athleteId }) }, run: RunningPart = { ...(day.running ?? {}) }, at = now.toISOString()
  const corrections = [...(run.corrections ?? [])]
  if (run.device && !same(run.device.sourceIdentity, dev?.sourceIdentity)) corrections.push({ field: 'device', from: run.device.sourceIdentity, to: dev?.sourceIdentity ?? null, at })
  run.device = dev ? { ...dev, linkedAt: at } : null
  if (rejectId) run.deviceRejected = [...new Set([...(run.deviceRejected ?? []), rejectId])]
  if (dev) run.deviceRejected = (run.deviceRejected ?? []).filter(x => x !== dev.sourceIdentity)
  if (corrections.length) run.corrections = corrections
  day.running = run
  return write({ ...doc, days: { ...doc.days, [date]: day } }, store)
}
export function markPrompted(id: string, store: KV | null = ls()): boolean { const doc = loadComponents(store); return write({ ...doc, prompted: [...new Set([...(doc.prompted ?? []), id])] }, store) }
export const STATUS_TEXT: Record<CompStatus, string> = { done: '完成', reduced: '减量完成', skipped: '跳过（没做）', not_recorded: '未记录' }
export const hasFeedback = (p: PartFeedback | undefined) => !!p && (!!p.status && p.status !== 'not_recorded' || p.rpe != null || !blank(p.pain) || !!p.feel || !!p.note)
export function partLine(name: string, p: PartFeedback | undefined): string | null {
  if (!hasFeedback(p)) return null
  const bits = [p!.status ? STATUS_TEXT[p!.status] : null, p!.rpe != null ? `RPE ${p!.rpe}` : null, p!.pain && !blank(p!.pain) ? `疼痛 ${p!.pain.area || '部位未写'}${p!.pain.score != null ? ' ' + p!.pain.score + '/10' : ''}` : null, p!.feel ? `感受：${p!.feel}` : null, p!.note ? `备注：${p!.note}` : null].filter(Boolean)
  return `${name} ${bits.join('，')}${p!.corrections?.length ? `（改过 ${p!.corrections.length} 次）` : ''}`
}
