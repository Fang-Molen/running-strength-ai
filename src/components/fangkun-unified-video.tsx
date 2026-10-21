import { useEffect, useRef, useState } from 'react'
import { poseCardUrl, POSE_CARD_LABEL } from '@/lib/strength/pose-cards-r8'
import { fetchVideo, preview, verifiedMediaBytes, type Gender, type VideoAsset } from '@/lib/character/identity'

/** One exact catalogue ID and character. Images are identity references, never action frames. */
export function FangkunExerciseVideo({ exerciseId, title, gender }: { exerciseId: string; title: string; gender: Gender }) {
  const video = useRef<HTMLVideoElement>(null), container = useRef<HTMLElement>(null)
  const [media, setMedia] = useState<{ asset: VideoAsset; url: string } | null>(null)
  const [state, setState] = useState('核对演示素材中…'), [slow, setSlow] = useState(false), [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0), [retry, setRetry] = useState(0)
  const current = media?.asset.exerciseId === exerciseId && media.asset.gender === gender ? media : null
  useEffect(() => {
    const abort = new AbortController(); let url: string | null = null
    setMedia(null); setSlow(false); setPlaying(false); setProgress(0); setState('核对演示素材中…')
    void (async () => {
      const asset = await fetchVideo(exerciseId, gender, abort.signal)
      if (abort.signal.aborted) return
      if (!asset) { setState('此动作暂无已审核的同角色视频'); return }
      const bytes = await verifiedMediaBytes(asset, abort.signal)
      if (abort.signal.aborted) return
      url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
      setMedia({ asset, url }); setState('已审核同角色视频 · 已校验文件版本')
    })().catch(() => { if (!abort.signal.aborted) { setMedia(null); setState('视频暂不可用，保留本动作教学文字') } })
    return () => { abort.abort(); video.current?.pause(); if (url) URL.revokeObjectURL(url) }
  }, [exerciseId, gender, retry])
  useEffect(() => {
    const pause = () => { video.current?.pause(); setPlaying(false) }
    const visibility = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', visibility)
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) pause() }) : null
    if (container.current) io?.observe(container.current)
    return () => { pause(); document.removeEventListener('visibilitychange', visibility); io?.disconnect() }
  }, [current?.url])
  return <section ref={container} aria-label={`${title}动作演示`} className="overflow-hidden rounded-2xl border border-line bg-[#15181d] p-3">
    <h3 className="font-bold">{title} · {gender === 'female' ? '女性' : '男性'}版</h3>
    {current ? <>
      <video key={current.url} ref={video} src={current.url} playsInline muted loop controls preload="metadata" className="mt-3 h-[250px] w-full object-contain"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setMedia(null); setState('视频加载失败，保留图文教学') }}
        onTimeUpdate={() => { const v = video.current; if (v && Number.isFinite(v.duration) && v.duration > 0) setProgress(v.currentTime / v.duration * 100) }} />
      <label className="mt-2 block text-xs">视频进度<input aria-label="视频进度" className="w-full" type="range" min={0} max={100} value={progress} onChange={e => {
        const v = video.current; if (!v || !Number.isFinite(v.duration)) return; v.pause(); v.currentTime = Number(e.target.value) * v.duration / 100; setProgress(Number(e.target.value))
      }} /></label>
      <div className="mt-2 flex gap-2"><button type="button" className="fk-chip min-h-11" onClick={() => {
        const v = video.current; if (!v) return
        if (v.paused) void v.play().catch(() => setState('播放未能开始，请使用视频控件重试')); else v.pause()
      }}>{playing ? '暂停' : '播放'}</button><button className="fk-chip min-h-11" type="button" aria-pressed={slow} onClick={() => { setSlow(!slow); if (video.current) video.current.playbackRate = slow ? 1 : .5 }}>慢放 0.5×</button></div>
    </> : poseCardUrl(exerciseId, gender) ? <figure className="m-0 mt-2 rounded-xl bg-[#111318] p-2 text-center" data-testid="pose-card"><img key={`${exerciseId}:${gender}`} src={poseCardUrl(exerciseId, gender)!} loading="lazy" decoding="async" className="mx-auto max-h-[420px] w-full object-contain" alt={`${title} · ${gender === 'female' ? '女性' : '男性'}版姿势示意（待审核）`} /><figcaption className="mt-1 text-xs font-semibold text-amber-500">{POSE_CARD_LABEL} · 以文字要领为准</figcaption></figure>
    : <figure className="m-0 mt-2 rounded-xl bg-[#111318] p-2 text-center"><img src={preview(gender)} className="mx-auto h-[210px] max-w-full object-contain" alt={`${gender === 'female' ? '女性' : '男性'}角色参考，非${title}动作姿势`} /><figcaption className="text-xs text-muted">同角色外观参考 · 非本动作示范</figcaption></figure>}
    <p role="status" className="mt-2 text-xs text-muted">{state}{!current ? '。动作步骤与注意事项仍可阅读。' : ''}</p>
    {!current && <button type="button" className="fk-chip mt-2 min-h-11" onClick={() => setRetry(x => x + 1)}>重新检查视频</button>}
  </section>
}
