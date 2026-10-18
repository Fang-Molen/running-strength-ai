import { useEffect, useMemo, useState } from 'react';
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
  return <section aria-label="力量动作添加方式" className="space-y-3 rounded-2xl border border-line bg-surface/40 p-3">
    <h3 className="font-bold">添加力量动作</h3>
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="动作添加方式">
      {([['search', '搜索添加'], ['category', '分类添加'], ['muscle', '肌肉图选择']] as [Mode, string][]).map(([key, title]) => <button
        type="button" key={key} aria-pressed={mode === key} className={`${CHIP} ${mode === key ? 'border-accent bg-accent/15 text-accent font-bold' : ''}`}
        onClick={() => changeMode(key)}>{title}</button>)}
    </div>
    {mode === 'search' ? <div>
      <label className="block text-sm font-medium" htmlFor="fk-exercise-search">按中文名、英文名或动作类型搜索</label>
      <input id="fk-exercise-search" type="search" className="mt-2 min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base" autoComplete="off" placeholder="例如：深蹲 / squat / 提踵" value={query} onChange={e => setQuery(e.target.value)} />
      <p className="keep mt-2 text-xs text-muted">搜索全部本地动作，不受上方已选训练部位限制。</p>
    </div> : null}
    {mode === 'category' ? <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" aria-label="动作类别">
        {COUNTS.map(({ name, count }) => <button type="button" key={name} aria-pressed={section === name} className={`${CHIP} flex items-center justify-between ${section === name ? 'border-accent bg-accent/15 text-accent font-bold' : ''}`}
          onClick={() => { setSection(name === section ? null : name); setPattern(null); }}><span>{name}</span><small>{count} 项 ›</small></button>)}
      </div>
      {section ? <div><p className="keep text-sm font-bold">{section} · 按动作模式细分</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={`${CHIP} ${pattern === null ? 'border-accent text-accent' : ''}`} aria-pressed={!pattern} onClick={() => setPattern(null)}>全部</button>{categoryPatterns(ACTIONS, section).map(p => <button type="button" key={p} aria-pressed={pattern === p} className={`${CHIP} ${pattern === p ? 'border-accent text-accent' : ''}`} onClick={() => setPattern(p)}>{p}</button>)}</div></div> : <p className="keep text-xs text-muted">先选择胸背肩腿、核心或足踝等类别，再选择具体动作。也可以在这里显示全部动作。</p>}
    </div> : null}
    {mode === 'muscle' ? <div className="rounded-xl border border-accent/40 p-3">
      <p className="keep text-sm">点人体图的肌肉位置，按主要/辅助肌群筛选；支持正面、背面、足部和小腿。模型失败时可改用肌肉名称列表。</p>
      <button type="button" className="fk-chip mt-3 min-h-11" onClick={onMuscle}>重新打开人体肌肉图 ›</button>
    </div> : null}
    {mode !== 'muscle' ? <div className="space-y-2">
      <p className="keep text-xs text-muted" role="status">找到 {rows.length} 个动作 · 点击「加入」后才会添加到训练</p>
      <div className="space-y-2" aria-label="可添加动作">
        {rows.slice(0, limit).map(item => {
          const already = selected.has(item.key) || selected.has(item.sourceId ?? '');
          return <div key={item.key} className="flex min-w-0 items-center gap-2 rounded-xl border border-line px-3 py-2">
            <div className="min-w-0 flex-1"><b className="block break-words text-sm">{item.name}</b><small className="block text-muted">{item.section} · {item.pattern}{item.catalogId ? ' · 3D审核中/图文可查' : ' · 图文/待核对'}</small></div>
            <button type="button" className="min-h-11 shrink-0 px-2 text-xs text-muted underline" aria-label={`查看${item.name}说明`} onClick={() => onPreview(item)}>查看</button>
            <button type="button" className="min-h-11 shrink-0 rounded-xl border border-accent px-3 text-sm font-bold text-accent disabled:border-line disabled:text-muted" disabled={already} onClick={() => onAdd(item)}>{already ? '已添加' : '＋加入'}</button>
          </div>;
        })}
      </div>
      {rows.length > limit ? <button type="button" className="fk-chip min-h-11" onClick={() => setLimit(l => l + 16)}>查看更多（剩余 {rows.length - limit} 项）</button> : null}
      {!rows.length ? <p className="keep rounded-xl border border-dashed border-line p-3 text-sm text-muted">没有匹配动作。可换名称，也可手动创建未审校动作。</p> : null}
      {mode === 'search' && customName && !exact ? <button type="button" className="fk-chip min-h-11" disabled={selected.has(`extra:${customName}`)} onClick={createCustom}>＋自定义「{customName.slice(0, 24)}」</button> : null}
    </div> : null}
    <p className="keep text-[11px] text-muted">动作目录与肌群映射需逐项专业核对；浏览和选择不会自动开课、设定训练强度或更改既有数据。</p>
  </section>;
}
