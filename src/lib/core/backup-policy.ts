import { currentStore, rawCurrentStore } from './storage.ts'

export const UNSAFE_BROWSER_RESTORE = '当前网页无法证明旧标签页已停止写入，未覆盖当前记录。请先预检并保存待核副本。'
/** Native identity and explicitly marked adapters are physical stores;
 * unmarked memory adapters remain usable for offline transformations. */
export function isPhysicalBackupStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false
  if ((store as { persistence?: unknown }).persistence === 'browser') return true
  try {
    if (typeof Storage !== 'undefined' && store instanceof Storage) return true
    const native = typeof localStorage === 'undefined' ? null : localStorage
    if (native && (store === native || (rawCurrentStore() === native && store === currentStore()))) return true
    if (typeof sessionStorage !== 'undefined' && store === sessionStorage) return true
  } catch { return true }
  return false
}
