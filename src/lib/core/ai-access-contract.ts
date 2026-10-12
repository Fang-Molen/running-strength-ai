/** BUILD 45: offline-safe AI access contract. This is NOT an authorization server. */
export type AiCapability = 'basic_coach' | 'local_ocr' | 'cloud_vision' | 'advanced_reasoning';
export type AiGrant = { capability: AiCapability; expiresAt: number; remainingCredits: number };
export type AiAccessInput = {
  capability: AiCapability;
  online: boolean;
  explicitConsent: boolean;
  now: number;
  estimatedCredits: number;
  grants: readonly AiGrant[];
  serverVerified: boolean;
};
export type AiAccessDecision = { allowed: boolean; reason: 'LOCAL_FREE' | 'OFFLINE' | 'CONSENT_REQUIRED' | 'SERVER_REQUIRED' | 'NO_ENTITLEMENT' | 'INSUFFICIENT_CREDITS' | 'AUTHORIZED' };
export function decideAiAccess(input: AiAccessInput): AiAccessDecision {
  if (input.capability === 'basic_coach' || input.capability === 'local_ocr') return { allowed: true, reason: 'LOCAL_FREE' };
  if (!input.online) return { allowed: false, reason: 'OFFLINE' };
  if (!input.explicitConsent) return { allowed: false, reason: 'CONSENT_REQUIRED' };
  // Client-side membership flags, coupon codes, and balances never authorize paid requests.
  if (!input.serverVerified) return { allowed: false, reason: 'SERVER_REQUIRED' };
  if (!Number.isSafeInteger(input.estimatedCredits) || input.estimatedCredits <= 0) return { allowed: false, reason: 'INSUFFICIENT_CREDITS' };
  const matching = input.grants.filter(g => g.capability === input.capability && g.expiresAt > input.now);
  if (!matching.length) return { allowed: false, reason: 'NO_ENTITLEMENT' };
  return matching.some(g => Number.isSafeInteger(g.remainingCredits) && g.remainingCredits >= input.estimatedCredits)
    ? { allowed: true, reason: 'AUTHORIZED' }
    : { allowed: false, reason: 'INSUFFICIENT_CREDITS' };
}
export type AiRequestDraft = { capability: AiCapability; imageIds: string[]; userConfirmed: boolean; containsSensitiveData: boolean };
export function canSendAiRequest(draft: AiRequestDraft, access: AiAccessDecision): boolean {
  return access.allowed && draft.userConfirmed && !draft.imageIds.some(id => !id.trim());
}
