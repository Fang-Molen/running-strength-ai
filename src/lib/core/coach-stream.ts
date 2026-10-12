export function safeResponseHeaders(response: Response): { status: number; contentType: string | null; requestId: string | null } {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    requestId: response.headers.get("x-request-id") ?? response.headers.get("x-xai-request-id"),
  }
}

export function safeUpstreamError(raw: string): { code: string | null; message: string | null } {
  const clean = (value: string) => value.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+|bearer\s+\S+|sk-[a-z0-9]+/gi, "[redacted]").slice(0, 300)
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown; code?: unknown; type?: unknown } | string; code?: unknown }
    const error = parsed?.error
    if (typeof error === "string") return { code: typeof parsed.code === "string" ? parsed.code : null, message: clean(error) }
    if (error && typeof error === "object") {
      const code = typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : null
      return { code, message: typeof error.message === "string" ? clean(error.message) : null }
    }
  } catch { /* non-json upstream body is not logged */ }
  return { code: null, message: null }
}

export type CoachStreamUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type CoachStreamResult = {
  content: string
  bytes: number
  completed: boolean
  finishReason: string | null
  sawDone: boolean
  contentChars: number
  reasoningChars: number
  usage: CoachStreamUsage | null
  deltaKeys: string[]
}

type StreamChunk = {
  error?: unknown
  usage?: unknown
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[]
}

const MAX_STREAM_BYTES = 64 * 1024
const MAX_CONTENT_CHARS = 16 * 1024

export async function consumeCoachEventStream(response: Response, onFirstContent?: () => void, maxBytes = MAX_STREAM_BYTES): Promise<CoachStreamResult> {
  if (!response.body) throw new Error("coach stream has no body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventLines: string[] = []
  let content = ""
  let bytes = 0
  let done = false
  let firstContent = false
  let finishReason: string | null = null
  let reasoningChars = 0
  let usage: CoachStreamUsage | null = null
  const deltaKeys = new Set<string>()

  const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null
  const readUsage = (raw: unknown): CoachStreamUsage | null => {
    if (!raw || typeof raw !== "object") return null
    const item = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; reasoning_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } }
    const reasoningTokens = numberOrNull(item.completion_tokens_details?.reasoning_tokens) ?? numberOrNull(item.reasoning_tokens)
    const next = { promptTokens: numberOrNull(item.prompt_tokens), completionTokens: numberOrNull(item.completion_tokens), totalTokens: numberOrNull(item.total_tokens), reasoningTokens }
    return next.promptTokens == null && next.completionTokens == null && next.totalTokens == null && next.reasoningTokens == null ? null : next
  }

  const flushEvent = () => {
    if (eventLines.length === 0) return
    const data = eventLines.join("\n")
    eventLines = []
    if (data === "[DONE]") {
      done = true
      return
    }
    let parsed: StreamChunk
    try {
      parsed = JSON.parse(data) as StreamChunk
    } catch {
      throw new Error("invalid coach SSE event")
    }
    if (parsed.error != null) throw new Error("xAI stream error")
    const nextUsage = readUsage(parsed.usage)
    if (nextUsage) usage = nextUsage
    for (const choice of parsed.choices ?? []) {
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason
      if (choice.delta && typeof choice.delta === "object") for (const key of Object.keys(choice.delta)) deltaKeys.add(key)
      const reasoning = choice.delta?.reasoning_content
      if (typeof reasoning === "string") reasoningChars += reasoning.length
      const delta = choice.delta?.content
      if (typeof delta !== "string" || delta.length === 0) continue
      content += delta
      if (content.length > MAX_CONTENT_CHARS) throw new Error("coach stream content too large")
      if (!firstContent) {
        firstContent = true
        onFirstContent?.()
      }
    }
  }

  const consumeLines = (final: boolean) => {
    while (true) {
      const index = buffer.indexOf("\n")
      if (index < 0) break
      const line = buffer.slice(0, index).replace(/\r$/, "")
      buffer = buffer.slice(index + 1)
      if (line === "") flushEvent()
      else if (line.startsWith("data:")) eventLines.push(line.slice(5).replace(/^ /, ""))
    }
    if (!final) return
    const line = buffer.replace(/\r$/, "")
    buffer = ""
    if (line.startsWith("data:")) eventLines.push(line.slice(5).replace(/^ /, ""))
    flushEvent()
  }

  while (!done) {
    const item = await reader.read()
    if (item.done) break
    bytes += item.value.byteLength
    if (bytes > maxBytes) throw new Error("coach stream too large")
    buffer += decoder.decode(item.value, { stream: true })
    consumeLines(false)
  }
  buffer += decoder.decode()
  consumeLines(true)
  return { content, bytes, completed: finishReason === "stop" || done && finishReason == null, finishReason, sawDone: done, contentChars: content.length, reasoningChars, usage, deltaKeys: [...deltaKeys].sort() }
}
