import { useEffect, useState } from 'react'
import { corosLogin, corosLogout, corosRecentImport, corosStatus } from '@/lib/health/coros-account-sync'
import type { DeviceParseResult } from '@/lib/ui/device-parse'

/** v89.9.2：高驰账号登录 + 读取近 28 天活动，结果交给上方同一个“核对 → 保存”流程。密码只发给本站中转做一次登录，不保存。 */
export function CorosAccount({ onResult }: { onResult: (r: DeviceParseResult) => void }) {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking')
  const [account, setAccount] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('')
  useEffect(() => { corosStatus().then(s => setState(s.loggedIn ? 'in' : 'out')).catch(() => setState('out')) }, [])
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); setMsg(''); try { await f() } catch (e) { setMsg(e instanceof Error ? e.message : '高驰请求失败') } finally { setBusy(false) } }
  return <details className="mt-3 rounded-xl border border-line p-3" data-testid="coros-account">
    <summary className="min-h-11 cursor-pointer content-center font-bold">高驰（COROS）账号 · {state === 'in' ? '已登录' : state === 'checking' ? '检查中…' : '未登录'}</summary>
    <p className="mt-1 text-xs text-muted">用高驰账号（邮箱/手机号）和密码登录，读取近 28 天活动摘要，核对后再保存。走高驰网页版的非官方接口，可能随高驰改版失效；目前只读活动，不读日内心率、睡眠、HRV，也没有“身体电量”。登录约 24 小时后需要重新登录。</p>
    {state !== 'in' ? <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => { await corosLogin(account, password); setPassword(''); setState('in'); setMsg('已登录高驰。') }) }}>
      <input aria-label="高驰账号" autoComplete="username" value={account} onChange={e => setAccount(e.target.value)} placeholder="高驰账号（邮箱/手机号）" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <input aria-label="高驰密码" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密码" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" />
      <button type="submit" disabled={busy || !account.trim() || !password} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50">{busy ? '登录中…' : '登录高驰'}</button>
    </form> : <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy} className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => void run(async () => { const r = await corosRecentImport(); onResult(r); setMsg(`读到 ${r.activities.length} 条跑步/力量，请在下方核对后保存。`) })}>{busy ? '读取中…' : '读取近 28 天活动'}</button>
      <button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => void run(async () => { await corosLogout(); setState('out'); setMsg('已退出高驰。已保存的记录不受影响。') })}>退出高驰</button>
    </div>}
    {msg ? <p role="status" className="mt-2 text-xs">{msg}</p> : null}
  </details>
}
