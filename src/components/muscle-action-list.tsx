import { useEffect, useMemo, useRef, useState } from 'react';
import { LOCAL_MUSCLE_ACTIONS, externalActions, findMuscleActions, type MuscleAction, type MusclePick, type ExternalCatalogue } from '@/lib/body/muscle-actions';

export function MuscleActionList({ pick, onAdd, onShow, selected = [], addLabel = '加入训练' }: { pick: MusclePick; onAdd?: (action: MuscleAction) => void; onShow?: (id: string) => void; selected?: string[]; addLabel?: string }) {
  const [query, setQuery] = useState(''), [equipment, setEquipment] = useState(''), [level, setLevel] = useState('');
  const [external, setExternal] = useState<MuscleAction[]>([]), [source, setSource] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(12);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => setCount(12), [pick?.k, pick?.g, query, equipment, level, source]);
  const actions = useMemo(() => source ? [...LOCAL_MUSCLE_ACTIONS, ...external] : LOCAL_MUSCLE_ACTIONS, [source, external]);
  const equipmentOptions = [...new Set(actions.flatMap(e => e.equipment))].sort();
  const levelOptions = [...new Set(actions.map(e => e.level))];
  const found = findMuscleActions(actions, pick, query, equipment, level);
  async function loadExternal() {
    setSource(true); if (external.length || busy) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('');
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/exercise-sources/free-exercise-db/catalog.json', { signal: controller.signal });
      if (!response.ok || /text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('目录暂不可用');
      const catalogue = await response.json() as ExternalCatalogue;
      if (!Array.isArray(catalogue.records)) throw new Error('目录格式有误');
      setExternal(externalActions(catalogue));
    } catch { if (request.current === controller) setError('扩展目录未加载成功，现有动作仍可使用。'); }
    finally { clearTimeout(timer); if (request.current === controller) setBusy(false); }
  }
  const control = 'min-h-11 min-w-0 rounded-xl border border-line bg-surface px-2 text-sm';
  return <section aria-label="按肌肉找动作" className="mt-3 space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{pick ? '相关动作' : '全部动作'}</h3><span className="text-xs text-muted">{found.length} 项</span></div>
    <input aria-label="搜索相关动作" className={control + ' w-full'} placeholder="名称、英文名或器械" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="grid grid-cols-2 gap-2"><select aria-label="动作器械" className={control} value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">全部器械 / 徒手</option>{equipmentOptions.map(e => <option key={e} value={e}>{e}</option>)}</select><select aria-label="动作难度" className={control} value={level} onChange={e => setLevel(e.target.value)}><option value="">全部难度</option>{levelOptions.map(e => <option key={e} value={e}>{e}</option>)}</select></div>
    {found.slice(0, count).map(action => <details key={action.id} className="rounded-xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer"><b>{action.name}</b><span className="mt-1 block text-xs text-muted">{action.equipment.join('、')} · {action.level}{action.source === 'external' ? ' · 外部候选，未审校' : ''}</span></summary>
      <p className="keep mt-1 text-xs text-muted">{action.source === 'external' ? '保留来源英文说明；未提供本动作的3D动画。' : '教学文字可查；同角色视频通过审核后才会显示。'}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{action.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol>
      <div className="mt-2 flex flex-wrap gap-2">{action.catalogId && onShow ? <button type="button" className="fk-chip" onClick={() => onShow(action.catalogId!)}>动作详情</button> : null}{onAdd ? <button type="button" disabled={selected.includes(action.id)} className="min-h-11 rounded-full border border-accent px-4 font-bold text-accent disabled:border-line disabled:text-muted" onClick={() => onAdd(action)}>{selected.includes(action.id) ? '✓ 已选入本次训练' : addLabel}</button> : null}{action.sourceUrl ? <a href={action.sourceUrl} target="_blank" rel="noreferrer" className="fk-chip">原始来源</a> : null}</div>
    </details>)}
    {!found.length ? <p className="keep py-3 text-sm text-muted">{pick ? '现有目录没有这一肌肉对应的动作。可清除肌肉选择后搜索，或加载扩展目录。' : '没有匹配动作，可换关键词或加载扩展目录。'}</p> : null}
    {found.length > count ? <button type="button" className="fk-chip" onClick={() => setCount(n => n + 12)}>再显示 12 项</button> : null}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} aria-pressed={source} className="fk-chip" onClick={() => { if (source && external.length) { setSource(false); setEquipment(''); setLevel(''); } else void loadExternal(); }}>{busy ? '正在加载扩展目录…' : source && external.length ? `收起扩展目录（${external.length}项）` : '库里没有？查扩展动作'}</button>{query || equipment || level ? <button type="button" className="fk-chip" onClick={() => { setQuery(''); setEquipment(''); setLevel(''); }}>清除筛选</button> : null}</div>
    {error ? <p className="keep text-xs text-amber-400" role="status">{error}</p> : null}
    {source ? <p className="keep text-xs text-muted">扩展文字：free-exercise-db · Unlicense。只作可选资料，未自动安排训练；不附带图片或动画。</p> : null}
  </section>;
}
