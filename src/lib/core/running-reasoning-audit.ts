/** BUILD 45I: conservative evidence-grounded interpretation, read-only. */
import {assessRunningContext, type ExamContext} from './running-context-exam.ts';
export type ReasoningQuestion = {context: ExamContext; question: 'PERFORMANCE'|'FATIGUE_CAUSE'|'NEXT_SESSION'|'PAIN_SAFETY'|'GOAL_FIT'};
export function answerRunningQuestion(q:ReasoningQuestion){
 const assessment=assessRunningContext(q.context);
 const base={decision:'NONE' as const, writes:0 as const, evidenceStatus:assessment.status};
 if(assessment.status!=='OBSERVATION_ONLY')return {...base,answer:'INSUFFICIENT_EVIDENCE' as const, explanation:'训练证据无效或不足，无法可靠判断。'};
 if(assessment.deltaSeconds===null && (q.question==='PERFORMANCE'||q.question==='GOAL_FIT'))return {...base,answer:'INSUFFICIENT_EVIDENCE' as const,explanation:'缺少可比较的同距离完整用时。'};
 if(q.context.pain===true)return {...base,answer:'SAFETY_REVIEW' as const,explanation:'存在疼痛标记；不自动生成下一次训练处方，需核查症状与功能影响。'};
 if(q.question==='FATIGUE_CAUSE'||q.question==='NEXT_SESSION')return {...base,answer:'INSUFFICIENT_EVIDENCE' as const,explanation:'用时变化不能单独确定疲劳原因或下一次训练处方。'};
 if(q.question==='PAIN_SAFETY')return {...base,answer:'NO_REPORTED_PAIN' as const,explanation:'没有报告疼痛不代表不存在疼痛。'};
 if(q.question==='GOAL_FIT')return {...base,answer:assessment.goalAssessment,explanation:'仅比较已记录的首末成绩；不能代表完整逐组目标达成情况。'};
 return {...base,answer:assessment.pattern,explanation:assessment.deltaSeconds===null?'不同距离或缺失数据不可直接比较。':`首末同距离用时差 ${assessment.deltaSeconds} 秒；不推断疲劳原因。`};
}
