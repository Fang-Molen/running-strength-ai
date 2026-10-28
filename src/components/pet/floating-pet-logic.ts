/** 悬浮桌宠的纯逻辑：显示条件、位置限制、点击气泡状态、本机存取。不读应用数据，不联网。 */
import type { PetMood } from './mood'

export type PetPos = { x: number; y: number }
/** 点一下桌宠依次出现的固定提示语（本地文案，不是联网回答，也不改任何数据）。 */
export const PET_TIPS: readonly { text: string; mood: PetMood }[] = [
  { text: '今天也辛苦啦，慢慢来就好。', mood: 'happy' },
  { text: '记得喝水，别等渴了才喝。', mood: 'water' },
  { text: '累了就休息，恢复也是训练的一部分。', mood: 'rest' },
  { text: '按计划练就很棒，不用一次补回来。', mood: 'encourage' },
  { text: '有问题点下面的「方坤」问我。', mood: 'hello' },
]
export const PET_IDLE_MOOD: PetMood = 'hello'
export const PET_BUBBLE_MS = 4000
export const PET_LONG_PRESS_MS = 650
export const PET_DRAG_THRESHOLD = 6

/** 所有主题都显示（经典=电脑人，其余=对应角色）；教练页隐藏。 */
export function shouldShowFloatingPet(i: { enabled: boolean; petEnabled: boolean; theme: string; onCoachTab: boolean; visible: boolean }): boolean {
  return i.enabled && i.petEnabled && !i.onCoachTab && i.visible
}

/** 把位置限制在屏幕内。bottomReserve 给底部导航留出空间。 */
export function clampPos(pos: PetPos, view: { w: number; h: number }, size: { w: number; h: number }, bottomReserve = 72, topReserve = 8): PetPos {
  const maxX = Math.max(0, view.w - size.w - 4)
  const maxY = Math.max(topReserve, view.h - size.h - bottomReserve)
  const fin = (n: number, d: number) => (Number.isFinite(n) ? n : d)
  return { x: Math.min(Math.max(4, fin(pos.x, maxX)), Math.max(4, maxX)), y: Math.min(Math.max(topReserve, fin(pos.y, maxY)), maxY) }
}

export function parsePos(raw: string | null | undefined): PetPos | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (v && typeof v === 'object' && typeof (v as PetPos).x === 'number' && typeof (v as PetPos).y === 'number' && Number.isFinite((v as PetPos).x) && Number.isFinite((v as PetPos).y)) return { x: (v as PetPos).x, y: (v as PetPos).y }
  } catch { /* ignore */ }
  return null
}

type Store = Pick<Storage, 'getItem' | 'setItem'>
export function readPetPos(store: Pick<Storage, 'getItem'> | undefined, key: string): PetPos | null {
  try { return parsePos(store?.getItem(key)) } catch { return null }
}
export function writePetPos(store: Pick<Storage, 'setItem'> | undefined, key: string, pos: PetPos): boolean {
  try { store?.setItem(key, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })); return true } catch { return false }
}
/** 没存过 = 显示；只有明确存了 "0" 才隐藏。 */
export function readPetVisible(store: Pick<Storage, 'getItem'> | undefined, key: string): boolean {
  try { return store?.getItem(key) !== '0' } catch { return true }
}
export function writePetVisible(store: Pick<Storage, 'setItem'> | undefined, key: string, visible: boolean): boolean {
  try { store?.setItem(key, visible ? '1' : '0'); return true } catch { return false }
}
export type { Store as PetStore }

/** 气泡状态：点一下 → 出现下一句并换表情；到时间或再次收起 → 回到待机。 */
export type BubbleState = { tip: number; open: boolean }
export type BubbleAction = { type: 'tap' } | { type: 'close' }
export const initialBubble: BubbleState = { tip: -1, open: false }
export function bubbleReducer(state: BubbleState, action: BubbleAction): BubbleState {
  if (action.type === 'tap') return { tip: (state.tip + 1) % PET_TIPS.length, open: true }
  return { ...state, open: false }
}
export function moodForBubble(state: BubbleState, idle: PetMood = PET_IDLE_MOOD): PetMood {
  return state.open && state.tip >= 0 ? PET_TIPS[state.tip].mood : idle
}
