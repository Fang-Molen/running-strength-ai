/** v87 日程写入闸口（区块 schedule-writer）：fk-schedule-v1 的所有写入都经过这里。
 *  - 每次写入把单调递增的修订号写到独立键 fk-schedule-v1-rev（不改日程文档本身的格式，旧数据原样保留），并记下是哪个写入方；
 *  - 异步写入方用同一把锁 PLAN_EXECUTION_LOCK（与改课执行器同名），浏览器没有 Web Locks 时退回本页内互斥并标明“未跨页协调”；
 *  - 改课宿主仍固定 UNCOORDINATED：同步写入方（首页日程、引导问卷、未标记课、进度同步、放弃本次）还不能跨页拿锁，见 docs/modules.md。
 */
export const SCHEDULE_DOC_KEY = 'fk-schedule-v1'
export const SCHEDULE_REVISION_KEY = 'fk-schedule-v1-rev'
export const SCHEDULE_PENDING_WRITE_KEY = 'fk-schedule-v1-pending-write'
/** 与 src/lib/coach/plan-execution/core.ts 的 PLAN_EXECUTION_LOCK 同名（测试锁定一致）。 */
export const SCHEDULE_WRITE_LOCK = 'fangkun-plan-execution-v1'
export type ScheduleWriter = 'today-board' | 'today-board-sync' | 'onboarding-r8' | 'unmarked-plans' | 'schedule-progress' | 'guided-discard' | 'scheduled-entry' | 'plan-execution' | 'unknown'
export const SCHEDULE_WRITERS: readonly ScheduleWriter[] = ['today-board', 'today-board-sync', 'onboarding-r8', 'unmarked-plans', 'schedule-progress', 'guided-discard', 'scheduled-entry']
import { sha256Hex } from '../core/sha256-sync.ts'
type Box = { getItem(k: string): string | null; setItem(k: string, v: string): void }
export type ScheduleRevision = { rev: number; writer: ScheduleWriter | null; at: string | null }
export function readScheduleRevision(box: Box | null | undefined): ScheduleRevision {
  try { const v = JSON.parse(box?.getItem(SCHEDULE_REVISION_KEY) ?? 'null'); if (v && Number.isSafeInteger(v.rev) && v.rev >= 0) return { rev: v.rev, writer: v.writer ?? null, at: v.at ?? null } } catch { /* 损坏按 0 处理，不覆盖日程 */ }
  return { rev: 0, writer: null, at: null }
}
/** 同步写入（单页内一次完成读改写）。expectedRev 给出时做 CAS：修订号不一致就不写。 */
/** 失败原因代码（只用于提示，不改变任何写入判断）。最近一次失败记在模块内，供界面读出；成功不清除，由 saveSchedule 开头清除。 */
export type ScheduleFailCode = 'E-NOSTORE' | 'E-DOC' | 'E-DUP' | 'E-OWNER' | 'E-AUDIT' | 'E-QUOTA' | 'E-VERIFY' | 'E-PENDING-BAD' | 'E-PENDING-REV' | 'E-PENDING-DOC' | 'E-REV-BAD' | 'E-CONFLICT' | 'E-EXC'
export type ScheduleFailure = { code: ScheduleFailCode; detail?: string }
let lastFailure: ScheduleFailure | null = null
export function recordScheduleFailure(code: ScheduleFailCode, detail?: string): void { lastFailure = detail ? { code, detail } : { code } }
export function clearScheduleFailure(): void { lastFailure = null }
export function lastScheduleFailure(): ScheduleFailure | null { return lastFailure }
export function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number } | null
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)
}
function fail<R extends 'VERSION_CONFLICT' | 'WRITE_FAILED'>(reason: R, code: ScheduleFailCode, detail?: string): { ok: false; reason: R } { recordScheduleFailure(code, detail); return { ok: false, reason } }
type SizedBox = Box & { keys?(): readonly string[]; key?(index: number): string | null; readonly length?: number }
/** 本机存储占用（字符数，近似）：合计 + 最大的几项。读不到就返回 null，不抛错。 */
export function storageUsage(box: SizedBox | null | undefined, top = 3): { total: number; top: { key: string; chars: number }[] } | null {
  try {
    if (!box) return null
    const keys = box.keys ? [...box.keys()] : typeof box.length === 'number' && box.key ? Array.from({ length: box.length }, (_, i) => box.key!(i)).filter((k): k is string => typeof k === 'string') : null
    if (!keys) return null
    const rows = keys.map(key => ({ key, chars: key.length + (box.getItem(key)?.length ?? 0) }))
    return { total: rows.reduce((n, r) => n + r.chars, 0), top: rows.sort((a, b) => b.chars - a.chars).slice(0, top) }
  } catch { return null }
}
const size = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M字符` : `${Math.max(1, Math.round(n / 1e3))}K字符`
const MEANING: Record<ScheduleFailCode, string> = {
  'E-NOSTORE': '浏览器没有给出本机存储（可能是无痕模式或被系统限制）',
  'E-DOC': '本机日程档案读不出来或格式不对（为防覆盖，不会当作空日程）',
  'E-DUP': '日程里有重复的训练编号',
  'E-OWNER': '这条训练与其他运动员档案的记录冲突',
  'E-AUDIT': '改课回执档案格式不对',
  'E-QUOTA': '浏览器本机存储空间已满',
  'E-VERIFY': '写入后读回不一致（存储被浏览器拒绝或静默丢弃）',
  'E-PENDING-BAD': '上一次保存的“待提交记录”残留且无法读取',
  'E-PENDING-REV': '上一次保存的“待提交记录”与当前版本号对不上',
  'E-PENDING-DOC': '上一次保存的“待提交记录”与当前日程内容对不上（可能另一窗口改过）',
  'E-REV-BAD': '日程版本号记录损坏',
  'E-CONFLICT': '日程刚被另一窗口修改',
  'E-EXC': '保存过程出现未预期的错误',
}
/** 给用户看的失败原因：代码 + 白话 + （存储满时）占用情况。 */
export function describeScheduleFailure(failure: ScheduleFailure | null, box?: SizedBox | null): string {
  if (!failure) return '原因未知（E-UNKNOWN）'
  let text = `原因 ${failure.code}：${MEANING[failure.code]}`
  if (failure.detail && (failure.code === 'E-VERIFY' || failure.code === 'E-EXC')) text += `（${failure.detail}）`
  if (failure.code === 'E-QUOTA' || failure.code === 'E-VERIFY') {
    const u = storageUsage(box)
    if (u) text += `；本机共约 ${size(u.total)}${u.top.length ? `，最大：${u.top.map(r => `${r.key} ${size(r.chars)}`).join('、')}` : ''}`
  }
  if (failure.code === 'E-QUOTA') text += '。请先下载备份，再清理最大的一项后重试'
  else if (failure.code.startsWith('E-PENDING') || failure.code === 'E-REV-BAD' || failure.code === 'E-DOC') text += '。请先下载备份并保留此提示，不要反复重试'
  return text
}
export function commitScheduleRaw(box: Box, raw: string, writer: ScheduleWriter, expectedRev?: number): { ok: true; rev: number } | { ok: false; reason: 'VERSION_CONFLICT' | 'WRITE_FAILED' } {
 try {
  // A failed metadata write must never be reported as a committed revision.
  // Keep the intent so a retry can finish metadata, without rewriting training.
  const pendingRaw = box.getItem(SCHEDULE_PENDING_WRITE_KEY)
  if (pendingRaw && pendingRaw !== 'null') {
    let pending: any; try { pending = JSON.parse(pendingRaw) } catch { return fail('WRITE_FAILED', 'E-PENDING-BAD') }
    // schema 1（旧版升级时可能遗留）：整份 before/after 原文；schema 2（v89.11.13）：只存 SHA-256，体积固定很小。两种都按同一语义恢复。
    let matchAfter: (v: string | null) => boolean, matchBefore: (v: string | null) => boolean
    if (pending && pending.schema === 1 && typeof pending.after === 'string' && (pending.before === null || typeof pending.before === 'string') && typeof pending.revision === 'string') {
      matchAfter = v => v === pending.after; matchBefore = v => v === pending.before
    } else if (pending && pending.schema === 2 && typeof pending.afterHash === 'string' && (pending.beforeHash === null || typeof pending.beforeHash === 'string') && typeof pending.revision === 'string') {
      matchAfter = v => v !== null && sha256Hex(v) === pending.afterHash; matchBefore = v => v === null ? pending.beforeHash === null : pending.beforeHash !== null && sha256Hex(v) === pending.beforeHash
    } else return fail('WRITE_FAILED', 'E-PENDING-BAD')
    const value = box.getItem(SCHEDULE_DOC_KEY)
    if (matchAfter(value)) {
      const currentRevision = box.getItem(SCHEDULE_REVISION_KEY)
      if (currentRevision !== pending.previousRevision && currentRevision !== pending.revision) return fail('VERSION_CONFLICT', 'E-PENDING-REV')
      box.setItem(SCHEDULE_REVISION_KEY, pending.revision)
      if (box.getItem(SCHEDULE_REVISION_KEY) !== pending.revision) return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_REVISION_KEY)
    } else if (!matchBefore(value)) return fail('VERSION_CONFLICT', 'E-PENDING-DOC')
    box.setItem(SCHEDULE_PENDING_WRITE_KEY, 'null')
    if (box.getItem(SCHEDULE_PENDING_WRITE_KEY) !== 'null') return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_PENDING_WRITE_KEY)
  }
  const revisionRaw = box.getItem(SCHEDULE_REVISION_KEY)
  if (revisionRaw !== null) {
    let parsed: any; try { parsed = JSON.parse(revisionRaw) } catch { return fail('WRITE_FAILED', 'E-REV-BAD') }
    if (!parsed || !Number.isSafeInteger(parsed.rev) || parsed.rev < 0) return fail('WRITE_FAILED', 'E-REV-BAD')
  }
  const cur = readScheduleRevision(box)
  if (expectedRev !== undefined && cur.rev !== expectedRev) return fail('VERSION_CONFLICT', 'E-CONFLICT')
  if (box.getItem(SCHEDULE_DOC_KEY) === raw) return { ok: true, rev: cur.rev }
  if (!Number.isSafeInteger(cur.rev + 1)) return fail('WRITE_FAILED', 'E-REV-BAD')
  const rev = cur.rev + 1
  const revision = JSON.stringify({ rev, writer, at: new Date().toISOString() })
  // v89.11.13：待提交记录只存前后内容的 SHA-256（原来整份 before+after 都写进 localStorage，占日程 3 倍空间，是 E-QUOTA 的放大器）。
  const beforeRaw = box.getItem(SCHEDULE_DOC_KEY)
  const intent = JSON.stringify({ schema: 2, beforeHash: beforeRaw === null ? null : sha256Hex(beforeRaw), afterHash: sha256Hex(raw), previousRevision: revisionRaw, revision })
  box.setItem(SCHEDULE_PENDING_WRITE_KEY, intent)
  if (box.getItem(SCHEDULE_PENDING_WRITE_KEY) !== intent) return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_PENDING_WRITE_KEY)
  box.setItem(SCHEDULE_DOC_KEY, raw)
  if (box.getItem(SCHEDULE_DOC_KEY) !== raw) return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_DOC_KEY)
  box.setItem(SCHEDULE_REVISION_KEY, revision)
  if (box.getItem(SCHEDULE_REVISION_KEY) !== revision) return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_REVISION_KEY)
  box.setItem(SCHEDULE_PENDING_WRITE_KEY, 'null')
  if (box.getItem(SCHEDULE_PENDING_WRITE_KEY) !== 'null') return fail('WRITE_FAILED', 'E-VERIFY', SCHEDULE_PENDING_WRITE_KEY)
  return { ok: true, rev }
 } catch (error) { return fail('WRITE_FAILED', isQuotaError(error) ? 'E-QUOTA' : 'E-EXC', error instanceof Error ? error.name : undefined) }
}
let tail: Promise<unknown> = Promise.resolve()
/** 共享写锁。coordinated=false 表示只在本页内互斥（没有 Web Locks）。 */
export async function withScheduleLock<T>(work: () => T | Promise<T>): Promise<{ value: T; coordinated: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return { value: await navigator.locks.request(SCHEDULE_WRITE_LOCK, async () => work()) as T, coordinated: true }
  const run = tail.then(work); tail = run.catch(() => {})
  return { value: await run, coordinated: false }
}
