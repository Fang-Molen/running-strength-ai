// Stale-shell recovery: an old cached page can reference a hashed chunk from an
// earlier deploy. On chunk-load failure, refresh the worker and reload once.
export const CHUNK_ERR = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|not a valid JavaScript MIME type|Loading chunk .* failed|Unable to preload CSS/i;
export function isChunkError(e: unknown): boolean { return CHUNK_ERR.test(String((e as Error)?.message ?? e)); }
export async function recoverFromChunkError(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const last = Number(sessionStorage.getItem("fk-chunk-reload") || 0);
  if (Date.now() - last < 60_000) return false; // loop guard
  sessionStorage.setItem("fk-chunk-reload", String(Date.now()));
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); } catch { /* offline */ }
  location.reload();
  return true;
}
let installed = false;
export function installChunkRecovery() {
  if (installed || typeof window === "undefined") return; installed = true;
  // Only a genuine stale-chunk failure reloads. Any other dynamic-import failure (for
  // example the 3D viewer module or WebGL failing) must reach the caller's own catch,
  // so its offline/text fallback shows instead of a page reload that drops the screen.
  window.addEventListener("vite:preloadError", (e) => { if (!isChunkError((e as Event & { payload?: unknown }).payload)) return; e.preventDefault(); void recoverFromChunkError(); });
  window.addEventListener("unhandledrejection", (e) => { if (isChunkError(e.reason)) void recoverFromChunkError(); });
  window.addEventListener("error", (e) => { if (isChunkError(e.message)) void recoverFromChunkError(); });
}
