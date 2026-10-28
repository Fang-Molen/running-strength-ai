import type { ReactNode } from 'react'
import { getCharacterTheme, type CharacterThemeId } from '@/lib/ui/character-themes'
import { CoachPet } from './coach-pet'
import { petRoleForTheme } from './config'
import type { PetMood } from './mood'

/** 教练头像：位置上永远只有一个。
 *  经典主题 → 原来的电脑人（由调用方传入 classic）；七套主题 → 该主题角色的表情图（pet=true 时随回答换表情，
 *  气泡里的小头像是静态头像）。表情图加载失败或总开关关闭时，退回该主题的静态头像。 */
export function CoachAvatar({ theme, mood, classic, title, size = 'bar', pet = true }: {
  theme: CharacterThemeId; mood: PetMood; classic: ReactNode; title?: string; size?: 'bar' | 'bubble'; pet?: boolean
}) {
  const info = theme === 'classic' ? null : getCharacterTheme(theme)
  const box = size === 'bar' ? 'size-9' : 'mt-1 size-8'
  if (!info) return <span data-testid="coach-avatar" data-avatar="classic" className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-full bg-surface`} title={title}>{classic}</span>
  const still = <img src={info.avatar} alt="" aria-hidden="true" draggable={false} data-testid="coach-avatar-still" className="size-full rounded-full object-cover" />
  if (pet && size === 'bar') {
    return <span data-testid="coach-avatar" data-avatar="pet" className="grid h-11 shrink-0 place-items-center" title={title}>
      <CoachPet role={petRoleForTheme(theme)} mood={mood} size={44} fallback={<span className="grid size-9 place-items-center overflow-hidden rounded-full">{still}</span>} />
    </span>
  }
  return <span data-testid="coach-avatar" data-avatar="theme" className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-full bg-surface`} title={title}>{still}</span>
}
