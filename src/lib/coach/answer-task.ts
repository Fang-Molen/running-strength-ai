import {needsAnswerRetrieval} from './answer-tools';
export type AnswerRequirement={id:string;kind:'COMPARISON'|'ARRANGEMENT'|'MISSING_DATA'|'COVERAGE'|'RETRIEVAL'|'ANSWER'};
/** Host-owned task contract; model taskCoverage fields are never consulted. */
export function buildAnswerTask(question:string):AnswerRequirement[]{
 const requirements:AnswerRequirement[]=[];
 const add=(kind:AnswerRequirement['kind'])=>requirements.push({id:'task:'+kind.toLowerCase(),kind});
 if(/比较|对比|哪次.*快|谁.*快|前后.*变化/.test(question))add('COMPARISON');
 if(/(?:建议|提出|给出|给我|请给|如何|怎么|考虑).{0,14}(?:明天|安排|规划|下一课)|(?:明天|下一课).{0,12}(?:建议|安排|考虑)|先帮我规划|安排思路/.test(question))add('ARRANGEMENT');
 if(/缺什么|缺项|资料清单|所需资料|补什么|需要什么资料/.test(question))add('MISSING_DATA');
 if(/(?:记录|全年|覆盖).{0,8}(?:完整|齐全)|完整性/.test(question))add('COVERAGE');
 if(needsAnswerRetrieval(question))add('RETRIEVAL');
 if(!requirements.length)add('ANSWER');
 return requirements;
}
export function evaluateAnswerTask(question:string,blocks:readonly {id:string;text:string;kind:string}[],retrievalSucceeded=false){
 const text=blocks.map(b=>b.text).join('\n');
 return buildAnswerTask(question).map(r=>{
  const matching=blocks.filter(b=>r.kind==='COMPARISON'?/(?:更快|略快|相同|并列|配速|差值|比.*多)/.test(b.text)&&/(?:\d|相同|并列)/.test(b.text):r.kind==='ARRANGEMENT'?b.kind==='CANDIDATE_ADVICE'&&/安排|保留|维持|阶段|关键课|恢复间隔|调整|优先|按原计划|先.*核对/.test(b.text):r.kind==='MISSING_DATA'?/补充|补记|请提供|需.{0,5}(?:目标|课表|训练|资料|日期)|缺少/.test(b.text):r.kind==='COVERAGE'?/覆盖|完整|齐全|漏记/.test(b.text):!!b.text.trim());
  return {...r,satisfied:(r.kind==='RETRIEVAL'?retrievalSucceeded:matching.length>0)&&!!text.trim(),blockIds:matching.map(b=>b.id)};
 });
}
