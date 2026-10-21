/** v89.9.2：高驰账号读取（经 /api/coros 中转，令牌只在 HttpOnly 加密 cookie）。
 * 只读近 28 天活动摘要 → 转成与文件导入相同的 DeviceActivity，进入原“核对 → 保存”流程，用户勾选确认后才入日志。
 * 接口为开源项目使用的非官方 Training Hub 接口；字段含义（startTime 单位、sportType 编码）按开源代码推断，待真实账号核对。
 * 不读取、也不生成：日内心率、压力、身体电量（Body Battery）、睡眠、HRV、分圈。 */
import type { DeviceActivity, DeviceParseResult } from '../ui/device-parse'
import { corosProvenance } from './brand-isolation'

export type CorosActivity = { labelId: string; name: string; sportType: number | null; date: string | null; startTime: number | null; endTime: number | null; totalTime: number | null; distance: number | null; avgHr: number | null; maxHr: number | null; calorie: number | null }
export const COROS_SOURCE = '高驰账号同步'

const epochIso = (v: number | null): string | null => {
  if (v == null || !Number.isFinite(v) || v <= 0) return null
  const ms = v > 1e12 ? v : v * 1000 // 开源代码未写明单位：毫秒或秒都接受
  const t = new Date(ms); return Number.isFinite(t.getTime()) && t.getUTCFullYear() >= 2010 ? t.toISOString() : null
}
const dayIso = (d: string | null) => d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00` : null
/** 高驰 sportType（据开源项目）：100 跑步、101 室内跑、102 越野、103 操场；402 力量。其他类型不入跑步/力量。 */
export function corosSport(t: number | null): DeviceActivity['sport'] {
  if (t != null && t >= 100 && t < 200 && t !== 104) return 'RUNNING'
  if (t === 402) return 'STRENGTH'
  return 'UNKNOWN'
}
export function corosToDevice(list: CorosActivity[], accountRef: string, receivedAt: string = new Date().toISOString()): DeviceActivity[] {
  if (!/^[0-9a-f]{8,32}$/.test(accountRef)) return []
  return list.flatMap(a => {
    if (!a.labelId || !/^[0-9A-Za-z_-]{1,40}$/.test(a.labelId)) return []
    const sport = corosSport(a.sportType), startIso = epochIso(a.startTime) ?? dayIso(a.date)
    const dur = a.totalTime != null && a.totalTime > 0 && a.totalTime < 86400 * 2 ? Math.round(a.totalTime) : null
    const dist = a.distance != null && a.distance > 0 && a.distance < 500000 ? Math.round(a.distance) : null
    const hr = (v: number | null) => v != null && v >= 25 && v <= 240 ? Math.round(v) : null
    return [{ key: `coros:${accountRef}:${a.labelId}`, sourceIdentity: `coros:${accountRef}:${a.labelId}`, source: COROS_SOURCE, sport,
      sportLabel: sport === 'RUNNING' ? '跑步' : sport === 'STRENGTH' ? '力量' : (a.name || '其他运动'), startIso, durationSec: dur, distanceM: dist,
      avgHr: hr(a.avgHr), maxHr: hr(a.maxHr), calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [],
      provenance: corosProvenance(accountRef, a.labelId, startIso, receivedAt) }]
  })
}
/** v89.9.4：带错误码，便于区分“登录过期/未登录”（需重新登录）和临时失败。 */
export class CorosError extends Error { constructor(message: string, readonly code: string, readonly status: number) { super(message) } }
export const corosNeedsLogin = (e: unknown) => e instanceof CorosError && (e.code === 'TOKEN_EXPIRED' || e.code === 'NOT_LOGGED_IN' || e.status === 401 && e.code !== 'BAD_CREDENTIALS')
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
async function call(path: string, init?: RequestInit) {
  const r = await fetch('/api/coros/' + path, { credentials: 'same-origin', ...init })
  const body = await r.json().catch(() => null) as { ok?: boolean; message?: string } & Record<string, unknown> | null
  if (!body) throw new CorosError('高驰中转没有返回有效数据', 'NO_BODY', r.status)
  if (!body.ok) throw new CorosError(body.message || '高驰请求失败', typeof body.error === 'string' ? body.error : 'UNKNOWN', r.status)
  return body
}
export const corosStatus = () => call('status') as Promise<{ ok: true; loggedIn: boolean; region: number | null }>
export const corosLogin = (account: string, password: string) => call('login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }) })
export const corosLogout = () => call('logout', { method: 'POST' })
/** 近 days 天活动 → 待核对的导入结果（不保存）。 */
export async function corosRecentImport(days = 28, now = new Date()): Promise<DeviceParseResult> {
  const end = ymd(now), start = ymd(new Date(now.getTime() - (days - 1) * 86400e3))
  const all: CorosActivity[] = []; let ref = ''
  for (let page = 1; page <= 5; page++) {
    const r = await call(`activities?startDay=${start}&endDay=${end}&page=${page}`) as unknown as { accountRef: string; totalPage: number; activities: CorosActivity[] }
    ref = r.accountRef; all.push(...r.activities)
    if (page >= (r.totalPage || 1)) break
    await new Promise(res => setTimeout(res, 350))
  }
  const mapped = corosToDevice(all, ref, new Date().toISOString()), activities = mapped.filter(a => a.sport !== 'UNKNOWN'), other = mapped.length - activities.length
  return { kind: '高驰账号', brand: 'COROS', activities, health: [], notes: [
    `从高驰账号读到近 ${days} 天 ${all.length} 条活动摘要（距离、时长、平均/最大心率）。其中跑步/力量 ${activities.length} 条${other ? `（其他运动 ${other} 条未列出）` : ''}。请核对后勾选保存；保存后与其他导入一样进入日志，关联计划课仍需你确认。`,
    '高驰这一步不提供日内心率、压力、睡眠、HRV 和分圈；不生成“身体电量”。开始时间和运动类型按开源资料解析，若与高驰 App 不一致请不要保存并告诉我。',
  ] }
}

/** 最近一次读取记录（只存时间和条数，不存令牌/账号）；按当前运动员分开。 */
export type CorosReadMeta = { at: string; read: number; saved?: number }
const metaKey = (athlete: string) => `fk-coros-last-read-v1:${athlete}`
export function loadCorosMeta(athlete: string): CorosReadMeta | null {
  try { const v = JSON.parse(localStorage.getItem(metaKey(athlete)) ?? 'null'); return v && typeof v.at === 'string' ? v : null } catch { return null }
}
export function saveCorosMeta(athlete: string, m: CorosReadMeta) {
  try { localStorage.setItem(metaKey(athlete), JSON.stringify(m)) } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event('fk-coros-changed')) } catch { /* no window */ }
}
