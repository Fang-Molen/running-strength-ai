import { useEffect, useMemo, useState } from 'react'
import { corosMcpLinked, corosTrend, isCurrentCorosContext, loadCorosHealth } from '@/lib/health/coros-mcp-client'
import { corosNeedsLogin } from '@/lib/health/coros-account-sync'
import { rowProvider } from '@/lib/health/brand-isolation'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'
import { runCorosHealthSync, useCorosSyncLive } from '@/lib/ui/coros-sync-live'
import { openDeviceSync } from '@/lib/ui/device-sync-navigation'

/** v89.10：高驰健康数据（官方授权）。只在本机连过高驰时显示；佳明用户看不到这块，佳明健康页原样不变。
 * 不画“身体电量”曲线（高驰没有）；日内只画高驰压力，并标出睡眠时段和训练时段；HRV/静息心率/睡眠为日级趋势；恢复度只有当前值。
 * 基准只在高驰自身数据里算（≥7 个此前完整日），不与佳明混算。 */
const minOfLocal = (s: string) => { const m = /T(\d\d):(\d\d)/.exec(s); return m ? +m[1] * 60 + +m[2] : null }
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const localMin = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }
const hm = (m: number | null | undefined) => m == null ? '—' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`
const W = 320, H = 110, PAD = 18
export function CorosHealthPanel({ day }: { day: string }) {
  const live = useCorosSyncLive(), context = live.context, athlete = context.athleteId
  const [view, setView] = useState(() => ({ athlete, data: loadCorosHealth(athlete), linked: corosMcpLinked(athlete) }))
  const data = view.athlete === athlete ? view.data : null, linked = view.athlete === athlete && view.linked
  const busy = live.health.running, error = live.health.error
  const msg = error ? corosNeedsLogin(error) ? `高驰授权已过期，请到“设备连接与同步”重新授权。${data ? '下面是本机保存的上次数据。' : ''}` : error instanceof Error ? error.message : '读取失败' : ''
  const refresh = () => { void runCorosHealthSync('manual').catch(() => {}) }
  useEffect(() => {
    const reload = () => {
      if (!isCurrentCorosContext(context)) return
      const cached = loadCorosHealth(athlete), received = live.health.result
      const latest = received && (!cached || Date.parse(received.fetchedAt) >= Date.parse(cached.fetchedAt)) ? received : cached
      setView({ athlete, data: latest, linked: corosMcpLinked(athlete) })
    }
    reload(); window.addEventListener('fk-coros-changed', reload)
    return () => window.removeEventListener('fk-coros-changed', reload)
  }, [athlete, context.generation, live.health.result]) // eslint-disable-line react-hooks/exhaustive-deps
  // v89.10.12：除了打开健康页，回到前台时也按原有间隔（本机数据超过 30 分钟）自动重读一次。
  useEffect(() => {
    if (!linked) return
    const go = () => { if (document.visibilityState === 'visible') void runCorosHealthSync('auto').catch(() => {}) }
    go(); document.addEventListener('visibilitychange', go); window.addEventListener('pageshow', go)
    return () => { document.removeEventListener('visibilitychange', go); window.removeEventListener('pageshow', go) }
  }, [linked, athlete, context.generation])
  const today = localDay(new Date().toISOString())
  const trend = useMemo(() => data ? corosTrend(data.days, athlete, today) : [], [data, athlete, today])
  const sessions = useMemo(() => { try { return loadTrainingActivities().filter(r => rowProvider(r) === 'COROS' && r.startedAt && localDay(r.startedAt) === day) } catch { return [] } }, [day, data, athlete])
  if (!linked && !data && !busy && !error) return null
  const stress = (data?.stress ?? []).map(p => p.iso ? { m: localDay(p.iso) === day ? localMin(p.iso) : null, v: p.value } : { m: p.local?.slice(0, 10) === day ? minOfLocal(p.local) : null, v: p.value }).filter(p => p.m != null) as { m: number; v: number }[]
  const x = (m: number) => PAD + (m / 1440) * (W - 2 * PAD), y = (v: number) => H - PAD - (v / 100) * (H - 2 * PAD)
  const sleepBands = (data?.days ?? []).flatMap(d => d.sleepStart && d.sleepEnd ? [[d.sleepStart, d.sleepEnd]] : []).flatMap(([s, e]) => {
    const a = s.slice(0, 10) === day ? minOfLocal(s) : s.slice(0, 10) < day && e.slice(0, 10) >= day ? 0 : null, b = e.slice(0, 10) === day ? minOfLocal(e) : e.slice(0, 10) > day && s.slice(0, 10) <= day ? 1440 : null
    return a != null && b != null && b > a ? [[a, b]] : [] })
  const trainBands = sessions.filter(r=>r.durationSec!=null&&Number.isFinite(r.durationSec)&&r.durationSec>0).map(r => { const a = localMin(r.startedAt); return [a, Math.min(1440, a + r.durationSec! / 60)] })
  const last = trend.filter(d=>d.date<=day).at(-1), days = (data?.days ?? []).filter(d=>d.date<=day).slice(-14).reverse()
  return <section className="home-card p-4 text-sm" aria-label="高驰健康数据" data-testid="coros-health">
    <div className="flex items-center justify-between"><h3 className="font-bold">高驰健康数据（官方授权）</h3>{linked ? <button type="button" className="min-h-11 px-2 text-accent" disabled={busy} onClick={() => void refresh()}>{busy ? '读取中…' : '刷新'}</button> : null}</div>
    <p className="keep mt-1 text-xs text-muted">{data ? `上次读取 ${new Date(data.fetchedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。` : '还没读取。'}高驰没有“身体电量”和全天心率曲线，这里不画。时间按高驰账号时区显示（与本机不同时区时待核）。</p>
    <div className="mt-2 rounded-lg border border-line p-2" data-testid="coros-recovery"><b>高驰恢复度：{day===today && data?.recovery?.percent != null ? `${data.recovery.percent}%` : '—'}</b>{data?.recovery?.level ? ` · ${data.recovery.level}` : ''}
      <p className="keep text-xs text-muted">这是高驰自己算的数值，只有当前值（{data?.recovery ? `读取于 ${new Date(data.recovery.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '暂无'}），没有历史曲线；不是佳明身体电量，方坤不据此改训练。{data?.recovery?.fullRecoveryText ? ` ${data.recovery.fullRecoveryText}` : ''}</p></div>
    <figure className="mt-2" data-testid="coros-stress-chart"><figcaption className="text-xs font-bold">日内压力（{day}）· <span className="font-normal text-muted">灰色=睡眠，橙色=已保存的高驰训练</span></figcaption>
      {stress.length ? <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`高驰压力 ${stress.length} 个读数`}>
        {sleepBands.map(([a, b], i) => <rect key={'s' + i} x={x(a)} y={PAD} width={x(b) - x(a)} height={H - 2 * PAD} fill="currentColor" opacity={0.12} />)}
        {trainBands.map(([a, b], i) => <rect key={'t' + i} x={x(a)} y={PAD} width={Math.max(2, x(b) - x(a))} height={H - 2 * PAD} fill="#ff6a13" opacity={0.3} />)}
        {[0, 6, 12, 18, 24].map(h => <text key={h} x={x(h * 60)} y={H - 4} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.6}>{h}:00</text>)}
        {[25, 50, 75].map(v => <line key={v} x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)} stroke="currentColor" opacity={0.1} />)}
        {stress.map((p,i)=><circle key={i} cx={x(p.m)} cy={y(p.v)} r={1.8} fill="#ff6a13" />)}
      </svg> : <p className="text-xs text-muted">这一天没有高驰压力读数（高驰只提供最近 7 天内的日内压力；没有就不画）。</p>}</figure>
    <div className="mt-2 overflow-x-auto"><table className="w-full text-xs" data-testid="coros-daily"><thead><tr className="text-muted"><th className="text-left">日期</th><th>HRV(ms)</th><th>静息心率</th><th>睡眠</th><th>睡眠分</th></tr></thead>
      <tbody>{days.map(d => <tr key={d.date} className="border-t border-line"><td>{d.date.slice(5)}</td><td className="text-center">{d.hrvMs ?? '—'}</td><td className="text-center">{d.restingHr ?? '—'}</td><td className="text-center">{hm(d.sleepMinutes)}</td><td className="text-center">{d.sleepScore ?? '—'}</td></tr>)}
      {last ? <tr className="border-t border-line text-muted"><td>个人基准</td><td className="text-center">{last.reference.hrvMs ?? '不足'}</td><td className="text-center">{last.reference.restingHr ?? '不足'}</td><td className="text-center">{last.reference.sleepMinutes != null ? hm(last.reference.sleepMinutes) : '不足'}</td><td /></tr> : null}</tbody></table>
      <p className="keep text-[11px] text-muted">个人参考 = 此前 7 个有记录日的中位数（供应商完整度及测量协议未核验），只用高驰自己的数据，不到 7 天显示“不足”；不和佳明数据混算。—=高驰没给或认不出。</p></div>
    {data?.issues.length ? <details className="mt-2 text-xs"><summary>待核：{data.issues.length} 项高驰返回没认出来</summary><ul className="list-disc pl-4">{data.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {Object.entries(data.raw ?? {}).map(([k, v]) => <details key={k}><summary>{k} 原文</summary><pre className="whitespace-pre-wrap break-all text-[10px]">{v || '（空）'}</pre></details>)}</details> : null}
    {msg ? <p role="status" className="mt-2 text-sm">{msg}</p> : null}
    {error && corosNeedsLogin(error) ? <button type="button" className="min-h-11 text-accent" onClick={() => openDeviceSync({ provider: 'coros' })}>重新连接高驰 ›</button> : null}
  </section>
}
