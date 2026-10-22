import { garminHealthDay } from './garmin-health'
import { buildIntradayDay, type IntradayDay } from './garmin-intraday'
import { shortHash, shiftDay } from './observation'
import { planGarminDailySync } from './garmin-sync-plan-u11'
import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'

export type GarminReply = { status: number; body: any }
/** v89.1：日内样本取 28 天；补取的旧日子之间停顿 350ms，避免触发佳明限流。 */
export const INTRADAY_DAYS = 28, INTRADAY_GAP_MS = 350
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export type GarminSyncReport = {
  at: string; status: 'ok' | 'partial' | 'empty' | 'auth' | 'fail' | 'stale'; subjectId: string; accountScope: string | null;
  healthRows: number; activityRows: number; saved: number; skipped: number; errors: string[];
  healthDaysRequested: number; coverageDays: string[]; activityLimit: number; completeHistory: false;
  /** v89.10.1：RECENT=增量同步（近 3 天 + 新活动）；FULL=完整复核（14 天 + 补历史 + 最近 200 条活动）。requests=本次向佳明发出的请求数。 */
  mode?: 'INITIAL' | 'RECENT' | 'FULL'; requests?: number;
  /** v89.1：日内样本单独计数，失败不再静默（不影响日汇总状态）。 */
  intraday?: { requested: number; saved: number; failed: string[]; throttled: boolean };
}
export function garminAccount(reply: GarminReply): { scope: string; name: string } | null {
  const b = reply.body
  if (reply.status !== 200 || !b?.loggedIn || !['cn', 'com'].includes(b.region) || typeof b.profile?.displayName !== 'string' || !b.profile.displayName.trim()) return null
  return { scope: `${b.region}:${b.profile.displayName}`, name: b.profile.displayName }
}
/** ISO 时刻 → 本机本地日（与 host.day=localDay() 同一时区）。 */
function localDayOf(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
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
  save: (health: DeviceHealthRow[], activities: DeviceActivity[]) => { saved: number; skipped: number; errors: string[]; healthErrors?: string[] };
  saveView: (activities: unknown[], accountScope: string) => void;
  report: (report: GarminSyncReport) => void; progress: (message: string) => void;
  /** v78：健康历史逐次补到 90 天。get = 已补到第几天（≥14），set 在本次保存成功后调用。 */
  backfill?: { get: (scope: string) => number; set: (scope: string, upTo: number) => void };
  /** v88.3：最近 7 天日内心率/身体电量（今天、昨天每次都取；更早的已完整就跳过）。失败不影响日汇总同步结果。 */
  intraday?: { complete: (day: string) => boolean; save: (days: IntradayDay[]) => number };
  /** 测试可注入；默认真实等待（节流）。 */
  sleep?: (ms: number) => Promise<void>;
  /** v89.10.1：增量同步。没有 fullReview（旧调用/测试）= 每次完整复核，行为与以前相同。
   * reason=MANUAL（点“同步最近活动和健康数据”）→ 完整复核；AUTO → 当天（本地日）首次、首次同步/新账号、或上次完整复核超过 24 小时 → 完整复核，否则增量。 */
  reason?: 'AUTO' | 'MANUAL';
  fullReview?: { get: (scope: string) => string | null; set: (scope: string, at: string) => void };
  /** 活动是否已在本机且数值未变（增量同步用来判断要不要往后翻页）。 */
  activitySeen?: (accountScope: string, o: any) => boolean;
  /** v89.10.10：按天记录（按佳明账号分开）。有它时：首次一次取全，之后只取“上次取到的日子往前 2 天 → 今天”+ 上次没取到的具体日子；
   * 已存过佳明健康记录的旧日子不再重取。完整复核仅在手动“完整复核最近数据”时。 */
  healthDays?: { get: (scope: string) => { through: string | null; retry: string[] }; set: (scope: string, v: { through: string; retry: string[] }) => void; saved?: (scope: string) => Set<string> };
}): Promise<GarminSyncReport> {
  const subjectId = host.subject(), generation = host.generation()
  const result: GarminSyncReport = { at: host.now, status: 'fail', subjectId, accountScope: null, healthRows: 0, activityRows: 0, saved: 0, skipped: 0,
    errors: [], healthDaysRequested: 0, coverageDays: [], activityLimit: 200, completeHistory: false }
  const unchanged = () => host.subject() === subjectId && host.generation() === generation
  let requests = 0
  const api = (path: string) => { requests++; return host.api(path) }
  try {
    const initial = await api('status'), account = garminAccount(initial)
    if (!unchanged()) { result.status = 'stale'; result.errors.push('账号或运动员已变化，已丢弃本次结果'); return result }
    // R1 SYNC-04：网络中断/服务不可达不是"登录失效"，单独报告为失败，便于用户判断该重试还是重登。
    if (!account && (initial.status === 0 || initial.status >= 404)) { result.status = 'fail'; result.errors.push(initial.status === 0 ? '网络中断或请求超时，未连接到佳明同步服务' : `佳明同步服务暂不可用（HTTP ${initial.status}）`); return result }
    if (!account) { result.status = 'auth'; result.errors.push('未登录、登录过期或账号身份不完整'); return result }
    result.accountScope = shortHash(account.scope)
    // v89.10.1：选模式（复用 U11 计划：FULL 的 14 天 + 补历史游标与以前一致）。本地日变了视同“超过 24 小时”。
    const lastFull = host.fullReview ? host.fullReview.get(account.scope) : null
    const sameLocalDay = !!lastFull && Number.isFinite(Date.parse(lastFull)) && localDayOf(lastFull) === host.day
    const plan = planGarminDailySync({ today: host.day, now: host.now, reason: !host.fullReview || host.reason !== 'AUTO' ? 'MANUAL' : 'PERIODIC', lastAttemptAt: null,
      lastFullSuccessAt: sameLocalDay ? lastFull : null, lastFailureAt: null, backfillThrough: host.backfill?.get(account.scope) ?? 90 })
    // 首次同步（新账号或历史还没补满 90 天）：一次补齐 90 天日汇总 + 28 天日内；中断/限流后下次从游标继续。
    const cursor = Math.min(90, Math.max(14, host.backfill?.get(account.scope) ?? 90))
    const days = host.healthDays ? host.healthDays.get(account.scope) : null, savedDays = host.healthDays?.saved?.(account.scope) ?? new Set<string>()
    const mode: 'INITIAL' | 'RECENT' | 'FULL' = host.fullReview && cursor < 90 ? 'INITIAL' : days ? host.reason === 'MANUAL' ? 'FULL' : 'RECENT' : plan.mode === 'RECENT' ? 'RECENT' : 'FULL'
    result.mode = mode
    // 活动列表：完整复核一次取 200 条；增量先取 20 条，整页都是新的/有变化才继续往后翻（每页 20，最多到 200），不漏新活动。
    const PAGE = mode === 'RECENT' ? 20 : 200, raw: any[] = []
    for (let start = 0; start < 200; start += PAGE) {
      const list = await api(`g/activitylist-service/activities/search/activities?start=${start}&limit=${PAGE}`)
      if ([401, 403].includes(list.status)) { result.errors.push(`活动列表 HTTP ${list.status}`); result.status = 'auth'; return result }
      if (list.status !== 200 || !Array.isArray(list.body)) { result.errors.push(`活动列表 HTTP ${list.status}`); break }
      raw.push(...list.body)
      if (mode !== 'RECENT' || list.body.length < PAGE || !host.activitySeen || list.body.some((o: any) => host.activitySeen!(result.accountScope!, o))) break
      if (!unchanged()) { result.status = 'stale'; return result }
    }
    result.activityLimit = mode !== 'RECENT' ? 200 : raw.length >= 20 ? Math.min(200, Math.ceil(raw.length / 20) * 20) : 20
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
    // 增量：只取最近 3 天（0–2）；完整复核：14 天 + 往前补 14 天，直到满 90 天。补历史游标只在保存成功后推进。
    const HIST = 90, from = cursor
    const offsetOf = (d: string) => Math.round((Date.parse(host.day + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 864e5)
    let offsets = mode === 'INITIAL' ? [...Array.from({ length: 14 }, (_, i) => i), ...Array.from({ length: HIST - from }, (_, i) => from + i)] : plan.offsets
    if (days) {
      // 最近窗口：从上次取到的日子往前 2 天到今天（没有记录时用本机已存的最近一天；都没有 = 首次，取近 14 天）。
      const latestSaved = [...savedDays].filter(d => d <= host.day).sort().at(-1) ?? null, through = days.through ?? latestSaved
      const span = through ? Math.min(HIST - 1, Math.max(2, offsetOf(through) + 2)) : 13
      const recent = Array.from({ length: span + 1 }, (_, i) => i)
      const retry = days.retry.map(offsetOf).filter(i => Number.isInteger(i) && i >= 0 && i < HIST)
      // 首次补历史：本机已有这个佳明账号记录的旧日子不再重取。
      const history = mode === 'INITIAL' ? Array.from({ length: HIST - from }, (_, i) => from + i).filter(i => i > span && !savedDays.has(shiftDay(host.day, -i))) : []
      offsets = [...new Set([...(mode === 'FULL' ? plan.offsets : []), ...recent, ...retry, ...history])].sort((a, b) => a - b)
    }
    const answered = new Set<number>()
    let done = 0, dailyThrottled = false, unavailableStreak = 0, serviceUnavailable = false
    let firstUnavailable: number | null = null, firstUnavailableHistory: number | null = null
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
      host.progress(mode === 'INITIAL' ? `首次同步：活动 ${acts.length} 条 · 健康 ${n + 1}/${offsets.length} 天${i < INTRADAY_DAYS ? '（含日内）' : ''}` : `${mode === 'RECENT' ? '增量同步' : '完整复核'}：已取得 ${acts.length} 条活动记录 · 健康 ${n + 1}/${offsets.length} 天${i >= 14 ? '（补更早历史）' : ''}`)
      const wantIntraday = !!host.intraday && !throttled && i < INTRADAY_DAYS && (i < 2 || !host.intraday.complete(d))
      const none = Promise.resolve(undefined)
      if (wantIntraday && i >= 2) await (host.sleep ?? defaultSleep)(INTRADAY_GAP_MS)
      const [s, h, sl, ihr, ist] = await Promise.all([
        api(`g/usersummary-service/usersummary/daily/${encodeURIComponent(account.name)}?calendarDate=${d}`),
        api(`g/hrv-service/hrv/${d}`), api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(account.name)}?date=${d}`),
        wantIntraday ? api(`g/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined) : none,
        wantIntraday ? api(`g/wellness-service/wellness/dailyStress/${d}`).catch(() => undefined) : none,
      ])
      // 日汇总被限流（429）：立即停止，保存已取得的部分；补历史游标只推进到已取完的那天，下次从那里继续。
      if (s.status === 429 || mode === 'INITIAL' && [h, sl].some(r => r.status === 429)) { dailyThrottled = throttled = true; result.errors.push(`佳明限流（429），已在第 ${n + 1}/${offsets.length} 天停止；下次同步从这里继续`); break }
      if (wantIntraday) takeIntraday(d, ihr, ist, sl)
      result.healthDaysRequested++; done = n + 1
      if ([s, h, sl].some(r => [401, 403].includes(r.status))) { result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result }
      const parsed = garminHealthDay(d, account.scope, s, h, sl, host.now)
      health.push(...parsed.rows); result.errors.push(...parsed.failures)
      if (parsed.rows.length) result.coverageDays.push(d)
      if (![s, h, sl].some(r => r.status === 0 || r.status === 429 || r.status >= 500)) answered.add(i)
      // 只有整天的三个接口都发生网络/网关故障才计连续失败；空数据、404 或单项缺失仍继续。
      if ([s, h, sl].every(r => [0, 502, 503, 504].includes(r.status))) {
        firstUnavailable ??= n
        if (i >= 14) firstUnavailableHistory ??= n
        unavailableStreak++
      }
      else unavailableStreak = 0
      if (unavailableStreak >= 2) {
        serviceUnavailable = true
        result.errors.push('连续 2 天的健康接口暂不可用，已暂停后续请求；保留已有记录，稍后重试未完成日期')
        break
      }
    }
    if (host.intraday && !serviceUnavailable) {
      const extra = Array.from({ length: INTRADAY_DAYS }, (_, i) => i).filter(i => !offsets.includes(i)).map(i => shiftDay(host.day, -i)).filter(d => !host.intraday!.complete(d))
      for (const [n, d] of extra.entries()) {
        if (throttled || !unchanged()) break
        host.progress(`补取日内心率/身体电量/压力 ${n + 1}/${extra.length} 天`)
        await (host.sleep ?? defaultSleep)(INTRADAY_GAP_MS)
        const [ihr, ist, sl] = await Promise.all([
          api(`g/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined),
          api(`g/wellness-service/wellness/dailyStress/${d}`).catch(() => undefined),
          api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined),
        ])
        if ([ihr, ist, sl].some(r => r && [401, 403].includes(r.status))) { result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result }
        takeIntraday(d, ihr, ist, sl)
      }
    }
    const final = garminAccount(await api('status'))
    if (!unchanged() || !final || final.scope !== account.scope) { result.status = 'stale'; result.errors.push('账号或运动员变化，未写入本次结果'); return result }
    if (!host.bindAccount(account.scope, subjectId)) { result.status = 'fail'; result.errors.push('此佳明账号已绑定其他运动员，或归属无法保存；本次未导入'); return result }
    result.healthRows = health.length; result.activityRows = acts.length
    const saved = host.save(health, acts)
    result.saved = saved.saved; result.skipped = saved.skipped; result.errors.push(...saved.errors)
    if (intraday.length) { try { intradayStat.saved = host.intraday?.save(intraday) ?? 0; if (!intradayStat.saved) intradayStat.failed.push('日内样本本机保存失败（空间不足？）') } catch { intradayStat.failed.push('日内样本本机保存失败') } }
    if (host.intraday) result.intraday = intradayStat
    // 历史游标不能跨过未取得的旧日；近 14 天下次完整复核会重取，不阻止已保存历史推进。
    // v89.10.10：只有健康记录本身保存失败才阻止推进；活动“需核对”提示不影响健康历史游标。
    const blocking = saved.healthErrors ?? saved.errors
    const back = offsets.slice(0, firstUnavailableHistory ?? done).filter(i => i >= 14), upTo = days ? HIST : back.length ? Math.max(...back) + 1 : from
    if (!blocking.length && upTo > from) host.backfill?.set(account.scope, upTo)
    // 没取到的具体日子（网络/限流/服务故障或中途停止）记下来，下次只重试这些天。
    const missing = offsets.filter(i => !answered.has(i)).map(i => shiftDay(host.day, -i))
    if (days && !blocking.length) { try { host.healthDays!.set(account.scope, { through: host.day, retry: missing }) } catch { /* 下次按原窗口重取 */ } }
    // 完整复核/首次同步完整做完且本机保存无误才记时间（按佳明账号分开）；被限流中断的不记，下次继续。
    if (mode !== 'RECENT' && !dailyThrottled && firstUnavailable === null && done === offsets.length && !blocking.length && !(days && missing.length)) { try { host.fullReview?.set(account.scope, host.now) } catch { /* 下次再复核 */ } }
    // Raw activity view remains account/athlete scoped and never counts as training sessions.
    host.saveView(raw.flatMap(o => { const a = garminActivity(o, account.scope); return a ? [{ ...o, fkSourceIdentity: a.sourceIdentity, fkStartIso: a.startIso }] : [] }), result.accountScope!)
    result.status = result.errors.length ? (result.saved + result.skipped ? 'partial' : 'fail') : health.length + acts.length ? 'ok' : 'empty'
  } catch { result.status = result.saved + result.skipped ? 'partial' : 'fail'; result.errors.push('请求、解析或本地保存失败；保留已有记录') }
  finally {
    result.requests = requests
    // A switched user must never receive another athlete's pending sync report.
    if (unchanged()) { try { host.report(result) } catch { result.status = 'fail'; result.errors.push('同步报告保存失败，未标记成功') } }
  }
  return result
}
