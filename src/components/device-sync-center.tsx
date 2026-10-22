import { useEffect, useState, type ReactNode } from 'react'
import { Watch, FileUp } from 'lucide-react'
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from '@/lib/core/events'
import { DEVICE_PLATFORMS, isSyncPlatform, type SyncCallback, type SyncPlatform, type SyncRequest } from '@/lib/ui/device-sync-navigation'
import { loadBrand } from '@/lib/ui/watch-mode'
import { GarminSync, type GarminConn } from './garmin-sync'
import { CorosAccount } from './coros-account'
import { DeviceImport } from './device-import'
import { DeviceCenter } from './device-center'
import { SyncStatusPanel } from './settings-center'
import { PlatformConnectionPanel } from './platform-connection-panel'
import './device-settings-detail.css'

function initialPlatform(request: SyncRequest): SyncPlatform {
  if (request.provider) return request.provider
  try { const value = sessionStorage.getItem(`fk-sync-platform:${currentAthleteId()}`); if (isSyncPlatform(value)) return value } catch { /* no saved view preference */ }
  const brand = loadBrand()
  return isSyncPlatform(brand) ? brand : brand === 'apple' ? 'apple_health' : 'coros'
}
const CALLBACK_MESSAGES: Record<string, string> = { ok: '已从官方授权页面返回，正在确认连接状态。', denied: '已取消授权，可在这里重新连接。', state: '授权已过期，请重新连接。', code: '授权未完成，请重新连接。', reauthorize: '需要重新授权，请再次连接。', client_auth_expired: '接入凭据已更新，请重新连接。', server_not_configured: '此平台尚未完成接入配置。', not_configured: '此平台尚未完成接入配置。' }

/** The only app-owned connection surface. Vendor authorization stays in this browsing context. */
export function DeviceSyncCenter({ today, request, callback, onSaved, children }: { today: string; request: SyncRequest; callback?: SyncCallback | null; onSaved: () => void; children?: ReactNode }) {
  const [provider, setProvider] = useState<SyncPlatform>(() => initialPlatform(request))
  const [mode, setMode] = useState(request.mode)
  const [visited, setVisited] = useState({ accounts: request.mode === 'accounts', files: request.mode === 'files' })
  const changeMode = (next: SyncRequest['mode']) => { setMode(next); setVisited(v => ({ ...v, [next]: true })) }
  const [owner, setOwner] = useState(currentAthleteId)
  const [garminConn, setGarminConn] = useState<GarminConn>(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  useEffect(() => { changeMode(request.mode); if (request.provider) setProvider(request.provider) }, [request])
  useEffect(() => { const changed = () => { setOwner(currentAthleteId()); setProvider(initialPlatform({ mode: 'accounts' })); setGarminConn(null); setReportsOpen(false) }; window.addEventListener(ATHLETE_SCOPE_CHANGED, changed); return () => window.removeEventListener(ATHLETE_SCOPE_CHANGED, changed) }, [])
  const select = (value: SyncPlatform) => { setProvider(value); try { sessionStorage.setItem(`fk-sync-platform:${owner}`, value) } catch { /* visual preference only */ } }
  return <div data-testid="device-sync-center" className="device-sync-center">
    <div className="device-sync-tabs mt-3" role="tablist" aria-label="设备数据接入方式">
      <button type="button" id="sync-accounts-tab" role="tab" aria-selected={mode === 'accounts'} aria-controls="sync-accounts-panel" onClick={() => changeMode('accounts')}><Watch aria-hidden="true" className="size-4" />账号连接</button>
      <button type="button" id="sync-files-tab" role="tab" aria-selected={mode === 'files'} aria-controls="sync-files-panel" onClick={() => changeMode('files')}><FileUp aria-hidden="true" className="size-4" />文件导入</button>
    </div>
    {visited.accounts ? <div id="sync-accounts-panel" role="tabpanel" aria-labelledby="sync-accounts-tab" hidden={mode !== 'accounts'}>
      <label htmlFor="sync-platform" className="mt-4 mb-2 block text-sm font-semibold">选择平台</label>
      <select id="sync-platform" data-testid="sync-platform" className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base font-semibold" value={provider} onChange={e => { if (isSyncPlatform(e.target.value)) select(e.target.value) }}>
        {DEVICE_PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {callback?.provider === provider ? <p className="mt-3 text-sm text-muted" role="status" data-testid="sync-auth-result">{CALLBACK_MESSAGES[callback.result] ?? '授权未完成，请重新连接。'}</p> : null}
      <div key={`${owner}:${provider}`}>
        {provider === 'garmin' ? <div className="-mx-3"><GarminSync hideBackup onState={setGarminConn} /></div> : provider === 'coros' ? <CorosAccount /> : <PlatformConnectionPanel provider={provider} onFiles={() => changeMode('files')} onSaved={onSaved} />}
      </div>
    </div> : null}
    {visited.files ? <div id="sync-files-panel" role="tabpanel" aria-labelledby="sync-files-tab" className="mt-3" hidden={mode !== 'files'} key={owner}>
      <DeviceImport today={today} onSaved={onSaved} hideConnectionLink />
      <details className="home-card mt-3 p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">各品牌导出步骤与文件预览</summary><DeviceCenter initialBrand={provider === 'apple_health' ? 'apple' : provider} /></details>
    </div> : null}
    <details className="home-card mt-3 p-3" onToggle={e => setReportsOpen(e.currentTarget.open)}><summary className="min-h-11 cursor-pointer text-sm font-bold">同步记录与详情</summary>{reportsOpen ? <SyncStatusPanel conn={garminConn} /> : null}</details>
    {children ? <details className="home-card mt-3 p-3"><summary className="min-h-11 cursor-pointer text-sm font-bold">设备显示设置</summary>{children}</details> : null}
  </div>
}
