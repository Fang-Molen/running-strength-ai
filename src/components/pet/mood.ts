/** 桌宠表情与「聊天状态 → 表情」映射。纯函数，不读任何应用状态，只看传入的数据。仅用于展示。 */
export const PET_MOODS = ['hello', 'happy', 'encourage', 'think', 'analyzing', 'suggest', 'question', 'recovery', 'water', 'rest', 'done', 'sprint'] as const
export type PetMood = (typeof PET_MOODS)[number]

export type PetChatMessage = { id: string; role: string; text: string; purpose?: string }

const has = (text: string, words: readonly string[]) => words.some(w => text.includes(w))
/** 安全/疼痛/红线类回答 */
const SAFETY = ['安全提醒', '停止训练', '先停', '停练', '就医', '急救', '胸痛', '晕厥', '疼痛', '受伤', '伤病', '红线']
const REST = ['睡眠', '恢复', '休息', '疲劳', '补觉', '减量']
const DONE = ['已记录', '已保存', '已完成', '记录完成', '记录好了']
const SPRINT = ['冲刺', '间歇', '加速', '比赛', '配速目标']
const CHEER = ['加油', '很好', '不错', '继续保持', '做得好']

/** 单条方坤回答的表情。优先级：安全 > 完成记录 > 恢复/睡眠 > 冲刺 > 本地知识 > 失败兜底 > 鼓励 > 你好 */
export function petMoodForAnswer(message: Pick<PetChatMessage, 'id' | 'text'>): PetMood {
  const t = message.text
  if (has(t, SAFETY)) return 'recovery'
  if (has(t, DONE)) return 'done'
  if (has(t, REST)) return 'rest'
  if (has(t, SPRINT)) return 'sprint'
  if (message.id.endsWith('-local')) return 'suggest'
  if (message.id.endsWith('-learning') || message.id.endsWith('-online')) return 'think'
  if (message.id.endsWith('-fallback')) return 'question'
  if (has(t, CHEER)) return 'encourage'
  return 'hello'
}

/** 聊天整体的表情：正在回答=分析中；没有回答=你好；否则看最后一条方坤回答。 */
export function petMoodFromChat(input: { sending?: boolean; messages?: readonly PetChatMessage[] | null }): PetMood {
  if (input.sending) return 'analyzing'
  const last = [...(input.messages ?? [])].reverse().find(m => m.id !== 'hi' && m.purpose !== 'KNOWLEDGE_READING')
  if (!last || last.role !== 'coach') return 'hello'
  return petMoodForAnswer(last)
}
