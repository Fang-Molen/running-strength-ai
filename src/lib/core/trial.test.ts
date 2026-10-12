import assert from "node:assert/strict"
import test from "node:test"
import { collectLocalBackup, restoreLocalBackup, trialReviewClosed } from "./trial.ts"

const open = { pain: { status: "ABSENT", value: null }, sessionRpe: { status: "RECORDED", value: 6 }, subjectiveRecovery: { status: "RECORDED" } }

test("pain with high RPE and missing recovery stays closed in the trial", () => {
  const closed = trialReviewClosed({
    pain: { status: "RECORDED", value: { location: "左膝", intensity: 4 } },
    sessionRpe: { status: "RECORDED", value: 9 },
    subjectiveRecovery: { status: "ABSENT" },
  })
  assert.match(closed ?? "", /暂不开放/)
  assert.match(closed ?? "", /不会据此加量/)
  assert.equal(trialReviewClosed({ ...open, pain: { status: "RECORDED", value: { location: "大腿", intensity: 3 } } }), null)
  assert.equal(trialReviewClosed({ ...open, sessionRpe: { status: "RECORDED", value: 9 }, subjectiveRecovery: { status: "ABSENT" } }), null)
})

test("backup restores listed keys and does not delete anything else", () => {
  const memory = new Map<string, string>([["fr255-events-v1", "old"], ["fr255-keep", "stay"], ["other", "no"]])
  const storage = {
    get length() { return memory.size },
    key: (index: number) => [...memory.keys()][index] ?? null,
    keys:()=>[...memory.keys()], getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
  }
  const file = collectLocalBackup(storage, "2026-10-09T00:00:00.000Z")
  assert.equal(file.includes("other"), false)
  memory.set("fr255-events-v1", "changed")
  memory.set("fr255-extra", "left-alone")
  const restored = restoreLocalBackup(file, storage)
  assert.equal(restored.ok, true)
  assert.equal(memory.get("fr255-events-v1"), "old")
  assert.equal(memory.get("fr255-extra"), "left-alone")
  assert.equal(memory.get("fr255-keep"), "stay")
  assert.equal(memory.get("other"), "no")
  assert.equal(restoreLocalBackup("{}", storage).ok, false)
  memory.set("fr255-events-v1", "before-failure")
  let writes = 0
  let rollingBack = false
  const failing = {
    ...storage,
    setItem: (key: string, value: string) => {
      if (!rollingBack) {
        writes += 1
        if (writes > 1) {
          rollingBack = true
          throw new Error("quota")
        }
      }
      memory.set(key, value)
    },
    removeItem: (key: string) => { memory.delete(key) },
  }
  const failed = restoreLocalBackup(file, failing)
  assert.equal(failed.ok, false)
  assert.match(failed.ok ? "" : failed.reason, /原有记录还在/)
  assert.equal(memory.get("fr255-events-v1"), "before-failure")
})
