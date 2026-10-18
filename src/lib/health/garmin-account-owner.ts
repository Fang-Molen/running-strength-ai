import { currentStore } from '../core/storage'
import { shortHash } from './observation'
/** Local ownership fence; not Garmin authentication. Retained on logout to protect history. */
export function bindGarminAccount(scope: string, subject: string): boolean {
  if (!scope || !subject) return false
  try {
    const store = currentStore(); if (!store) return false
    const key = 'fk-garmin-account-owner:' + shortHash(scope), raw = store.getItem(key)
    if (raw !== null) { const prior = JSON.parse(raw); return prior.scope === scope && prior.subject === subject }
    const value = JSON.stringify({ scope, subject })
    store.setItem(key, value); return store.getItem(key) === value
  } catch { return false }
}
