/** Versioned analysis DTO, implemented by analysis-evidence/exposure/recovery/packet modules.
 * Reuse/extend equivalent existing domain types; keep an explicit mapping if names differ.
 * One authoritative snapshot supplies offline analysis, UI and online packets.
 */
export type Provider = 'GARMIN' | 'COROS' | 'APPLE' | 'HUAWEI' | 'MANUAL' | 'APP';
export type Quality = 'AVAILABLE' | 'PARTIAL' | 'MISSING' | 'CONFLICT' | 'STALE' | 'UNSUPPORTED';
export type ActualStatus = 'CONFIRMED' | 'UNVERIFIED' | 'PLANNED' | 'RETRACTED';
export type Region = 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'hip_flexors' |
 'adductors' | 'core' | 'lower_back' | 'chest' | 'back' | 'shoulders' | 'arms' | 'feet';
export type Side = 'LEFT' | 'RIGHT' | 'BILATERAL' | 'UNSPECIFIED';
export interface EvidenceRef { id: string; revision: number; }
export interface Context {
 athleteId: string; asOf: string; timeZone: string; planVersion: string | null;
 consentVersion: string; analysisVersion: string;
}
export interface EvidenceMeta extends EvidenceRef {
 athleteId: string; provider: Provider; accountRef: string | null; deviceId: string | null;
 protocolKey: string | null; sourceRecordId: string; occurredAt: string;
 knownAt: string; receivedAt: string; sourceTimeZone: string | null;
 status: ActualStatus; quality: Quality;
 /** Server verifies account ownership; no browser verifiedOwner flag. */
 ownershipReceiptId: string | null;
}
export interface MetricFact extends EvidenceMeta {
 kind: 'METRIC'; metric: string; value: number | null; unit: string;
 statistic: 'SAMPLE' | 'DAILY_TOTAL' | 'DAILY_MEAN' | 'PROVIDER_ASSESSMENT' | 'UNKNOWN';
 windowStart: string | null; windowEnd: string | null;
 providerDate: string | null; isFinal: boolean | null;
 energyKind: 'ACTIVE' | 'RESTING' | 'TOTAL' | 'WORKOUT' | 'UNKNOWN' | null;
}
export interface RunSegment {
 id: string; blockId: string; roundIndex: number | null; stepIndex: number;
 distanceM: number | null; durationSeconds: number | null;
 restAfterSeconds: number | null; rawResolutionSeconds: number | null;
 gradePercent: number | null; surface: string | null;
 completion: 'COMPLETED' | 'SKIPPED' | 'NOT_RECORDED';
}
export interface StrengthSet {
 id: string; catalogId: string | null; catalogVersion: string | null; side: Side;
 loadKg: number | null; loadBasis: 'TOTAL_EXTERNAL' | 'PER_HAND' | 'ASSISTANCE' | 'BODYWEIGHT' | 'UNKNOWN';
 reps: number | null; holdSeconds: number | null; setRpe: number | null; rir: number | null;
 effortScale: string | null; eccentricSeconds: number | null; rangeProtocol: string | null;
 completion: 'COMPLETED' | 'SKIPPED' | 'NOT_RECORDED';
}
export interface TrainingFact extends EvidenceMeta {
 kind: 'TRAINING'; canonicalActivityId: string; occurrenceId: string; componentId: string;
 modality: 'RUN' | 'STRENGTH' | 'JUMP' | 'OTHER';
 startedAt: string; endedAt: string | null;
 plannedPurpose: string | null; observedType: string | null; observedTypeBasis: EvidenceRef[];
 sessionRpe: number | null; sessionRpeScale: string | null; actualDurationSeconds: number | null;
 runSegments: RunSegment[]; strengthSets: StrengthSet[]; jumpContacts: number | null;
}
export interface ResponseFact extends EvidenceMeta {
 kind: 'RESPONSE'; relatedTrainingRefs: EvidenceRef[]; region: Region | null; side: Side;
 measure: 'SORENESS' | 'PAIN' | 'FUNCTION' | 'SUBJECTIVE_FATIGUE' | 'RECOVERY_FEELING';
 value: number | null; scale: string; observationProtocol: string | null;
 elapsedHours: number | null; functionTaskId: string | null; notes: string | null;
}
export type AnalysisFact = MetricFact | TrainingFact | ResponseFact;
export interface EvidenceInput { context: Context; facts: AnalysisFact[]; }
export interface EvidenceSnapshot {
 context: Context; snapshotId: string; inputDigest: string; facts: AnalysisFact[];
 excluded: { ref: EvidenceRef; reason: string }[];
 gaps: string[]; conflicts: { refs: EvidenceRef[]; reason: string }[];
 /** Existing safety restrictions are supplied by trusted host, not inferred from silence. */
 safetyConstraints: { id: string; version: string; scope: string; evidenceRefs: EvidenceRef[] }[];
}
export interface MuscleExposureReview {
 snapshotId: string; regions: { region: Region; side: Side; refs: EvidenceRef[];
  runDistanceM: number | null; runWorkSeconds: number | null;
  knownStrengthSets: number; knownStrengthReps: number | null;
  volumeLoadKgRepsByExercise: { catalogId: string; loadBasis: string; value: number; refs: EvidenceRef[] }[];
  jumpContacts: number | null; overlapObserved: boolean; gaps: string[] }[];
 mappingVersion: string; isMeasuredMuscleFatigue: false; automaticPrescription: false;
}
export type CandidateKind = 'KEEP_EXISTING' | 'ADJUST_PENDING_CONFIRMATION' | 'DEFER_AND_REVIEW' | 'REQUEST_MINIMUM_DATA';
export interface RecoveryAssessment {
 snapshotId: string; dataQuality: Quality;
 signalState: 'NO_ADVERSE_SIGNAL_OBSERVED' | 'RECOVERY_CONCERN' | 'MIXED_SIGNALS' | 'INSUFFICIENT';
 safetyState: 'NO_KNOWN_HOLD' | 'HOLD_ACTIVE' | 'ESCALATION_REQUIRED' | 'UNKNOWN';
 observations: { text: string; evidenceRefs: EvidenceRef[] }[];
 hypotheses: { id: string; claim: string; supportingRefs: EvidenceRef[];
  weakeningRefs: EvidenceRef[]; discriminator: string; certainty: 'POSSIBLE' | 'UNRESOLVED' }[];
 candidates: { id: string; kind: CandidateKind; basisRefs: EvidenceRef[];
  conditions: string[]; planVersion: string | null; requiresConfirmation: true }[];
 missingDecisionInputs: string[]; medicalClearance: false; automaticPrescription: false;
}
export interface PersonalResponseInput {
 context: Context; protocolKey: string; region: Region; side: Side;
 training: TrainingFact[]; responses: ResponseFact[];
 registeredEndpoint: string; settingsVersion: string;
}
export interface PersonalResponseReview {
 status: 'UNCALIBRATED' | 'INSUFFICIENT' | 'NOT_COMPARABLE' | 'DESCRIPTIVE' | 'RESEARCH_ESTIMATE';
 endpoint: string; independentSessionCount: number; observationCount: number;
 intervalCensoredCount: number; rightCensoredCount: number; missingCount: number;
 comparator: string | null; estimateInterval: [number, number] | null; unit: string | null;
 validationReportId: string | null; evidenceRefs: EvidenceRef[]; caveats: string[];
 isTissueRecoveryPrediction: false; canAuthorizeTraining: false;
}
export interface CoachAnalysisPacket {
 schemaVersion: 'FK_ANALYSIS_HANDOFF_1'; context: Context; snapshotId: string; inputDigest: string;
 permittedFacts: AnalysisFact[]; assessment: RecoveryAssessment; exposure: MuscleExposureReview;
 allowedCandidateIds: string[]; knowledgeRefs: { id: string; version: string; approvalReceipt: string }[];
 writeAuthority: 'NONE';
}
export interface CoachAnalysisReply {
 answer: string; factualClaims: { text: string; refs: EvidenceRef[] }[];
 selectedCandidateId: string | null; hypotheses: RecoveryAssessment['hypotheses'];
 unknowns: string[]; followup: string | null;
 memoryClaim: 'NOT_SAVED' | 'HOST_RECEIPT_REQUIRED';
}
export interface ReplyValidation {
 status: 'ACCEPTED_STRUCTURALLY' | 'REJECTED' | 'NEEDS_SEMANTIC_REVIEW';
 errors: string[]; reviewedClaims: string[]; professionalCorrectness: 'NOT_PROVEN';
}
