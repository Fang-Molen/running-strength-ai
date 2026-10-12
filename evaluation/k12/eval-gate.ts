/**
 * Isolated K12 evaluation gate. NOT used by any production server function and
 * never imported from src/. It does not touch AI_MODEL_CALLS_ENABLED,
 * beginModelCall, auth, allowlists or quota of the product.
 *
 * Requirements (all must hold):
 *  - FANGKUN_EVAL_ENABLED === "true"
 *  - not a production/deploy environment (NODE_ENV!=="production", no VERCEL / VERCEL_ENV)
 *  - FANGKUN_EVAL_IDENTITY starts with "eval-" and is listed in FANGKUN_EVAL_ALLOWED_IDS
 *  - append-only file ledger below the hard cap (min(FANGKUN_EVAL_CALL_CAP, 120))
 *  - at most one call in flight
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export const HARD_CALL_CAP = 120

export type EvalDenial = "EVAL_DISABLED" | "PRODUCTION_ENV" | "NO_EVAL_IDENTITY" | "NOT_ALLOWLISTED" | "CALL_CAP_REACHED" | "CONCURRENCY"
export type EvalDecision = { ok: true; identity: string; used: number; cap: number } | { ok: false; reason: EvalDenial; used: number; cap: number }

export function ledgerCount(ledgerPath: string): number {
  if (!existsSync(ledgerPath)) return 0
  return readFileSync(ledgerPath, "utf8").split("\n").filter((line) => line.trim()).length
}

let inFlight = 0

export function decideEvalAccess(env: NodeJS.ProcessEnv, ledgerPath: string): EvalDecision {
  const cap = Math.min(HARD_CALL_CAP, Math.max(0, Number(env.FANGKUN_EVAL_CALL_CAP ?? 0) || 0))
  const used = ledgerCount(ledgerPath)
  if (env.FANGKUN_EVAL_ENABLED !== "true") return { ok: false, reason: "EVAL_DISABLED", used, cap }
  if (env.NODE_ENV === "production" || env.VERCEL || env.VERCEL_ENV) return { ok: false, reason: "PRODUCTION_ENV", used, cap }
  const identity = (env.FANGKUN_EVAL_IDENTITY ?? "").trim()
  if (!identity.startsWith("eval-")) return { ok: false, reason: "NO_EVAL_IDENTITY", used, cap }
  const allowed = (env.FANGKUN_EVAL_ALLOWED_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean)
  if (!allowed.includes(identity)) return { ok: false, reason: "NOT_ALLOWLISTED", used, cap }
  if (used >= cap) return { ok: false, reason: "CALL_CAP_REACHED", used, cap }
  if (inFlight >= 1) return { ok: false, reason: "CONCURRENCY", used, cap }
  return { ok: true, identity, used, cap }
}

/** Every outbound attempt (success or failure) is recorded before it is sent. */
export async function withEvalCall<T>(env: NodeJS.ProcessEnv, ledgerPath: string, meta: Record<string, unknown>, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: EvalDenial }> {
  const decision = decideEvalAccess(env, ledgerPath)
  if (!decision.ok) return { ok: false, reason: decision.reason }
  mkdirSync(dirname(ledgerPath), { recursive: true })
  appendFileSync(ledgerPath, JSON.stringify({ n: decision.used + 1, at: new Date().toISOString(), identity: decision.identity, ...meta }) + "\n")
  inFlight += 1
  try {
    return { ok: true, value: await run() }
  } finally {
    inFlight -= 1
  }
}
