/** R3 historical methodological lessons: author syntheses, NOT verified empirical studies. */
export const RESEARCH_METHOD_VERSION = 'FK-R3-METHOD-GUARD-20261012' as const
export type MethodGuidance = Readonly<{
  id:string; topics:readonly string[]; reviewQuestion:string; failureMode:string;
  provenance:string; status:'HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED';
  decisionAuthorization:false; personalFact:false
}>
const GUIDANCE:readonly MethodGuidance[]=[
  {id:'R3-M26-TIME',topics:['预测','赛季','缺赛','成绩估计','未来','预测模型'],
    reviewQuestion:'明确预测生成时点，并列出当时实际可取得的输入；完整赛季缺赛模式只能用于回顾性补全，不能作为赛季初前瞻预测的已知输入。',
    failureMode:'用未来参赛或退出信息预测过去时点的成绩，造成未来信息泄漏。',
    provenance:'R3第26轮_预测时间与决策价值，作者知识研究总结；原论文未在本轮独立重读',
    status:'HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED',decisionAuthorization:false,personalFact:false},
  {id:'R3-M26-DECISION',topics:['监测','HRV','训练决策','负荷','预测','调整'],
    reviewQuestion:'分开核对测量可靠性、信息是否真正改变决定、行动后运动员结局、实施成本；不以预测准确性代替干预有效性。',
    failureMode:'把指标相关性或模型准确率当作自动加减量的因果证据。',
    provenance:'R3第26轮_预测时间与决策价值，作者方法综合；非随机干预效果证据',
    status:'HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED',decisionAuthorization:false,personalFact:false},
  {id:'R3-M1-CONFLICT',topics:['伤后','康复','疼痛','HRV','恢复','冲刺','回归'],
    reviewQuestion:'当可穿戴恢复指标与局部症状或专业限制冲突时，优先保留现行专业限制，不能以HRV好转推翻回归门槛。',
    failureMode:'以手表单一指标替代临床判断或专项功能评估。',
    provenance:'R3知识总审计与综合推理，作者冲突仲裁候选；非临床许可',
    status:'HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED',decisionAuthorization:false,personalFact:false},
  {id:'R3-M1-FACTS',topics:['更正','计划','完成','训练记录','复盘','反馈'],
    reviewQuestion:'严格区分计划、已完成、跳过、未记录及更正后的事实；更正必须撤回依赖旧事实的解释。',
    failureMode:'把计划冒充完成，或沿用被更正的旧事实作出结论。',
    provenance:'R3知识总审计与综合推理，作者知识架构候选；不是运动员个人数据',
    status:'HISTORICAL_AUTHOR_SYNTHESIS_UNVERIFIED',decisionAuthorization:false,personalFact:false},
] as const
function norm(s:string){return s.normalize('NFKC').toLowerCase().slice(0,3000)}
export function retrieveMethodGuidance(question:string,max=2):MethodGuidance[]{
 const q=norm(question),n=Number.isFinite(max)?Math.max(0,Math.min(4,Math.floor(max))):2
 if(!q.trim())return []
 return GUIDANCE.filter(g=>g.topics.some(t=>q.includes(norm(t)))).slice(0,n).map(g=>({...g,topics:[...g.topics]}))
}
export function buildMethodGuidanceContext(question:string,maxChars=1400){
 const budget=Number.isFinite(maxChars)?Math.max(350,Math.min(2500,Math.floor(maxChars))):1400
 const result:{version:string;status:'AUTHOR_METHOD_GUIDANCE_ONLY';decisionAuthorization:false;personalFact:false;entries:MethodGuidance[];truncated:boolean}={
  version:RESEARCH_METHOD_VERSION,status:'AUTHOR_METHOD_GUIDANCE_ONLY',decisionAuthorization:false,personalFact:false,entries:[],truncated:false}
 for(const item of retrieveMethodGuidance(question,4)){
  if(JSON.stringify({...result,entries:[...result.entries,item]}).length>budget){result.truncated=true;break}
  result.entries.push(item)
 }
 return result
}
export const RESEARCH_METHOD_COUNTS={historicalMethodCandidates:GUIDANCE.length,independentlyReverified:0} as const
