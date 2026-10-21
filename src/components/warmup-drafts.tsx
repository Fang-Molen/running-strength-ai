import { useEffect, useId, useRef, useState } from 'react';
import drafts from '@/lib/education/warmup-drafts-r4.json';

/** R4 remains a separate, unreviewed preview catalogue, never a training prescription. */
export const WARMUP_DRAFTS: readonly { id: string; name: string; female: string; male: string }[] = drafts;

function DraftVideo({ src, name, active }: { src: string; name: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const statusId = useId();
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const available = useRef(active); available.current = active;
  const fail = () => { ref.current?.pause(); setPlaying(false); setLoading(false); setError('视频暂时无法加载。请检查网络后重试，知识正文仍可阅读。'); };

  useEffect(() => {
    const video = ref.current;
    if (!active) video?.pause();
    const stopWhenHidden = () => { if (document.visibilityState === 'hidden') video?.pause(); };
    document.addEventListener('visibilitychange', stopWhenHidden);
    const stop = () => video?.pause();
    window.addEventListener('pagehide', stop);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) video?.pause();
    });
    if (video) observer?.observe(video);
    return () => { video?.pause(); observer?.disconnect(); document.removeEventListener('visibilitychange', stopWhenHidden); window.removeEventListener('pagehide', stop); };
  }, [active]);

  useEffect(() => {
    if (!loading || !active) return;
    const timer = window.setTimeout(fail, 15000);
    return () => window.clearTimeout(timer);
  }, [loading, active]);

  const play = async () => {
    const video = ref.current;
    if (!video || !available.current) return;
    setError(''); setLoading(video.readyState < 3);
    try {
      await video.play();
      if (!available.current || document.visibilityState === 'hidden') video.pause();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      fail();
    }
  };
  // The visible Pause control must never restart playback if an observer has
  // just paused the video before React receives the native pause event.
  const toggle = () => { if (playing) { ref.current?.pause(); setPlaying(false); } else void play(); };
  const ready = () => { setLoading(false); setError(''); };
  return <div className="space-y-2" data-testid="warmup-player">
    <video ref={ref} src={src} loop muted playsInline preload="metadata" aria-label={`${name} 草案示意视频`} aria-describedby={statusId}
      onPlay={event => { if (!available.current || document.visibilityState === 'hidden') event.currentTarget.pause(); else setPlaying(true); }}
      onPlaying={ready} onPause={() => setPlaying(false)} onError={fail}
      onWaiting={() => setLoading(true)} onCanPlay={ready}
      onLoadedMetadata={event => { event.currentTarget.playbackRate = slow ? 0.5 : 1; ready(); }}
      className="mx-auto block w-full max-w-[240px] rounded-lg bg-black" style={{ aspectRatio: '3 / 4' }} />
    <p id={statusId} role="status" className="text-center text-xs leading-relaxed text-muted">
      {error || (loading ? '正在加载视频…' : playing ? '循环播放中；离开画面会自动暂停。' : '已暂停 · 点击播放；离线时未加载的视频可能不可用。')}
    </p>
    <div className="flex flex-wrap justify-center gap-2">
      {error ? <button type="button" className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={() => { setError(''); setLoading(true); ref.current?.load(); void play(); }}>重新加载</button>
        : <button type="button" aria-pressed={playing} className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={toggle}>{playing ? '暂停' : '播放'}</button>}
      <button type="button" aria-pressed={slow} className="min-h-11 rounded-lg border border-line px-3 text-sm" onClick={() => { const next = !slow; setSlow(next); if (ref.current) ref.current.playbackRate = next ? 0.5 : 1; }}>{slow ? '0.5 倍速' : '正常速度'}</button>
    </div>
  </div>;
}

export function WarmupDrafts({ active = true }: { active?: boolean }) {
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const uid = useId();
  const matches = WARMUP_DRAFTS.filter(d => d.name.normalize('NFKC').includes(query.normalize('NFKC').trim()));
  return <details className="fk-warmup-drafts home-card p-3" data-testid="warmup-drafts" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer content-center font-semibold"><span className="block">基础热身动作 · {WARMUP_DRAFTS.length} 项</span><span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 text-xs font-normal text-amber-500">草案·动作未经专业审核</span></summary>
    <p className="mt-2 text-xs leading-relaxed text-muted">2D 示意草案（每条约 3 秒，循环播放），仅供预览，不是标准教学，也不对应力量动作库里的其他动作。动作有疑问以教练现场指导为准。</p>
    <div className="mt-2 flex gap-2" role="group" aria-label="示意人物">
      {(['female', 'male'] as const).map(g => <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)} className={`min-h-11 rounded-full border px-3 text-sm ${gender === g ? 'border-accent text-accent' : 'border-line text-muted'}`}>{g === 'female' ? '女' : '男'}</button>)}
    </div>
    <label className="mt-3 block text-xs text-muted" htmlFor={`${uid}-search`}>查找热身动作</label>
    <input id={`${uid}-search`} type="search" maxLength={60} value={query} onChange={event => setQuery(event.target.value)} placeholder="输入动作名称，例如摆臂、半蹲" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base" />
    <ul className="mt-2 space-y-1">
      {matches.map(d => <li key={d.id} className="rounded-lg border border-line">
        <button type="button" aria-expanded={openId === d.id} aria-controls={`${uid}-${d.id}`} className="min-h-11 w-full px-3 text-left text-sm" onClick={() => setOpenId(openId === d.id ? null : d.id)}>{d.name}<span className="ml-2 text-xs text-muted">草案</span></button>
        <div id={`${uid}-${d.id}`} hidden={openId !== d.id}>
          {expanded && openId === d.id ? <div className="px-3 pb-3"><DraftVideo key={d[gender]} src={d[gender]} name={d.name} active={active} /></div> : null}
        </div>
      </li>)}
    </ul>
    {!matches.length ? <div role="status" className="mt-2 text-sm text-muted">没有匹配的热身动作。<button type="button" className="min-h-11 px-2 text-accent" onClick={() => setQuery('')}>显示全部动作</button></div> : null}
  </details>;
}
