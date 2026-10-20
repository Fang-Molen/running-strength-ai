/** Restored test harness for the V88.1 behavior suite; calls existing UI logic.
 * No network, production storage writes or fabricated model response. */
import { currentAthleteId } from '../../src/lib/core/events'
import { assembleCoachBrief } from '../../src/lib/core/coach-brief'
import { emptyDialogue, type CoachDialogue } from '../../src/lib/core/coach-dialogue'
import { answerLocally, answerStaysLocal } from '../../src/lib/core/coach-local-first'
import { detectRedFlags } from '../../src/lib/core/coach-red-flags'
import { intervalRestAnswer } from '../../src/lib/coach/plain-coach'
export function newSession(): {dialogue:CoachDialogue} { return {dialogue:emptyDialogue(currentAthleteId())} }
export function localTurn(session:ReturnType<typeof newSession>,question:string) {
  const brief=assembleCoachBrief(null,question,null)
  const local=answerLocally(brief,undefined,[],undefined,session.dialogue)
  const redFlag=detectRedFlags(question).level!=='NONE'||brief.pain||brief.constraints.medicalReferral
  const shown=!redFlag&&!answerStaysLocal(local)?intervalRestAnswer(question)??local.text:local.text
  session.dialogue=local.dialogue??session.dialogue
  return {...local,shown,dialogue:session.dialogue}
}
