import { useEffect, useState } from 'react'
import { getCharacterTheme, readCharacterTheme, CHARACTER_THEME_KEY, type CharacterThemeId } from '@/lib/ui/character-themes'

/** 同一页面内切换主题时发出的事件（storage 事件只在其他标签页触发）。 */
export const CHARACTER_THEME_EVENT = 'fk-character-theme-change'

/** 读取当前角色主题：与 strength-app 同一份 localStorage，同页切换用自定义事件，其他标签页用 storage 事件。 */
export function useCharacterThemeId(): CharacterThemeId {
  const [theme, setTheme] = useState<CharacterThemeId>('classic')
  useEffect(() => {
    const read = () => setTheme(readCharacterTheme(window.localStorage))
    const onStorage = (e: StorageEvent) => { if (e.key === CHARACTER_THEME_KEY || e.key === null) read() }
    read()
    window.addEventListener('storage', onStorage)
    window.addEventListener(CHARACTER_THEME_EVENT, read)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHARACTER_THEME_EVENT, read) }
  }, [])
  return theme
}

/** 页面里代表"方坤"的小头像：经典 = 原电脑人，七套主题 = 对应角色头像。图片加载失败时显示 fallback。 */
export function ThemeAvatar({ className, fallback, theme: forced }: { className?: string; fallback?: React.ReactNode; theme?: CharacterThemeId }) {
  const current = useCharacterThemeId()
  const theme = forced ?? current
  const info = theme === 'classic' ? null : getCharacterTheme(theme)
  const [failed, setFailed] = useState<string | null>(null)
  const src = info ? info.avatar : '/fangshen/care-bust.png'
  if (failed === src && fallback) return <>{fallback}</>
  return <img src={src} alt="" aria-hidden="true" draggable={false} data-testid="theme-avatar" data-avatar={info ? info.id : 'classic'} onError={() => setFailed(src)} className={className ?? 'size-full object-cover'} />
}
