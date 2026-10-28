import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { FLOATING_PET_ENABLED, FLOATING_PET_POS_KEY, FLOATING_PET_VISIBLE_KEY, PET_ENABLED, petMoodSrc, petRoleForTheme } from './config'
import { PET_DONE_EVENTS, PET_DONE_MS, petMoodForPage } from './page-mood'
import {
  PET_BUBBLE_MS, PET_DRAG_THRESHOLD, PET_LONG_PRESS_MS, PET_TIPS, bubbleReducer, clampPos, initialBubble, moodForBubble,
  readPetPos, readPetVisible, shouldShowFloatingPet, writePetPos, writePetVisible, type BubbleState, type PetPos,
} from './floating-pet-logic'

export const PET_VISIBLE_EVENT = 'fk-pet-visible-change'
const PET_H = 68
const PET_W = 52
/** 动画只用 CSS transform，不加图片。reduce-motion 时一律不加动画类（JS 与 CSS 两层都关）。 */
const CSS = `
@keyframes fk-fpet-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,1.045)}}
@keyframes fk-fpet-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.9)}}
@keyframes fk-fpet-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes fk-fpet-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-10px)}70%{transform:translateY(0)}85%{transform:translateY(-3px)}}
.fk-fpet-breathe{animation:fk-fpet-breathe 3.6s ease-in-out infinite;transform-origin:50% 100%}
.fk-fpet-blink{animation:fk-fpet-blink 5.2s ease-in-out infinite;transform-origin:50% 100%}
.fk-fpet-bounce{animation:fk-fpet-bounce .5s ease-in-out infinite}
.fk-fpet-hop{animation:fk-fpet-hop .6s ease-out 1}
@media (prefers-reduced-motion:reduce){.fk-fpet-breathe,.fk-fpet-blink,.fk-fpet-bounce,.fk-fpet-hop{animation:none!important}}
`

