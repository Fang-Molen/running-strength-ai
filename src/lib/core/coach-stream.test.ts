import assert from "node:assert/strict"
import test from "node:test"
import { consumeCoachEventStream } from "./coach-stream.ts"

function response(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), { headers: { "content-type": "text/event-stream" } })
}

test("coach SSE joins split structured output and reports the first content once", async () => {
  let first = 0
  const result = await consumeCoachEventStream(response([
    "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"mode\\\":\\\"ans\"}}]}\r\n\r\n",
    "data: {\"choices\":[{\"delta\":{\"content\":\"wer\\\"}\"},\"finish_reason\":null}]}\n\n",
    "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DO",
    "NE]\n\n",
  ]), () => { first += 1 })
  assert.equal(result.content, "{\"mode\":\"answer\"}")
  assert.equal(result.completed, true)
  assert.equal(result.finishReason, "stop")
  assert.equal(first, 1)
  assert.equal(result.bytes > result.content.length, true)
})

test("coach SSE accepts a complete stop event even if the transport omits DONE", async () => {
  const result = await consumeCoachEventStream(response([
    "data: {\"choices\":[{\"delta\":{\"content\":\"{}\"},\"finish_reason\":\"stop\"}]}\n\n",
  ]))
  assert.equal(result.completed, true)
  assert.equal(result.content, "{}")
})

test("coach SSE never marks a partial connection close as complete", async () => {
  const result = await consumeCoachEventStream(response([
    "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"mode\\\":\"},\"finish_reason\":null}]}\n\n",
  ]))
  assert.equal(result.completed, false)
})

test("coach SSE rejects a token-limit finish even when DONE arrives", async () => {
  const result = await consumeCoachEventStream(response([
    "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"mode\\\":\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n",
  ]))
  assert.equal(result.completed, false)
  assert.equal(result.finishReason, "length")
  assert.equal(result.sawDone, true)
  assert.equal(result.reasoningChars, 0)
  assert.deepEqual(result.deltaKeys, ["content"])
  assert.ok(result.contentChars > 0)
  assert.ok(result.bytes > result.contentChars)
})

test("coach SSE rejects malformed upstream events", async () => {
  await assert.rejects(() => consumeCoachEventStream(response(["data: not-json\n\n"])), /invalid coach SSE event/)
})
