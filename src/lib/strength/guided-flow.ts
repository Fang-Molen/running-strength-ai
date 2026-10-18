/** 力量课引导流程：组 → 组间休息 → 下一组；单侧动作 左 → 换侧间隔 → 右；动作最后一组后 → 动作之间休息 → 下一个动作。纯函数，便于测试。 */
export type Side = 'L' | 'R' | null
export type FlowMove = { id: string; name: string; sets: number; perSide?: boolean; restSec: number; sideRestSec?: number | null; betweenRestSec?: number | null }
export type FlowSet = { moveId: string; setIndex: number; done: boolean }
export type RestKind = 'side' | 'set' | 'between'
export type FlowNext = { kind: RestKind; seconds: number; cursor: number; side: Side } | { kind: 'finish'; seconds: 0; cursor: -1; side: null }
const sec = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), 3600) : 0)
export const firstSide = (move: Pick<FlowMove, 'perSide'> | undefined): Side => (move?.perSide ? 'L' : null)
export const SIDE_LABEL: Record<'L' | 'R', string> = { L: '左侧', R: '右侧' }

/** 当前组/侧完成后接下来做什么。sets 里 cursor 那组若还没写入 done，按刚完成处理。 */
export function afterStep(moves: FlowMove[], sets: FlowSet[], cursor: number, side: Side): FlowNext {
  const cur = sets[cursor], move = moves.find(m => m.id === cur?.moveId)
  if (!cur || !move) return { kind: 'finish', seconds: 0, cursor: -1, side: null }
  if (move.perSide && side === 'L') return { kind: 'side', seconds: sec(move.sideRestSec), cursor, side: 'R' }
  const open = (i: number) => i !== cursor && !sets[i].done
  let next = sets.findIndex((_, i) => i > cursor && open(i))
  if (next < 0) next = sets.findIndex((_, i) => open(i))
  if (next < 0) return { kind: 'finish', seconds: 0, cursor: -1, side: null }
  const nextMove = moves.find(m => m.id === sets[next].moveId)
  if (sets[next].moveId === cur.moveId) return { kind: 'set', seconds: sec(move.restSec), cursor: next, side: firstSide(nextMove) }
  return { kind: 'between', seconds: sec(move.betweenRestSec ?? move.restSec), cursor: next, side: firstSide(nextMove) }
}
export const REST_LABEL: Record<RestKind, string> = { side: '换侧间隔', set: '组间休息', between: '动作之间休息' }
/** 时间戳计时：锁屏/后台后按截止时间重算，不依赖定时器累计。 */
export function remainingMs(deadlineMs: number | null, pausedRemainingMs: number, now: number) {
  return deadlineMs == null ? Math.max(0, pausedRemainingMs) : Math.max(0, deadlineMs - now)
}
export function addRest(deadlineMs: number | null, pausedRemainingMs: number, now: number, deltaSec: number) {
  const rem = remainingMs(deadlineMs, pausedRemainingMs, now) + deltaSec * 1000
  const clamped = Math.max(0, Math.min(rem, 3600_000))
  return deadlineMs == null ? { deadlineMs: null, remainingMs: clamped } : { deadlineMs: now + clamped, remainingMs: clamped }
}
/** 1–10，可含一位小数；空白 = 未填。 */
export function parseRpe(text: string): number | null | 'invalid' {
  const t = text.trim().replace('，', '.').replace(',', '.')
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) && v >= 1 && v <= 10 ? Math.round(v * 10) / 10 : 'invalid'
}
/** 引导进度（含侧别）的本机持久化：刷新后从同一组同一侧继续。 */
export type GuidedState = { version: 1; side: Side; restKind: RestKind | null; restSide: Side; restStartedAt: number | null }
export function decodeGuided(raw: string | null): GuidedState | null {
  try { const v = raw ? JSON.parse(raw) : null; return v && v.version === 1 && [null, 'L', 'R'].includes(v.side) ? v : null } catch { return null }
}
