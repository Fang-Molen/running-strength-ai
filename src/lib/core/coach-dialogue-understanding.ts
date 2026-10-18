import {parseChatTraining,type ChatTraining} from './coach-chat-evidence.ts'

export type PendingCoachQuestion={kind:'RPE_SCOPE';trainingId:string;askedTurn:number;askedAt:string;intent:'LOAD'|'REVIEW'}

export function validPendingCoachQuestion(value:unknown):value is PendingCoachQuestion{
 const p=value as PendingCoachQuestion|undefined
 return !!p&&p.kind==='RPE_SCOPE'&&typeof p.trainingId==='string'&&p.trainingId.length>0&&Number.isInteger(p.askedTurn)&&p.askedTurn>0&&typeof p.askedAt==='string'&&Number.isFinite(Date.parse(p.askedAt))&&(p.intent==='LOAD'||p.intent==='REVIEW')
}

/** Only mask explicit declined actions for intent routing. Safety always sees the original text.
 * Questions such as “要不要加量” and “不能加量吗” still request a decision. */
export function requestedActionText(input:string):string{
 return input.replace(/(?<!要|是否|是不是)(?:先别|暂不|先不|不要|不用|无需|不想|不需要|不考虑|不)(?:再)?(?:加(?:组|量|强度|重量)|多(?:跑|练))(?=$|[，,。；;！!\s]|只|先|帮|请)/g,'')
}

/** Short answers resolve only the immediately preceding, actually displayed question.
 * Exact phrases exclude new sessions, other athletes, questions and conflicting numbers. */
export function clarifyChatRpe(input:string,training:ChatTraining,pending:PendingCoachQuestion|undefined,turn:number,asOf:string):ChatTraining|null{
 if(!validPendingCoachQuestion(pending)||pending.trainingId!==training.id||pending.askedTurn!==turn-1||pending.askedAt.slice(0,10)!==asOf.slice(0,10)||!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)<Date.parse(pending.askedAt)||!training.rpeAssumed||training.rpe===null||training.issues.length||training.savedOccurrenceId)return null
 const q=input.normalize('NFKC').replace(/[\s，,。！!]/g,'')
 const session=/^(?:是的?|对的?|对)?(?:刚才(?:那节课)?的?)?(?:是)?(?:整课|整节课|整堂课|全课)(?:的)?(?:RPE|评分|感受|用力评分)?(?:是|的)?$/i.test(q)
 const set=/^(?:不是(?:整课|整节课|全课)(?:的)?(?:RPE|评分)?(?:而)?是|是|只是)?(?:末组|最后一组|单组|这一组)(?:的)?(?:RPE|评分|感受)?$/i.test(q)
 const segment=/^(?:不是(?:整课|整节课|全课)(?:的)?(?:RPE|评分)?(?:而)?是|是|只是)?(?:单段|这一段)(?:的)?(?:RPE|评分|感受)?$/i.test(q)
 if(!session&&!set&&!segment)return null
 const scope=session?'SESSION_RPE':set?'SET_RPE':'SEGMENT_RPE'
 const raw=training.raw+'\n用户补充评分范围：'+input
 return {...training,id:parseChatTraining(raw).id,raw,rpe:session?training.rpe:null,rpeAssumed:false,
  rpeScopeClarification:{originalTrainingId:training.id,originalRaw:training.raw,answer:input,scope,answeredAt:asOf},
 }
}
