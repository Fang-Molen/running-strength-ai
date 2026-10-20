import { garminHealthDay } from './garmin-health'
import { buildIntradayDay, type IntradayDay } from './garmin-intraday'
import { shortHash, shiftDay } from './observation'
import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'

export type GarminReply = { status: number; body: any }
/** v89.1：日内样本取 28 天；补取的旧日子之间停顿 350ms，避免触发佳明限流。 */
export const INTRADAY_DAYS = 28, INTRADAY_GAP_MS = 350
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export type GarminSyncReport = {
  at: string; status: 'ok' | 'partial' | 'empty' | 'auth' | 'fail' | 'stale'; subjectId: string; accountScope: string | null;
  healthRows: number; activityRows: number; saved: number; skipped: number; errors: string[];
  healthDaysRequested: number; coverageDays: string[]; activityLimit: 200; completeHistory: false;
  /** v89.1：日内样本单独计数，失败不再静默（不影响日汇总状态）。 */
  intraday?: { requested: number; saved: number; failed: string[]; throttled: boolean };
}
export function garminAccount(reply: GarminReply): { scope: string; name: string } | null {
  const b = reply.body
  if (reply.status !== 200 || !b?.loggedIn || !['cn', 'com'].includes(b.region) || typeof b.profile?.displayName !== 'string' || !b.profile.displayName.trim()) return null
  return { scope: `${b.region}:${b.profile.displayName}`, name: b.profile.displayName }
}
export const garminStorageKey = (key: string, subject: string) => `${key}:${encodeURIComponent(subject)}`
const number = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null
/** Same stable source activity ID across numeric corrections. Missing ID/time stays unimported. */
export function garminActivity(o: any, scope: string): DeviceActivity | null {
  if (!o || !(typeof o.activityId === 'string' && /^\d+$/.test(o.activityId) || Number.isSafeInteger(o.activityId) && o.activityId > 0) || typeof o.startTimeGMT !== 'string') return null
  const raw = o.startTimeGMT.replace(' ', 'T'), stamp = /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : raw + 'Z'
  if (!/^\d{4}-\d\d-\d\dT/.test(stamp) || !Number.isFinite(Date.parse(stamp))) return null
  const k = String(o.activityType?.typeKey ?? '').toLowerCase()
  const sport = /run|track|treadmill/.test(k) ? 'RUNNING' : /strength|fitness|weight|hiit/.test(k) ? 'STRENGTH' : 'UNKNOWN'
  const identity = `garmin:${encodeURIComponent(scope)}:${o.activityId}`
  return { key: identity, sourceIdentity: identity, source: '佳明账号同步', sport, sportLabel: sport === 'RUNNING' ? '跑步' : sport === 'STRENGTH' ? '力量' : k || '其他',
    startIso: new Date(stamp).toISOString(), durationSec: number(o.duration), distanceM: number(o.distance), avgHr: number(o.averageHR), maxHr: number(o.maxHR),
    calories: number(o.calories), avgCadence: number(o.averageRunningCadenceInStepsPerMinute), avgPower: number(o.avgPower),
    verticalOscMm: number(o.avgVerticalOscillation) === null ? null : o.avgVerticalOscillation * 10, groundContactMs: number(o.avgGroundContactTime), sets: [] }
}

