import { createDeepSeekLedger, type LedgerDatabase } from '../../src/lib/coach/deepseek-ledger.server.ts';
import type { FangkunCoachServices, VerifiedDeepSeekPolicy } from './lib/coach-service-contract.ts';
import { assertVerifiedPolicy } from './lib/coach-request-boundary.ts';
import { createCoachSnapshotStore } from './coach-snapshot-store.server.ts';

/** Dependency injection is server code only; HTTP JSON never selects these ports. */
export function createCoachServices(options: { db: LedgerDatabase; authenticate: (request: Request) => Promise<string | null>; policy: () => VerifiedDeepSeekPolicy | null; now?: () => number; fetch?: typeof fetch; retrieve?: FangkunCoachServices['retrieve']; lookupActionReceipt?:FangkunCoachServices['lookupActionReceipt'] }) {
  const now = options.now ?? Date.now;
  const snapshots = createCoachSnapshotStore(options.db, now);
  const services: FangkunCoachServices = {
    authenticate: async request => { const id = await options.authenticate(request); return id ? snapshots.subject(id) : null; },
    loadAuthorizedSnapshot: (subject, refs) => snapshots.load(subject, refs),
    getVerifiedPolicy: async () => { const policy = options.policy(); assertVerifiedPolicy(policy, now()); return policy; },
    ledger: createDeepSeekLedger(options.db), now,
    ...(options.lookupActionReceipt ? {lookupActionReceipt:options.lookupActionReceipt}:{}),
    ...(options.retrieve ? { retrieve: options.retrieve } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };
  return { services, snapshots };
}
export type CoachRuntime = ReturnType<typeof createCoachServices>;
