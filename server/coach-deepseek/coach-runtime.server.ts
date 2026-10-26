import { Pool } from 'pg';
import { createPgTransactionAdapter } from '../../src/lib/coach/deepseek-ledger.server.ts';
import { authenticateCoachRequest } from '../../src/lib/auth/coach-request.server.ts';
import { assertVerifiedPolicy } from './lib/coach-request-boundary.ts';
import type { VerifiedDeepSeekPolicy } from './lib/coach-service-contract.ts';
import { createCoachServices, type CoachRuntime } from './coach-services.server.ts';

type Environment = Record<string, string | undefined>;
/** Pure inspection: no auth, SQL, personal records, secrets in output, or model request. */
export function coachConfigurationReason(env: Environment, now = Date.now()): string | null {
  if (env.FANGKUN_DEEPSEEK_ENABLED !== 'true') return 'SERVICE_DISABLED';
  if (!env.DEEPSEEK_API_KEY?.trim()) return 'SERVICE_KEY_MISSING';
  if (!env.DATABASE_URL?.trim() || env.FANGKUN_COACH_SCHEMA_READY !== 'true') return 'PERSISTENCE_UNAVAILABLE';
  if (env.VITE_AUTH_ENABLED === 'false' || !env.BETTER_AUTH_SECRET?.trim()) return 'AUTH_UNAVAILABLE';
  // Explicit operator reconciliation is required; a fresh empty ledger is not proof of zero past spend.
  if (env.FANGKUN_COACH_LEDGER_RECONCILED !== 'true') return 'BUDGET_HISTORY_UNVERIFIED';
  try { assertVerifiedPolicy(JSON.parse(env.FANGKUN_DEEPSEEK_POLICY_JSON ?? 'null'), now); }
  catch { return 'POLICY_UNVERIFIED'; }
  return null;
}

let installed: { key: string; runtime: CoachRuntime } | undefined;
export function getCoachRuntime(env: Environment = process.env, revokeOnly = false): CoachRuntime {
  const reason = revokeOnly
    ? !env.DATABASE_URL?.trim() || env.FANGKUN_COACH_SCHEMA_READY !== 'true' ? 'PERSISTENCE_UNAVAILABLE'
      : env.VITE_AUTH_ENABLED === 'false' || !env.BETTER_AUTH_SECRET?.trim() ? 'AUTH_UNAVAILABLE' : null
    : coachConfigurationReason(env);
  if (reason) throw Error(reason);
  // Never import getSql(): its preview fallback is intentionally in-memory.
  const key = env.DATABASE_URL!;
  if (installed) {
    if (installed.key !== key) throw Error('DATABASE_CONFIGURATION_CHANGED');
    return installed.runtime;
  }
  const pool = new Pool({ connectionString: key, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const runtime = createCoachServices({ db: createPgTransactionAdapter(pool), authenticate: authenticateCoachRequest,
    policy: () => JSON.parse(env.FANGKUN_DEEPSEEK_POLICY_JSON ?? 'null') as VerifiedDeepSeekPolicy | null });
  installed = { key, runtime };
  return runtime;
}
