import { useSyncExternalStore } from 'react'
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from '../core/events'

/** Ephemeral presentation of the existing job; never stored as a successful sync receipt. */
export type GarminSyncLive = Readonly<{
  subjectId: string | null
  running: boolean
  message: string
  startedAt: string | null
  result: 'ok' | 'partial' | 'auth' | 'fail' | null
}>
const EMPTY: GarminSyncLive = Object.freeze({ subjectId: null, running: false, message: '', startedAt: null, result: null })
let state = EMPTY
let generation = 0
const listeners = new Set<() => void>()
function publish(next: GarminSyncLive) {
  state = Object.freeze(next)
  for (const listener of listeners) listener()
}
export function readGarminSyncLive(subjectId = currentAthleteId()): GarminSyncLive {
  return state.subjectId === subjectId ? state : EMPTY
}
export function subscribeGarminSyncLive(listener: () => void) {
  listeners.add(listener)
  const target = typeof window === 'undefined' ? null : window
  target?.addEventListener(ATHLETE_SCOPE_CHANGED, listener)
  return () => { listeners.delete(listener); target?.removeEventListener(ATHLETE_SCOPE_CHANGED, listener) }
}
export function beginGarminSyncLive(subjectId: string, startedAt: string): number {
  const token = ++generation
  publish({ subjectId, startedAt, running: true, message: '正在确认佳明账号…', result: null })
  return token
}
export function updateGarminSyncLive(token: number, message: string) {
  if (token === generation && state.running) publish({ ...state, message })
}
export function finishGarminSyncLive(token: number, result: GarminSyncLive['result'] = null) {
  if (token === generation && state.running) publish({ ...state, running: false, result })
}
export function clearGarminSyncLive(token?: number) {
  if (token != null && token !== generation) return
  generation++
  publish(EMPTY)
}
export function useGarminSyncLive(): GarminSyncLive {
  return useSyncExternalStore(subscribeGarminSyncLive, readGarminSyncLive, () => EMPTY)
}
