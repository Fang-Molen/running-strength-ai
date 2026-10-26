import type { AskCoachRawInput } from '../../../src/lib/strength/coach-pipeline.ts';
import type { CoachAnalysisPacket } from '../../../src/lib/health/analysis-contract.ts';

/** Only server middleware may construct these ports. No request/body value is a port. */
export type VerifiedCoachSubject = { id: string; verified: true; athleteIds: string[] };
export type CoachSnapshotRefs = { snapshotId: string; consentId: string; asOf: string; question: string };
export type AuthorizedCoachSnapshot = {
  subjectId: string;
  athleteId: string;
  snapshotId: string;
  version: string;
  asOf: string;
  latestEvidenceKnownAt: string;
  expiresAt: string;
  revokedAt: string | null;
  scope: { purpose: 'coach_explanation'; occurrenceIds: string[] };
  consent: { id: string; subjectId: string; purpose: 'coach_explanation'; grantedAt: string; expiresAt: string; revokedAt: string | null };
  rawInput: AskCoachRawInput;
  /** Constructed and minimized by the trusted host after consent; never accepted from request JSON. */
  analysisPacket?: CoachAnalysisPacket;
  /** Optional scientific decision reconstructed by the same trusted snapshot loader. */
  r6Decision?: import('./coach-r6-handoff').R6ScientificDecision;
};
export type LedgerBinding = { requestId: string; ownerId: string; contextHash: string; modelHash: string; configHash: string };
export type CoachLedgerCaps = {
  campaignCalls: number | null; pilotCalls: number | null; campaignCostMicros: string | null;
  ownerCalls: number | null; ownerCostMicros: string | null; concurrency: number | null;
  globalDailyCalls: number | null; globalDailyCostMicros: string | null;
  ownerDailyCalls: number | null; ownerDailyCostMicros: string | null; perCallCostMicros: string | null;
};
export type CoachLedger = {
  reserve(input: LedgerBinding & { campaignId: string; phase: 'pilot' | 'evaluation'; day: string; worstCostMicros: string; caps: CoachLedgerCaps }): Promise<{ status: 'RESERVED' | 'DUPLICATE'; reservationId: string; state: string }>;
  markDispatched(input: LedgerBinding): Promise<unknown>;
  settle(input: LedgerBinding & { outcome: 'SUCCESS' | 'NOT_SENT' | 'UNKNOWN'; actualCostMicros: string | null; usageHash: string | null }): Promise<{ state: string; overrun?: boolean }>;
};
export type VerifiedDeepSeekPolicy = {
  enabled: true;
  approvalId: string;
  approvalExpiresAt: string;
  campaignId: string;
  phase: 'pilot' | 'evaluation';
  model: string;
  acceptedResponseModels: string[];
  modelVersion: string;
  modelVerified: true;
  samplingVerified: true;
  temperature: 0.4;
  jsonObjectModeVerified: true;
  tokenUpperBoundVerified: true;
  tokenOverheadUpperBound: number;
  reasoningIncludedInCompletionVerified: true;
  usageCacheAccountingVerified: true;
  priceVersion: string;
  pricesVerified: true;
  currency: string;
  inputMicrosPerMillion: number;
  cachedInputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  timeoutMs: number;
  caps: CoachLedgerCaps;
};
export type FangkunCoachServices = {
  authenticate(request: Request): Promise<VerifiedCoachSubject | null>;
  loadAuthorizedSnapshot(subject: VerifiedCoachSubject, refs: CoachSnapshotRefs): Promise<AuthorizedCoachSnapshot | null>;
  getVerifiedPolicy(): Promise<VerifiedDeepSeekPolicy | null>;
  ledger: CoachLedger;
  /** Test or trusted transport adapter. Browser input can never supply this. */
  fetch?: typeof globalThis.fetch;
  now?: () => number;
};
