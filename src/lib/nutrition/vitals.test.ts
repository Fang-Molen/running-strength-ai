import assert from "node:assert/strict"
import test from "node:test"
import { EVENTS_KEY } from "@/lib/core/events"
import { collectLocalBackup, restoreLocalBackup } from "@/lib/core/trial"
import { setStoreBackend, type MemoryStore } from "@/lib/core/storage"
import { latestOnDay, loadVitals, removeVital, saveVital, trendPoints, VITALS_KEY, type VitalDraft } from "./vitals.ts"

function memory(): MemoryStore & { dump: Map<string, string>; length: number; key(index: number): string | null } {
  const dump = new Map<string, string>()
  return {
    dump,
    get length() { return dump.size },
    key: (index) => [...dump.keys()][index] ?? null,
    keys:()=>[...dump.keys()], getItem: (key) => dump.get(key) ?? null,
    setItem: (key, value) => void dump.set(key, value),
  }
}

function draft(extra: Partial<VitalDraft> = {}): VitalDraft {
  return { kind: "HRV", value: 42, observedOn: "2026-10-08", observedAt: "07:30", source: "MANUAL", note: "", hrvMethod: "RMSSD", ...extra }
}

test("vitals stay independent, keep same-day rows, and do not invent trends", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem("fr255-body-v1", "[{\"weight\":70}]")
  box.setItem("fr255-food-log-v1", "[{\"kcal\":174}]")
  box.setItem("fr255-day-v1", "{\"burn\":1}")
  box.setItem(EVENTS_KEY, "{\"data\":[]}")
  assert.equal(saveVital(draft({ value: 0 })).ok, false)
  assert.equal(saveVital(draft({ observedOn: "2026-13-40" })).ok, false)
  assert.equal(saveVital(draft({ hrvMethod: null })).ok, false)
  assert.equal(saveVital(draft({ note: "字".repeat(81) })).ok, false)
  assert.equal(loadVitals().records.length, 0)
  const first = saveVital(draft(), "a", "2026-10-08T07:00:00.000Z")
  const second = saveVital(draft({ value: 55, observedAt: "08:00" }), "b", "2026-10-08T08:00:00.000Z")
  const other = saveVital(draft({ value: 80, hrvMethod: "SDNN" }), "c", "2026-10-08T09:00:00.000Z")
  assert.equal(first.ok && second.ok && other.ok, true)
  assert.equal(loadVitals().records.length, 3)
  assert.equal(latestOnDay(loadVitals().records, "HRV", "2026-10-08")?.id, "c")
  assert.equal(latestOnDay(loadVitals().records, "HRV", "2026-10-07"), null)
  assert.deepEqual(trendPoints(loadVitals().records, "HRV", "2026-10-08", 7, "RMSSD")?.map((item) => item.value), [42, 55])
  assert.equal(trendPoints(loadVitals().records, "HRV", "2026-10-08", 7, "SDNN"), null)
  const older = saveVital(draft({ observedOn: "2026-10-02", value: 40 }), "d", "2026-10-02T07:00:00.000Z")
  assert.equal(older.ok, true)
  const rmssd = trendPoints(loadVitals().records, "HRV", "2026-10-08", 7, "RMSSD")
  assert.deepEqual(rmssd?.map((item) => item.id), ["d", "a", "b"])
  assert.equal(trendPoints(loadVitals().records, "HRV", "2026-10-08", 7, "SDNN"), null)
  assert.equal(trendPoints(loadVitals().records, "HRV", "2026-10-08", 7), null)
  const outside = saveVital(draft({ observedOn: "2026-09-08", value: 33 }), "old", "2026-09-08T07:00:00.000Z")
  assert.equal(outside.ok, true)
  assert.equal(trendPoints(loadVitals().records, "HRV", "2026-10-08", 30, "RMSSD")?.some((item) => item.id === "old"), false)
  const sleep = saveVital(draft({ kind: "SLEEP", value: 7.26, hrvMethod: null, source: "IMAGE_CONFIRMED", observedAt: "" }), "sleep", "2026-10-08T06:00:00.000Z")
  assert.equal(sleep.ok, true)
  assert.equal(loadVitals().records.find((item) => item.id === "sleep")?.value, 7.3)
  assert.equal(loadVitals().records.find((item) => item.id === "sleep")?.observedAt, null)
  assert.equal(removeVital("a").ok, true)
  assert.equal(loadVitals().records.some((item) => item.id === "a"), false)
  assert.equal(loadVitals().records.some((item) => item.id === "b"), true)
  assert.equal(box.getItem("fr255-body-v1"), "[{\"weight\":70}]")
  assert.equal(box.getItem("fr255-food-log-v1"), "[{\"kcal\":174}]")
  assert.equal(box.getItem("fr255-day-v1"), "{\"burn\":1}")
  assert.equal(box.getItem(EVENTS_KEY), "{\"data\":[]}")
  const backup = collectLocalBackup(box, "2026-10-08T00:00:00.000Z")
  assert.match(backup, /fr255-vitals-v1/)
  const next = memory()
  next.setItem("fr255-body-v1", "keep")
  assert.equal(restoreLocalBackup(backup, next).ok, true)
  setStoreBackend(next)
  assert.equal(loadVitals().records.length, 5)
  assert.equal(next.getItem("fr255-body-v1")?.includes("70"), true)
  setStoreBackend(null)
})

test("unreadable vitals are not overwritten", () => {
  const box = memory()
  setStoreBackend(box)
  box.setItem(VITALS_KEY, "{")
  assert.equal(loadVitals().unreadable, true)
  assert.equal(saveVital(draft()).ok, false)
  assert.equal(box.getItem(VITALS_KEY), "{")
  setStoreBackend(null)
})
