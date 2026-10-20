/**
 * 已确认导入的保留规则（区块 training-import）。纯函数，不读写存储。
 *
 * v86.2 根因修复：旧版按“写入顺序”截取最后 100 条（slice(-100)）。佳明活动列表是“新的在前”，
 * 一次同步 200 条时，最先写入的最新活动会被后写入的旧活动挤掉，存下来的反而是最旧的 100 条
 * （复盘选课只剩 6 月的导入）。现在按训练发生时间保留最新的，旧记录只在超过上限时才让位。
 */
export const MAX_CONFIRMED_IMPORTS = 400

type Retained = { draftId: string; occurredAt: { value: string | null }; confirmedAt?: string }

const at = (r: Retained) => { const t = Date.parse(r.occurredAt?.value ?? ''); return Number.isFinite(t) ? t : -Infinity }

/** 超过上限时去掉发生时间最早的记录；未超限原样返回（保持原写入顺序）。 */
export function retainNewest<T extends Retained>(records: readonly T[], max = MAX_CONFIRMED_IMPORTS): T[] {
  if (records.length <= max) return [...records]
  const drop = new Set([...records].map((r, i) => ({ r, i })).sort((a, b) => at(a.r) - at(b.r) || a.i - b.i).slice(0, records.length - max).map(x => x.i))
  return records.filter((_, i) => !drop.has(i))
}

/** 加入一条新记录；如果它本身早于保留范围（会被立刻挤掉），返回 null，避免“看似保存成功、下次同步又重写”的循环。 */
export function appendRetained<T extends Retained>(records: readonly T[], next: T, max = MAX_CONFIRMED_IMPORTS): T[] | null {
  const kept = retainNewest([...records, next], max)
  return kept.includes(next) ? kept : null
}