function usePrefersReducedMotion(override?: boolean): boolean {
  const [reduced, setReduced] = useState(override ?? false)
  useEffect(() => {
    if (override !== undefined) { setReduced(override); return }
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined
    if (!media) return
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [override])
  return reduced
}

function localStore(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }

/** 悬浮桌宠：所有主题都出现（经典=电脑人，其余=该主题角色），教练页、总开关或显示开关关闭时不出现。
 *  不联网、不读写训练数据；位置与显示偏好只存本机 localStorage（fk-pet-pos-v1 / fk-pet-visible-v1）。
 *  enabled / visible / reducedMotion / initialBubble / storage 仅供测试注入。 */
export function FloatingPet({ theme, page = 'today', onCoachTab = false, enabled = FLOATING_PET_ENABLED, visible: visibleOverride, reducedMotion, initialBubble: bubbleInit = initialBubble, storage, initialDone = false, initialHop = false }: {
  theme: string; page?: string; onCoachTab?: boolean; enabled?: boolean; visible?: boolean; reducedMotion?: boolean; initialBubble?: BubbleState; storage?: Storage; initialDone?: boolean; initialHop?: boolean
}) {
  const store = storage ?? localStore()
  const [visible, setVisible] = useState(() => visibleOverride ?? readPetVisible(store, FLOATING_PET_VISIBLE_KEY))
  const [pos, setPos] = useState<PetPos | null>(null)
  const [bubble, dispatch] = useReducer(bubbleReducer, bubbleInit)
  const [place, setPlace] = useState({ below: false, alignLeft: false })
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const [done, setDone] = useState(initialDone)
  const [hop, setHop] = useState(initialHop)
  const lastPage = useRef(page)
  const reduced = usePrefersReducedMotion(reducedMotion)
  const wrap = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick = useRef(false)
  const posRef = useRef<PetPos | null>(null)
  const show = shouldShowFloatingPet({ enabled, petEnabled: PET_ENABLED, theme, onCoachTab, visible })

  const view = () => ({ w: window.innerWidth, h: window.innerHeight })
  const size = () => { const r = wrap.current?.getBoundingClientRect(); return { w: r?.width || PET_W, h: r?.height || PET_H } }

  // 显示偏好：外观设置里的开关、其他标签页改动都会同步
  useEffect(() => {
    if (visibleOverride !== undefined) { setVisible(visibleOverride); return }
    const sync = () => setVisible(readPetVisible(store, FLOATING_PET_VISIBLE_KEY))
    const onStorage = (e: StorageEvent) => { if (e.key === FLOATING_PET_VISIBLE_KEY || e.key === null) sync() }
    window.addEventListener(PET_VISIBLE_EVENT, sync); window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(PET_VISIBLE_EVENT, sync); window.removeEventListener('storage', onStorage) }
  }, [store, visibleOverride])

  // 位置：读存档并限制在屏幕内；窗口变化时重新限制
  useEffect(() => {
    if (!show) return
    const saved = readPetPos(store, FLOATING_PET_POS_KEY)
    if (saved) { const p = clampPos(saved, view(), size()); posRef.current = p; setPos(p) }
    const onResize = () => { if (posRef.current) { const p = clampPos(posRef.current, view(), size()); posRef.current = p; setPos(p) } }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [show, store])

  // 切页：换页面表情，并小跳一次（首次挂载不跳）
  useEffect(() => {
    if (lastPage.current === page) return
    lastPage.current = page
    setHop(true)
    const t = setTimeout(() => setHop(false), 700)
    return () => clearTimeout(t)
  }, [page])
  // 记录/饮食保存后短暂 done（只监听应用已有事件，不读写数据）
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const on = () => { setDone(true); if (t) clearTimeout(t); t = setTimeout(() => setDone(false), PET_DONE_MS) }
    for (const n of PET_DONE_EVENTS) window.addEventListener(n, on)
    return () => { for (const n of PET_DONE_EVENTS) window.removeEventListener(n, on); if (t) clearTimeout(t) }
  }, [])

  // 气泡几秒后自动收起，表情恢复
  useEffect(() => {
    if (!bubble.open) return
    const t = setTimeout(() => dispatch({ type: 'close' }), PET_BUBBLE_MS)
    return () => clearTimeout(t)
  }, [bubble.open, bubble.tip])
  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current) }, [])

  const hide = useCallback(() => {
    writePetVisible(store, FLOATING_PET_VISIBLE_KEY, false)
    setVisible(false); dispatch({ type: 'close' })
    try { window.dispatchEvent(new Event(PET_VISIBLE_EVENT)) } catch { /* ignore */ }
  }, [store])

  if (!show) return null
  const role = petRoleForTheme(theme)
  const idleMood = done ? 'done' : petMoodForPage(page)
  const mood = moodForBubble(bubble, idleMood)
  const shownMood = failed.has(role + ':' + mood) ? 'hello' : mood
  if (failed.has(role + ':hello')) return null
  const clearPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    suppressClick.current = false
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    clearPress()
    pressTimer.current = setTimeout(() => { if (drag.current && !drag.current.moved) { suppressClick.current = true; drag.current = null; hide() } }, PET_LONG_PRESS_MS)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < PET_DRAG_THRESHOLD) return
    if (!d.moved) { d.moved = true; clearPress(); dispatch({ type: 'close' }) }
    const p = clampPos({ x: d.ox + dx, y: d.oy + dy }, view(), size())
    posRef.current = p; setPos(p)
  }
  const endPointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    clearPress()
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d.moved) { suppressClick.current = true; if (posRef.current) writePetPos(store, FLOATING_PET_POS_KEY, posRef.current) }
  }
  const onClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    const r = wrap.current?.getBoundingClientRect()
    if (r) setPlace({ below: r.top < 110, alignLeft: r.left + r.width / 2 < window.innerWidth / 2 })
    dispatch({ type: 'tap' })
  }

  const motion = !reduced
  const talking = bubble.open
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }
  const tip = bubble.open && bubble.tip >= 0 ? PET_TIPS[bubble.tip].text : null
  return <div ref={wrap} data-testid="floating-pet" data-role={role} data-mood={shownMood} data-page={page} data-motion={motion ? 'on' : 'off'} className="pointer-events-none fixed z-30 select-none" style={style}>
    <style>{CSS}</style>
    {tip ? <div role="status" data-testid="floating-pet-bubble" className={'pointer-events-auto absolute w-40 rounded-2xl border border-line bg-surface px-2.5 py-1.5 text-xs leading-snug text-fg shadow-lg ' + (place.below ? 'top-full mt-1 ' : 'bottom-full mb-1 ') + (place.alignLeft ? 'left-0' : 'right-0')}>
      <p>{tip}</p>
      <button type="button" data-testid="floating-pet-hide" onClick={hide} className="mt-1 min-h-7 rounded-md border border-line px-2 text-[11px] leading-none text-muted">收起</button>
    </div> : null}
    <button type="button" data-testid="floating-pet-body" aria-label="桌宠。点一下说句话，拖动可移动，长按收起"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onClick={onClick} onContextMenu={e => e.preventDefault()}
      className={'pointer-events-auto block cursor-grab bg-transparent p-0 ' + (motion && talking ? 'fk-fpet-bounce' : motion && hop ? 'fk-fpet-hop' : '')}
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}>
      <span className={'block ' + (motion ? 'fk-fpet-breathe' : '')}>
        <img key={role + shownMood} src={petMoodSrc(role, shownMood)} alt="" aria-hidden="true" draggable={false} decoding="async" data-testid="floating-pet-img"
          className={'pointer-events-none block select-none object-contain ' + (motion ? 'fk-fpet-blink' : '')} style={{ height: PET_H, width: 'auto' }}
          onError={() => setFailed(prev => new Set(prev).add(role + ':' + shownMood))} />
      </span>
    </button>
  </div>
}

/** 外观设置里的「显示悬浮桌宠」开关。所有主题都可见。 */
export function PetVisibleToggle({ enabled = FLOATING_PET_ENABLED, storage, initialVisible }: { theme?: string; enabled?: boolean; storage?: Storage; initialVisible?: boolean }) {
  const store = storage ?? localStore()
  const [on, setOn] = useState(() => initialVisible ?? readPetVisible(store, FLOATING_PET_VISIBLE_KEY))
  if (!enabled || !PET_ENABLED) return null
  const toggle = () => {
    const next = !on
    writePetVisible(store, FLOATING_PET_VISIBLE_KEY, next); setOn(next)
    try { window.dispatchEvent(new Event(PET_VISIBLE_EVENT)) } catch { /* ignore */ }
  }
  return <button type="button" data-testid="pet-visible-toggle" role="switch" aria-checked={on} onClick={toggle} className="fk-theme-classic mt-2">显示悬浮桌宠：{on ? '已开' : '已关'}</button>
}
