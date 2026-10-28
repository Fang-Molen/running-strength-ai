import { useEffect, useRef, useState } from 'react'
import { fetchModel, preview, verifiedMediaBytes, type Gender } from '@/lib/character/identity'
import { ChiyanStill } from '@/components/pet'
type View = 'front' | 'side' | 'back' | 'three'
type Controller = { setView(v: View): void; setAppearance(x: Record<string, number>): void; destroy(): void }
export function FangkunHealthCharacter({ gender, view = 'front', appearance = {} }: { gender: Gender; view?: View; appearance?: Record<string, number> }) {
  const canvas = useRef<HTMLCanvasElement>(null), controller = useRef<Controller | null>(null)
  const latest = useRef({ view, appearance }); latest.current = { view, appearance }
  const [loadedGender, setLoadedGender] = useState<Gender | null>(null), [message, setMessage] = useState('核对3D素材中…')
  const ready = loadedGender === gender
  useEffect(() => {
    const abort = new AbortController(); let instance: Controller | null = null
    setLoadedGender(null); setMessage('核对3D素材中…')
    const fail = () => { if (!abort.signal.aborted) { setLoadedGender(null); setMessage('3D暂不可用，显示同角色设计参考。'); instance?.destroy(); controller.current = null } }
    void (async () => {
      const asset = await fetchModel(gender, abort.signal)
      if (abort.signal.aborted) return
      if (!asset) { setMessage('同形象3D待制作与审核；当前为角色参考图。'); return }
      const data = await verifiedMediaBytes(asset, abort.signal)
      const mod = await import(/* @vite-ignore */ new URL('/fangkun-character/viewer.js', location.origin).href)
      if (abort.signal.aborted || !canvas.current) return
      instance = await mod.createVerifiedViewer(canvas.current, { data, ...latest.current, signal: abort.signal, onFailure: fail })
      if (abort.signal.aborted) { instance?.destroy(); return }
      controller.current = instance; instance?.setView(latest.current.view); instance?.setAppearance(latest.current.appearance)
      setLoadedGender(gender); setMessage('已审核3D人物')
    })().catch(fail)
    return () => { abort.abort(); instance?.destroy(); controller.current = null }
  }, [gender])
  useEffect(() => { if (ready) controller.current?.setView(view) }, [view, ready])
  useEffect(() => {
    if (ready) try { controller.current?.setAppearance(appearance) } catch { controller.current?.destroy(); controller.current = null; setLoadedGender(null); setMessage('体型形变不可用，保留外观参考。') }
  }, [appearance, ready])
  return <div className="relative h-full w-full overflow-hidden rounded-xl bg-[#15181d]" aria-label="方坤人物形象">
    <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ visibility: ready ? 'visible' : 'hidden' }} aria-hidden={!ready} aria-label="可旋转3D人物" />
    {!ready && <ChiyanStill gender={gender} fallbackSrc={preview(gender, view)} fallbackAlt="角色外观参考图（非3D）" className="h-full w-full object-contain" />}
    {!ready && <p role="status" className="absolute inset-x-2 bottom-2 rounded-lg bg-black/75 p-2 text-xs text-white">{message}</p>}
  </div>
}
