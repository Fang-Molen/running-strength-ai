import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { DEVICE_PLATFORMS } from '@/lib/ui/device-sync-navigation'
import { platformSync, type RemotePlatform } from '@/lib/ui/platform-sync-runtime'
import { DeviceSyncPreview } from './device-sync-preview'

const ignore = (promise: Promise<unknown>) => { void promise.catch(() => {}) }
export function PlatformConnectionPanel({ provider, onFiles, onSaved }: { provider: RemotePlatform; onFiles: () => void; onSaved: () => void }) {
  const state = useSyncExternalStore(platformSync.subscribe, () => platformSync.snapshot(provider), () => platformSync.snapshot(provider))
  const [accessKey, setAccessKey] = useState('')
  const label = DEVICE_PLATFORMS.find(p => p.id === provider)!.short
  const status = state.status, busy = Boolean(state.action), native = status?.native
  useEffect(() => { ignore(platformSync.refresh(provider)) }, [provider, state.owner])
  useEffect(() => { setAccessKey('') }, [provider, state.owner])
  const badge = state.action === 'read' ? '读取中' : state.checking && !status ? '确认中…' : state.error && !status ? '暂不可达' : native ? native.state === 'needs_native_app' ? '需手机版' : native.state === 'provider_unavailable' ? '当前不可用' : native.state === 'permissions_required' ? '待授权' : '模块可用' : status?.connected ? '已连接' : status && !status.configured ? '待开通' : status?.reason === 'PERSONAL_ACCESS_REQUIRED' ? '个人接入' : '未连接'
  const cloudUnavailable = provider === 'huawei' ? '华为账号直连尚需完成官方接入申请，可先导入文件。' : provider === 'strava' ? '个人 MCP 接入尚未配置完成。' : '此平台尚未开通账号连接，可先导入文件。'
  const start = () => { platformSync.invalidate(provider); setAccessKey('') }
  return <section className="home-card device-account-card mt-3 p-4 text-sm" aria-label={`${label}连接`} data-testid={`platform-${provider}`}>
    <div className="device-account-heading"><h3 className="font-bold">{label}</h3><span role="status" className="device-account-status" data-tone={status?.connected ? 'ok' : state.error ? 'warn' : undefined}>{badge}</span></div>
    {!status && !state.checking ? <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line" onClick={() => ignore(platformSync.refresh(provider, true))}>重新确认连接</button> : null}
    {native ? <>
      <p className="mt-2 text-muted">{native.state === 'needs_native_app' ? '需要含健康读取模块的方坤手机版。网页及添加到主屏幕的版本暂不支持系统健康授权。' : native.state === 'provider_unavailable' ? '当前设备的健康服务暂不可用。' : native.state === 'permissions_required' ? '选择允许读取的项目，再同步最近的记录。' : '读取近 28 天记录，核对后保存。'}</p>
      {native.available ? <div className="device-account-actions mt-3">
        {native.state === 'available' ? <button type="button" disabled={busy} className="min-h-11 flex-1 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => ignore(platformSync.read(provider))}>{busy ? '处理中…' : '立即读取'}</button> : null}
        <button type="button" disabled={busy} className={`min-h-11 flex-1 rounded-xl px-3 ${native.state === 'permissions_required' ? 'bg-accent font-bold text-accent-fg' : 'border border-line'}`} onClick={() => { if (provider === 'apple_health' || provider === 'health_connect') ignore(platformSync.permission(provider)) }}>{state.action === 'permission' ? '等待系统授权…' : native.state === 'permissions_required' ? '选择读取项目' : '管理读取权限'}</button>
      </div> : <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line font-semibold" onClick={onFiles}>导入已有文件</button>}
      <details className="device-sync-disclosure"><summary><span>读取说明</span><ChevronDown aria-hidden="true" /></summary><div className="device-sync-detail-body text-muted"><p>{native.message}</p><p>不同来源的记录保留各自标记；缺少的指标不会补成 0，也不会自动生成恢复分。</p></div></details>
    </> : status ? status.configured ? provider === 'strava' && status.reason === 'OWNER_MISMATCH' ? <p className="mt-3 text-muted">此个人连接未配置给当前运动员档案，请切回已配置的档案。</p> : status.reason === 'PERSONAL_ACCESS_REQUIRED' ? <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); const value = accessKey; setAccessKey(''); ignore(platformSync.unlockStrava(value)) }}>
      <p className="text-muted">仅连接你个人使用的 Strava 账号。</p>
      <label className="block font-semibold" htmlFor="strava-personal-access">个人接入码</label>
      <input id="strava-personal-access" type="password" autoComplete="off" value={accessKey} onChange={e => setAccessKey(e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base" disabled={busy} />
      <button type="submit" disabled={busy || !accessKey} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50">{busy ? '验证中…' : '验证个人接入'}</button>
    </form> : status.connected ? <>
      <p className="mt-2 text-muted">{provider === 'strava' ? '个人 MCP 已连接；可核验连接能力，训练数据暂不导入方坤。' : '读取近 28 天记录，核对后保存。'}</p>
      <div className="device-account-actions mt-3"><button type="button" disabled={busy} aria-busy={state.action === 'read'} className="min-h-11 flex-1 rounded-xl bg-accent px-3 font-bold text-accent-fg" onClick={() => ignore(platformSync.read(provider))}>{busy ? state.action === 'disconnect' ? '断开中…' : '读取中…' : provider === 'strava' ? '核验连接能力' : '立即同步'}</button><button type="button" disabled={busy} className="min-h-11 rounded-xl border border-line px-3" onClick={() => ignore(platformSync.disconnect(provider))}>断开</button></div>
    </> : <>
      <p className="mt-2 text-muted">{provider === 'strava' ? '通过 Strava 官方页面授权个人 MCP。此连接暂不把训练记录导入方坤。' : '在官方页面授权，完成后回到这里同步。'}</p>
      {provider !== 'apple_health' && provider !== 'health_connect' ? <a data-testid={`${provider}-oauth`} href={busy || state.checking ? undefined : platformSync.startUrl(provider)} aria-disabled={busy || state.checking} tabIndex={busy || state.checking ? -1 : 0} onClick={e => { if (busy || state.checking) e.preventDefault(); else start() }} className={`mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-accent font-bold text-accent-fg ${busy || state.checking ? 'opacity-50' : ''}`}>连接{label}</a> : null}
    </> : <>
      <p className="mt-2 text-muted">{cloudUnavailable}</p>
      {provider !== 'strava' ? <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-line font-semibold" onClick={onFiles}>导入已有文件</button> : null}
    </> : null}
    {state.error ? <p className="mt-3 rounded-xl border border-line p-3 text-warn" role="alert">{state.error}</p> : null}
    {state.notice ? <p className="device-sync-message mt-3" role="status">{state.notice}</p> : null}
    {state.lastRead ? <p className="mt-2 text-sm text-muted">上次读取：{new Date(state.lastRead).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p> : null}
    {state.tools ? <p className="mt-2 text-muted">官方服务已返回 {state.tools.length} 项能力。没有新增训练或健康记录。</p> : null}
    {state.preview ? <DeviceSyncPreview key={`${state.owner}:${state.preview.fetchedAt}`} provider={provider} owner={state.owner} preview={state.preview} disabled={busy} onSaved={onSaved} /> : null}
    {provider === 'strava' ? <details className="device-sync-disclosure"><summary><span>个人连接说明</span><ChevronDown aria-hidden="true" /></summary><div className="device-sync-detail-body text-muted"><p>此入口仅供已配置的个人使用环境。Strava 官方 MCP 需要符合其订阅和个人使用条件，不能据此开放给其他用户使用。</p><p>这里只确认官方 MCP 连接和能力列表。尚未核实的运动数据格式不会进入教练、恢复判断或训练记录。</p></div></details> : null}
    {status && !busy ? <button type="button" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted" onClick={() => ignore(platformSync.refresh(provider, true))}><RefreshCw className="size-3.5" aria-hidden="true" />刷新连接状态</button> : null}
  </section>
}
