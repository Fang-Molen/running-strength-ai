/** v89.9.4：设备品牌隔离（高驰 / 佳明 / 其他）。纯函数，不读写存储，不改佳明同步。
 * - 来源只按“稳定来源标识”的前缀判断（garmin: / coros:），不按标题或日期猜。
 * - 跨品牌“可能是同一次活动”只给候选，由用户决定是否保存；绝不自动合并、不自动标完成。
 * - 健康基准（HRV/静息心率/睡眠）本来就按来源+口径分组（recovery-quantitative 的 protocol），这里不跨品牌混算。 */
export type Provider = 'GARMIN' | 'COROS' | 'POLAR' | 'SUUNTO' | 'HUAWEI' | 'APPLE_HEALTH' | 'HEALTH_CONNECT' | 'OTHER'
export function providerOf(identity: string | null | undefined): Provider {
  if (typeof identity !== 'string') return 'OTHER'
  if (identity.startsWith('garmin:')) return 'GARMIN'
  if (identity.startsWith('coros:')) return 'COROS'
  if (identity.startsWith('polar:')) return 'POLAR'
  if (identity.startsWith('suunto:')) return 'SUUNTO'
  if (identity.startsWith('huawei:')) return 'HUAWEI'
  if (identity.startsWith('apple_health:')) return 'APPLE_HEALTH'
  if (identity.startsWith('health_connect:')) return 'HEALTH_CONNECT'
  return 'OTHER'
}
/** 记录来源字段：provider / accountRef / recordId / measuredAt / receivedAt。缺的就是 null，不补。 */
export type Provenance = { provider: Provider; accountRef: string | null; recordId: string | null; measuredAt: string | null; receivedAt: string }
export function corosProvenance(accountRef: string, recordId: string, measuredAt: string | null, receivedAt: string): Provenance {
  return { provider: 'COROS', accountRef: accountRef || null, recordId: recordId || null, measuredAt, receivedAt }
}
export type ActLike = { id: string; sport: string; startedAt: string | null; distanceM: number | null; durationSec: number | null; originIds?: string[]; source?: string; timeUnknown?: boolean }
/** 一条日志/缓存记录的品牌（佳明缓存行 source='garmin'；导入行看 originIds 里的稳定标识）。 */
export function rowProvider(r: ActLike): Provider {
  if (r.source === 'garmin') return 'GARMIN'
  const ids = r.originIds ?? [r.id]
  if (ids.some(x => providerOf(x) === 'GARMIN')) return 'GARMIN'
  if (ids.some(x => providerOf(x) === 'COROS')) return 'COROS'
  return ids.map(providerOf).find(p => p !== 'OTHER') ?? 'OTHER'
}
const close = (a: number | null, b: number | null, rel: number, abs: number) => a == null || b == null ? null : Math.abs(a - b) <= Math.max(abs, rel * Math.max(a, b))
/** 跨品牌同一次活动候选：项目相同、开始时间相差 ≤2 分钟、距离或时长接近（且已知的都不矛盾）。只给候选。 */
export function sameActivityCandidate(a: ActLike, b: ActLike): boolean {
  if (a.sport !== b.sport || !a.startedAt || !b.startedAt || a.timeUnknown || b.timeUnknown) return false
  const ta = Date.parse(a.startedAt), tb = Date.parse(b.startedAt)
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || Math.abs(ta - tb) > 120_000) return false
  const d = close(a.distanceM, b.distanceM, 0.05, 100), t = close(a.durationSec, b.durationSec, 0.05, 60)
  if (d === false || t === false) return false
  return d === true || t === true
}
/** 待保存的某品牌活动 vs 日志里其他品牌的活动 → { 待保存 id: 对方 id }。同品牌不比（同品牌重复由稳定 ID 处理）。 */
export function crossBrandCandidates(incoming: ActLike[], existing: ActLike[], incomingProvider: Provider): Map<string, string> {
  const out = new Map<string, string>()
  const others = existing.filter(r => { const p = rowProvider(r); return p !== incomingProvider && p !== 'OTHER' })
  for (const a of incoming) { const hit = others.find(r => sameActivityCandidate(a, r)); if (hit) out.set(a.id, hit.id) }
  return out
}
/** 日志里已经同时存在的跨品牌疑似重复对（只读提示，用户自己决定删哪条）。 */
export function crossBrandPairsInLog(rows: ActLike[]): [string, string][] {
  const g = rows.filter(r => rowProvider(r) === 'GARMIN'), c = rows.filter(r => rowProvider(r) === 'COROS')
  const pairs: [string, string][] = []
  for (const x of c) { const hit = g.find(y => sameActivityCandidate(x, y)); if (hit) pairs.push([x.id, hit.id]) }
  return pairs
}
/** 高驰活动的 labelId（来源标识 coros:<账号引用>:<labelId>）。换登录方式后账号引用可能不同，同一 labelId 仍视为同一条高驰记录。 */
export function corosLabelOf(identity: string | null | undefined): string | null {
  const m = typeof identity === 'string' ? /^coros:[^:]*:([0-9A-Za-z_-]{1,40})$/.exec(identity) : null
  return m ? m[1] : null
}
