import type {AnswerDecision} from '@/lib/coach/answer-gate';
const labels:Record<AnswerDecision,string>={VALIDATED:'本层校验通过',REPAIRED:'修复后完成',PARTIAL:'部分完成，仍有未回答内容',NEEDS_CLARIFICATION:'需要补充资料，尚未形成完整方案',SAFE_REFUSAL:'受限部分未执行',FAILED_TECHNICAL:'本轮处理未完成'};
export function CoachAnswerValidation({decision,professionalReview,sources=[]}:{decision?:AnswerDecision;professionalReview?:'PENDING'|'NOT_REQUIRED';sources?:readonly string[]}){
 if(!decision)return null;
 return <div data-testid="coach-answer-validation" className="mt-2 min-w-0 break-words text-xs">
  <p role="status">{labels[decision]}{professionalReview==='PENDING'?'；专业适用性待复核':''}</p>
  {!!sources.length&&<details className="mt-1"><summary className="min-h-11 cursor-pointer py-2">查看本轮依据</summary><ul className="space-y-2">{[...new Set(sources)].map((s,i)=><li className="whitespace-pre-wrap break-words" key={i}>{s}</li>)}</ul></details>}
 </div>;
}
