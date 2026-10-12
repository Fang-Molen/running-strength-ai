import type { AthleteState, DecisionRecord } from "./types.ts"
import { deriveAthleteState } from "./state.ts"
import { loadDecisions } from "./decisions.ts"
import { loadEvents } from "./events.ts"
import { currentStoredDecision } from "./coach-view.ts"
import { TRAINING_DECISION_TYPES } from "./brain-loop.ts"

const TRAINING = new Set<string>(TRAINING_DECISION_TYPES)

export type CoachOpenView = {
  athlete: AthleteState
  inbox: DecisionRecord | null
  pending: DecisionRecord | null
  completedDecisionId: string | null
}

/** Reading the coach page cannot create a decision, state snapshot or learning entry. */
export function readCoachOpenView(): CoachOpenView {
  const decisions = loadDecisions()
  const training = decisions.filter((item) => TRAINING.has(item.decision_type))
  const completedId = loadEvents().filter((event) => event.event_type === "TRAINING_COMPLETED").at(-1)?.payload.decisionId
  return {
    athlete: deriveAthleteState(),
    inbox: currentStoredDecision(training) ?? training.at(-1) ?? null,
    pending: currentStoredDecision(decisions.filter((item) => !TRAINING.has(item.decision_type))),
    completedDecisionId: typeof completedId === "string" ? completedId : null,
  }
}
