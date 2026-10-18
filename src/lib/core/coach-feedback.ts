import { currentAthleteId } from './events.ts'
import { readEnvelope, writeEnvelope } from './storage.ts'

export const COACH_FEEDBACK_KEY='fr255-coach-answer-feedback-v1'
export type CoachAnswerFeedback={id:string;athleteId:string;messageId:string;answer:string;category:'FACT'|'ADVICE'|'CLARITY'|'OTHER';note:string;recordedAt:string}
export function listCoachAnswerFeedback():CoachAnswerFeedback[]{
 const rows=readEnvelope<CoachAnswerFeedback[]>(COACH_FEEDBACK_KEY,[]).data
 return Array.isArray(rows)?rows.filter(r=>r&&r.athleteId===currentAthleteId()):[]
}
export function saveCoachAnswerFeedback(input:Pick<CoachAnswerFeedback,'messageId'|'answer'|'category'|'note'>):boolean{
 if(!input.messageId||!input.note.trim())return false
 const raw=readEnvelope<CoachAnswerFeedback[]>(COACH_FEEDBACK_KEY,[]).data
 const rows=Array.isArray(raw)?raw:[]
 const record:CoachAnswerFeedback={...input,id:crypto.randomUUID(),athleteId:currentAthleteId(),answer:input.answer.slice(0,5000),note:input.note.trim().slice(0,1000),recordedAt:new Date().toISOString()}
 return !!writeEnvelope(COACH_FEEDBACK_KEY,[...rows,record].slice(-200))
}
