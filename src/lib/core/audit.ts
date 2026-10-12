import { readEnvelope, writeEnvelope } from "./storage.ts"
import type { AuditEntry } from "./types.ts"

export const AUDIT_KEY = "fr255-audit-v1"

export function loadAudit(): AuditEntry[] {
  const data = readEnvelope<AuditEntry[]>(AUDIT_KEY, []).data
  return Array.isArray(data) ? data : []
}

export function recordAudit(entry: Omit<AuditEntry, "id" | "timestamp"> & { timestamp?: string }): AuditEntry | null {
  try {
    const row: AuditEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      source: entry.source,
      action: entry.action,
      originalValue: entry.originalValue,
      newValue: entry.newValue,
      reason: entry.reason,
      risk: entry.risk,
      decisionId: entry.decisionId,
    }
    const saved = writeEnvelope(AUDIT_KEY, [...loadAudit(), row].slice(-400))
    return saved ? row : null
  } catch {
    return null
  }
}
