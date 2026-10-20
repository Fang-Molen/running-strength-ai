// R1.1 node harness: mirrors components/coach-sheet.tsx local path (online OFF, no network).
// Used only for fast iteration and regression tests; the browser run (qa/r11 drive) stays the release measurement.
import { setStoreBackend } from '../../src/lib/core/storage.ts'
import { firstWeekMemory } from '../../src/lib/core/coach-first-week.fixtures.ts'
import { assembleCoachBrief } from '../../src/lib/core/coach-brief.ts'
import { answerLocally } from '../../src/lib/core/coach-local-first.ts'
import { emptyDialogue, type CoachDialogue } from '../../src/lib/core/coach-dialogue.ts'
import { currentAthleteId } from '../../src/lib/core/events.ts'
import { readFormalEvidenceRows } from '../../src/lib/core/coach-v4-formal-rows-store.ts'
import { normalizeV4 } from '../../src/lib/strength/coach-pipeline.ts'
import { latestReasoningBasis } from '../../src/lib/core/coach-reasoning.ts'
import { readCoachMemory } from '../../src/lib/core/coach-context-memory.ts'
import { detectRedFlags } from '../../src/lib/core/coach-red-flags.ts'
import { presentCoachAnswer } from '../../src/lib/core/coach-persona.ts'
import { extractConversationContext, contextualFollowup } from '../../src/lib/core/coach-conversation-context.ts'
import { intervalRestAnswer } from '../../src/lib/coach/plain-coach.ts'

export type Msg = { id: string; role: 'user' | 'coach'; text: string }
export function newSession() { const store = firstWeekMemory(); setStoreBackend(store); return { store, messages: [] as Msg[], dialogue: emptyDialogue(currentAthleteId()) as CoachDialogue } }
export function localTurn(s: ReturnType<typeof newSession>, value: string) {
  let brief = assembleCoachBrief(null, value, null); brief = { ...brief, question: value.slice(0, 8000) }
  s.messages.push({ id: String(Date.now()), role: 'user', text: value })
  const athleteId = currentAthleteId(), asOf = new Date().toISOString()
  const priorAnalysis = latestReasoningBasis(s.messages as never, athleteId, asOf, [])
  const formal = readFormalEvidenceRows(athleteId, asOf)
  const v4 = { athleteId, asOf, rows: formal.rows, unknownCommitTime: formal.unknownCommitTime.length, priorAnalysis }
  const reviewed = normalizeV4(v4, value, Date.now(), brief.occurrenceId ?? null)
  const mem = readCoachMemory(athleteId, asOf, reviewed?.review.audit.snapshot).active
  const local = answerLocally(brief, reviewed ? { frame: reviewed.reasoning, snapshot: reviewed.review.audit.snapshot } : undefined, mem, undefined, s.dialogue)
  const conversation = extractConversationContext(s.messages as never, value)
  const contextual = detectRedFlags(value).level !== 'NONE' || local.offlineRuleIds?.length || local.reasoning?.scopeOccurrenceIds.length ? null : contextualFollowup(value, conversation)
  const redFlag = detectRedFlags(value).level !== 'NONE' || brief.pain || brief.constraints.medicalReferral || !!reviewed?.reasoning.safety.mustRetain
  let shown = local.dialogue ? local.text : presentCoachAnswer(local.text + (contextual ?? ''), 'balanced')
  if (!redFlag) { const iv = intervalRestAnswer(value); if (iv) shown = iv }
  if (local.dialogue) s.dialogue = local.dialogue
  s.messages.push({ id: `${Date.now()}-local`, role: 'coach', text: shown })
  return { shown, redFlag, dialogue: s.dialogue, brief }
}
