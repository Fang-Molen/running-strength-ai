/** One app-owned destination for account connections and device-file import. */
export const DEVICE_PLATFORMS = [
  { id: 'coros', label: '高驰 · COROS', short: '高驰' },
  { id: 'garmin', label: '佳明 · Garmin', short: '佳明' },
  { id: 'polar', label: '博能 · Polar Flow', short: '博能' },
  { id: 'suunto', label: '颂拓 · Suunto', short: '颂拓' },
  { id: 'huawei', label: '华为运动健康', short: '华为运动健康' },
  { id: 'apple_health', label: '苹果健康 · Apple Watch', short: '苹果健康' },
  { id: 'health_connect', label: '安卓 · Health Connect', short: 'Health Connect' },
  { id: 'strava', label: 'Strava · 个人 MCP', short: 'Strava' },
] as const
export type SyncPlatform = typeof DEVICE_PLATFORMS[number]['id']
export type SyncRequest = { mode: 'accounts' | 'files'; provider?: SyncPlatform }
export type SyncCallback = { provider: SyncPlatform; result: string; cleanSearch: string }
export const DEVICE_SYNC_OPEN = 'fk-open-sync'
export function isSyncPlatform(value: unknown): value is SyncPlatform {
  return typeof value === 'string' && DEVICE_PLATFORMS.some(p => p.id === value)
}
export function normalizeSyncRequest(value: unknown): SyncRequest {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { mode: input.mode === 'files' ? 'files' : 'accounts', ...(isSyncPlatform(input.provider) ? { provider: input.provider } : {}) }
}
export function openDeviceSync(value?: Partial<SyncRequest>): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DEVICE_SYNC_OPEN, { detail: normalizeSyncRequest(value) }))
}
export function readSyncCallback(search: string): SyncCallback | null {
  const q = new URLSearchParams(search)
  const coros = q.getAll('coros_auth'), platforms = q.getAll('watch_provider'), results = q.getAll('watch_auth')
  let provider: SyncPlatform, result: string
  if (coros.length === 1 && !platforms.length && !results.length) { provider = 'coros'; result = coros[0] }
  else if (platforms.length === 1 && results.length === 1 && !coros.length && ['polar', 'suunto', 'huawei', 'strava'].includes(platforms[0])) { provider = platforms[0] as SyncPlatform; result = results[0] }
  else return null
  if (!/^[a-z_]{1,64}$/.test(result)) return null
  q.delete('watch_provider'); q.delete('watch_auth'); q.delete('coros_auth')
  const clean = q.toString()
  return { provider, result, cleanSearch: clean ? `?${clean}` : '' }
}
