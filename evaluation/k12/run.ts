/**
 * K12/K14 isolated evaluation runner.
 * Pipeline: synthetic facts -> normalizeAskCoachInput (server boundary) ->
 * buildCoachModelRequest (same packet, retrieval and system prompt as askCoach) ->
 * eval gate + OpenAI-compatible adapter (NOT the product transport) ->
 * interpretCoachModelOutput (same guards as askCoach).
 * Entry label: EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT (product pipeline code, different provider/model/transport).
 */
import { createHash } from "node:crypto"
import { appendFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { execSync } from "node:child_process"
import { buildCoachModelRequest, COACH_RESPONSE_FORMAT, interpretCoachModelOutput, normalizeAskCoachInput } from "@/lib/strength/coach-pipeline"
import { buildParts, type FactSpec } from "./fixtures.ts"
import { deriveCoachBrief } from "@/lib/core/coach-brief"
import { withEvalCall } from "./eval-gate.ts"
import { callOpenAICompatible } from "./adapter.ts"

type Scenario = { id: string; category: string; question: string; history?: { role: "user" | "coach"; text: string }[]; facts: FactSpec }

const arg = (name: string, fallback = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const scenariosPath = arg("scenarios"); const outPath = arg("out"); const batch = arg("batch", "K12")
const only = arg("ids") ? arg("ids").split(",") : null
const ledger = process.env.FANGKUN_EVAL_LEDGER ?? "/workspace/fangkun-k12/ledger/calls.jsonl"
const baseUrl = process.env.FANGKUN_EVAL_BASE_URL ?? ""
const keyEnv = process.env.FANGKUN_EVAL_KEY_ENV ?? ""
const models = (process.env.FANGKUN_EVAL_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean)
const reasoningEffort = process.env.FANGKUN_EVAL_REASONING_EFFORT || undefined
const extraTokens = Number(process.env.FANGKUN_EVAL_EXTRA_TOKENS ?? 0) || 0
const providerLabel = process.env.FANGKUN_EVAL_PROVIDER_LABEL ?? "Google Gemini API (OpenAI-compatible endpoint)"
const costNote = process.env.FANGKUN_EVAL_COST_NOTE ?? "0 expected (free tier key per user; billing status not verifiable via API)"
const pauseMs = Number(process.env.FANGKUN_EVAL_PAUSE_MS ?? 6000)
const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let sourceRev = "unknown"
try { sourceRev = execSync("git rev-parse HEAD", { cwd: new URL("../..", import.meta.url).pathname }).toString().trim() + (execSync("git status --porcelain", { cwd: new URL("../..", import.meta.url).pathname }).toString().trim() ? "+dirty" : "") } catch { /* no git */ }

const scenarios = (JSON.parse(readFileSync(scenariosPath, "utf8")) as Scenario[]).filter((s) => !only || only.includes(s.id))
mkdirSync(dirname(outPath), { recursive: true })
for (const [index, s] of scenarios.entries()) {
  const parts = buildParts(s.question, s.facts)
  const data = normalizeAskCoachInput({ brief: deriveCoachBrief(parts), history: s.history ?? [] })
  const request = buildCoachModelRequest(data)
  const kc = request.knowledgeContext
  const retrieved = {
    lessons: kc.lessons.map((l) => l.id), references: kc.references.map((r) => r.id), pendingResearch: kc.pendingResearch.map((p) => p.id),
    researchEvidence: kc.researchEvidence.entries.map((e) => e.id), methodology: kc.methodology.entries.map((e: { id: string }) => e.id),
    conflictReviews: kc.conflictReviews.entries.map((e: { id: string }) => e.id), syntheticExample: kc.syntheticExample?.id ?? null, truncated: kc.truncated,
  }
  const attempts: unknown[] = []
  let final: { model: string; status: number; bodyText: string; startedAt: string; endedAt: string; elapsedMs: number; retry: boolean; payload: unknown } | null = null
  let blocked: string | null = null
  for (const [attemptIndex, model] of models.slice(0, 2).entries()) {
    const payload = { model, temperature: 0.2, max_tokens: request.maxTokens + extraTokens, response_format: COACH_RESPONSE_FORMAT, messages: request.messages, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
    const result = await withEvalCall(process.env, ledger, { batch, caseId: s.id, model, attempt: attemptIndex + 1 }, () => callOpenAICompatible(baseUrl, keyEnv, payload))
    if (!result.ok) { blocked = result.reason; break }
    const r = result.value
    attempts.push({ model, status: r.status, error: r.error, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: r.elapsedMs, bodyPreview: r.ok ? null : r.bodyText.slice(0, 600) })
    if (r.ok) { final = { model, status: r.status, bodyText: r.bodyText, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: r.elapsedMs, retry: attemptIndex > 0, payload }; break }
    if (![0, 429, 500, 502, 503, 504].includes(r.status)) break
    await sleep(4000)
  }
  let content: string | null = null, finish: string | null = null, usage: unknown = null, returnedModel: string | null = null, bodyJson: unknown = null
  if (final) {
    try { bodyJson = JSON.parse(final.bodyText); const b = bodyJson as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown; model?: string }; content = b.choices?.[0]?.message?.content ?? null; finish = b.choices?.[0]?.finish_reason ?? null; usage = b.usage ?? null; returnedModel = b.model ?? null } catch { content = null }
  }
  const guarded = content != null ? interpretCoachModelOutput(data, content) : null
  const payloadForRecord = final?.payload ?? { model: models[0], temperature: 0.2, max_tokens: request.maxTokens + extraTokens, response_format: COACH_RESPONSE_FORMAT, messages: request.messages, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) }
  const payloadText = JSON.stringify(payloadForRecord)
  const snapshot = JSON.stringify(s.facts)
  const record = {
    case_id: s.id, batch, category: s.category, question: s.question, history: s.history ?? [],
    data_snapshot: s.facts, data_snapshot_sha256: sha(snapshot),
    server_brief_sha256: sha(JSON.stringify(data.brief)), brief_constraints: data.brief.constraints, brief_mustAsk: data.brief.mustAsk,
    return_state: data.brief.returnToTraining?.state ?? null, next_session: data.brief.nextSession ? { status: data.brief.nextSession.status, allowed: data.brief.nextSession.allowed, increaseSupported: data.brief.nextSession.increaseSupported } : null,
    kind: request.kind, intent: request.intent, product_max_tokens: request.maxTokens,
    retrieved, payload: payloadForRecord, payload_sha256: sha(payloadText),
    entry: "EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT", pipeline: "coach-pipeline.ts (askCoach request+guard code), eval adapter transport", source_revision: sourceRev,
    provider: providerLabel, base_url: baseUrl, model_requested: final?.model ?? models[0] ?? null, model_returned: returnedModel,
    params: { temperature: 0.2, max_tokens: request.maxTokens + extraTokens, product_max_tokens: request.maxTokens, stream: false, response_format: "json_schema coach_answer (product schema)", reasoning_effort: reasoningEffort ?? null },
    started_at: final?.startedAt ?? null, ended_at: final?.endedAt ?? null, elapsed_ms: final?.elapsedMs ?? null, retry: final?.retry ?? false, attempts,
    raw_response_body: final?.bodyText ?? null, raw_response: content, finish_reason: finish, usage,
    cost: { billed_usd: final ? costNote : 0, evidence: usage },
    guard: guarded ? { mode: guarded.turn.mode, code: guarded.code, subcode: guarded.subcode, text: guarded.turn.text, nextStep: guarded.turn.nextStep, citations: guarded.turn.citations, medicalReferral: guarded.turn.medicalReferral } : null,
    status: final && content != null ? "REAL_MODEL_RESPONSE" : "NO_REAL_MODEL_RESPONSE", blocked_reason: blocked,
    scorer: null,
  }
  appendFileSync(outPath, JSON.stringify(record) + "\n")
  console.log(`[${index + 1}/${scenarios.length}] ${s.id} ${record.status} model=${record.model_requested} retry=${record.retry} finish=${finish} guard=${record.guard?.code ?? "-"} ${blocked ?? ""}`)
  if (blocked === "CALL_CAP_REACHED" || blocked === "EVAL_DISABLED") break
  if (index < scenarios.length - 1) await sleep(pauseMs)
}
