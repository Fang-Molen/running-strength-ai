/** E1 standalone research reference: adapter must populate only from a TRUSTED host decision layer. */
export type SafetyLevel = 'normal' | 'caution' | 'urgent';
export type Complexity = 'simple' | 'moderate' | 'complex';
export type DepthMode = 'brief' | 'standard' | 'deep';
export type ClaimKind = 'safety' | 'correction' | 'conclusion' | 'fact' | 'uncertainty' | 'limit' | 'decision' | 'action';
export type ClaimPriority = 'required' | 'supporting' | 'detail';

export interface ApprovedClaim {
  id: string;
  kind: ClaimKind;
  /** Chinese text already approved by the host; never rewritten or numerically transformed here. */
  text: string;
  priority: ClaimPriority;
  sourceIds: string[];
}

export interface ApprovedGloss {
  id: string;
  afterClaimId: string;
  /** Explanatory wording already approved by host, not free-generated. */
  text: string;
  priority: Exclude<ClaimPriority, 'required'>;
}

export interface ApprovedQuestion {
  id: string;
  text: string;
  missingField: string;
  necessity: 'blocking' | 'optional';
  /** Do not delay urgent safety guidance with clarification. */
  permissibleDuringUrgency?: boolean;
}

export interface ApprovedCoachBundle {
  schemaVersion: 'E1.0';
  bundleId: string;
  factVersion: string;
  sourceRevision: string;
  safetyLevel: SafetyLevel;
  complexity: Complexity;
  claims: ApprovedClaim[];
  glosses?: ApprovedGloss[];
  followups?: ApprovedQuestion[];
  revokedSourceIds?: string[];
  allowedActionClaimIds: string[];
  permissions: {
    maySendToAthlete: boolean;
    planMutationAuthorized: boolean;
  };
}

export interface DialogueContext {
  latestUserText: string;
  depthPreference?: 'auto' | 'short' | 'detailed';
  literacyLevel?: 'beginner' | 'experienced';
  /** ONLY host-attested IDs of already asked questions, not raw conversation text guesses. */
  alreadyAskedQuestionIds?: string[];
  allowOptionalFollowup?: boolean;
  /** Controls whether a brief empathic acknowledgment is appropriate. */
  disableEmpathy?: boolean;
}

export interface DraftSegment {
  id: string;
  kind: 'opening' | 'claim' | 'gloss' | 'question';
  text: string;
  sourceId?: string;
}

export interface InternalPreview {
  schemaVersion: 'E1.0';
  bundleId: string;
  factVersion: string;
  sourceRevision: string;
  mode: DepthMode;
  segments: DraftSegment[];
  renderedText: string;
  usedApprovedClaimIds: string[];
  selectedQuestionId: string | null;
  /** Always false in R13 research integration. No code path is authorized to send to the athlete. */
  authorizedForDelivery: false;
  /** Always false: action advice is a preview only, not a plan mutation. */
  modifiesPlan: false;
}

export interface ValidationResult {
  pass: boolean;
  errors: string[];
}
