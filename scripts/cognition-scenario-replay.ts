import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { answerLocally } from '../src/lib/core/coach-local-first.ts'
import { deriveCoachBrief } from '../src/lib/core/coach-brief.ts'
import { setStoreBackend } from '../src/lib/core/storage.ts'
import { classifyLocalSafety } from '../src/lib/core/coach-local-safety.ts'
const dataset=process.argv[2]??'quality/cognition/transfer_exam_78.json'
const output=process.argv[3]??'evidence/round1/transfer-replay.json'
const rows=JSON.parse(readFileSync(dataset,'utf8'))
const base=(question:string)=>deriveCoachBrief({question,occurrenceId:null,runningStructure:'UNAVAILABLE',sessionRpe:null,sleepHours:null,recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:0,continuousCount:0,plannedSetCount:null,completedSetCount:null,durationSec:null,pain:false,daysToCompetition:null,week:null,bias:null,sources:[],sourceIds:[],running:[]})
const result=rows.map((row:{id:string;prompt?:string;trigger?:string;expected_behaviors?:string[];forbidden_behaviors?:string[];expected?:string})=>{
 const data=new Map<string,string>();setStoreBackend({getItem:k=>data.get(k)??null,setItem:(k,v)=>void data.set(k,v)})
 const prompt=row.prompt??row.trigger??''
 const a=answerLocally(base(prompt));const c=a.cognition
 return {id:row.id,prompt,modelMode:'LOCAL',observedOutput:a.text,cognition:c??null,safety:classifyLocalSafety(prompt),assertions:{readOnly:data.size===0,noDecisionAuthority:c?c.decisionAuthorization===false:true,eventKnowledgeRetrieved:!!c?.knowledge.length,competingHypotheses:!!c&&c.hypotheses.length>=2,counterEvidence:!!c&&c.hypotheses.every(h=>h.against.length&&h.test),candidateOptions:!!c&&c.options.length>=2,uncertainty:!!c&&c.unknowns.length>0},expected:row.expected_behaviors??row.expected??null,forbidden:row.forbidden_behaviors??[],assessment:'NOT_HUMAN_REVIEWED',evidenceScope:row.trigger?'TEXT_REPLAY_ONLY_NOT_TECHNICAL_GATE':'LOCAL_SYNTHETIC_PROMPT_ONLY'}
})
mkdirSync(output.substring(0,output.lastIndexOf('/')),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2))
console.log(JSON.stringify({dataset,total:result.length,structured:result.filter((r:{cognition:unknown})=>r.cognition).length,readOnly:result.filter((r:{assertions:{readOnly:boolean}})=>r.assertions.readOnly).length,fullSemanticPass:'NOT_ASSESSED'},null,2))
