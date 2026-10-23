import { garminHealthDay } from './garmin-health'
import { buildIntradayDay, type IntradayDay } from './garmin-intraday'
import { shortHash, shiftDay } from './observation'
import { planGarminDailySync } from './garmin-sync-plan-u11'
import { planGarminProgressSync, validProgressDays, type GarminDailyProgress } from './garmin-daily-progress'
import type { DeviceActivity, DeviceHealthRow } from '../ui/device-parse'
export type { GarminDailyProgress } from './garmin-daily-progress'

export type GarminReply = { status: number; body: any }
/** v89.1：日内样本取 28 天；补取的旧日子之间停顿 350ms，避免触发佳明限流。 */
export const INTRADAY_DAYS = 28, INTRADAY_GAP_MS = 350
const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
export type GarminSyncReport = {
  at: string; status: 'ok' | 'partial' | 'empty' | 'auth' | 'fail' | 'stale'; subjectId: string; accountScope: string | null;
  healthRows: number; activityRows: number; saved: number; skipped: number; errors: string[];
  healthDaysRequested: number; coverageDays: string[]; activityLimit: number; completeHistory: false;
  /** RECENT=近期 3 日；BACKFILL=近期 3 日 + 最多 14 个历史缺口；
   * FULL=显式复核近期 14 日/200 活动；INITIAL=新账号首次历史。requests 为实际请求数。 */
  mode?: 'INITIAL' | 'RECENT' | 'BACKFILL' | 'FULL'; requests?: number;
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
  /** 近 28 天日内样本；今昨重取，更早完整或已核对的日期跳过。
   * 日内失败不阻塞独立日汇总进度，但现代调用会在整体报告中保留失败。 */
  intraday?: { complete: (day: string) => boolean; save: (days: IntradayDay[]) => number };
  /** 测试可注入；默认真实等待（节流）。 */
  sleep?: (ms: number) => Promise<void>;
  /** MANUAL 显式完整复核。现代 AUTO 按日期回执增量/续传，跨日不自动全量。
   * 没有 dailyProgress 的旧调用继续沿用 fullReview/历史游标计划。 */
  reason?: 'AUTO' | 'MANUAL';
  fullReview?: { get: (scope: string) => string | null; set: (scope: string, at: string) => void };
  /** Account + athlete scoped, committed only after final ownership checks and
   * successful health persistence. Activity conflicts keep their own errors. */
  dailyProgress?: { get: (scope: string) => GarminDailyProgress | null; set: (scope: string, progress: GarminDailyProgress) => void };
  /** 活动是否已在本机且数值未变（增量同步用来判断要不要往后翻页）。 */
  activitySeen?: (accountScope: string, o: any) => boolean;
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
    // 保留旧调用的 U11 计划；现代调用在下面由逐日期回执选择范围。
    const lastFull = host.fullReview ? host.fullReview.get(account.scope) : null
    const sameLocalDay = !!lastFull && Number.isFinite(Date.parse(lastFull)) && localDayOf(lastFull) === host.day
    const plan = planGarminDailySync({ today: host.day, now: host.now, reason: !host.fullReview || host.reason !== 'AUTO' ? 'MANUAL' : 'PERIODIC', lastAttemptAt: null,
      lastFullSuccessAt: sameLocalDay ? lastFull : null, lastFailureAt: null, backfillThrough: host.backfill?.get(account.scope) ?? 90 })
    // 兼容历史游标；现代旧账号中断后不再重跑 INITIAL 的全部剩余历史。
    const cursor = Math.min(90, Math.max(14, host.backfill?.get(account.scope) ?? 90))
    const dailyProgress = host.dailyProgress?.get(account.scope) ?? null
    const progressPlan = host.dailyProgress ? planGarminProgressSync({ today: host.day, now: host.now, reason: host.reason, progress: dailyProgress, backfillThrough: cursor }) : null
    const mode = progressPlan?.mode ?? (host.fullReview && cursor < 90 ? 'INITIAL' : plan.mode === 'RECENT' ? 'RECENT' : 'FULL')
    result.mode = mode
    // 活动列表：完整复核一次取 200 条；增量先取 20 条，整页都是新的/有变化才继续往后翻（每页 20，最多到 200），不漏新活动。
    const incrementalActivities = mode === 'RECENT' || mode === 'BACKFILL'
    const PAGE = incrementalActivities ? 20 : 200, raw: any[] = []
    for (let start = 0; start < 200; start += PAGE) {
      const list = await api(`g/activitylist-service/activities/search/activities?start=${start}&limit=${PAGE}`)
      if ([401, 403].includes(list.status)) { result.errors.push(`活动列表 HTTP ${list.status}`); result.status = 'auth'; return result }
      if (list.status !== 200 || !Array.isArray(list.body)) { result.errors.push(`活动列表 HTTP ${list.status}`); break }
      raw.push(...list.body)
      if (!incrementalActivities || list.body.length < PAGE || !host.activitySeen || list.body.some((o: any) => host.activitySeen!(result.accountScope!, o))) break
      if (!unchanged()) { result.status = 'stale'; return result }
    }
    result.activityLimit = !incrementalActivities ? 200 : raw.length >= 20 ? Math.min(200, Math.ceil(raw.length / 20) * 20) : 20
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
    // 现代计划精确列出近期日期与待补缺口；旧调用保留原有 14 日 + 游标规则。
    const HIST = 90, from = cursor
    const offsets = progressPlan?.offsets ?? (mode === 'INITIAL' ? [...Array.from({ length: 14 }, (_, i) => i), ...Array.from({ length: HIST - from }, (_, i) => from + i)] : plan.offsets)
    const checkedDaily = new Set<string>(), checkedIntraday = new Set<string>(), attemptedIntraday = new Set<string>()
    const priorIntraday = new Set(validProgressDays(dailyProgress?.intradayCheckedDays, host.day))
    // A known date-scoped resource returning 404 has no data. This is a read
    // receipt, not a synthetic measurement. Auth, 429, 5xx and malformed 200
    // responses still fail validation and remain pending.
    const emptyResource = (r: GarminReply | undefined) => host.dailyProgress && r?.status === 404 ? { status: 204, body: null } : r
    const intradayNeeded = (d: string, offset: number) => offset < 2 || !host.intraday!.complete(d) &&
      !(host.dailyProgress && host.reason !== 'MANUAL' && priorIntraday.has(d))
    let done = 0, dailyThrottled = false, unavailableStreak = 0, serviceUnavailable = false
    let firstUnavailable: number | null = null, firstUnavailableHistory: number | null = null
    // v89.1：日内样本首次/历史不足时补到 28 天。今天、昨天每次都重取；更早的只取还没取全的日子。
    // 不在本次日汇总范围内的日子（第 14–27 天）单独逐天取，每天之间停顿，遇到 429 立即停止日内补取（日汇总照常）。
    let throttled = false
    const intradayStat = { requested: 0, saved: 0, failed: [] as string[], throttled: false }
    const takeIntraday = (d: string, ihr: GarminReply | undefined, ist: GarminReply | undefined, sl?: GarminReply) => {
      attemptedIntraday.add(d)
      intradayStat.requested++
      if ([ihr, ist].some(r => r?.status === 429)) { throttled = intradayStat.throttled = true; intradayStat.failed.push(`${d} 佳明限流（429），稍后再同步补取`); return }
      if (!ihr && !ist) { intradayStat.failed.push(`${d} 日内请求失败（网络）`); return }
      const hr = emptyResource(ihr), stress = emptyResource(ist), sleep = emptyResource(sl)
      const built = buildIntradayDay({ day: d, now: host.now, hr, stress, sleep, activities: acts })
      if (built.day) intraday.push({ ...built.day, sourceId: 'garmin:' + shortHash(account.scope) }); else if (built.failures.length) intradayStat.failed.push(...built.failures.slice(0, 2))
      if (host.dailyProgress) {
        // Empty valid replies may produce no IntradayDay. Missing transport
        // replies and failed metrics must never be mistaken for checked empties.
        const validReplies = [hr, stress, sleep].every(r => !!r && (r.status === 204 || r.status === 200 && r.body &&
          typeof r.body === 'object' && !Array.isArray(r.body) && r.body.ok !== false && !r.body.error))
        const sleepFailed = sleep ? garminHealthDay(d, account.scope, { status: 204, body: null }, { status: 204, body: null }, sleep, host.now).failures.length : 1
        if (validReplies && !built.failures.length && !sleepFailed && !built.day?.failedReadings?.length) checkedIntraday.add(d)
        if (built.day && built.failures.length) intradayStat.failed.push(...built.failures.slice(0, 2))
        if ((!validReplies || sleepFailed) && !built.failures.length) intradayStat.failed.push(`${d} 日内部分请求未完成`)
      }
    }
    for (const [n, i] of offsets.entries()) {
      if (!unchanged()) { result.status = 'stale'; return result }
      const d = shiftDay(host.day, -i)
      host.progress(mode === 'INITIAL' ? `首次同步：活动 ${acts.length} 条 · 健康 ${n + 1}/${offsets.length} 天${i < INTRADAY_DAYS ? '（含日内）' : ''}` : `${mode === 'RECENT' ? '增量同步' : mode === 'BACKFILL' ? '补齐历史' : '完整复核'}：已取得 ${acts.length} 条活动记录 · 健康 ${n + 1}/${offsets.length} 天${i >= 3 && mode === 'BACKFILL' || i >= 14 ? '（补更早历史）' : ''}`)
      const wantIntraday = !!host.intraday && !throttled && i < INTRADAY_DAYS && intradayNeeded(d, i)
      const none = Promise.resolve(undefined)
      if (wantIntraday && i >= 2) await (host.sleep ?? defaultSleep)(INTRADAY_GAP_MS)
      if (host.dailyProgress) result.healthDaysRequested++
      const [s, h, sl, ihr, ist] = await Promise.all([
        api(`g/usersummary-service/usersummary/daily/${encodeURIComponent(account.name)}?calendarDate=${d}`),
        api(`g/hrv-service/hrv/${d}`), api(`g/wellness-service/wellness/dailySleepData/${encodeURIComponent(account.name)}?date=${d}`),
        wantIntraday ? api(`g/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(account.name)}?date=${d}`).catch(() => undefined) : none,
        wantIntraday ? api(`g/wellness-service/wellness/dailyStress/${d}`).catch(() => undefined) : none,
      ])
      if (host.dailyProgress && [s, h, sl, ihr, ist].some(r => r && [401, 403].includes(r.status))) {
        result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result
      }
      // 日汇总被限流（429）：立即停止，保存已取得的部分；补历史游标只推进到已取完的那天，下次从那里继续。
      if (s.status === 429 || (mode === 'INITIAL' || host.dailyProgress) && [h, sl].some(r => r.status === 429)) { dailyThrottled = throttled = true; result.errors.push(`佳明限流（429），已在第 ${n + 1}/${offsets.length} 天停止；下次同步从这里继续`); break }
      if (wantIntraday) takeIntraday(d, ihr, ist, sl)
      if (!host.dailyProgress) result.healthDaysRequested++
      done = n + 1
      if ([s, h, sl].some(r => [401, 403].includes(r.status))) { result.status = 'auth'; result.errors.push('同步期间登录过期，未写入本次结果'); return result }
      const parsed = garminHealthDay(d, account.scope, emptyResource(s)!, emptyResource(h)!, emptyResource(sl)!, host.now)
      health.push(...parsed.rows); result.errors.push(...parsed.failures)
      if (!parsed.failures.length) checkedDaily.add(d)
      if (parsed.rows.length) result.coverageDays.push(d)
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
      const extraCandidates = Array.from({ length: INTRADAY_DAYS }, (_, i) => i).filter(i => !offsets.includes(i)).filter(i => intradayNeeded(shiftDay(host.day, -i), i))
      // Resuming history must not quietly add a second unbounded old-date scan.
      const extraLimit = host.dailyProgress && incrementalActivities ? Math.max(0, 14 - offsets.filter(i => i >= 3).length) : INTRADAY_DAYS
      const extra = extraCandidates.slice(0, extraLimit).map(i => shiftDay(host.day, -i))
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
    let intradayStored = true
    if (intraday.length) { try { intradayStat.saved = host.intraday?.save(intraday) ?? 0; if (intradayStat.saved < intraday.length) { intradayStored = false; intradayStat.failed.push('日内样本本机保存未完成（空间不足？）') } } catch { intradayStored = false; intradayStat.failed.push('日内样本本机保存失败') } }
    if (host.intraday) result.intraday = intradayStat
    if (host.dailyProgress && intradayStat.failed.length) result.errors.push(...intradayStat.failed)
    const healthErrors = saved.healthErrors ?? saved.errors
    if (host.dailyProgress && progressPlan) {
      const checked = new Set(validProgressDays(dailyProgress?.checkedDays, host.day))
      const pending = new Set(progressPlan.pendingDays)
      for (const i of offsets) { const d = shiftDay(host.day, -i); if (!healthErrors.length && checkedDaily.has(d)) { checked.add(d); pending.delete(d) } else checked.delete(d) }
      for (const d of attemptedIntraday) priorIntraday.delete(d)
      if (intradayStored) for (const d of checkedIntraday) priorIntraday.add(d)
      const progress: GarminDailyProgress = {
        checkedDays: validProgressDays([...checked], host.day).filter(d => d >= shiftDay(host.day, -89)),
        pendingDays: validProgressDays([...pending], host.day),
        lastSyncAt: !healthErrors.length && checkedDaily.size ? host.now : dailyProgress?.lastSyncAt ?? null,
        intradayCheckedDays: validProgressDays([...priorIntraday], host.day).filter(d => d >= shiftDay(host.day, -(INTRADAY_DAYS - 1))),
      }
      // Write the durable per-date receipt before advancing the compatibility
      // cursor. If this fails, the job remains partial and is safe to retry.
      host.dailyProgress.set(account.scope, progress)
      let upTo = from
      if (!healthErrors.length) while (upTo < HIST && checked.has(shiftDay(host.day, -upTo)) && !pending.has(shiftDay(host.day, -upTo))) upTo++
      if (upTo > from) host.backfill?.set(account.scope, upTo)
      if ((mode === 'INITIAL' || mode === 'FULL') && !dailyThrottled && done === offsets.length && !result.errors.length && !progress.pendingDays.length && !intradayStat.failed.length) {
        try { host.fullReview?.set(account.scope, host.now) } catch { /* A missing review marker never invalidates the checked-date receipt. */ }
      }
    } else {
      // Legacy callers keep their existing scheduling and conservative error gate.
      const back = offsets.slice(0, firstUnavailableHistory ?? done).filter(i => i >= 14), upTo = back.length ? Math.max(...back) + 1 : from
      if (!saved.errors.length && upTo > from) host.backfill?.set(account.scope, upTo)
      if (mode !== 'RECENT' && !dailyThrottled && firstUnavailable === null && done === offsets.length && !saved.errors.length) { try { host.fullReview?.set(account.scope, host.now) } catch { /* 下次再复核 */ } }
    }
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
