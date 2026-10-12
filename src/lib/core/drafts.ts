import { readEnvelope, writeEnvelope } from "./storage.ts"
import type { RunDraft } from "./types.ts"

export const DRAFTS_KEY = "fr255-drafts-v1"

export function loadDrafts(): RunDraft[] {
  const data = readEnvelope<RunDraft[]>(DRAFTS_KEY, []).data
  return Array.isArray(data) ? data : []
}

function saveDrafts(drafts: RunDraft[]) {
  writeEnvelope(DRAFTS_KEY, drafts.slice(-40))
}

export function parseRunUtterance(text: string): Omit<RunDraft, "id" | "confirmed" | "createdAt"> {
  const raw = text.replace(/\s+/g, "")
  const km = raw.match(/(\d+(?:\.\d+)?)公里/)
  const minutes = raw.match(/(\d+(?:\.\d+)?)分钟/)
  const rpe = raw.match(/RPE(\d{1,2})/i) ?? raw.match(/强度(\d{1,2})/)
  const rpeValue = rpe ? Number(rpe[1]) : null
  return {
    source: "AI_PREFILL",
    text: text.slice(0, 80),
    distanceKm: km ? Number(km[1]) : null,
    durationSec: minutes ? Math.round(Number(minutes[1]) * 60) : null,
    rpe: rpeValue != null && rpeValue >= 1 && rpeValue <= 10 ? rpeValue : null,
    note: "",
  }
}

export function prefillRun(text: string): RunDraft {
  const parsed = parseRunUtterance(text)
  const draft: RunDraft = {
    ...parsed,
    id: `draft-${Date.now()}`,
    confirmed: false,
    createdAt: new Date().toISOString(),
  }
  saveDrafts([...loadDrafts(), draft])
  return draft
}

export function markDraftConfirmed(id: string) {
  const drafts = loadDrafts()
  const found = drafts.find((item) => item.id === id)
  if (!found) return
  found.confirmed = true
  saveDrafts(drafts)
}
