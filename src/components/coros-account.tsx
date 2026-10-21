import { useEffect, useRef, useState } from 'react'
import { corosLogin, corosLogout, corosNeedsLogin, corosRecentImport, corosStatus, loadCorosMeta, saveCorosMeta } from '@/lib/health/coros-account-sync'
import { crossBrandCandidates, crossBrandPairsInLog } from '@/lib/health/brand-isolation'
import { loadTrainingActivities } from '@/lib/ui/training-read-model'
import { activityDraftId, existingKeys, saveDeviceRows } from '@/lib/ui/device-store'
import { currentAthleteId } from '@/lib/core/events'
import type { DeviceActivity } from '@/lib/ui/device-parse'

/** v89.9.4：日志里其他品牌（佳明）的活动，用于“可能是同一次活动”提示；读不到就当没有。 */
const logRows = () => { try { return loadTrainingActivities() } catch { return [] } }
const asLike = (a: DeviceActivity) => ({ id: a.key, sport: a.sport, startedAt: a.startIso, distanceM: a.distanceM, durationSec: a.durationSec, timeUnknown: !a.startIso || !/[zZ]|[+-]\d\d:\d\d$/.test(a.startIso) })
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
/** v89.9.3：高驰账号卡片（设备连接与同步 / 首次引导共用）。密码只发给本站中转做一次登录，不保存；读到的活动先列出，勾选确认后才保存进日志。 */
export function CorosAccount({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unreachable'>('checking')
  const [account, setAccount] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  const [rows, setRows] = useState<DeviceActivity[] | null>(null), [pick, setPick] = useState<Record<string, boolean>>({}), [dup, setDup] = useState<Set<string>>(new Set())
  const [cross, setCross] = useState<Set<string>>(new Set()), [logPairs, setLogPairs] = useState(0)
  const busyRef = useRef(false), rowsRef = useRef<DeviceActivity[] | null>(null)
  rowsRef.current = rows
  useEffect(() => { corosStatus().then(s => setState(s.loggedIn ? 'in' : 'out')).catch(() => setState('unreachable')) }, [])
  // 登录过期/未登录：回到登录表单，清掉预览；已保存的记录不动。
  const expired = () => { setState('out'); setRows(null); setMsg('高驰登录已过期（约 24 小时），请重新登录。已保存的记录不受影响。') }
  const run = async (f: () => Promise<void>) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setMsg(''); try { await f() } catch (e) { if (corosNeedsLogin(e)) expired(); else setMsg(e instanceof Error ? e.message : '高驰请求失败') } finally { busyRef.current = false; setBusy(false) } }
  /** 已保存过（同一高驰记录）和“可能与佳明同一次活动”的默认不勾选；用户自己决定，绝不自动合并。 */
  const prepare = (list: DeviceActivity[]) => {
    const have = existingKeys(), d = new Set(list.filter(a => have.activities.has(activityDraftId(a))).map(a => a.key))
    const all = logRows(); setLogPairs(crossBrandPairsInLog(all).length)
    const c = new Set(crossBrandCandidates(list.filter(a => !d.has(a.key)).map(asLike), all, 'COROS').keys())
    return { d, c }
  }
  const read = () => run(async () => {
    const r = await corosRecentImport(); const { d, c } = prepare(r.activities)
    setDup(d); setCross(c); setPick(Object.fromEntries(r.activities.map(a => [a.key, !d.has(a.key) && !c.has(a.key)]))); setRows(r.activities)
    saveCorosMeta(currentAthleteId(), { at: new Date().toISOString(), read: r.activities.length })
    setMsg(r.activities.length ? `读到 ${r.activities.length} 条跑步/力量（${d.size} 条已保存过${c.size ? `，${c.size} 条可能与佳明记录是同一次活动` : ''}）。勾选核对无误的再保存。` : '近 28 天没有读到跑步/力量活动。')
  })
  // v89.9.4：前台自动检查（参考补丁合入）：只在已登录时运行；页面在前台每 10 分钟查近 7 天，回到前台也查一次。
  // 只列出未保存的新活动待勾选，绝不自动保存、不改计划、不判疲劳；登录过期则停止并回到登录表单。
  useEffect(() => {
    if (state !== 'in') return
    let active = true
    const refresh = async () => {
      if (!active || busyRef.current || document.visibilityState !== 'visible') return
      busyRef.current = true
      try {
        const result = await corosRecentImport(7)
        if (!active) return
        const { d, c } = prepare(result.activities), fresh = result.activities.filter(a => !d.has(a.key))
        if (!fresh.length) return
        // 用户正在核对的列表里已有的不打断；有新活动才替换为“新活动”列表，已勾选状态保留。
        const cur = rowsRef.current
        if (cur && fresh.every(a => cur.some(x => x.key === a.key))) return
        setRows(fresh); setDup(new Set()); setCross(c)
        setPick(p => Object.fromEntries(fresh.map(a => [a.key, p[a.key] ?? !c.has(a.key)])))
        setMsg(`发现 ${fresh.length} 条未保存的高驰活动${c.size ? `（${c.size} 条可能与佳明记录是同一次活动）` : ''}，核对后勾选保存。`)
        saveCorosMeta(currentAthleteId(), { at: new Date().toISOString(), read: result.activities.length })
      } catch (e) { if (active && corosNeedsLogin(e)) expired() /* 其他临时失败不提示、不改任何记录 */ }
      finally { busyRef.current = false }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), 10 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [state])
  const save = () => { if (!rows) return; const r = saveDeviceRows([], rows.filter(a => pick[a.key]))
    const m = loadCorosMeta(currentAthleteId()); if (m) saveCorosMeta(currentAthleteId(), { ...m, saved: r.saved })
    setLogPairs(crossBrandPairsInLog(logRows()).length)
    setMsg(`已保存 ${r.saved} 条${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ''}${r.errors.length ? `；${r.errors.length} 条未保存` : ''}。保存后在日志里查看；关联计划课仍需你确认。`); if (!r.errors.length) setRows(null) }
  const nPick = rows ? rows.filter(a => pick[a.key]).length : 0
  return <section className={compact ? 'mt-3 rounded-xl border border-line p-3 text-sm' : 'home-card mt-3 p-4 text-sm'} aria-label="高驰账号" data-testid="coros-account">
    <h3 className="font-bold">高驰（COROS）账号 · {state === 'in' ? '已登录' : state === 'checking' ? '检查中…' : state === 'unreachable' ? '中转暂不可达' : '未登录'}</h3>
    <p className="mt-1 text-xs text-muted">用高驰账号（邮箱/手机号）和密码登录，读取近 28 天活动摘要（距离、时长、心率），核对后再保存。走高驰网页版的非官方接口，可能随高驰改版失效；目前只读活动，不读日内心率、睡眠、HRV，也没有“身体电量”。已登录时页面在前台每 10 分钟检查新活动，回到页面也会检查；只列出来让你核对，不自动保存。高驰数据单独记来源，不和佳明混算、不进佳明身体电量和佳明计划关联。约 24 小时后需要重新登录。</p>
    {state !== 'in' ? <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => { await corosLogin(account, password); setPassword(''); setState('in'); setMsg('已登录高驰，可以读取活动。') }) }}>
      <input aria-label="高驰账号" autoComplete="username" value={account} onChange={e => setAccount(e.target.value)} placeholder="高驰账号（邮箱/手机号）" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <input aria-label="高驰密码" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <button type="submit" disabled={busy || !account.trim() || !password} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50">{busy ? '登录中…' : '登录高驰'}</button>
    </form> : <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => void read()}>{busy ? '读取中…' : '手动读取近 28 天'}</button>
      <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => void run(async () => { await corosLogout(); setState('out'); setRows(null); setMsg('已退出高驰。已保存的记录不受影响。') })}>退出高驰</button>
    </div>}
    {rows && rows.length ? <div className="mt-2 space-y-1" data-testid="coros-preview">
      {rows.map(a => <label key={a.key} className="flex min-h-11 items-center gap-2 border-t border-line pt-1 text-xs"><input type="checkbox" checked={!!pick[a.key]} onChange={e => setPick(p => ({ ...p, [a.key]: e.target.checked }))} />
        <span>{fmt(a.startIso)} · {a.sportLabel}{a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(2)} km` : ''}{a.durationSec ? ` · ${Math.round(a.durationSec / 60)} 分钟` : ''}{a.avgHr ? ` · 均心率 ${a.avgHr}` : ''}{dup.has(a.key) ? '（已保存过）' : cross.has(a.key) ? '（可能与佳明同一次活动，默认不勾选）' : ''}</span></label>)}
      <button type="button" disabled={!nPick} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={save}>保存选中的 {nPick} 条</button>
    </div> : null}
    {logPairs ? <p className="mt-2 text-xs text-muted" data-testid="coros-crossbrand-note">日志里有 {logPairs} 条高驰记录与佳明记录开始时间相差 2 分钟内、距离/时长接近，可能是同一次活动记了两次。没有自动合并，请到日志里核对，需要时删掉其中一条。</p> : null}
    {msg ? <p role="status" className="mt-2 text-xs">{msg}</p> : null}
  </section>
}
/** 设备连接与同步状态卡里的高驰行（只显示实际查询/读取结果）。 */
export function CorosStatusRows({ KV }: { KV: (p: { k: string; v: string; tone?: 'warn' | 'ok' }) => React.ReactNode }) {
  const [st, setSt] = useState<string>('正在确认…'), [meta, setMeta] = useState(() => loadCorosMeta(currentAthleteId()))
  useEffect(() => { const f = () => { setMeta(loadCorosMeta(currentAthleteId())); corosStatus().then(s => setSt(s.loggedIn ? '已登录' : '未登录')).catch(() => setSt('中转暂不可达')) }; f(); window.addEventListener('fk-coros-changed', f); return () => window.removeEventListener('fk-coros-changed', f) }, [])
  return <>{KV({ k: '连接状态', v: st })}{KV({ k: '最近读取', v: meta ? `${fmt(meta.at)} · 读到 ${meta.read} 条${meta.saved != null ? ` · 保存 ${meta.saved} 条` : ''}` : '暂无记录' })}</>
}
