/**
 * R2 multi-round sealed evaluation. Per round: committed events/corrections with recordedAt<=asOf ->
 * buildFormalEvidenceRows (read-only) -> normalizeAskCoachInput (server boundary, V4 review recomputed) ->
 * buildCoachModelRequest -> eval gate + adapter -> interpretCoachModelOutput (production guard + V4 guard).
 * Entry label: EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT. Synthetic data only.
 */
import { createHash } from "node:crypto"
import { appendFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { buildCoachModelRequest, interpretCoachModelOutput, normalizeAskCoachInput } from "@/lib/strength/coach-pipeline"
import { deriveCoachBrief } from "@/lib/core/coach-brief"
import { buildFormalEvidenceRows, type CommittedEvent } from "@/lib/core/coach-v4-formal-rows"
import { buildParts, type FactSpec } from "../k12/fixtures.ts"
import { withEvalCall } from "../k12/eval-gate.ts"
import { callOpenAICompatible } from "../k12/adapter.ts"

const arg = (n: string, f = "") => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : f }
const ATH = "eval-athlete-r2"
const scen = JSON.parse(readFileSync(arg("scenarios"), "utf8")) as any[]
const out = arg("out"), only = arg("ids") ? arg("ids").split(",") : null, maxRounds = Number(arg("rounds", "99")), dry = arg("dry") === "1"
const ledger = process.env.FANGKUN_EVAL_LEDGER ?? "", baseUrl = process.env.FANGKUN_EVAL_BASE_URL ?? "", keyEnv = process.env.FANGKUN_EVAL_KEY_ENV ?? ""
const model = process.env.FANGKUN_EVAL_MODEL ?? "", pauseMs = Number(process.env.FANGKUN_EVAL_PAUSE_MS ?? 7000)
const sha = (s: string) => createHash("sha256").update(s).digest("hex"), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const vis = (rec: string | null | undefined, asOf: string) => rec != null && Date.parse(rec) <= Date.parse(asOf)
mkdirSync(dirname(out), { recursive: true })
let stop = false
// --reguard <jsonl>: re-apply the CURRENT guards to previously saved raw model outputs (no network); input must hash-match.
const reguard = arg("reguard") ? new Map(readFileSync(arg("reguard"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r: any) => [`${r.case_id}#${r.round}`, r])) : null
for (const s of scen.filter((x) => !only || only.includes(x.id))) {
  if (stop) break
  const history: { role: "user" | "coach"; text: string }[] = []
  for (const [ri, round] of s.rounds.slice(0, maxRounds).entries()) {
    const asOf: string = round.asOf
    // Only what had been committed by asOf is visible (legacy null-recordedAt events stay in, builder marks them unknown).
    const committed: CommittedEvent[] = s.events.filter((e: CommittedEvent) => e.recordedAt == null ? Date.parse(e.event.timestamp!) <= Date.parse(asOf) : vis(e.recordedAt, asOf))
    const corrections = s.corrections.filter((c: any) => c.recordedAt == null || vis(c.recordedAt, asOf))
    const ev = (id: string) => committed.find((e) => e.event.event_id === id)
    const running: Record<string, any> = {}
    for (const r of s.running) {
      if (!ev(r.occ)) continue
      running[r.occ] = { availability: "AVAILABLE", terminal: true, continuous: [], recoveries: [], repetitions: Array.from({ length: r.n }, (_, k) => {
        const e = ev(`run:${r.occ}:r${k + 1}`)
        return { trainingOccurrenceId: r.occ, runningSnapshotId: "rs", componentId: "c1", blockId: "b1", stepId: "s1", roundOrdinal: 1, repeatOrdinal: k + 1,
          status: !e ? "NOT_RECORDED" : e.event.event_type === "RUNNING_REPETITION_SKIPPED" ? "SKIPPED" : "COMPLETED", plannedDistanceMeters: 400, plannedDurationSeconds: r.goal,
          actualDistanceMeters: e ? 400 : null, actualDurationSeconds: (e?.event.payload?.actualDurationSeconds as number) ?? null, sourceEventIds: e ? [e.event.event_id] : [],
          derivedPaceSecPerMeter: null, paceDistanceSourceEventId: null, paceDurationSourceEventId: null }
      }) }
    }
    const formal = buildFormalEvidenceRows({ athleteId: ATH, asOf, committed, corrections, running })
    // Existing brief retrieval for the focused session (voided sessions contribute no facts, as excludeVoidedTrainingEvents does).
    const occ = round.focus, start = ev(occ)
    const voided = formal.rows.some((r) => r.trainingOccurrenceId === occ && r.status === "VOIDED")
    const one = (id: string) => { const e = ev(id); return e && e.event.athlete_id === ATH && !voided ? e : null }
    const val = (id: string, k: string) => (one(id)?.event.payload?.[k] as number | undefined)
    const multiRpe = committed.filter((e) => e.event.payload?.evidenceType === "SESSION_RPE" && e.event.payload?.trainingOccurrenceId === occ).length > 1
    const painE = one(`ev:${occ}:pain`)
    const spec: FactSpec = { occurrence: start ? { id: occ, startedAt: start.event.timestamp!, lifecycle: "COMPLETED" } : null,
      rpe: multiRpe ? undefined : val(`ev:${occ}:rpe`, "value"), sleep: val(`ev:${occ}:sleep`, "hours"),
      pain: painE ? { location: String(painE.event.payload?.location), intensity: Number(painE.event.payload?.intensity) } : undefined,
      running: voided || !running[occ] ? [] : running[occ].repetitions.map((r: any) => ({ kind: "REPETITION", position: `第${r.repeatOrdinal}组`, status: r.status, planned: `${r.plannedDurationSeconds}秒`, actual: r.actualDurationSeconds ? `${r.actualDurationSeconds}秒` : "未记录", id: r.sourceEventIds[0] ?? `run:${occ}:missing${r.repeatOrdinal}` })).filter((r: any) => r.status !== "NOT_RECORDED") }
    const prior: any = reguard?.get(`${s.id}#${ri + 1}`) ?? null
    const data = normalizeAskCoachInput({ brief: deriveCoachBrief(buildParts(round.question, spec)), history: prior ? prior.history_in : [...history], v4: { athleteId: ATH, asOf, rows: formal.rows, unknownCommitTime: formal.unknownCommitTime.length } })
    const request = buildCoachModelRequest(data)
    const payload = { model, temperature: 0.2, max_tokens: request.maxTokens + 1200, response_format: request.responseFormat, messages: request.messages }
    const attempts: any[] = []; let final: any = null, blocked: string | null = null
    if (prior && sha(JSON.stringify(payload)) !== prior.payload_sha256) throw new Error(`reguard input mismatch ${s.id}#${ri + 1}`)
    if (!dry && !prior) for (let a = 1; a <= 2; a++) {   // max 1 retry
      const res = await withEvalCall(process.env, ledger, { batch: "R2", caseId: `${s.id}#${ri + 1}`, model, attempt: a }, () => callOpenAICompatible(baseUrl, keyEnv, payload))
      if (!res.ok) { blocked = res.reason; break }
      const r = res.value
      attempts.push({ attempt: a, status: r.status, error: r.error, startedAt: r.startedAt, endedAt: r.endedAt, elapsedMs: r.elapsedMs, errorBody: r.ok ? null : r.bodyText.slice(0, 800) })
      if (r.ok) { final = r; break }
      if (![0, 429, 500, 502, 503, 504].includes(r.status)) break
      await sleep(15000)
    }
    let content: string | null = prior?.raw_response ?? null, returnedModel: string | null = prior?.model_returned ?? null, usage: unknown = prior?.usage ?? null, finish: string | null = prior?.finish_reason ?? null
    if (final) { try { const b = JSON.parse(final.bodyText); content = b.choices?.[0]?.message?.content ?? null; returnedModel = b.model ?? null; usage = b.usage ?? null; finish = b.choices?.[0]?.finish_reason ?? null } catch { /* keep raw */ } }
    const g = content != null ? interpretCoachModelOutput(data, content) : null
    const snap = data.v4!.review.audit.snapshot
    const rec = { case_id: s.id, round: ri + 1, asOf, focus: occ, question: round.question, history_in: [...history], entry: "EXTERNAL_MODEL_WITH_FANGKUN_CONTEXT",
      visible_input: { committed_event_ids: committed.map((e) => e.event.event_id), correction_ids: corrections.map((c: any) => c.correctionId) },
      formal_rows: formal, v4_snapshot: { active: snap.active.map((e) => e.id), excluded: snap.excluded, quarantined: snap.quarantined, corrections: snap.corrections, missing: snap.missing, safety: snap.safety, hypotheses: snap.hypotheses },
      knowledge_hit: { lessons: request.knowledgeContext.lessons.map((l: any) => l.id), references: request.knowledgeContext.references.map((r: any) => r.id) },
      payload, payload_sha256: sha(JSON.stringify(payload)), model_requested: model, model_returned: returnedModel, attempts, raw_response_body: final?.bodyText ?? null, raw_response: content, usage, finish_reason: finish,
      visible: g ? { mode: g.turn.mode, text: g.turn.text, nextStep: g.turn.nextStep, citations: g.turn.citations, medicalReferral: g.turn.medicalReferral, planChanged: g.turn.planChanged } : null,
      gates: g ? { code: g.code, subcode: g.subcode, v4: g.v4, scaffold: g.scaffold } : null, reguard_of: prior ? "raw/r4-sealed.jsonl" : null, status: content != null ? "REAL_MODEL_RESPONSE" : dry ? "DRY" : "NO_REAL_MODEL_RESPONSE", blocked_reason: blocked }
    appendFileSync(out, JSON.stringify(rec) + "\n")
    console.log(`${s.id}#${ri + 1} ${rec.status} active=${snap.active.length} q=${snap.quarantined.length} safety=${snap.safety} unknownCommit=${formal.unknownCommitTime.length} gate=${g?.code ?? "-"} v4=${g?.v4.status ?? "-"} ${g?.v4.flags.join("|") ?? ""} ${blocked ?? ""} att=${attempts.map((x) => x.status).join(",")}`)
    history.push({ role: "user", text: round.question.slice(0, 300) })
    if (g) history.push({ role: "coach", text: (g.turn.text + (g.turn.nextStep ? ` 下一步：${g.turn.nextStep}` : "")).slice(0, 300) })
    if (blocked === "CALL_CAP_REACHED" || blocked === "EVAL_DISABLED") { stop = true; break }
    if (!dry && !prior) await sleep(pauseMs)
  }
}
