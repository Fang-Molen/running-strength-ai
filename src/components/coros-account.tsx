import { useEffect, useState } from 'react'
import { corosLogin, corosLogout, corosRecentImport, corosStatus, loadCorosMeta, saveCorosMeta } from '@/lib/health/coros-account-sync'
import { activityDraftId, existingKeys, saveDeviceRows } from '@/lib/ui/device-store'
import { currentAthleteId } from '@/lib/core/events'
import type { DeviceActivity } from '@/lib/ui/device-parse'

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
/** v89.9.3：高驰账号卡片（设备连接与同步 / 首次引导共用）。密码只发给本站中转做一次登录，不保存；读到的活动先列出，勾选确认后才保存进日志。 */
export function CorosAccount({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unreachable'>('checking')
  const [account, setAccount] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  const [rows, setRows] = useState<DeviceActivity[] | null>(null), [pick, setPick] = useState<Record<string, boolean>>({}), [dup, setDup] = useState<Set<string>>(new Set())
  useEffect(() => { corosStatus().then(s => setState(s.loggedIn ? 'in' : 'out')).catch(() => setState('unreachable')) }, [])
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); setMsg(''); try { await f() } catch (e) { setMsg(e instanceof Error ? e.message : '高驰请求失败') } finally { setBusy(false) } }
  const read = () => run(async () => {
    const r = await corosRecentImport(); const have = existingKeys(); const d = new Set(r.activities.filter(a => have.activities.has(activityDraftId(a))).map(a => a.key))
    setDup(d); setPick(Object.fromEntries(r.activities.map(a => [a.key, !d.has(a.key)]))); setRows(r.activities)
    saveCorosMeta(currentAthleteId(), { at: new Date().toISOString(), read: r.activities.length })
    setMsg(r.activities.length ? `读到 ${r.activities.length} 条跑步/力量（${d.size} 条已保存过）。勾选核对无误的再保存。` : '近 28 天没有读到跑步/力量活动。')
  })
  const save = () => { if (!rows) return; const r = saveDeviceRows([], rows.filter(a => pick[a.key]))
    const m = loadCorosMeta(currentAthleteId()); if (m) saveCorosMeta(currentAthleteId(), { ...m, saved: r.saved })
    setMsg(`已保存 ${r.saved} 条${r.skipped ? `，跳过已存在 ${r.skipped} 条` : ''}${r.errors.length ? `；${r.errors.length} 条未保存` : ''}。保存后在日志里查看；关联计划课仍需你确认。`); if (!r.errors.length) setRows(null) }
  const nPick = rows ? rows.filter(a => pick[a.key]).length : 0
  return <section className={compact ? 'mt-3 rounded-xl border border-line p-3 text-sm' : 'home-card mt-3 p-4 text-sm'} aria-label="高驰账号" data-testid="coros-account">
    <h3 className="font-bold">高驰（COROS）账号 · {state === 'in' ? '已登录' : state === 'checking' ? '检查中…' : state === 'unreachable' ? '中转暂不可达' : '未登录'}</h3>
    <p className="mt-1 text-xs text-muted">用高驰账号（邮箱/手机号）和密码登录，读取近 28 天活动摘要（距离、时长、心率），核对后再保存。走高驰网页版的非官方接口，可能随高驰改版失效；目前只读活动，不读日内心率、睡眠、HRV，也没有“身体电量”。约 24 小时后需要重新登录。</p>
    {state !== 'in' ? <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => { await corosLogin(account, password); setPassword(''); setState('in'); setMsg('已登录高驰，可以读取活动。') }) }}>
      <input aria-label="高驰账号" autoComplete="username" value={account} onChange={e => setAccount(e.target.value)} placeholder="高驰账号（邮箱/手机号）" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <input aria-label="高驰密码" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <button type="submit" disabled={busy || !account.trim() || !password} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50">{busy ? '登录中…' : '登录高驰'}</button>
    </form> : <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => void read()}>{busy ? '读取中…' : '读取近 28 天活动'}</button>
      <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => void run(async () => { await corosLogout(); setState('out'); setRows(null); setMsg('已退出高驰。已保存的记录不受影响。') })}>退出高驰</button>
    </div>}
    {rows && rows.length ? <div className="mt-2 space-y-1" data-testid="coros-preview">
      {rows.map(a => <label key={a.key} className="flex min-h-11 items-center gap-2 border-t border-line pt-1 text-xs"><input type="checkbox" checked={!!pick[a.key]} onChange={e => setPick(p => ({ ...p, [a.key]: e.target.checked }))} />
        <span>{fmt(a.startIso)} · {a.sportLabel}{a.distanceM ? ` · ${(a.distanceM / 1000).toFixed(2)} km` : ''}{a.durationSec ? ` · ${Math.round(a.durationSec / 60)} 分钟` : ''}{a.avgHr ? ` · 均心率 ${a.avgHr}` : ''}{dup.has(a.key) ? '（已保存过）' : ''}</span></label>)}
      <button type="button" disabled={!nPick} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={save}>保存选中的 {nPick} 条</button>
    </div> : null}
    {msg ? <p role="status" className="mt-2 text-xs">{msg}</p> : null}
  </section>
}
/** 设备连接与同步状态卡里的高驰行（只显示实际查询/读取结果）。 */
export function CorosStatusRows({ KV }: { KV: (p: { k: string; v: string; tone?: 'warn' | 'ok' }) => React.ReactNode }) {
  const [st, setSt] = useState<string>('正在确认…'), [meta, setMeta] = useState(() => loadCorosMeta(currentAthleteId()))
  useEffect(() => { const f = () => { setMeta(loadCorosMeta(currentAthleteId())); corosStatus().then(s => setSt(s.loggedIn ? '已登录' : '未登录')).catch(() => setSt('中转暂不可达')) }; f(); window.addEventListener('fk-coros-changed', f); return () => window.removeEventListener('fk-coros-changed', f) }, [])
  return <>{KV({ k: '连接状态', v: st })}{KV({ k: '最近读取', v: meta ? `${fmt(meta.at)} · 读到 ${meta.read} 条${meta.saved != null ? ` · 保存 ${meta.saved} 条` : ''}` : '暂无记录' })}</>
}
