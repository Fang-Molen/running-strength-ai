import { ATHLETE_SCOPE_CHANGED, onAppEvent } from '../core/events'
import { HEALTH_CHANGED } from './observation'

export type HealthSubscriptionOptions = { batch?: boolean; reconcile?: boolean }
/** Local invalidation only: no requests, polling, storage writes or automatic imports.
 * Batch synchronous provider-save notifications into one microtask. Reconcile after
 * subscribing closes the gap between first render and effect installation. */
export function subscribeHealthUpdates(refresh: () => void, options: HealthSubscriptionOptions = {}): () => void {
  const target = typeof window === 'undefined' ? null : window
  const documentTarget = typeof document === 'undefined' ? null : document
  let disposed = false, queued = false
  const notify = () => {
    if (disposed) return
    if (!options.batch) { refresh(); return }
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; if (!disposed) refresh() })
  }
  const names = [HEALTH_CHANGED, 'fk-profile-changed', 'fk-r5-changed', 'fk-training-corrected', 'fk-food-changed', 'storage', 'fk-garmin-synced', 'fk-coros-changed', ATHLETE_SCOPE_CHANGED, 'focus', 'pageshow']
  const off = onAppEvent(notify)
  for (const name of names) target?.addEventListener(name, notify)
  const visible = () => { if (documentTarget?.visibilityState === 'visible') notify() }
  documentTarget?.addEventListener('visibilitychange', visible)
  if (options.reconcile && target) notify()
  return () => { disposed = true; off(); for (const name of names) target?.removeEventListener(name, notify); documentTarget?.removeEventListener('visibilitychange', visible) }
}
