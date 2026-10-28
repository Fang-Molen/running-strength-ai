import { useState } from 'react'
import { PET_BASE, PET_ENABLED } from './config'

/** 体型模拟里「没有 3D 模型时」显示的参考图。
 *  男版：赤焰·逐风全身立绘（静态，不随滑杆变形）；女版：保持原参考图，并如实标注「女版待制作」。
 *  总开关关闭或立绘加载失败时，输出与接入前完全相同的原参考图。 */
export function ChiyanStill({ gender, fallbackSrc, fallbackAlt, className }: { gender: 'male' | 'female'; fallbackSrc: string; fallbackAlt: string; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!PET_ENABLED) return <img src={fallbackSrc} alt={fallbackAlt} className={className} />
  if (gender === 'female') return <>
    <img src={fallbackSrc} alt={fallbackAlt} className={className} />
    <p data-testid="chiyan-note" className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white">女版形象待制作 · 当前为原参考图</p>
  </>
  if (failed) return <img src={fallbackSrc} alt={fallbackAlt} className={className} />
  return <>
    <img src={`${PET_BASE}/chiyan-fullbody.webp`} alt="赤焰·逐风全身立绘（静态形象，非3D）" className={className} decoding="async" onError={() => setFailed(true)} />
    <p data-testid="chiyan-note" className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white">赤焰·逐风 · 静态形象，不随滑杆变形</p>
  </>
}
