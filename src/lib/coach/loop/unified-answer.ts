/** One judgement chain for the coach answer.
 *
 * R4 professional reference and the personal-goal planner used to answer first
 * and return, which cut off training calculations, fatigue/recovery and the
 * online analysis. They are now supplementary inputs: this module turns their
 * output into (a) a short section appended to the local answer, (b) at most two
 * follow-up questions that would change the advice, and (c) a bounded block of
 * facts for the existing DeepSeek request. Nothing here writes data or a plan.
 */

export type R4AnswerLike = {
  text: string
  day: string
  conditions?: { population?: 'healthy_adult' | 'special' | 'unknown' | string; reasons?: string[] } | null
  safety?: string
} | null

/** The online proxy rejects fact summaries above 8000 characters. */
export const ONLINE_FACTS_LIMIT = 8000
const SECTION_LIMIT = 600
const FACTS_BLOCK_LIMIT = 1500
/** Requirement: never ask more than two questions per answer. */
export const MAX_FOLLOW_UPS = 2

import { conflictQuestions, describeEffectiveProfile, type EffectiveProfile } from './effective-profile'

const MISSING_LABEL: Record<EffectiveProfile['missing'][number], string> = { weightKg: '体重', age: '年龄', sex: '性别', heightCm: '身高', goal: '主要目标' }

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)

/** Messages that only ask the athlete to fill in a form are turned into questions. */
const SETUP_PATTERN = /^可以按你的目标提供饮食或力量建议。先在/
const STALE_PATTERN = /^个人条件已超过30天未复核/
const NEXT_STEP_PATTERN = /^下一步请核对：(.+?)。/

export type UnifiedSupplement = {
  /** Appended under the local answer; null when there is nothing to add. */
  localSection: string | null
  /** Up to two short questions, formatted for display; empty string when none. */
  followUps: string
  /** Assumptions are stated explicitly and never presented as the athlete's facts. */
  assumptions: string[]
  appendToFacts: (facts: string) => string
}

export function composeUnifiedSupplement(input: {
  question: string
  r4: R4AnswerLike
  personalText: string | null
  /** Shared current profile; when given, its sources and conflicts are used. */
  effective?: EffectiveProfile | null
  /** Open suggestions and tracked outcomes, so the coach can explain and revise them. */
  suggestionLines?: string[]
}): UnifiedSupplement {
  const questions: string[] = []
  // Conflicting values change advice the most, so they are asked first.
  if (input.effective) questions.push(...conflictQuestions(input.effective))
  const assumptions: string[] = []
  const lines: string[] = []

  const r4Lines = (input.r4?.text ?? '').split('\n').map(line => line.trim()).filter(Boolean)
  for (const line of r4Lines) {
    const next = line.match(NEXT_STEP_PATTERN)
    if (next) {
      for (const item of next[1].split('、')) questions.push(`请补充「${item}」——它会改变知识参考或课程的选择。`)
      continue
    }
    lines.push(line)
  }

  const population = input.r4?.conditions?.population
  if (input.r4 && population === 'unknown') {
    assumptions.push('年龄与健康筛查尚未确认：以下只按通用原则说明，不给依赖这些条件的精确数值。')
  }

  const personal = input.personalText?.trim() ?? ''
  if (personal) {
    if (SETUP_PATTERN.test(personal)) {
      const missing = input.effective ? input.effective.missing.map(k => MISSING_LABEL[k]) : ['年龄', '体重', '主要目标']
      // Never re-ask for information that is already on record.
      if (missing.length) questions.push(`如果方便，补充你的${missing.slice(0, 3).join('、')}，饮食和力量建议会更具体。`)
    } else if (STALE_PATTERN.test(personal)) {
      questions.push('你保存的身体与健康条件已超过30天，现在还准确吗？有变化请在「私人教练」里更新。')
    } else {
      lines.push(personal)
      const missing = input.effective?.missing.map(k => MISSING_LABEL[k]) ?? []
      if (missing.length) questions.push(`如果方便，补充你的${missing.slice(0, 3).join('、')}，方案中的数值会更具体。`)
    }
  }

  const body = lines.length ? clip(lines.join('\n'), SECTION_LIMIT) : ''
  const localSection = body || assumptions.length
    ? ['【个人目标与专业参考】', ...assumptions.map(text => `假设：${text}`), body].filter(Boolean).join('\n')
    : null

  const unique = [...new Set(questions)].slice(0, MAX_FOLLOW_UPS)
  const followUps = unique.length
    ? `补充后会更准确（可选，不影响上面的回答）：\n${unique.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : ''

  const appendToFacts = (facts: string) => {
    const blockParts = [
      ...(input.effective ? describeEffectiveProfile(input.effective).map(line => `当前有效资料｜${line}`) : []),
      ...assumptions.map(text => `假设（不是用户事实）：${text}`),
      ...lines,
      ...(input.suggestionLines ?? []),
      ...(unique.length ? [`尚缺、会改变建议的信息：${unique.join(' ')}`] : []),
    ]
    if (!blockParts.length) return facts
    const room = ONLINE_FACTS_LIMIT - facts.length - 40
    if (room < 200) return facts
    const block = clip(blockParts.join('\n'), Math.min(FACTS_BLOCK_LIMIT, room))
    return `${facts}\n\n【本机个人条件与R4专业参考】\n${block}`
  }

  return { localSection, followUps, assumptions, appendToFacts }
}
