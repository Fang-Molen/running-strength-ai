import { useEffect, useMemo, useState } from 'react';
import { useApprovedVideos } from './use-approved-videos';
import { DEMO_STATUS_LABEL, demoStatusOf } from '@/lib/strength/library-view';
import { defaultPoseGender, poseCardUrl } from '@/lib/strength/pose-cards-r8';
import { ACTIONS, SECTIONS, categoryPatterns, queryActions, sectionCounts, type ActionEntry, type ActionSection } from '@/lib/strength/action-picker';

type Mode = 'search' | 'category' | 'muscle';
type Props = { selectedKeys: readonly string[]; onAdd: (entry: ActionEntry) => void; onPreview: (entry: ActionEntry) => void; onMuscle: () => void };
const CHIP = 'min-h-11 rounded-xl border border-line px-3 py-2 text-sm';
const COUNTS = sectionCounts(ACTIONS);

/** 三条路径最终调用同一明确 onAdd；筛选和打开预览绝不修改训练。 */
export function ActionPicker({ selectedKeys, onAdd, onPreview, onMuscle }: Props) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<ActionSection | null>(null);
  const [pattern, setPattern] = useState<string | null>(null);
  const [limit, setLimit] = useState(16);
  const approved = useApprovedVideos(), [gender] = useState(defaultPoseGender);
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const rows = useMemo(() => queryActions(ACTIONS, mode === 'search' ? query : '', mode === 'category' ? section : null, mode === 'category' ? pattern : null), [mode, query, section, pattern]);
  useEffect(() => { setLimit(16); }, [mode, query, section, pattern]);
  const changeMode = (next: Mode) => { setMode(next); if (next === 'muscle') onMuscle(); };
  const createCustom = () => {
    const name = query.trim().slice(0, 80);
    if (!name) return;
    onAdd({ key: `extra:${name}`, name, en: '', parts: [], section: '全身', pattern: '其他动作', catalogId: null, sourceId: null });
  };
  const customName = query.trim();
  const exact = ACTIONS.some(e => e.name.toLocaleLowerCase() === customName.toLocaleLowerCase());
  return <section aria-label="力量动作添加方式" className="fk-action-picker space-y-3">
    <h3 className="font-bold">添加力量动作</h3>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="动作添加方式">
      {([['search', '搜索添加'], ['category', '分类添加'], ['muscle', '肌肉图选择']] as [Mode, string][]).map(([key, title]) => <button
        type="button" key={key} aria-label={title} aria-pressed={mode === key} className={`${CHIP} ${mode === key ? 'border-accent bg-accent/15 text-accent font-bold' : ''}`}
        onClick={() => changeMode(key)}>{key === 'search' ? '搜索' : key === 'category' ? '分类' : '肌肉图'}</button>)}
    </div>
    {mode === 'search' ? <div>
      <label className="block text-sm font-medium" htmlFor="fk-exercise-search">搜索动作</label>
      <input id="fk-exercise-search" type="search" className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" autoComplete="off" placeholder="例如：深蹲 / squat / 提踵" value={query} onChange={e => setQuery(e.target.value)} />
    </div> : null}
    {mode === 'category' ? <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" aria-label="动作类别">
        {COUNTS.map(({ name, count }) => <button type="button" key={name} aria-pressed={section === name} className={`${CHIP} flex items-center justify-between ${section === name ? 'border-accent bg-accent/15 text-accent font-bold' : ''}`}
          onClick={() => { setSection(name === section ? null : name); setPattern(null); }}><span>{name}</span><small>{count} 项 ›</small></button>)}
      </div>
      {section ? <div><p className="keep text-sm font-bold">{section}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={`${CHIP} ${pattern === null ? 'border-accent text-accent' : ''}`} aria-pressed={!pattern} onClick={() => setPattern(null)}>全部</button>{categoryPatterns(ACTIONS, section).map(p => <button type="button" key={p} aria-pressed={pattern === p} className={`${CHIP} ${pattern === p ? 'border-accent text-accent' : ''}`} onClick={() => setPattern(p)}>{p}</button>)}</div></div> : null}
    </div> : null}
    {mode === 'muscle' ? <div className="rounded-xl border border-accent/40 p-3">
      <button type="button" className="fk-chip min-h-11" onClick={onMuscle}>打开肌肉图 ›</button>
    </div> : null}
    {mode !== 'muscle' ? <div className="space-y-2">
      <p className="keep text-xs text-muted" role="status">{rows.length} 个动作</p>
      <div className="space-y-2" aria-label="可添加动作">
        {rows.slice(0, limit).map(item => {
          const already = selected.has(item.key) || selected.has(item.sourceId ?? '');
          const status = demoStatusOf({ id: item.catalogId ?? item.key, catalogId: item.catalogId, source: item.sourceId?.startsWith('external:') ? 'external' : 'local' }, gender, approved);
          const thumb = status === 'none' ? null : poseCardUrl(item.catalogId ?? item.key, gender);
          return <div key={item.key} className="flex min-w-0 items-center gap-2 rounded-xl border border-line px-3 py-2">
            <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2" aria-hidden="true">{thumb ? <img src={thumb} loading="lazy" decoding="async" alt="" className="h-full w-full object-cover object-top" /> : <small className="text-[11px] text-muted">无图</small>}</span>
            <div className="min-w-0 flex-1"><b className="block break-words text-sm">{item.name}</b><small className="block text-muted">{item.parts.length ? item.parts.join('、') : item.section}</small><small className="block text-muted">{DEMO_STATUS_LABEL[status]}</small></div>
            <button type="button" className="min-h-11 shrink-0 px-2 text-sm font-bold text-accent" aria-label={`查看${item.name}说明`} onClick={() => onPreview(item)}>查看动作</button>
            <button type="button" className="min-h-11 shrink-0 rounded-xl border border-accent px-3 text-sm font-bold text-accent disabled:border-line disabled:text-muted" disabled={already} onClick={() => onAdd(item)}>{already ? '已添加' : '＋加入'}</button>
          </div>;
        })}
      </div>
      {rows.length > limit ? <button type="button" className="fk-chip min-h-11" onClick={() => setLimit(l => l + 16)}>查看更多（剩余 {rows.length - limit} 项）</button> : null}
      {!rows.length ? <p className="keep rounded-xl border border-dashed border-line p-3 text-sm text-muted">没有匹配动作，可换个名称或自定义。</p> : null}
      {mode === 'search' && customName && !exact ? <button type="button" className="fk-chip min-h-11" disabled={selected.has(`extra:${customName}`)} onClick={createCustom}>＋自定义「{customName.slice(0, 24)}」</button> : null}
    </div> : null}
  </section>;
}
