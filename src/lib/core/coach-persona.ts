/** Presentation preference only; never changes training decisions, evidence or safety policy. */
export type CoachPersona = 'balanced' | 'strict' | 'gentle' | 'analytical'
export type CoachReplyContext = 'training' | 'nutrition' | 'recovery' | 'safety' | 'general'
export const PERSONAS: {id: CoachPersona; label: string; description: string}[] = [
  {id:'balanced',label:'专业均衡',description:'清晰、直接、适度鼓励'},
  {id:'strict',label:'严格督导',description:'强调纪律与执行，不羞辱、不强迫冒险'},
  {id:'gentle',label:'温柔支持',description:'共情、循序渐进，不淡化风险'},
  {id:'analytical',label:'数据分析',description:'突出证据、缺口和不确定性'},
]
export const PERSONA_KEY = 'fr255-coach-persona-v1'
export function parsePersona(value: unknown): CoachPersona {
  return PERSONAS.some(p => p.id === value) ? value as CoachPersona : 'balanced'
}
/** Context detection is only for phrasing; never use it for medical triage or plan decisions. */
export function classifyReplyContext(answer: string): CoachReplyContext {
  if (/胸痛|晕厥|急诊|骨应力|呼吸困难|立即就医|停止运动|医疗评估|医学评估/.test(answer)) return 'safety'
  if (/铁蛋白|贫血|热量|碳水|蛋白质|补水|饮食|补给|能量可用性/.test(answer)) return 'nutrition'
  if (/恢复|睡眠|酸痛|疲劳|HRV/.test(answer)) return 'recovery'
  if (/训练|课表|配速|间歇|组数|周期|RPE/.test(answer)) return 'training'
  return 'general'
}
const framing: Record<Exclude<CoachPersona,'balanced'>, Record<CoachReplyContext,string>> = {
  strict: {
    training:'先对照计划与实际记录。执行要有纪律，但不能为了完成数字忽视风险。',
    nutrition:'补给也属于训练执行的一部分。先核实记录，不用猜测替代数据。',
    recovery:'恢复是训练安排的一部分。先看证据，不因一时冲动加量。',
    safety:'安全底线不讨论硬扛；先处理风险，再谈训练目标。',
    general:'先明确目标和已知事实，再确定下一步。',
  },
  gentle: {
    training:'我们一起核对训练完成情况，再决定怎样稳妥地推进。',
    nutrition:'可以从你已记录的饮食信息入手，逐步补齐缺少的部分。',
    recovery:'先关注身体的反馈，恢复信息不足时不用急着下结论。',
    safety:'你的身体安全更重要。先认真处理这些警示信息。',
    general:'我们先从已知信息开始，一步一步分析。',
  },
  analytical: {
    training:'分析顺序：计划与实际 → 证据缺口 → 可支持的结论。',
    nutrition:'分析顺序：已记录摄入 → 未知消耗与需求 → 判断边界。',
    recovery:'分析顺序：恢复观察 → 时间趋势 → 不确定性。',
    safety:'优先级：风险线索 → 必要评估 → 暂不授权高风险训练。',
    general:'分析顺序：已知事实 → 缺失信息 → 判断边界。',
  },
}
/** Keeps the underlying answer byte-for-byte; no style can weaken warnings or grant permission. */
export function presentCoachAnswer(answer: string, persona: CoachPersona): string {
  // Emergency wording is already the complete 2–4 sentence product response.
  if (/(?:拨打|打)\s*120/.test(answer) && /停止活动|停止运动|当事人/.test(answer)) return answer
  const safePersona = parsePersona(persona)
  if (safePersona === 'balanced' || !answer.trim()) return answer
  const context = classifyReplyContext(answer)
  return `${framing[safePersona][context]}\n\n${answer}`
}