/** All writes are after the final account/subject fence. No credentials or GPS in the report. */
export async function runGarminSyncJob(host: {
  api: (path: string) => Promise<GarminReply>; subject: () => string; generation: () => number; day: string; now: string;
  bindAccount: (scope: string, subject: string) => boolean;
  save: (health: DeviceHealthRow[], activities: DeviceActivity[]) => { saved: number; skipped: number; errors: string[] };
  saveView: (activities: unknown[], accountScope: string) => void;
  report: (report: GarminSyncReport) => void; progress: (message: string) => void;
  /** v78：健康历史逐次补到 90 天。get = 已补到第几天（≥14），set 在本次保存成功后调用。 */
  backfill?: { get: (scope: string) => number; set: (scope: string, upTo: number) => void };
  /** v88.3：最近 7 天日内心率/身体电量（今天、昨天每次都取；更早的已完整就跳过）。失败不影响日汇总同步结果。 */
  intraday?: { complete: (day: string) => boolean; save: (days: IntradayDay[]) => number };
  /** 测试可注入；默认真实等待（节流）。 */
  sleep?: (ms: number) => Promise<void>;
}): Promise<GarminSyncReport> {
  const subjectId = host.subject(), generation = host.generation()
  const result: GarminSyncReport = { at: host.now, status: 'fail', subjectId, accountScope: null, healthRows: 0, activityRows: 0, saved: 0, skipped: 0,
    errors: [], healthDaysRequested: 0, coverageDays: [], activityLimit: 200, completeHistory: false }
  const unchanged = () => host.subject() === subjectId && host.generation() === generation
  try {
    const initial = await host.api('status'), account = garminAccount(initial)
    if (!unchanged()) { result.status = 'stale'; result.errors.push('账号或运动员已变化，已丢弃本次结果'); return result }
    // R1 SYNC-04：网络中断/服务不可达不是"登录失效"，单独报告为失败，便于用户判断该重试还是重登。
    if (!account && (initial.status === 0 || initial.status >= 404)) { result.status = 'fail'; result.errors.push(initial.status === 0 ? '网络中断或请求超时，未连接到佳明同步服务' : `佳明同步服务暂不可用（HTTP ${initial.status}）`); return result }
    if (!account) { result.status = 'auth'; result.errors.push('未登录、登录过期或账号身份不完整'); return result }
    result.accountScope = shortHash(account.scope)
    const list = await host.api('g/activitylist-service/activities/search/activities?start=0&limit=200')
    const raw = list.status === 200 && Array.isArray(list.body) ? list.body : []
    if (list.status !== 200 || !Array.isArray(list.body)) result.errors.push(`活动列表 HTTP ${list.status}`)
    if ([401, 403].includes(list.status)) { result.status = 'auth'; return result }
    const acts: DeviceActivity[] = [], health: DeviceHealthRow[] = [], intraday: IntradayDay[] = []
    const identities = new Map<string, DeviceActivity>()
    for (const o of raw) {
      const a = garminActivity(o, account.scope)
      if (!a) { result.errors.push('活动稳定 ID 或 UTC 时间无效，未导入'); continue }
      const prior = identities.get(a.key)
      if (prior && JSON.stringify(prior) !== JSON.stringify(a)) { result.errors.push('同一活动 ID 出现冲突版本，未写入活动'); result.status = 'fail'; return result }
      identities.set(a.key, a)
    }
    acts.push(...identities.values())
    // 每次同步最近 14 天；另外往前补 14 天更早的历史，直到满 90 天（恢复趋势 30/90 天才有数据）。
    const HIST = 90, from = Math.min(HIST, Math.max(14, host.backfill?.get(account.scope) ?? HIST)), upTo = Math.min(HIST, from + 14)
    const offsets = [...Array.from({ length: 14 }, (_, i) => i), ...Array.from({ length: upTo - from }, (_, i) => from + i)]
    // v89.1：日内样本首次/历史不足时补到 28 天。今天、昨天每次都重取；更早的只取还没取全的日子。
    // 不在本次日汇总范围内的日子（第 14–27 天）单独逐天取，每天之间停顿，遇到 429 立即停止日内补取（日汇总照常）。
    let throttled = false
    const intradayStat = { requested: 0, saved: 0, failed: [] as string[], throttled: false }
    const takeIntraday = (d: string, ihr: GarminReply | undefined, ist: GarminReply | undefined, sl?: GarminReply) => {
      intradayStat.requested++
      if ([ihr, ist].some(r => r?.status === 429)) { throttled = intradayStat.throttled = true; intradayStat.failed.push(`${d} 佳明限流（429），稍后再同步补取`); return }
      if (!ihr && !ist) { intradayStat.failed.push(`${d} 日内请求失败（网络）`); return }
      const built = buildIntradayDay({ day: d, now: host.now, hr: ihr, stress: ist, sleep: sl, activities: acts })
      if (built.day) intraday.push(built.day); else if (built.failures.length) intradayStat.failed.push(...built.failures.slice(0, 2))
    }
    for (const [n, i] of offsets.entries()) {
      if (!unchanged()) { result.status = 'stale'; return result }
      const d = shiftDay(host.day, -i)
      host.progress(`已取得 ${acts.length} 条活动记录 · 健康 ${n + 1}/${offsets.length} 天${i >= 14 ? '（补更早历史）' : ''}`)
      const wantIntraday = !!host.intraday && !throttled && i < INTRADAY_DAYS && (i < 2 || !host.intraday.complete(d))
      const none = Promise.resolve(undefined)
      if (wantIntraday && i >= 2) await (host.sleep ?? defaultSleep)(INTRADAY_GAP_MS)
      const [s, h, sl, ihr, ist] = await Promise.all([
        host.api(`g/usersummary-service/usersummary/daily/${encodeURIComponent(account.name)}?calendarDate=${d}`),
        host.api(`g/hrv-service/hrv/${d}`), host.api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(account.name)}?date=${d}`),
        wantIntraday ? host.api(`g/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined) : none,
        wantIntraday ? host.api(`g/wellness-service/wellness/dailyStress/${d}`).catch(() => undefined) : none,
      ])
      if (wantIntraday) takeIntraday(d, ihr, ist, sl)
      result.healthDaysRequested++
      if ([s, h, sl].some(r => [401, 403].includes(r.status))) { result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result }
      const parsed = garminHealthDay(d, account.scope, s, h, sl, host.now)
      health.push(...parsed.rows); result.errors.push(...parsed.failures)
      if (parsed.rows.length) result.coverageDays.push(d)
    }
    if (host.intraday) {
      const extra = Array.from({ length: INTRADAY_DAYS }, (_, i) => i).filter(i => !offsets.includes(i)).map(i => shiftDay(host.day, -i)).filter(d => !host.intraday!.complete(d))
      for (const [n, d] of extra.entries()) {
        if (throttled || !unchanged()) break
        host.progress(`补取日内心率/身体电量/压力 ${n + 1}/${extra.length} 天`)
        await (host.sleep ?? defaultSleep)(INTRADAY_GAP_MS)
        const [ihr, ist, sl] = await Promise.all([
          host.api(`g/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined),
          host.api(`g/wellness-service/wellness/dailyStress/${d}`).catch(() => undefined),
          host.api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined),
        ])
        if ([ihr, ist, sl].some(r => r && [401, 403].includes(r.status))) { result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result }
        takeIntraday(d, ihr, ist, sl)
      }
    }
    const final = garminAccount(await host.api('status'))
    if (!unchanged() || !final || final.scope !== account.scope) { result.status = 'stale'; result.errors.push('账号或运动员变化，未写入本次结果'); return result }
    if (!host.bindAccount(account.scope, subjectId)) { result.status = 'fail'; result.errors.push('此佳明账号已绑定其他运动员，或归属无法保存；本次未导入'); return result }
    result.healthRows = health.length; result.activityRows = acts.length
    const saved = host.save(health, acts)
    result.saved = saved.saved; result.skipped = saved.skipped; result.errors.push(...saved.errors)
    if (intraday.length) { try { intradayStat.saved = host.intraday?.save(intraday) ?? 0; if (!intradayStat.saved) intradayStat.failed.push('日内样本本机保存失败（空间不足？）') } catch { intradayStat.failed.push('日内样本本机保存失败') } }
    if (host.intraday) result.intraday = intradayStat
    if (!saved.errors.length && upTo > from) host.backfill?.set(account.scope, upTo)
    // Raw activity view remains account/athlete scoped and never counts as training sessions.
    host.saveView(raw.flatMap(o => { const a = garminActivity(o, account.scope); return a ? [{ ...o, fkSourceIdentity: a.sourceIdentity, fkStartIso: a.startIso }] : [] }), result.accountScope!)
    result.status = result.errors.length ? (result.saved + result.skipped ? 'partial' : 'fail') : health.length + acts.length ? 'ok' : 'empty'
  } catch { result.status = result.saved + result.skipped ? 'partial' : 'fail'; result.errors.push('请求、解析或本地保存失败；保留已有记录') }
  finally {
    // A switched user must never receive another athlete's pending sync report.
    if (unchanged()) { try { host.report(result) } catch { result.status = 'fail'; result.errors.push('同步报告保存失败，未标记成功') } }
  }
  return result
}
