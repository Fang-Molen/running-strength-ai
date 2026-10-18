/**
 * OpenAI-compatible chat-completions adapter for isolated evaluation only.
 * The key is read from the env var NAMED by FANGKUN_EVAL_KEY_ENV; it is never
 * logged, returned or written. Response headers are not stored (they can carry
 * account identifiers); only status, model, usage and body text are kept.
 */
export type AdapterRequest = {
  model: string
  messages: { role: "system" | "user"; content: string }[]
  temperature: number
  max_tokens: number
  response_format?: unknown
  reasoning_effort?: string
}
export type AdapterResult = {
  status: number
  ok: boolean
  bodyText: string
  elapsedMs: number
  startedAt: string
  endedAt: string
  error: string | null
}

export async function callOpenAICompatible(baseUrl: string, keyEnvName: string, req: AdapterRequest, timeoutMs = 60000): Promise<AdapterResult> {
  const key = process.env[keyEnvName]
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  if (!key) return { status: 0, ok: false, bodyText: "", elapsedMs: 0, startedAt, endedAt: startedAt, error: "NO_KEY" }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(req),
    })
    const bodyText = await res.text()
    return { status: res.status, ok: res.ok, bodyText: bodyText.split(key).join("[REDACTED]"), elapsedMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString(), error: null }
  } catch (error) {
    return { status: 0, ok: false, bodyText: "", elapsedMs: Date.now() - t0, startedAt, endedAt: new Date().toISOString(), error: error instanceof Error ? `${error.name}:${(error.cause as { code?: string } | undefined)?.code ?? ""}` : "unknown" }
  }
}
