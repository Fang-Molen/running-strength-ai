import {currentAthleteId} from '../core/events'
/**
 * v89.6：计划是数据，不是代码。应用里不再内置任何个人课表；当前运动员的计划只来自本机存储
 * （用户自己导入的计划/备份文件，或首次引导由本地规则生成并确认的计划）。
 * 存储键 fk-plan-doc-v1：{ schema:'fangkun-plan-v1', label, tag, plan:{ name, shiftDays, weeks, days, final? } }。
 * 读取只读、失败返回 null（显示“未导入计划”），绝不抛错影响日志等其他页面。
 */
import type { V4Day, V4Plan } from '../ui/plan400-view'

export const PLAN_DOC_KEY = 'fk-plan-doc-v1'
export const PLAN_DOC_PREV_KEY = 'fk-plan-doc-prev-v1'
export const planDocumentKey = (owner=currentAthleteId()) => owner==='local'?PLAN_DOC_KEY:PLAN_DOC_KEY+':'+encodeURIComponent(owner)
const previousPlanKey = () => currentAthleteId()==='local'?PLAN_DOC_PREV_KEY:PLAN_DOC_PREV_KEY+':'+encodeURIComponent(currentAthleteId())
export const PLAN_DOC_SCHEMA = 'fangkun-plan-v1'
export const PLAN_CHANGED_EVT = 'fk-plan-doc-changed'
export type ProfileMarkDefault = { meters: number; goal?: string; recent?: string; deadline?: string }
/** profileDefaults：随计划文件带来的个人资料默认值（只在资料对应项为空时填入，导入预览里列出）。 */
export type PlanDoc = { athleteId?: string; schema: typeof PLAN_DOC_SCHEMA; label?: string; tag?: string; importedAt?: string; plan: V4Plan; profileDefaults?: { marks?: ProfileMarkDefault[] } }

type Store = { getItem(k: string): string | null }
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const isDay = (d: unknown): d is V4Day => !!d && typeof d === 'object' && typeof (d as V4Day).date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test((d as V4Day).date) && typeof (d as V4Day).title === 'string'
  && ['main', 'aux', 'strength'].every(k => Array.isArray((d as Record<string, unknown>)[k]) && ((d as Record<string, unknown[]>)[k]).every(x => typeof x === 'string'))

/** 校验一份计划文档；不合格返回原因（中文），不做任何写入。 */
export function validatePlanDoc(x: unknown): { ok: true; doc: PlanDoc } | { ok: false; reason: string } {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, reason: '不是方坤计划文件。' }
  const o = x as Record<string, unknown>
  if (o.schema !== PLAN_DOC_SCHEMA) return { ok: false, reason: '不是方坤计划文件（缺少 fangkun-plan-v1 标记）。' }
  const p = o.plan as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object' || !Array.isArray(p.days) || !p.days.length) return { ok: false, reason: '计划里没有训练日。' }
  if (p.days.length > 1000) return { ok: false, reason: '计划天数过多（上限 1000 天）。' }
  if (!p.days.every(isDay)) return { ok: false, reason: '计划里有训练日格式不对（需要日期、标题和内容行）。' }
  if (new Set((p.days as V4Day[]).map(d => d.date)).size !== p.days.length) return { ok: false, reason: '计划里有重复日期。' }
  const plan: V4Plan = { name: typeof p.name === 'string' ? p.name.slice(0, 80) : '导入的计划', shiftDays: Number(p.shiftDays) || 0, weeks: Array.isArray(p.weeks) ? p.weeks as V4Plan['weeks'] : [], days: p.days as V4Day[], ...(p.final && typeof p.final === 'object' ? { final: p.final as V4Day } : {}) }
  return { ok: true, doc: { ...(typeof o.athleteId==='string'?{athleteId:o.athleteId}:{}), schema: PLAN_DOC_SCHEMA, label: typeof o.label === 'string' ? o.label.slice(0, 40) : undefined, tag: typeof o.tag === 'string' ? o.tag.slice(0, 12) : undefined, importedAt: typeof o.importedAt === 'string' ? o.importedAt : undefined, plan, ...profileDefaultsOf(o.profileDefaults) } }
}

