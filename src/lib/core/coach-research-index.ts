import { candidateIntake } from '../../../knowledge/r167-r168-candidates.ts'

export type ResearchQuery={question:string;step:'认识人'|'初步判断'|'测试性训练'|'反馈与观察'|'修改与循环';sport:string|null;stage:string|null;age:number|null;sex?:string|null;experienceMonths:number|null;purpose:string|null;safetyRestricted:boolean}
export type ResearchHit={id:string;title:string;status:string;summary:string;counterevidence:string;boundary:string;source:string|null;applicability:'CONDITIONAL';automaticExecution:false}
const score=(q:string,title:string)=>{
 const pieces=title.toLowerCase().match(/[a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g)??[]
 return pieces.reduce((n,p)=>n+(q.includes(p)?p.length:0)+[...p].slice(1).reduce((s,_,i)=>s+(q.includes(p.slice(i,i+2))?1:0),0),0)
}
const supportsPopulation=(population:string,q:ResearchQuery)=>{
 if(/全部/.test(population))return true
 if(/女性/.test(population))return q.sex==='FEMALE'
 if(/大师/.test(population))return q.age!==null&&q.age>=50
 if(/跑步人群/.test(population))return q.sport!==null
 if(/青少年|儿童/.test(population))return q.age!==null&&q.age<18
 if(/成人/.test(population)&& (q.age===null||q.age<18))return false
 if(/新手|初学/.test(population)&& (q.experienceMonths===null||q.experienceMonths>12))return false
 if(/短跑/.test(population))return q.sport!==null&&/^(60|100|200|400)米$/.test(q.sport)
 if(/中长跑|耐力/.test(population))return q.sport!==null&&/800|1500|3000|5000|10000|马拉松/.test(q.sport)
 // Unknown applicability never silently becomes universal.
 return false
}
/** Separate candidate table; no executable function, numeric threshold or plan writer is returned. */
export function retrieveResearchIndex(q:ResearchQuery,limit=3):ResearchHit[]{
 const text=[q.question,q.sport,q.purpose].filter(Boolean).join(' ').normalize('NFKC').toLowerCase()
 if(q.safetyRestricted)return []
 const stage=q.stage?.replace('储备/基础期','基础期').replace('备赛期/减量','备赛期')
 const sprint=/^(60|100|200|400)米$/.test(q.sport??'')
 const relevant=(s:string)=>!(/解耦|Pw:HR|DECOUPLING/i.test(s)&&(sprint||!/解耦|功率.*心率/.test(q.question)))&&!(/HRMAX/.test(s)&&!/最大心率|hrmax/i.test(q.question))&&!(/ATL_CTL/.test(s)&&!/EWMA|ATL|CTL|急慢性/i.test(q.question))&&!(/RPE_MISMATCH/.test(s)&&!/轻松|计划/.test(q.question))&&!(/跟腱|腘绳肌|伤病|损伤|RCT/i.test(s)&&!/跟腱|腘绳肌|伤病|损伤/.test(q.question))
 const rules=candidateIntake.rules.filter(r=>relevant(r.id+' '+r.condition+' '+r.summary)&&r.step.includes(q.step)&&supportsPopulation(r.population,q)&&(/全部/.test(r.stage)||stage!=null&&r.stage.includes(stage)))
  .map(r=>({n:score(text,r.domain+' '+r.condition),hit:{id:r.id,title:r.condition,status:r.status,summary:r.summary,counterevidence:r.counterevidence,boundary:r.boundary,source:r.source,applicability:'CONDITIONAL' as const,automaticExecution:false as const}}))
 const cards=candidateIntake.cards.filter(r=>relevant(r.title+' '+r.boundary)&&!(q.sex==='FEMALE'&&/不能.*外推女子/.test(r.boundary))).map(r=>({n:score(text,r.title),hit:{id:r.id,title:r.title,status:r.status,summary:r.claim+'；观察：'+r.observation,counterevidence:r.counterevidence,boundary:r.boundary,source:r.source,applicability:'CONDITIONAL' as const,automaticExecution:false as const}}))
 // Cards remain explanations of research, with the original population boundaries visible.
 return [...rules,...cards].filter(x=>x.n>=3).sort((a,b)=>b.n-a.n||a.hit.id.localeCompare(b.hit.id)).slice(0,Math.max(0,Math.min(4,limit))).map(x=>x.hit)
}
export function pendingResearchTopics(question:string,limit=2){
 return candidateIntake.framework.map(r=>({r,n:score(question,r.topic)})).filter(x=>x.n>=3).sort((a,b)=>b.n-a.n).slice(0,limit).map(({r})=>({id:r.id,topic:r.topic,status:r.status,requires:r.requires,usableAsDecisionRule:false as const}))
}
export const researchIntakeAudit={version:candidateIntake.version,frameworkCount:candidateIntake.framework.length,candidateCardCount:candidateIntake.cards.length,candidateRuleCount:candidateIntake.rules.length,newVerifiedEvidence:candidateIntake.independentlyVerified,automaticRulesEnabled:0,workbookSha256:candidateIntake.workbookSha256} as const
