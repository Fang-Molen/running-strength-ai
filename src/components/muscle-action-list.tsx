import { useEffect, useMemo, useRef, useState } from 'react';
import demoData from '../lib/strength/demo/data.json' with { type: 'json' };
import { FOOT_LIBRARY } from '../lib/body/foot-library';
import { MUS } from '@/lib/body/muscles';
import { MUSCLES } from '@/lib/strength/demo/musclemap.js';
import { LOCAL_MUSCLE_ACTIONS, externalActions, findMuscleActions, type MuscleAction, type MusclePick, type ExternalCatalogue } from '@/lib/body/muscle-actions';

const DEMO_CAT = new Map<string, string>(demoData.exercises.map(e => [e.id, e.category]));
const FOOT_CAT = new Map<string, string>(FOOT_LIBRARY.map(e => [`foot:${e.id}`, e.id === 'ft-balance' ? '稳定控制' : e.cat]));
/** 动作分类：部位分类来自动作目录；足踝动作分为足部与足弓/踝关节/小腿，单脚平衡归入稳定控制。 */
export const ACTION_CATEGORIES = ['胸', '背', '肩', '手臂', '腿', '臀', '核心', '全身', '足部与足弓', '踝关节', '小腿', '稳定控制'] as const;
export function actionCategory(a: MuscleAction): string { return a.source === 'foot' ? FOOT_CAT.get(a.id) ?? '足踝' : a.catalogId ? DEMO_CAT.get(a.catalogId) ?? '其他' : '扩展'; }
const partName = (key: string) => (MUSCLES as Record<string, string>)[key] ?? MUS.find(m => m.k === key)?.zh ?? key;
export function MuscleActionList({ pick, onAdd, onShow, selected = [], addLabel = '加入训练' }: { pick: MusclePick; onAdd?: (action: MuscleAction) => void; onShow?: (id: string) => void; selected?: string[]; addLabel?: string }) {
  const [query, setQuery] = useState(''), [equipment, setEquipment] = useState(''), [level, setLevel] = useState(''), [cat, setCat] = useState('');
  const [external, setExternal] = useState<MuscleAction[]>([]), [source, setSource] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(12);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => setCount(12), [pick?.k, pick?.g, query, equipment, level, source, cat]);
  useEffect(() => { setQuery(''); setEquipment(''); setLevel(''); setCat(''); }, [pick?.k, pick?.g]);
  const actions = useMemo(() => source ? [...LOCAL_MUSCLE_ACTIONS, ...external] : LOCAL_MUSCLE_ACTIONS, [source, external]);
  const equipmentOptions = [...new Set(actions.flatMap(e => e.equipment))].sort();
  const levelOptions = [...new Set(actions.map(e => e.level))].filter(value => !/未/.test(value));
  const found = findMuscleActions(actions, pick, query, equipment, level).filter(a => !cat || actionCategory(a) === cat);
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
  return <section aria-label="按部位找动作" className="mt-3 space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{pick ? '相关动作' : '全部动作'}</h3><span className="text-xs text-muted">{found.length} 项</span></div>
    <input aria-label="搜索相关动作" className={control + ' w-full'} placeholder="搜索动作" value={query} onChange={e => setQuery(e.target.value)} />
    <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted">筛选{cat || equipment || level ? ' · 已启用' : ''}</summary><div className="grid grid-cols-2 gap-2"><select aria-label="动作分类" className={control} value={cat} onChange={e => setCat(e.target.value)}><option value="">全部部位</option>{ACTION_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select><select aria-label="动作器械" className={control} value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">全部器械 / 徒手</option>{equipmentOptions.map(e => <option key={e} value={e}>{e}</option>)}</select>{levelOptions.length > 1 ? <select aria-label="动作难度" className={control} value={level} onChange={e => setLevel(e.target.value)}><option value="">全部难度</option>{levelOptions.map(e => <option key={e} value={e}>{e}</option>)}</select> : null}</div></details>
    {found.slice(0, count).map(action => <article key={action.id} className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="font-bold">{action.name}</h4><p className="mt-1 text-sm text-muted">{[...new Set(action.primary)].map(partName).join('、') || actionCategory(action)}</p>{action.source === 'external' ? <span className="text-xs text-amber-400">待核对</span> : null}</div>{onAdd ? <button type="button" aria-label={`${selected.includes(action.id) ? '已选择' : '添加'}${action.name}`} disabled={selected.includes(action.id)} className="min-h-11 shrink-0 rounded-full border border-accent px-3 text-sm font-bold text-accent disabled:border-line disabled:text-muted" onClick={() => onAdd(action)}>{selected.includes(action.id) ? '✓ 已选' : addLabel}</button> : null}</div>
      {action.catalogId && onShow ? <button type="button" className="mt-1 min-h-11 text-sm font-bold text-accent" onClick={() => onShow(action.catalogId!)}>查看示范 ›</button> : null}
      {action.instructions.length ? <details className="mt-1 text-sm"><summary className="min-h-11 cursor-pointer py-2">动作要点</summary><ol className="list-decimal space-y-1 pl-5">{action.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol>{action.secondary.length ? <p className="mt-2 text-muted">辅助部位：{action.secondary.map(partName).join('、')}</p> : null}</details> : null}
    </article>)}
    {!found.length ? <p className="py-3 text-sm text-muted">{pick ? '暂无匹配动作，可更换部位或清除筛选。' : '没有匹配动作，试试其他名称。'}</p> : null}
    {found.length > count ? <button type="button" className="fk-chip" onClick={() => setCount(n => n + 12)}>更多动作</button> : null}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} aria-pressed={source} className="fk-chip" onClick={() => { if (source && external.length) { setSource(false); setEquipment(''); setLevel(''); } else void loadExternal(); }}>{busy ? '加载中…' : source && external.length ? '收起扩展动作' : '查找更多动作'}</button>{query || equipment || level || cat ? <button type="button" className="fk-chip" onClick={() => { setQuery(''); setEquipment(''); setLevel(''); setCat(''); }}>清除筛选</button> : null}</div>
    {error ? <p className="keep text-xs text-amber-400" role="status">{error}</p> : null}
  </section>;
}
