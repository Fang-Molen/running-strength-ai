import type { CoachQuestionIntent } from "./coach-model-packet.ts"

export type CoachCallKind = "candidate-route" | "formal-compare" | "formal-series"

export function coachMaxTokens(kind: CoachCallKind, intent: CoachQuestionIntent): number {
  if (kind === "formal-series") return 320
  if (kind === "formal-compare") return 300
  if (intent === "RETURN") return 220
  if (intent === "NEXT_SESSION" || intent === "FUEL") return intent === "FUEL" ? 220 : 240
  if (intent === "RUNNING" || intent === "GENERAL") return 260
  return 260
}
