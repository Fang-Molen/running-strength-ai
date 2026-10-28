import type { AnalysisFact, CoachAnalysisPacket, EvidenceRef } from '../health/analysis-contract'
import type { CoachContextRecord } from './online-contract'
import { stableJson } from '../health/analysis-evidence'
import { sha256Hex } from '../core/sha256-sync'

export type OnlineConversationTurn = { role: 'user' | 'coach'; text: string }
export function contextualQuestion(question:string,turns:readonly OnlineConversationTurn[]=[]):string {
 if(!/^(?:那|那么|明天呢|后天呢|刚才|这节|这次|继续|为什么这么)/.test(question.trim()))return question
 const prior=turns.filter(t=>t.role==='user').at(-1)
 return prior ? `${prior.text.slice(0,256)}；追问：${question}` : question
}
const digest=(v:unknown)=>sha256Hex(stableJson(v))
const clean=(s:string)=>s.normalize('NFKC').replace(/[\u0000-\u001f<>]/g,' ').slice(0,256)
const field=(name:string,value:string|number|boolean|null,unit:string|null=null)=>({name,value:typeof value==='string'?clean(value):value,unit})

/** A browser analysis is transmitted as a declared interpretation, never installed
 * as the server's privileged analysisPacket or as an executable plan. */
export function localAnalysisRecords(packet:CoachAnalysisPacket|undefined,owner:string,question:string,facts:AnalysisFact[]):CoachContextRecord[]{
 if(!packet||packet.context.athleteId!==owner)return []
 const keys=new Set(facts.map(f=>`${f.id}@${f.revision}`))
 const supported=(refs:EvidenceRef[])=>refs.length>0&&refs.every(r=>keys.has(`${r.id}@${r.revision}`))
 const refs=(rs:EvidenceRef[])=>rs.map(r=>digest([r.id,r.revision]).slice(0,16)).join(',')
 // The packet ID includes its read instant. Only semantic content and source
 // revisions identify this read-only handoff; recalculating is not a source edit.
 const meaning=(text:string)=>text.replaceAll(packet.context.asOf,packet.context.asOf.slice(0,10))
 const make=(key:string,fields:CoachContextRecord['fields']):CoachContextRecord=>({
  recordId:'analysis:'+digest([owner,question,key]),revision:digest(fields),occurredAt:null,knownAt:null,
  category:'ANALYSIS',state:'UNKNOWN',source:'USER_DECLARED:LOCAL_ANALYSIS',fields:[...fields,field('boundedSummary',true)],
 })
 const result:CoachContextRecord[]=[]
 for(const d of packet.derivedFacts??[])if(supported(d.evidenceRefs))result.push(make('computed:'+digest([d.metric,d.evidenceRefs,d.inputs,d.formula,d.value,d.unit]),[field('kind','COMPUTED'),field('metric',d.metric),field('value',d.value,d.unit),field('evidenceVersions',refs(d.evidenceRefs)),field('formula',d.formula),field('formulaVersion',d.formulaVersion),field('meaning',meaning(d.text)),field('inputsOmitted',Math.max(0,d.inputs.length-4)),...d.inputs.slice(0,4).flatMap((i,n)=>[field('input'+n,i.value,i.unit),field('inputSource'+n,refs([i.ref])+':'+i.field)])]))
 for(const [i,o]of packet.assessment.observations.entries())if(supported(o.evidenceRefs)&&!(packet.derivedFacts??[]).some(d=>d.text===o.text))result.push(make('observation:'+i,[field('kind','OBSERVATION'),field('meaning',meaning(o.text)),field('evidenceVersions',refs(o.evidenceRefs))]))
 for(const h of packet.assessment.hypotheses)if(supported(h.supportingRefs)&&h.weakeningRefs.every(r=>keys.has(`${r.id}@${r.revision}`)))result.push(make(h.id,[field('kind','HYPOTHESIS'),field('meaning',h.claim),field('certainty',h.certainty),field('support',refs(h.supportingRefs)),field('counterevidence',refs(h.weakeningRefs)),field('review',h.discriminator)]))
 if(/明天|下一|安排|计划|方案|调整/.test(question))for(const c of packet.assessment.candidates)if(c.basisRefs.every(r=>keys.has(`${r.id}@${r.revision}`)))result.push(make('candidate:'+digest([c.kind,c.action,c.changedVariable,c.basisRefs]),[field('kind','CANDIDATE'),field('candidateKind',c.kind),field('reason',c.reason??null),field('conditions',c.conditions.join('；')),field('executionState',c.executionState??'HOST_REVIEW_REQUIRED'),field('planVersion',c.planVersion?digest(c.planVersion):null),field('requiresConfirmation',true),field('medicalClearance',false)]))
 result.push(make('coverage',[field('kind','ANALYSIS_COVERAGE'),field('dataQuality',packet.assessment.dataQuality),field('missing',packet.assessment.missingDecisionInputs.join('；')),field('writeAuthority','NONE'),field('medicalClearance',false)]))
 return result
}

/** Conversation clarifies the question only; its numbers are not quotable evidence. */
export function dialogueRecords(owner:string,question:string,turns:readonly OnlineConversationTurn[]):CoachContextRecord[]{
 return turns.slice(-4).map((turn,index)=>({recordId:'dialogue:'+digest([owner,question,index,turn]),revision:digest(turn),occurredAt:null,knownAt:null,
  category:'DIALOGUE',state:'UNKNOWN',source:'USER_DECLARED:CONVERSATION',fields:[field('speaker',turn.role),field('text',turn.text),field('factAuthority','NONE')]}))
}
