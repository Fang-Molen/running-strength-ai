import { useState, type ReactNode } from 'react'
import { PET_ENABLED, petMoodSrc, type PetRoleId } from './config'
import type { PetMood } from './mood'

/** 桌宠：只通过 props 接收表情。总开关关闭或图片加载失败时什么都不显示，不影响聊天。 */
export function CoachPet({ mood, size = 44, fallback = null, role = 'chiyan' }: { mood: PetMood; size?: number; fallback?: ReactNode; role?: PetRoleId }) {
  const [failed, setFailed] = useState<ReadonlySet<PetMood>>(() => new Set())
  if (!PET_ENABLED || failed.has(mood)) return <>{fallback}</>
  return <img key={mood} src={petMoodSrc(role, mood)} data-role={role} alt="" aria-hidden="true" data-testid="coach-pet" data-mood={mood} loading="lazy" decoding="async" draggable={false}
    width={Math.round(size * 0.77)} height={size} className="pointer-events-none shrink-0 select-none object-contain" style={{ height: size, width: 'auto' }}
    onError={() => setFailed(prev => new Set(prev).add(mood))} />
}
