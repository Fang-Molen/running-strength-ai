import assert from "node:assert/strict"
import test from "node:test"
import { requestTrainingModel, type TrainingModelTrace } from "./training-model.ts"

const args = { kind: "REVIEW" as const, apiKey: "TEST-NOT-A-REAL-KEY", model: "grok-4.5", name: "test", schema: { type: "object" }, system: "PRIVATE-SYSTEM", content: "PRIVATE-TRAINING", maxTokens: 700, waitMs: 45_000 }
function stream(content: string, finish: string | null = "stop", done = true) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n${done ? "data: [DONE]\n\n" : ""}`, { headers: { "content-type": "text/event-stream" } })
}

test("training transport requests strict low-effort SSE once and traces only stage metadata", async () => {
  const traces: TrainingModelTrace[] = []
  let count = 0
  const result = await requestTrainingModel(args, { trace: (event) => traces.push(event), fetch: async (_url, init) => {
    count += 1
    const body = JSON.parse(String(init?.body))
    assert.equal(body.reasoning_effort, "low")
    assert.equal(body.stream, true)
    assert.equal(body.stream_options.include_usage, true)
    assert.equal(body.max_tokens, 700)
    assert.equal(body.response_format.json_schema.strict, true)
    assert.ok(init?.signal)
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"facts":[]}' }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 1 } } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  assert.deepEqual(result, { ok: true, value: { facts: [] } })
  assert.equal(count, 1)
  assert.deepEqual(traces.map((event) => event.stage), ["fetch", "headers", "first-content", "complete"])
  assert.equal(traces.at(-1)?.promptTokens, 11)
  assert.equal(traces.at(-1)?.completionTokens, 4)
  assert.equal(traces.at(-1)?.reasoningTokens, 1)
  assert.deepEqual(traces.at(-1)?.deltaKeys, ["content"])
  assert.equal(/PRIVATE|TEST-NOT-A-REAL-KEY/.test(JSON.stringify(traces)), false)
})

test("partial stream, token limit, DONE without stop and invalid JSON are never adopted or retried", async () => {
  for (const [content, finish, done, failureClass] of [
    ['{"partial":', null, false, "NOT_STOP"],
    ["{}", "length", true, "LENGTH"],
    ["{}", null, true, "NOT_STOP"],
    ["not-json", "stop", true, "BAD_JSON"],
  ] as const) {
    let count = 0
    const traces: TrainingModelTrace[] = []
    const result = await requestTrainingModel(args, { trace: (event) => traces.push(event), fetch: async () => { count += 1; return stream(content, finish, done) } })
    assert.deepEqual(result, { ok: false, reason: "INVALID_OUTPUT" })
    assert.equal(count, 1)
    assert.equal(traces.filter((event) => event.stage === "failed").length, 1)
    assert.equal(traces.at(-1)?.failureClass, failureClass)
  }
})

test("reasoning SSE above the frozen 64KB coach cap is adopted only inside the training byte cap", async () => {
  const reasoning = "x".repeat(80_000)
  const accepted = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":1}' }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`
  const ok = await requestTrainingModel(args, { fetch: async () => new Response(accepted, { headers: { "content-type": "text/event-stream" } }) })
  assert.deepEqual(ok, { ok: true, value: { ok: 1 } })
  const oversized = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "y".repeat(1_100_000) } }] })}\n\n`
  const traces: TrainingModelTrace[] = []
  const rejected = await requestTrainingModel(args, { trace: (event) => traces.push(event), fetch: async () => new Response(oversized, { headers: { "content-type": "text/event-stream" } }) })
  assert.deepEqual(rejected, { ok: false, reason: "INVALID_OUTPUT" })
  assert.equal(traces.at(-1)?.failureClass, "STREAM_TOO_LARGE")
  assert.equal(JSON.stringify(traces).includes("yyyy"), false)
})

test("timeout, upstream rejection and network interruption remain distinct", async () => {
  assert.deepEqual(await requestTrainingModel(args, { fetch: async () => { throw new DOMException("test", "TimeoutError") } }), { ok: false, reason: "TIMEOUT" })
  assert.deepEqual(await requestTrainingModel(args, { fetch: async () => { throw new Error("connection reset") } }), { ok: false, reason: "NETWORK" })
  assert.deepEqual(await requestTrainingModel(args, { fetch: async () => new Response("private upstream body", { status: 429 }) }), { ok: false, reason: "UPSTREAM" })
})