let cache: { owner:string; raw: string | null; doc: PlanDoc | null } | null = null
/** 当前运动员已保存的计划文档；没有或损坏 → null。 */
export function activePlanDoc(s: Store | null = store()): PlanDoc | null {
  const test = import.meta.env?.PROD===true||currentAthleteId()!=='local'?undefined:(globalThis as { __FK_TEST_PLAN_DOC__?: PlanDoc }).__FK_TEST_PLAN_DOC__ // 仅测试夹具注入；应用里永远不设
  let raw: string | null = null
  try { raw = s?.getItem(planDocumentKey()) ?? null } catch { raw = null }
  if (raw == null) return test ?? null
  if (cache && cache.owner === currentAthleteId() && cache.raw === raw) return cache.doc
  let doc: PlanDoc | null = null
  try { const v = validatePlanDoc(JSON.parse(raw)); doc = v.ok&&(!v.doc.athleteId||v.doc.athleteId===currentAthleteId()) ? v.doc : null } catch { doc = null }
  cache = { owner:currentAthleteId(), raw, doc }
  return doc
}
export const activePlan = (s?: Store | null): V4Plan | null => activePlanDoc(s === undefined ? store() : s)?.plan ?? null
/** 没有计划时是空数组：所有读取方都能照常运行（日志、复盘不受影响）。 */
export const planDays = (s?: Store | null): V4Day[] => activePlan(s)?.days ?? []
export const planDay = (date: string, s?: Store | null): V4Day | undefined => planDays(s).find(d => d.date === date)
export const hasActivePlan = (s?: Store | null): boolean => planDays(s).length > 0
/** 短标签（如“计划”），记录标题里用；来自计划文件，不写死。 */
export const planTag = (s?: Store | null): string => activePlanDoc(s === undefined ? store() : s)?.tag || ''
/** 标题前缀：有标签时“V4 ”这类，没有就是空串。 */
export const planPrefix = (s?: Store | null): string => { const t = planTag(s); return t ? `${t} ` : '' }
export const planLabel = (s?: Store | null): string => { const d = activePlanDoc(s === undefined ? store() : s); return d?.label || d?.plan.name || '未导入计划' }

type WStore = Store & { setItem(k: string, v: string): void; removeItem(k: string): void }
/** 确认后写入（预览由调用方先用 validatePlanDoc 展示）；旧计划存一份供“撤销导入”。读回校验。 */
export function savePlanDoc(doc: PlanDoc, s: WStore = localStorage): { ok: true } | { ok: false; reason: string } {
  try {
    if(doc.athleteId&&doc.athleteId!==currentAthleteId())return {ok:false,reason:'计划归属与当前档案不一致，未覆盖。'}
    const prev = s.getItem(planDocumentKey()), raw = JSON.stringify({ ...doc, athleteId:currentAthleteId(), importedAt: new Date().toISOString() })
    s.setItem(previousPlanKey(), JSON.stringify({ raw: prev, at: new Date().toISOString() }))
    s.setItem(planDocumentKey(), raw)
    if (s.getItem(planDocumentKey()) !== raw) { if (prev == null) s.removeItem(planDocumentKey()); else s.setItem(planDocumentKey(), prev); return { ok: false, reason: '保存校验失败（可能存储空间不足），未做修改。' } }
    notify(); return { ok: true }
  } catch { return { ok: false, reason: '保存失败（可能存储空间不足），未做修改。' } }
}
/** 撤销最近一次导入/生成：恢复之前的计划（之前没有就回到“未导入计划”）。训练记录不受影响。 */
export function undoPlanDoc(s: WStore = localStorage): boolean {
  try {
    const p = JSON.parse(s.getItem(previousPlanKey()) || 'null') as { raw: string | null } | null
    if (!p) return false
    if (p.raw == null) s.removeItem(planDocumentKey()); else s.setItem(planDocumentKey(), p.raw)
    s.removeItem(previousPlanKey()); notify(); return true
  } catch { return false }
}
export const canUndoPlanDoc = (s: Store | null = store()): boolean => { try { return !!s?.getItem(previousPlanKey()) } catch { return false } }
function notify() { cache = null; try { window.dispatchEvent(new Event(PLAN_CHANGED_EVT)) } catch { /* node */ } }

function profileDefaultsOf(x: unknown): { profileDefaults?: { marks: ProfileMarkDefault[] } } {
  const marks = (x as { marks?: unknown } | null)?.marks
  if (!Array.isArray(marks)) return {}
  const ok = marks.filter((m): m is ProfileMarkDefault => !!m && typeof m === 'object' && Number.isFinite((m as ProfileMarkDefault).meters) && (m as ProfileMarkDefault).meters > 0)
    .map(m => ({ meters: m.meters, ...(typeof m.goal === 'string' ? { goal: m.goal.slice(0, 20) } : {}), ...(typeof m.recent === 'string' ? { recent: m.recent.slice(0, 20) } : {}), ...(typeof m.deadline === 'string' ? { deadline: m.deadline.slice(0, 10) } : {}) }))
  return ok.length ? { profileDefaults: { marks: ok.slice(0, 12) } } : {}
}
