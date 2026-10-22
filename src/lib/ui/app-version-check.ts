/** v89.10.12：长时间挂在后台的标签页 / 主屏幕 App 回到前台时，检查线上是否已有新版本。
 * 新的 Service Worker 会 skipWaiting + clients.claim，但已在内存里运行的旧页面脚本不会自己换掉；
 * 所以回到前台时读一次 /sw.js 第 1 行的缓存版本号，和本页启动时的版本号不同就整页刷新一次（训练进行中不刷新）。 */
export const VERSION_RE = /CACHE\s*=\s*"([^"]+)"/
export function versionAction(input: { boot: string | null; latest: string | null; trainingOpen: boolean; reloadedFor: string | null }): "keep" | "remember" | "reload" {
  if (!input.latest) return "keep"
  if (!input.boot) return "remember"
  if (input.latest === input.boot || input.trainingOpen || input.reloadedFor === input.latest) return "keep"
  return "reload"
}
let boot: string | null = null
async function latestVersion(): Promise<string | null> {
  try { const r = await fetch("/sw.js", { cache: "no-store" }); if (!r.ok) return null; return VERSION_RE.exec(await r.text())?.[1] ?? null } catch { return null }
}
/** 返回 true 表示已开始刷新页面（调用方应跳过本次其他工作）。 */
export async function checkForNewVersion(trainingOpen: () => boolean): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false
  const latest = await latestVersion()
  let reloadedFor: string | null = null
  try { reloadedFor = sessionStorage.getItem("fk-version-reloaded") } catch { /* private mode */ }
  let open = true
  try { open = trainingOpen() } catch { open = true }
  const action = versionAction({ boot, latest, trainingOpen: open, reloadedFor })
  if (action === "remember") boot = latest
  if (action !== "reload" || !latest) return false
  try { sessionStorage.setItem("fk-version-reloaded", latest) } catch { /* private mode */ }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update() } catch { /* offline */ }
  location.reload()
  return true
}
