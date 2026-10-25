/** Additive extension ports. No new calculators, periodization or diet engine is enabled. */
import type { EvidenceRef } from "../../health/analysis-contract";
export interface MeasuredCapability {
  metric: "RHR" | "MAX_HR" | "THRESHOLD_HR" | "PACE_ZONE" | "ONE_RM" | "BODY_FAT";
  value: number | null;
  unit: string;
  measuredAt: string | null;
  source: string;
  method: string | null;
  confidence: "MEASURED" | "ESTIMATED" | "UNKNOWN";
  exerciseId?: string;
  refs: EvidenceRef[];
}
export interface RacePeriodizationPort {
  raceDate: string | null;
  eventMeters: number | null;
  targetSeconds: number | null;
  currentAbilityRefs: EvidenceRef[];
  phase: "BASE" | "BUILD" | "SPECIFIC" | "TAPER" | "UNKNOWN";
  keySessionIds: string[];
  confirmedAt: string | null;
}
export interface TrainingNutritionPort {
  athleteId: string;
  day: string;
  actualTrainingRefs: EvidenceRef[];
  recordedFoodIds: string[];
  dayComplete: false;
  weightGoal: string | null;
  missing: string[];
  writeAuthority: "NONE";
}
export interface JudgmentChain {
  facts: { text: string; refs: EvidenceRef[] }[];
  calculations: { text: string; refs: EvidenceRef[] }[];
  scientificSources: {
    id: string;
    title: string;
    url: string;
    scope: string;
    limitations: string;
  }[];
  hypotheses: {
    claim: string;
    support: EvidenceRef[];
    counter: EvidenceRef[];
    discriminator: string;
  }[];
  unknowns: string[];
  candidate: string;
  requiresConfirmation: true;
  professionalValidation: "NOT_PROVEN";
}
