import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { corosNeedsLogin, loadCorosMeta, saveCorosMeta } from '@/lib/health/coros-account-sync'
import { corosMcpDisconnect, corosMcpLaps, corosMcpRecent, corosMcpStartUrl, corosMcpStatus, legacyCorosLoggedIn, legacyCorosLogout, setCorosMcpLinked, type McpPreview } from '@/lib/health/coros-mcp-client'
import { corosLabelOf, crossBrandCandidates, crossBrandPairsInLog } from '@/lib/health/brand-isolation'
import type { McpLap } from '@/lib/health/coros-mcp-parse'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'
import { activityDraftId, existingKeys, saveDeviceRows } from '@/lib/ui/device-store'
import { currentAthleteId } from '@/lib/core/events'
import { fmtDurationPrecise, fmtSeconds } from '@/lib/ui/activity-format'
import './device-settings-detail.css'

/** 日志里已有的活动（用于“已保存过”和“可能与佳明同一次活动”提示）；读不到就当没有。 */
const logRows = () => { try { return loadTrainingActivities() } catch { return [] } }
const asLike = (a: McpPreview) => ({ id: a.key, sport: a.sport, startedAt: a.startIso, distanceM: a.distanceM, durationSec: a.durationSec, timeUnknown: !a.startIso })
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
const AUTH_MSG: Record<string, string> = { ok: '已用高驰官方授权登录。', denied: '你在高驰页面取消了授权。', state: '授权已过期或不是从本页发起，请重新点“用高驰授权登录”。', code: '高驰没有返回授权码，请重试。', reauthorize: '高驰拒绝了授权，请重试。', register_failed: '高驰客户端注册失败，请稍后再试。', host_not_allowed: '高驰返回了白名单外的地址，已停止。', server_not_configured: '服务器未配置，暂不能授权。' }
/** v89.10：高驰卡片只保留官方 MCP 授权（OAuth）。不再收账号密码；读到的活动先列出，勾选确认后才保存进日志。 */
export function CorosAccount({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unreachable'>('checking')
  const [legacy, setLegacy] = useState(false), [region, setRegion] = useState<'cn' | 'auto'>('cn')
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  const [rows, setRows] = useState<McpPreview[] | null>(null), [pick, setPick] = useState<Record<string, boolean>>({}), [dup, setDup] = useState<Set<string>>(new Set())
  const [cross, setCross] = useState<Set<string>>(new Set()), [logPairs, setLogPairs] = useState(0), [unusable, setUnusable] = useState(0)
  const [laps, setLaps] = useState<Record<string, McpLap[] | string>>({})
  const busyRef = useRef(false), rowsRef = useRef<McpPreview[] | null>(null)
  rowsRef.current = rows
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('coros_auth')
    if (q) { setMsg(AUTH_MSG[q] ?? `高驰授权未完成（${q}）。`); const u = new URL(location.href); u.searchParams.delete('coros_auth'); history.replaceState(null, '', u.pathname + u.search + u.hash) }
    corosMcpStatus().then(s => { setState(s.connected ? 'in' : 'out'); setCorosMcpLinked(currentAthleteId(), s.connected)
      if (s.connected) void legacyCorosLogout(); else void legacyCorosLoggedIn().then(setLegacy) }).catch(() => setState('unreachable'))
  }, [])
  const expired = () => { setState('out'); setRows(null); setCorosMcpLinked(currentAthleteId(), false); setMsg('高驰授权已过期，请重新点“用高驰授权登录”。已保存的记录不受影响。') }
  const run = async (f: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setMsg(''); try { await f() } catch (e) { if (corosNeedsLogin(e)) expired(); else setMsg(e instanceof Error ? e.message : '高驰请求失败') } finally { busyRef.current = false; setBusy(false) } }
  /** 已保存过（同一高驰 labelId，含旧登录方式保存的）和“可能与佳明同一次活动”的默认不勾选；绝不自动合并。 */
  const prepare = (list: McpPreview[]) => {
    const have = existingKeys(), all = logRows(), savedLabels = new Set(all.flatMap(r => r.originIds.filter(id=>id.startsWith('coros:'))).filter(Boolean) as string[])
    const d = new Set(list.filter(a => have.activities.has(activityDraftId(a)) || !!a.sourceIdentity && savedLabels.has(a.sourceIdentity)).map(a => a.key))
    setLogPairs(crossBrandPairsInLog(all).length)
    const c = new Set(crossBrandCandidates(list.filter(a => !d.has(a.key)).map(asLike), all, 'COROS').keys())
    return { d, c }
  }
  const read = () => run(async () => {
    const r = await corosMcpRecent(28); const { d, c } = prepare(r.rows)
    setDup(d); setCross(c); setUnusable(r.unusable.length); setPick(Object.fromEntries(r.rows.map(a => [a.key, !d.has(a.key) && !c.has(a.key)]))); setRows(r.rows)
    saveCorosMeta(currentAthleteId(), { at: new Date().toISOString(), read: r.rows.length })
    setMsg(r.total ? `读到 ${r.rows.length} 条跑步/力量（${d.size} 条已保存过${c.size ? `，${c.size} 条可能与佳明记录是同一次活动` : ''}）${r.other ? `；其他运动 ${r.other} 条未列出` : ''}${r.truncated ? '；可能没读全（一次最多 100 条）' : ''}。勾选核对无误的再保存。` : '近 28 天没有读到活动。')
  })
  // 前台自动检查：只在已授权时运行；页面在前台每 10 分钟查近 7 天，回到前台也查一次。只列出未保存的新活动，绝不自动保存。
  useEffect(() => {
    if (state !== 'in') return
    let active = true
    const refresh = async () => {
      if (!active || busyRef.current || document.visibilityState !== 'visible') return
      busyRef.current = true
      try {
        const r = await corosMcpRecent(7); if (!active) return
        const { d, c } = prepare(r.rows), fresh = r.rows.filter(a => !d.has(a.key))
        if (!fresh.length) return
        const cur = rowsRef.current; if (cur && fresh.every(a => cur.some(x => x.key === a.key))) return
        setRows(fresh); setDup(new Set()); setCross(c); setPick(p => Object.fromEntries(fresh.map(a => [a.key, p[a.key] ?? !c.has(a.key)])))
        setMsg(`发现 ${fresh.length} 条未保存的高驰活动${c.size ? `（${c.size} 条可能与佳明记录是同一次活动）` : ''}，核对后勾选保存。`)
        saveCorosMeta(currentAthleteId(), { at: new Date().toISOString(), read: r.rows.length })
      } catch (e) { if (active && corosNeedsLogin(e)) expired() }
      finally { busyRef.current = false }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), 10 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [state])
  const save = () => { if (!rows) return; const r = saveDeviceRows([], rows.filter(a => pick[a.key] && !dup.has(a.key)))
    const m = loadCorosMeta(currentAthleteId()); if (m) saveCorosMeta(currentAthleteId(), { ...m, saved: r.saved })
    setLogPairs(crossBrandPairsInLog(logRows()).length)
    setMsg(`已保存 ${r.saved} 条${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ''}${r.errors.length ? `；${r.errors.length} 条未保存：${r.errors.slice(0, 2).join('；')}` : ''}。保存后在日志里查看；高驰记录不进佳明计划关联。`); if (!r.errors.length) setRows(null) }
  const showLaps = (a: McpPreview) => { if (a.sportType == null) { setLaps(l => ({ ...l, [a.key]: '没有运动类型码，查不了分圈' })); return }
    void corosMcpLaps(a.labelId, a.sportType).then(r => setLaps(l => ({ ...l, [a.key]: r.laps.length ? r.laps : (r.issues[0] ?? '没有分圈') }))).catch(e => { if (corosNeedsLogin(e)) expired(); else setLaps(l => ({ ...l, [a.key]: e instanceof Error ? e.message : '读取失败' })) }) }
  const nPick = rows ? rows.filter(a => pick[a.key] && !dup.has(a.key)).length : 0
  return <section className={`device-account-card ${compact ? 'mt-3 rounded-xl border border-line p-3 text-sm' : 'home-card mt-3 p-4 text-sm'}`} aria-label="高驰账号" data-testid="coros-account">
    <div className="device-account-heading"><h3 className="font-bold">高驰（COROS）</h3><span role="status" className="device-account-status" data-tone={state === 'in' ? 'ok' : state === 'unreachable' ? 'warn' : undefined}>{state === 'in' ? '已授权' : state === 'checking' ? '确认中…' : state === 'unreachable' ? '暂不可达' : '未授权'}</span></div>
    <p className="keep mt-2 text-muted">{state === 'in' ? '读取近 28 天活动，核对后保存。' : '通过高驰官方授权，密码仅在高驰页面输入。'}</p>
    {legacy && state !== 'in' ? <p className="keep mt-2 rounded-lg border border-line p-2" data-testid="coros-legacy-note">高驰登录方式已升级为官方授权：请点下面按钮重新授权一次。以前保存的高驰记录都还在，不会重复保存。</p> : null}
    {state !== 'in' ? <div className="mt-2 space-y-2">
      <div className="device-account-regions" role="radiogroup" aria-label="高驰账号地区">
        {([['cn', '中国区账号'], ['auto', '海外账号（自动）']] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={region === v} onClick={() => setRegion(v)} className={`min-h-11 flex-1 rounded-xl border px-2 ${region === v ? 'border-accent font-bold' : 'border-line'}`}><Check aria-hidden="true" className={region === v ? '' : 'invisible'} />{l}</button>)}
      </div>
      <a href={corosMcpStartUrl(region)} onClick={() => { void legacyCorosLogout() }} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-accent font-bold text-accent-fg" data-testid="coros-oauth">连接高驰</a>
    </div> : <div className="device-account-actions mt-2">
      <button type="button" disabled={busy} className="min-h-11 flex-1 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => void read()}>{busy ? '读取中…' : '立即同步'}</button>
      <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => void run(async () => { const r = await corosMcpDisconnect(); setState('out'); setRows(null); setCorosMcpLinked(currentAthleteId(), false); setMsg(`已断开高驰。${r.revoked ? '' : '本机凭证已删除；如需彻底撤销授权，请到高驰 App 的授权管理里取消（入口待核）。'}已保存的记录不受影响。`) })}>断开高驰</button>
    </div>}
    {msg ? <p role="status" className="device-sync-message mt-2">{msg}</p> : null}
    {rows && rows.length ? <div className="mt-2 space-y-1" data-testid="coros-preview">
      {rows.map(a => <div key={a.key} className="border-t border-line pt-1"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={dup.has(a.key)} checked={!!pick[a.key] && !dup.has(a.key)} onChange={e => setPick(p => ({ ...p, [a.key]: e.target.checked }))} />
        <span>{fmt(a.startIso)}{a.timeAssumed ? '（按本机时区，待核）' : ''} · {a.sportLabel}{a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(2)} km` : ''}{a.durationSec ? ` · 用时 ${fmtDurationPrecise(a.durationSec)}` : ''}{a.avgHr ? ` · 均心率 ${a.avgHr}` : ''}{dup.has(a.key) ? '（已保存过）' : cross.has(a.key) ? '（可能与佳明同一次活动，默认不勾选）' : ''}</span></label>
        <button type="button" className="min-h-11 px-2 text-accent" onClick={() => showLaps(a)}>分圈</button>
        {Array.isArray(laps[a.key]) ? <div className="mt-1 overflow-x-auto"><table aria-label="高驰分圈" className="w-full whitespace-nowrap text-sm tabular-nums"><thead><tr><th>圈</th><th>用时</th><th>配速</th><th>均心率</th><th>步频</th></tr></thead><tbody>{(laps[a.key] as McpLap[]).map((l, i) => <tr key={i} className="text-center"><td>{l.index ?? i + 1}</td><td className="px-1">{fmtSeconds(l.timeSec)}</td><td className="px-1">{l.paceSecPerKm != null ? `${Math.floor(l.paceSecPerKm / 60)}'${String(Math.round(l.paceSecPerKm % 60)).padStart(2, '0')}"` : '—'}</td><td className="px-1">{l.avgHr ?? '—'}</td><td>{l.avgCadence ?? '—'}</td></tr>)}</tbody></table></div> : laps[a.key] ? <p className="text-muted">{laps[a.key] as string}</p> : null}</div>)}
      <button type="button" disabled={!nPick} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={save}>保存选中的 {nPick} 条</button>
    </div> : null}
    {unusable ? <p className="keep mt-2 text-warn">另有 {unusable} 条活动高驰没给出活动标识或开始时刻，暂不能保存（待核）。</p> : null}
    {logPairs ? <p className="mt-2 text-muted" data-testid="coros-crossbrand-note">日志里有 {logPairs} 条高驰记录与佳明记录开始时间相差 2 分钟内、距离/时长接近，可能是同一次活动记了两次。没有自动合并，请到日志里核对，需要时删掉其中一条。</p> : null}
    <details className="device-sync-disclosure">
      <summary><span>同步说明</span><ChevronDown aria-hidden="true" /></summary>
      <div className="device-sync-detail-body text-muted">
        <p>通过高驰官方授权页登录，密码只在高驰页面输入，方坤拿不到。可读：活动、分圈、睡眠、睡眠 HRV、静息心率、日内压力、当前恢复度。高驰没有全天心率曲线，也没有“身体电量”。</p>
        <p>高驰数据单独记来源，不和佳明混算、不进佳明计划关联。读取的活动需要核对、勾选后保存。</p>
        <p>已授权时，此页在前台每 10 分钟检查近 7 天的新活动，回到前台也会检查；只列出待核对记录，不会自动保存。手动同步读取近 28 天活动。</p>
      </div>
    </details>
  </section>
}
/** 设备连接与同步状态卡里的高驰行（只显示实际查询/读取结果）。 */
export function CorosStatusRows({ KV }: { KV: (p: { k: string; v: string; tone?: 'warn' | 'ok' }) => React.ReactNode }) {
  const [st, setSt] = useState<string>('正在确认…'), [meta, setMeta] = useState(() => loadCorosMeta(currentAthleteId()))
  useEffect(() => { const f = () => { setMeta(loadCorosMeta(currentAthleteId())); corosMcpStatus().then(s => setSt(s.connected ? '已授权（官方）' : '未授权')).catch(() => setSt('中转暂不可达')) }; f(); window.addEventListener('fk-coros-changed', f); return () => window.removeEventListener('fk-coros-changed', f) }, [])
  return <>{KV({ k: '连接状态', v: st })}{KV({ k: '最近读取', v: meta ? `${fmt(meta.at)} · 读到 ${meta.read} 条${meta.saved != null ? ` · 保存 ${meta.saved} 条` : ''}` : '暂无记录' })}</>
}
