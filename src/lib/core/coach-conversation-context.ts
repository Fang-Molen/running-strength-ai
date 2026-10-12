/** BUILD 26: ephemeral, read-only conversation facts. No inferred clinical facts. */
export type ConversationContext = { event: string | null; startTime: string | null; gastrointestinalConcern: boolean; source: string[] }
const EVENT = /(?:^|[^\d])(800|1500|3000|5000|10000)\s*(?:米|m)|半马|马拉松/u
const TIME = /(?:早上|上午|下午|晚上|凌晨)?\s*(\d{1,2})\s*(?:[:：点时])\s*(\d{1,2})?\s*(?:分)?/u
export function extractConversationContext(history: readonly {role: string; text: string}[], currentQuestion: string): ConversationContext {
  const turns = [...history.filter(x => x.role === 'user').slice(-8).map(x => x.text), currentQuestion]
  let event: string | null = null, startTime: string | null = null, gastrointestinalConcern = false
  const source: string[] = []
  for (const turn of turns) {
    const e = turn.match(EVENT)
    if (e) { event = e[1] ? `${e[1]}米` : e[0].trim(); source.push('用户提供比赛项目') }
    const t = turn.match(TIME)
    if (t && /比赛|开赛|起跑|开始|早上|上午|下午|晚上|凌晨/u.test(turn)) {
      const hour = Number(t[1]), minute = Number(t[2] ?? 0)
      if (hour <= 23 && minute <= 59) { startTime = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`; source.push('用户提供时间') }
    }
    if (/胃不舒服|肠胃不适|胃肠不适|吃.*拉肚子|容易腹泻/u.test(turn) && !/没有|并不|已经不|从未/u.test(turn)) gastrointestinalConcern = true
    if (/胃(已经)?好了|没有胃(肠)?不适|不再腹泻/u.test(turn)) gastrointestinalConcern = false
  }
  return { event, startTime, gastrointestinalConcern, source: [...new Set(source)] }
}
export function contextualFollowup(question: string, context: ConversationContext): string | null {
  if (!/吃什么|怎么吃|赛前饮食|赛前补给|早餐|补给安排/u.test(question)) return null
  const known = [context.event ? `比赛项目：${context.event}` : null, context.startTime ? `已提供开赛时间：${context.startTime}` : null, context.gastrointestinalConcern ? '此前提到赛前胃肠不适' : null].filter(Boolean)
  if (!known.length) return null
  const missing = [!context.startTime ? '开赛时间' : null, !context.event ? '比赛项目' : null, '平时能耐受的食物及进食间隔'].filter(Boolean)
  return `\n本轮已知上下文（仅来自你的对话）：${known.join('；')}。${context.gastrointestinalConcern ? '优先沿用训练中已验证耐受的食物，避免赛前尝试新品。' : ''}\n如需细化，还需要：${missing.join('、')}。这不是自动生成的个人医疗或营养处方。`
}
