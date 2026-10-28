/** 悬浮桌宠按当前页面选表情。纯函数，只看页面名，只用现有 12 张表情图。
 *  页面名 = strength-app 的标签：today 今天 / plan 计划 / courses 课程 / log 记录·复盘 / body 健康·恢复 / diet 饮食 / coach 方坤（悬浮桌宠在此页隐藏）。
 *  其他（含设置）= 你好。 */
import type { PetMood } from './mood'

export const PAGE_MOODS: Readonly<Record<string, PetMood>> = {
  today: 'hello',
  plan: 'suggest',
  courses: 'sprint',
  log: 'analyzing',
  body: 'rest',
  diet: 'water',
  coach: 'hello',
}
export function petMoodForPage(pageId: string | null | undefined): PetMood {
  return (pageId && Object.prototype.hasOwnProperty.call(PAGE_MOODS, pageId) ? PAGE_MOODS[pageId] : undefined) ?? 'hello'
}
/** 记录完成后短暂显示 done 的时长；这些事件由应用已有的记录/饮食保存流程发出，桌宠只监听、不改数据。 */
export const PET_DONE_MS = 2500
export const PET_DONE_EVENTS = ['fk-food-changed', 'fk-training-activities-changed'] as const
