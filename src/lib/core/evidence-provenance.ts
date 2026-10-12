import { readEvidenceBundle } from "./evidence-bundle.ts"
import type { TrainingInference } from "./evidence-inference.ts"
import type { MusculoskeletalRecord } from "./evidence-musculoskeletal.ts"

export type EvidenceProvenanceRecord = {
  domain: "FATIGUE" | "RECOVERY" | "MUSCULOSKELETAL"
  role: "SIGNAL" | "CONTEXT" | "OPPOSING" | "UNRESOLVED" | "PAIN" | "SORENESS"
  evidenceId: string
  reasonCode: string
  inferenceType: string
  observationTypes: string[]
  location: string[] | null
  severity: number | null
  timestamp: string | null
  rule: string
}

export type EvidenceProvenance = {
  trainingOccurrenceId: string
  records: EvidenceProvenanceRecord[]
}

function fromInference(domain: "FATIGUE" | "RECOVERY", role: EvidenceProvenanceRecord["role"], rule: string, items: TrainingInference[]): EvidenceProvenanceRecord[] {
  return items.flatMap((item) => item.evidenceIds.map((evidenceId) => ({
    domain,
    role,
    evidenceId,
    reasonCode: item.reasonCode,
    inferenceType: item.type,
    observationTypes: [...item.observationTypes],
    location: null,
    severity: null,
    timestamp: null,
    rule,
  })))
}

function fromBody(role: "PAIN" | "SORENESS", rule: string, items: MusculoskeletalRecord[]): EvidenceProvenanceRecord[] {
  return items.map((item) => ({
    domain: "MUSCULOSKELETAL",
    role,
    evidenceId: item.evidenceId,
    reasonCode: item.reasonCode,
    inferenceType: role === "PAIN" ? "PAIN_RECORDED" : "SORENESS_RECORDED",
    observationTypes: [item.observationType],
    location: item.location ? [...item.location] : null,
    severity: item.severity,
    timestamp: item.timestamp,
    rule,
  }))
}

export function evidenceProvenance(trainingOccurrenceId: string): EvidenceProvenance | null {
  const bundle = readEvidenceBundle(trainingOccurrenceId)
  if (!bundle) return null
  return {
    trainingOccurrenceId,
    records: [
      ...fromInference("FATIGUE", "SIGNAL", bundle.fatigue.rule, bundle.fatigue.signals),
      ...fromInference("FATIGUE", "OPPOSING", bundle.fatigue.rule, bundle.fatigue.opposingSignals),
      ...fromInference("FATIGUE", "UNRESOLVED", bundle.fatigue.rule, bundle.fatigue.unresolvedSignals),
      ...fromInference("RECOVERY", "SIGNAL", bundle.recovery.rule, bundle.recovery.signals),
      ...fromInference("RECOVERY", "CONTEXT", bundle.recovery.rule, bundle.recovery.contextSignals),
      ...fromInference("RECOVERY", "OPPOSING", bundle.recovery.rule, bundle.recovery.opposingSignals),
      ...fromInference("RECOVERY", "UNRESOLVED", bundle.recovery.rule, bundle.recovery.unresolvedSignals),
      ...fromBody("PAIN", bundle.musculoskeletal.rule, bundle.musculoskeletal.pain),
      ...fromBody("SORENESS", bundle.musculoskeletal.rule, bundle.musculoskeletal.soreness),
    ],
  }
}
