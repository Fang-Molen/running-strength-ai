import { useRef, useState } from 'react';
import drafts from '@/lib/education/warmup-drafts-r4.json';

/** v89.8：R4 15 项基础热身 2D 草案。独立清单，不映射到力量动作库；动作未经专业审核。 */
export const WARMUP_DRAFTS: readonly { id: string; name: string; female: string; male: string }[] = drafts;

function DraftVideo({ src, name }: { src: string; name: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) { void v.play().catch(() => setPlaying(false)); } else v.pause(); };
  const setRate = (next: boolean) => { setSlow(next); if (ref.current) ref.current.playbackRate = next ? 0.5 : 1; };
  return <div className="space-y-2">
    <video ref={ref} key={src} src={src} loop muted playsInline preload="metadata" aria-label={`${name} 草案示意视频`}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={e => { e.currentTarget.playbackRate = slow ? 0.5 : 1; }}
      className="mx-auto block w-full max-w-[240px] rounded-lg bg-black" style={{ aspectRatio: '3 / 4' }} />
    <div className="flex justify-center gap-2">
      <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={toggle}>{playing ? '暂停' : '播放'}</button>
      <button type="button" aria-pressed={slow} className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={() => setRate(!slow)}>{slow ? '0.5 倍速' : '正常速度'}</button>
    </div>
  </div>;
}

export function WarmupDrafts() {
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [openId, setOpenId] = useState<string | null>(null);
  return <details className="home-card p-3" data-testid="warmup-drafts">
    <summary className="min-h-11 cursor-pointer content-center font-semibold">基础热身动作 · {WARMUP_DRAFTS.length} 项 <span className="ml-1 rounded bg-amber-500/15 px-1.5 text-xs font-normal text-amber-500">草案·动作未经专业审核</span></summary>
    <p className="mt-2 text-xs leading-relaxed text-muted">2D 示意草案（每条约 3 秒，循环播放），仅供预览，不是标准教学，也不对应力量动作库里的其他动作。动作有疑问以教练现场指导为准。</p>
    <div className="mt-2 flex gap-2" role="group" aria-label="示意人物">
      {(['female', 'male'] as const).map(g => <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} className={`min-h-11 rounded-full border px-3 text-sm ${gender === g ? 'border-accent text-accent' : 'border-line text-muted'}`}>{g === 'female' ? '女' : '男'}</button>)}
    </div>
    <ul className="mt-2 space-y-1">
      {WARMUP_DRAFTS.map(d => <li key={d.id} className="rounded-lg border border-line">
        <button type="button" aria-expanded={openId === d.id} className="min-h-11 w-full px-3 text-left text-sm" onClick={() => setOpenId(openId === d.id ? null : d.id)}>{d.name}<span className="ml-2 text-xs text-muted">草案</span></button>
        {openId === d.id ? <div className="px-3 pb-3"><DraftVideo src={d[gender]} name={d.name} /></div> : null}
      </li>)}
    </ul>
  </details>;
}
