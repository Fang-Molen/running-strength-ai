import { readEnvelope, writeEnvelope } from "./storage.ts"

export const CORE_KEY = "fr255-core-v1"

const LEGACY_KEYS = [
  "fr255-strength-plan-v3",
  "fr255-strength-plan-v2",
  "fr255-strength-plan-v1",
  "fr255-day-v1",
  "fr255-food-log-v1",
  "fr255-body-v1",
  "fr255-profile-v1",
  "fr255-coach-v2",
  "fr255-coach-v1",
]

export type CoreMeta = {
  athleteId: string
  migrated: boolean
  migratedAt: string
  seen: { key: string; bytes: number }[]
}

const EMPTY: CoreMeta = { athleteId: "local", migrated: false, migratedAt: "", seen: [] }

export function migrationStatus(): CoreMeta {
  return readEnvelope<CoreMeta>(CORE_KEY, EMPTY).data
}

/** Idempotent. Reads old keys, never deletes or rewrites them. */
export function runMigrations(): CoreMeta {
  const current = migrationStatus()
  if (current.migrated) return current
  if (typeof localStorage === "undefined") return current
  const seen = LEGACY_KEYS.map((key) => {
    try {
      const raw = localStorage.getItem(key)
      return { key, bytes: raw ? raw.length : 0 }
    } catch {
      return { key, bytes: 0 }
    }
  })
  const next: CoreMeta = { athleteId: "local", migrated: true, migratedAt: new Date().toISOString(), seen }
  const saved = writeEnvelope(CORE_KEY, next)
  if (readEnvelope("fr255-settings-v1", null).revision === 0) writeEnvelope("fr255-settings-v1", { athleteId: "local" })
  if (readEnvelope("fr255-memory-v1", null).revision === 0) writeEnvelope("fr255-memory-v1", { notes: [] })
  return saved?.data ?? current
}
