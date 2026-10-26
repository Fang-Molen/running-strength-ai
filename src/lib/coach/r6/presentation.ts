import type {R6Decision} from './runtime'
export const r6Question = (question:string) => /双阈值|金字塔|极化|分块训练|训练模型|科学训练|阈值导向|模型适用/.test(question)
const names:Record<string,string>={PYRAMIDAL:'金字塔',POLARIZED:'极化',THRESHOLD_ORIENTED:'阈值导向',SINGLE_THRESHOLD:'单次阈值',DOUBLE_THRESHOLD:'双阈值',BLOCK:'分块训练',EVENT_SPECIFIC:'专项结构'}
const status:Record<string,string>={CONSIDER:'可讨论',CONDITIONAL:'有条件',NOT_APPLICABLE:'不适用',INSUFFICIENT:'资料不足',HOLD:'暂停复核'}
/** Human readable output of the deterministic decision, never a model-generated prescription. */
export function r6DecisionText(d:R6Decision){
 const models=d.comparison.methods.map(m=>`${names[m.method]??m.method}：${status[m.status]??m.status}${m.missing.length?`（缺${m.missing.slice(0,2).join('、')}）`:''}`)
 const candidates=d.candidates.map(c=>`${c.option} ${c.title}：${c.reason}；${c.canConfirm?'可预览后确认':'当前仅作比较'}。`)
 return [`科学训练决策 · ${d.day}`,d.explanation,'强度分布、训练组织与专项结构分别比较；双阈值与极化可以描述不同维度。',...models,...candidates,d.missing.length?`优先补充：${d.missing.slice(0,2).join('；')}`:'','以上来自本机确定性分析；请到复盘中的「R6 科学训练决策」查看完整依据和确认候选。'].filter(Boolean).join('\n')
}
