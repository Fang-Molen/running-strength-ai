import { readEvidenceBundle, type EvidenceBundle } from "./evidence-bundle.ts"
import type { MusculoskeletalRecord } from "./evidence-musculoskeletal.ts"

export type EvidenceConsistencyIssue = {
  code: string
  domain: "BUNDLE" | "FATIGUE" | "RECOVERY" | "MUSCULOSKELETAL"
}

export type EvidenceConsistency = {
  trainingOccurrenceId: string
  status: "CONSISTENT" | "INCONSISTENT"
  issues: EvidenceConsistencyIssue[]
}

function samePlace(left: string[] | null, right: string[] | null): boolean {
  if (left == null || right == null) return left == null && right == null
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function incompatible(records: MusculoskeletalRecord[]): boolean {
  return records.some((record, index) => records.slice(index + 1).some((other) => record.evidenceId === other.evidenceId && (record.severity !== other.severity || !samePlace(record.location, other.location))))
}

export function inspectEvidenceBundle(bundle: EvidenceBundle): EvidenceConsistency {
  const issues: EvidenceConsistencyIssue[] = []
  if (bundle.fatigue.trainingOccurrenceId !== bundle.trainingOccurrenceId || bundle.recovery.trainingOccurrenceId !== bundle.trainingOccurrenceId || bundle.musculoskeletal.trainingOccurrenceId !== bundle.trainingOccurrenceId) issues.push({ code: "ID_MISMATCH", domain: "BUNDLE" })
  if (bundle.fatigue.fatigueConclusion !== "UNKNOWN") issues.push({ code: "CONCLUSION_NOT_UNKNOWN", domain: "FATIGUE" })
  if (bundle.recovery.recoveryConclusion !== "UNKNOWN") issues.push({ code: "CONCLUSION_NOT_UNKNOWN", domain: "RECOVERY" })
  if (bundle.musculoskeletal.musculoskeletalConclusion !== "UNKNOWN") issues.push({ code: "CONCLUSION_NOT_UNKNOWN", domain: "MUSCULOSKELETAL" })
  if (bundle.fatigue.rule !== "FATIGUE_EVIDENCE_V1") issues.push({ code: "RULE_MISMATCH", domain: "FATIGUE" })
  if (bundle.recovery.rule !== "RECOVERY_EVIDENCE_V1") issues.push({ code: "RULE_MISMATCH", domain: "RECOVERY" })
  if (bundle.musculoskeletal.rule !== "MUSCULOSKELETAL_EVIDENCE_V1") issues.push({ code: "RULE_MISMATCH", domain: "MUSCULOSKELETAL" })
  const fatigueEmpty = bundle.fatigue.signals.length === 0 && bundle.fatigue.opposingSignals.length === 0 && bundle.fatigue.unresolvedSignals.length === 0
  if (bundle.fatigue.state === "NO_RELEVANT_EVIDENCE" && !fatigueEmpty) issues.push({ code: "STATE_SHAPE", domain: "FATIGUE" })
  if (bundle.fatigue.state === "SIGNAL_PRESENT" && (bundle.fatigue.signals.length === 0 || bundle.fatigue.opposingSignals.length > 0)) issues.push({ code: "STATE_SHAPE", domain: "FATIGUE" })
  if (bundle.fatigue.state === "CONFLICTING_EVIDENCE" && (bundle.fatigue.signals.length === 0 || bundle.fatigue.opposingSignals.length === 0)) issues.push({ code: "STATE_SHAPE", domain: "FATIGUE" })
  if (bundle.fatigue.state === "INSUFFICIENT_EVIDENCE" && bundle.fatigue.signals.length > 0) issues.push({ code: "STATE_SHAPE", domain: "FATIGUE" })
  const recoveryListed = bundle.recovery.signals.length + bundle.recovery.contextSignals.length + bundle.recovery.opposingSignals.length + bundle.recovery.unresolvedSignals.length
  if (bundle.recovery.state === "NO_RELEVANT_EVIDENCE" && recoveryListed > 0) issues.push({ code: "STATE_SHAPE", domain: "RECOVERY" })
  if (bundle.recovery.state === "SIGNAL_PRESENT" && (bundle.recovery.signals.length === 0 || bundle.recovery.opposingSignals.length > 0)) issues.push({ code: "STATE_SHAPE", domain: "RECOVERY" })
  if (bundle.recovery.state === "CONFLICTING_EVIDENCE" && (bundle.recovery.signals.length === 0 || bundle.recovery.opposingSignals.length === 0)) issues.push({ code: "STATE_SHAPE", domain: "RECOVERY" })
  if (bundle.recovery.state === "INSUFFICIENT_EVIDENCE" && bundle.recovery.signals.length > 0) issues.push({ code: "STATE_SHAPE", domain: "RECOVERY" })
  const body = [...bundle.musculoskeletal.pain, ...bundle.musculoskeletal.soreness]
  if (bundle.musculoskeletal.state === "NO_RELEVANT_EVIDENCE" && body.length > 0) issues.push({ code: "STATE_SHAPE", domain: "MUSCULOSKELETAL" })
  if (bundle.musculoskeletal.state === "INSUFFICIENT_EVIDENCE" && body.length > 0) issues.push({ code: "STATE_SHAPE", domain: "MUSCULOSKELETAL" })
  if (bundle.musculoskeletal.state === "SIGNAL_PRESENT" && (body.length === 0 || incompatible(body))) issues.push({ code: "STATE_SHAPE", domain: "MUSCULOSKELETAL" })
  if (bundle.musculoskeletal.state === "CONFLICTING_EVIDENCE" && !incompatible(body)) issues.push({ code: "STATE_SHAPE", domain: "MUSCULOSKELETAL" })
  return { trainingOccurrenceId: bundle.trainingOccurrenceId, status: issues.length === 0 ? "CONSISTENT" : "INCONSISTENT", issues }
}

export function checkEvidenceConsistency(trainingOccurrenceId: string): EvidenceConsistency | null {
  const bundle = readEvidenceBundle(trainingOccurrenceId)
  if (!bundle) return null
  return inspectEvidenceBundle(bundle)
}
