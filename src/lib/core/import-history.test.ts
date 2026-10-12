import assert from "node:assert/strict"
import test from "node:test"
import { readConfirmedPerformances } from "./import-history.ts"
import { confirmTrainingImport, createTrainingImportDraft } from "./training-import.ts"
import { deriveAthleteState } from "./state.ts"
import { evaluateTrainingReadiness, generateTrainingAdjustment, readTrainingContext } from "./training-decision.ts"
import { setStoreBackend, type MemoryStore } from "./storage.ts"
import { freshMemory, recordedCoachFatigue } from "@/lib/strength/coach"

function memory(): MemoryStore {
  const data = new Map<string, string>()
  return { keys:()=>[...data.keys()], getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const recorded = <T>(value: T) => ({ value, status: "RECORDED" as const, sourceIds: ["text"] })
const absent = { value: null, status: "ABSENT" as const, sourceIds: [] as string[] }

function draft(id: string, at: string, meters: number, seconds: number) {
  const created = createTrainingImportDraft({
    sport: "RUNNING",
    occurredAt: recorded(at),
    title: recorded(id),
    durationSeconds: recorded(seconds),
    totalDistanceMeters: recorded(meters),
    runningStructure: "CONTINUOUS",
    runningSegments: [{
      id: "r1",
      kind: "CONTINUOUS",
      round: absent,
      repeat: absent,
      distanceMeters: recorded(meters),
      durationSeconds: recorded(seconds),
      recoverySeconds: absent,
      completion: "COMPLETED",
      sourceIds: ["text"],
    }],
    strengthSets: [],
    sessionRpe: absent,
    subjectiveRecovery: absent,
    sleepHours: absent,
    pain: absent,
    soreness: absent,
    uncertainFields: [],
    conflicts: [],
    warnings: [],
  }, "TEXT", ["text"])
  created.draftId = id
  return created
}

const planned = { name: "深蹲", sets: 4, amount: 8, weightKg: 60, mode: "reps" as const }

test("an empty coach does not turn fatigue 20 or pain false into a normal state", () => {
  assert.equal(recordedCoachFatigue(freshMemory()), null)
  const store = memory()
  setStoreBackend(store)
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true })
  const athlete = deriveAthleteState()
  assert.equal(athlete.recovery.fatigueScore, null)
  assert.equal(athlete.recovery.recoveryStatus, "未知")
  assert.equal(athlete.recovery.pain, false)
  assert.equal(athlete.uncertainty.missingData.some((item) => item.includes("疼痛未记录")), true)
  const ctx = readTrainingContext(null)
  assert.equal(ctx.fatigue, null)
  assert.equal(evaluateTrainingReadiness(ctx), "UNKNOWN")
  const decision = generateTrainingAdjustment(ctx, planned)
  assert.equal(decision.readiness, "UNKNOWN")
  assert.equal(decision.change, "none")
  assert.equal(decision.evidence.some((item) => item.startsWith("疲劳")), false)
  setStoreBackend(null)
})

test("confirmed performances stay out of the evidence reader until after they happened", () => {
  const store = memory()
  setStoreBackend(store)
  const earlier = confirmTrainingImport(draft("hist-early", "2026-04-06T12:00:00+08:00", 6000, 1818))
  const race = confirmTrainingImport(draft("hist-race", "2026-04-22T12:00:00+08:00", 800, 113.3))
  assert.equal(earlier.ok, true)
  assert.equal(race.ok, true)
  const beforeRace = readConfirmedPerformances("2026-04-22T00:00:00+08:00")
  assert.deepEqual(beforeRace.map((item) => item.draftId), ["hist-early"])
  assert.equal(beforeRace.some((item) => item.durationSeconds === 113.3), false)
  const afterRace = readConfirmedPerformances("2026-04-23T00:00:00+08:00")
  assert.deepEqual(afterRace.map((item) => item.draftId), ["hist-early", "hist-race"])
  const ctx = readTrainingContext(null)
  assert.equal(ctx.recentRunKm, null)
  assert.equal(ctx.snapshot?.recentRuns.length, 0)
  setStoreBackend(null)
})
