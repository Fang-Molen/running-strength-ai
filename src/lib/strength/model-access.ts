export const MODEL_DEV_USER_ID = "dev-user"

export type ModelAccessDenial =
  | "CALLS_DISABLED"
  | "AUTH_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "NOT_ALLOWLISTED"
  | "QUOTA_STORE_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "CONCURRENCY_EXCEEDED"

export type ModelAccessDecision =
  | { ok: true; userId: string }
  | { ok: false; reason: ModelAccessDenial }

export type ModelQuotaSnapshot = {
  used: number
  limit: number
  inFlight: number
  maxInFlight: number
}

export type ModelAccessInput = {
  callsEnabled: boolean
  authConfigured: boolean
  user: { id: string; email: string | null } | null
  allowUserIds: string[]
  allowEmails: string[]
  quotaStore: "neon" | "missing"
  quota: ModelQuotaSnapshot | null
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** Pure decision. It never reads a key and never calls a model. */
export function decideModelAccess(input: ModelAccessInput): ModelAccessDecision {
  if (!input.callsEnabled) return { ok: false, reason: "CALLS_DISABLED" }
  if (!input.authConfigured) return { ok: false, reason: "AUTH_NOT_CONFIGURED" }
  if (!input.user || input.user.id === MODEL_DEV_USER_ID || !input.user.id.trim()) return { ok: false, reason: "UNAUTHENTICATED" }
  const email = input.user.email?.trim() ?? ""
  const allowed = input.allowUserIds.includes(input.user.id) || (email !== "" && input.allowEmails.some((item) => sameEmail(item, email)))
  if (input.allowUserIds.length + input.allowEmails.length === 0 || !allowed) return { ok: false, reason: "NOT_ALLOWLISTED" }
  if (input.quotaStore !== "neon" || !input.quota) return { ok: false, reason: "QUOTA_STORE_UNAVAILABLE" }
  if (input.quota.used >= input.quota.limit) return { ok: false, reason: "QUOTA_EXCEEDED" }
  if (input.quota.inFlight >= input.quota.maxInFlight) return { ok: false, reason: "CONCURRENCY_EXCEEDED" }
  return { ok: true, userId: input.user.id }
}

/** Runs the model function only after the decision allows it. */
export async function invokeModelIfAllowed<T>(decision: ModelAccessDecision, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: ModelAccessDenial }> {
  if (!decision.ok) return decision
  return { ok: true, value: await run() }
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean)
}

/**
 * Live gate for the five model server functions.
 * The emergency switch defaults to off. There is no shared quota ledger in this
 * environment, so a passed identity still cannot reach the model.
 */
export async function beginModelCall(): Promise<ModelAccessDecision> {
  if (process.env.AI_MODEL_CALLS_ENABLED !== "true") return { ok: false, reason: "CALLS_DISABLED" }
  const { authConfigured, getSessionUser } = await import("@/lib/auth/verify.server")
  const user = authConfigured ? await getSessionUser() : null
  return decideModelAccess({
    callsEnabled: true,
    authConfigured,
    user,
    allowUserIds: list(process.env.AI_ALLOWED_USER_IDS),
    allowEmails: list(process.env.AI_ALLOWED_EMAILS),
    quotaStore: process.env.DATABASE_URL?.trim() ? "neon" : "missing",
    quota: null,
  })
}
