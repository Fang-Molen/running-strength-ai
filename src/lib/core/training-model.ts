import { consumeCoachEventStream } from "./coach-stream.ts"

export type TrainingModelFailure = "TIMEOUT" | "NETWORK" | "UPSTREAM" | "INVALID_OUTPUT"
export type TrainingStreamFailureClass = "TIMEOUT" | "STREAM_TOO_LARGE" | "CONTENT_TOO_LARGE" | "BAD_SSE" | "UPSTREAM_STREAM" | "NO_BODY" | "BAD_JSON" | "LENGTH" | "NOT_STOP" | "OTHER"
export type TrainingModelTrace = {
  kind: "EXTRACT" | "REVIEW" | "PLAN"
  stage: "fetch" | "headers" | "first-content" | "complete" | "failed"
  elapsedMs: number
  maxTokens: number
  waitMs: number
  packetChars: number
  status?: number
  bytes?: number
  contentChars?: number
  reasoningChars?: number
  sawDone?: boolean
  deltaKeys?: string[]
  promptTokens?: number | null
  completionTokens?: number | null
  reasoningTokens?: number | null
  finishReason?: string | null
  reason?: TrainingModelFailure
  failureClass?: TrainingStreamFailureClass
}

// Frozen coach calls keep the 64KB stream default. This path requires reasoning_effort=low;
// reasoning_content SSE can exceed 64KB before a small JSON body finishes. Content stays capped at 16KB.
const TRAINING_STREAM_BYTES = 1024 * 1024

// No prompt, record, image, key or response text may be included in traces.
export async function requestTrainingModel(args: {
  kind: TrainingModelTrace["kind"]
  apiKey: string
  model: string
  name: string
  schema: Record<string, unknown>
  system: string
  content: unknown
  maxTokens: number
  waitMs: number
}, dependencies: { fetch?: typeof fetch; trace?: (event: TrainingModelTrace) => void } = {}): Promise<{ ok: true; value: unknown } | { ok: false; reason: TrainingModelFailure }> {
  const started = Date.now()
  const packetChars = JSON.stringify(args.content).length
  let status: number | undefined
  const emit = (stage: TrainingModelTrace["stage"], extra: Partial<TrainingModelTrace> = {}) => dependencies.trace?.({ kind: args.kind, stage, elapsedMs: Date.now() - started, maxTokens: args.maxTokens, waitMs: args.waitMs, packetChars, ...extra })
  const failed = (reason: TrainingModelFailure, failureClass?: TrainingStreamFailureClass, extra: Partial<TrainingModelTrace> = {}) => {
    emit("failed", { status, reason, failureClass, ...extra })
    return { ok: false as const, reason }
  }
  try {
    emit("fetch")
    const response = await (dependencies.fetch ?? fetch)("https://api.x.ai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(args.waitMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({ model: args.model, temperature: 0, reasoning_effort: "low", max_tokens: args.maxTokens, stream: true,
        stream_options: { include_usage: true },
        response_format: { type: "json_schema", json_schema: { name: args.name, strict: true, schema: args.schema } },
        messages: [{ role: "system", content: args.system }, { role: "user", content: args.content }],
      }),
    })
    status = response.status
    emit("headers", { status })
    if (!response.ok) {
      await response.body?.cancel()
      return failed("UPSTREAM")
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel()
      return failed("INVALID_OUTPUT")
    }
    const result = await consumeCoachEventStream(response, () => emit("first-content", { status }), TRAINING_STREAM_BYTES)
    const measured = {
      bytes: result.bytes,
      contentChars: result.contentChars,
      reasoningChars: result.reasoningChars,
      sawDone: result.sawDone,
      finishReason: result.finishReason,
      deltaKeys: result.deltaKeys,
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      reasoningTokens: result.usage?.reasoningTokens ?? null,
    }
    emit("complete", { status, ...measured })
    if (!result.completed || result.finishReason !== "stop") return failed("INVALID_OUTPUT", result.finishReason === "length" ? "LENGTH" : "NOT_STOP", measured)
    let value: unknown
    try { value = JSON.parse(result.content) } catch { return failed("INVALID_OUTPUT", "BAD_JSON") }
    if (!value || typeof value !== "object" || Array.isArray(value)) return failed("INVALID_OUTPUT", "BAD_JSON")
    return { ok: true, value }
  } catch (error) {
    const detail = error instanceof Error ? error.message : ""
    if (error instanceof Error && error.name === "TimeoutError") return failed("TIMEOUT", "TIMEOUT")
    if (detail.includes("coach stream content too large")) return failed("INVALID_OUTPUT", "CONTENT_TOO_LARGE")
    if (detail.includes("coach stream too large")) return failed("INVALID_OUTPUT", "STREAM_TOO_LARGE")
    if (detail.includes("invalid coach SSE")) return failed("INVALID_OUTPUT", "BAD_SSE")
    if (detail.includes("xAI stream error")) return failed("INVALID_OUTPUT", "UPSTREAM_STREAM")
    if (detail.includes("coach stream has no body")) return failed("INVALID_OUTPUT", "NO_BODY")
    return failed("NETWORK", "OTHER")
  }
}
