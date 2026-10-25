import { poseFrames, type PoseGender } from '@/lib/strength/pose-cards-r8'

/** 关键帧：起始、过程、到位三帧逐帧显示；缺帧不补图，只写缺哪一帧。图片只在打开动作后才加载。 */
export default function PoseFrames({ exerciseId, gender }: { exerciseId: string; gender: PoseGender }) {
  const frames = poseFrames(exerciseId, gender)
  const missing = frames.filter(f => !f.url).map(f => f.label)
  return <section className="fk-pose-frames" aria-label="动作关键帧" data-testid="pose-frames">
    <div className="fk-pose-grid">{frames.map(f => f.url
      ? <figure key={f.key}><img src={f.url} loading="lazy" decoding="async" alt={`${f.label}帧`}/><figcaption>{f.label}</figcaption></figure>
      : <figure key={f.key} className="empty"><div>暂无</div><figcaption>{f.label}</figcaption></figure>)}</div>
    {missing.length ? <p className="fk-pose-missing">缺：{missing.join('、')}，待补图，未补前不进入标准。</p> : null}
  </section>
}
