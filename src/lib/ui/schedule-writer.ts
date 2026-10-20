/** v87 日程写入闸口（区块 schedule-writer）：fk-schedule-v1 的所有写入都经过这里。
 *  - 每次写入把单调递增的修订号写到独立键 fk-schedule-v1-rev（不改日程文档本身的格式，旧数据原样保留），并记下是哪个写入方；
 *  - 异步写入方用同一把锁 PLAN_EXECUTION_LOCK（与改课执行器同名），浏览器没有 Web Locks 时退回本页内互斥并标明“未跨页协调”；
 *  - 改课宿主仍固定 UNCOORDINATED：同步写入方（首页日程、引导问卷、未标记课、进度同步、放弃本次）还不能跨页拿锁，见 docs/modules.md。
 */
export const SCHEDULE_DOC_KEY = 'fk-schedule-v1'
export const SCHEDULE_REVISION_KEY = 'fk-schedule-v1-rev'
/** 与 src/lib/coach/plan-execution/core.ts 的 PLAN_EXECUTION_LOCK 同名（测试锁定一致）。 */
export const SCHEDULE_WRITE_LOCK = 'fangkun-plan-execution-v1'
export type ScheduleWriter = 'today-board' | 'today-board-sync' | 'onboarding-r8' | 'unmarked-plans' | 'schedule-progress' | 'guided-discard' | 'scheduled-entry' | 'plan-execution' | 'unknown'
export const SCHEDULE_WRITERS: readonly ScheduleWriter[] = ['today-board', 'today-board-sync', 'onboarding-r8', 'unmarked-plans', 'schedule-progress', 'guided-discard', 'scheduled-entry']
type Box = { getItem(k: string): string | null; setItem(k: string, v: string): void }
export type ScheduleRevision = { rev: number; writer: ScheduleWriter | null; at: string | null }
export function readScheduleRevision(box: Box | null | undefined): ScheduleRevision {
  try { const v = JSON.parse(box?.getItem(SCHEDULE_REVISION_KEY) ?? 'null'); if (v && Number.isSafeInteger(v.rev) && v.rev >= 0) return { rev: v.rev, writer: v.writer ?? null, at: v.at ?? null } } catch { /* 损坏按 0 处理，不覆盖日程 */ }
  return { rev: 0, writer: null, at: null }
}
/** 同步写入（单页内一次完成读改写）。expectedRev 给出时做 CAS：修订号不一致就不写。 */
export function commitScheduleRaw(box: Box, raw: string, writer: ScheduleWriter, expectedRev?: number): { ok: true; rev: number } | { ok: false; reason: 'VERSION_CONFLICT' | 'WRITE_FAILED' } {
  const cur = readScheduleRevision(box)
  if (expectedRev !== undefined && cur.rev !== expectedRev) return { ok: false, reason: 'VERSION_CONFLICT' }
  if (box.getItem(SCHEDULE_DOC_KEY) === raw) return { ok: true, rev: cur.rev }
  box.setItem(SCHEDULE_DOC_KEY, raw)
  if (box.getItem(SCHEDULE_DOC_KEY) !== raw) return { ok: false, reason: 'WRITE_FAILED' }
  const rev = cur.rev + 1
  try { box.setItem(SCHEDULE_REVISION_KEY, JSON.stringify({ rev, writer, at: new Date().toISOString() })) } catch { /* 修订号写失败不回滚日程；下次读取仍可比对内容哈希 */ }
  return { ok: true, rev }
}
let tail: Promise<unknown> = Promise.resolve()
/** 共享写锁。coordinated=false 表示只在本页内互斥（没有 Web Locks）。 */
export async function withScheduleLock<T>(work: () => T | Promise<T>): Promise<{ value: T; coordinated: boolean }> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return { value: await navigator.locks.request(SCHEDULE_WRITE_LOCK, work) as T, coordinated: true }
  const run = tail.then(work); tail = run.catch(() => {})
  return { value: await run, coordinated: false }
}
