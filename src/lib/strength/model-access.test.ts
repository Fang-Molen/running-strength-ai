import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { beginModelCall, decideModelAccess, invokeModelIfAllowed, type ModelAccessInput } from "./model-access.ts"

const allowed: ModelAccessInput = {
  callsEnabled: true,
  authConfigured: true,
  user: { id: "user-1", email: "coach@example.com" },
  allowUserIds: ["user-1"],
  allowEmails: [],
  quotaStore: "neon",
  quota: { used: 0, limit: 2, inFlight: 0, maxInFlight: 1 },
}

test("model access fails closed before any model call", async () => {
  const cases: [ModelAccessInput, string][] = [
    [{ ...allowed, callsEnabled: false }, "CALLS_DISABLED"],
    [{ ...allowed, authConfigured: false }, "AUTH_NOT_CONFIGURED"],
    [{ ...allowed, user: null }, "UNAUTHENTICATED"],
    [{ ...allowed, user: { id: "dev-user", email: "dev@example.com" } }, "UNAUTHENTICATED"],
    [{ ...allowed, allowUserIds: [], allowEmails: [] }, "NOT_ALLOWLISTED"],
    [{ ...allowed, allowUserIds: ["other"], allowEmails: [] }, "NOT_ALLOWLISTED"],
    [{ ...allowed, allowUserIds: [], allowEmails: ["coach@example.com"] }, "ok"],
    [{ ...allowed, quotaStore: "missing" }, "QUOTA_STORE_UNAVAILABLE"],
    [{ ...allowed, quota: null }, "QUOTA_STORE_UNAVAILABLE"],
    [{ ...allowed, quota: { used: 2, limit: 2, inFlight: 0, maxInFlight: 1 } }, "QUOTA_EXCEEDED"],
    [{ ...allowed, quota: { used: 0, limit: 2, inFlight: 1, maxInFlight: 1 } }, "CONCURRENCY_EXCEEDED"],
  ]
  for (const [input, reason] of cases) {
    let called = 0
    const result = await invokeModelIfAllowed(decideModelAccess(input), async () => {
      called += 1
      return "spent"
    })
    if (reason === "ok") {
      assert.equal(result.ok, true)
      assert.equal(called, 1)
    } else {
      assert.deepEqual(result, { ok: false, reason })
      assert.equal(called, 0)
    }
  }
})

test("the live gate stays closed and does not touch the network", async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error("model network is not allowed in this test")
  }
  try {
    assert.deepEqual(await beginModelCall(), { ok: false, reason: "CALLS_DISABLED" })
    assert.equal(calls, 0)
    assert.equal(process.env.AI_MODEL_CALLS_ENABLED, undefined)
    assert.equal(process.env.DATABASE_URL, undefined)
  } finally {
    globalThis.fetch = original
  }
})

test("all five model handlers consult the gate before the key or the network", () => {
  const source = ["src/lib/strength/coach-ai.ts", "src/lib/strength/training-import-ai.ts", "src/lib/strength/coach-plan-ai.ts"].map((file) => readFileSync(file, "utf8")).join("\n")
  for (const name of ["explainCoach", "askCoach", "extractTrainingImport", "reviewTrainingImport", "generateCoachPlan"]) {
    const start = source.indexOf(`export const ${name} = createServerFn`)
    assert.notEqual(start, -1, name)
    const next = source.indexOf("export const ", start + 20)
    const body = source.slice(start, next === -1 ? source.length : next)
    const gate = body.indexOf("beginModelCall")
    const key = body.indexOf("XAI_API_KEY")
    assert.equal(gate > 0 && key > gate, true, name)
  }
})
