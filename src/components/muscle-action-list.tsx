import { useEffect, useMemo, useRef, useState } from 'react';
import './muscle-action-list.css';
import { useApprovedVideos } from './use-approved-videos';
import { DEMO_STATUS_LABEL, demoStatusOf, groupByPattern } from '@/lib/strength/library-view';
import { defaultPoseGender, poseCardUrl, type PoseGender } from '@/lib/strength/pose-cards-r8';
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
const GROUP_PAGE = 12;
export function MuscleActionList({ pick, onAdd, onShow, selected = [], addLabel = '加入训练' }: { pick: MusclePick; onAdd?: (action: MuscleAction) => void; onShow?: (id: string) => void; selected?: string[]; addLabel?: string }) {
  const [query, setQuery] = useState(''), [equipment, setEquipment] = useState(''), [level, setLevel] = useState(''), [cat, setCat] = useState('');
  const [gender, setGender] = useState<PoseGender>(defaultPoseGender), [onlyApproved, setOnlyApproved] = useState(false);
  const [external, setExternal] = useState<MuscleAction[]>([]), [source, setSource] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({}), [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const approved = useApprovedVideos();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { setQuery(''); setEquipment(''); setLevel(''); setCat(''); setOnlyApproved(false); }, [pick?.k, pick?.g]);
  // 筛选条件变化时：分组恢复默认展开规则、每组恢复首页数量；用户手动展开/收起只在条件不变时保留。
  useEffect(() => { setLimits({}); setOpenMap({}); }, [pick?.k, pick?.g, query, equipment, level, source, cat, onlyApproved]);
  const actions = useMemo(() => source ? [...LOCAL_MUSCLE_ACTIONS, ...external] : LOCAL_MUSCLE_ACTIONS, [source, external]);
  const equipmentOptions = [...new Set(actions.flatMap(e => e.equipment))].sort();
  const levelOptions = [...new Set(actions.map(e => e.level))].filter(value => !/未/.test(value));
  const statusOf = (a: MuscleAction) => demoStatusOf(a, gender, approved);
  const found = findMuscleActions(actions, pick, query, equipment, level).filter(a => (!cat || actionCategory(a) === cat) && (!onlyApproved || statusOf(a) === 'video'));
  const approvedCount = LOCAL_MUSCLE_ACTIONS.filter(a => demoStatusOf(a, gender, approved) === 'video').length;
  const filtering = Boolean(query.trim() || cat || equipment || level || onlyApproved);
  const clearAll = () => { setQuery(''); setEquipment(''); setLevel(''); setCat(''); setOnlyApproved(false); };
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
  const row = (action: MuscleAction) => {
    const status = statusOf(action), chosen = selected.includes(action.id), thumb = status === 'none' ? null : poseCardUrl(action.catalogId ?? action.id, gender);
    const canShow = Boolean(action.catalogId && onShow);
    const media = <><span className="img">{thumb ? <img src={thumb} loading="lazy" decoding="async" alt="" /> : <span className="none">暂无图</span>}</span><span className="fk-actlib-status" data-s={status}>{DEMO_STATUS_LABEL[status]}</span></>;
    return <article key={action.id} className="fk-actlib-row" aria-label={action.name}>
      {canShow ? <button type="button" className="fk-actlib-thumb" aria-label={`查看${action.name}动作（${DEMO_STATUS_LABEL[status]}）`} onClick={() => onShow!(action.catalogId!)}>{media}</button> : <div className="fk-actlib-thumb">{media}</div>}
      <div className="fk-actlib-main"><h4>{action.name}</h4><p className="meta">{[...new Set(action.primary)].map(partName).join('、') || actionCategory(action)}{action.equipment.length ? ` · ${action.equipment.join('、')}` : ''}</p>{action.source === 'external' ? <span className="fk-actlib-tag">待核对</span> : null}
        {canShow ? <button type="button" className="fk-actlib-view" onClick={() => onShow!(action.catalogId!)}>查看动作 ›</button> : null}
        {action.instructions.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2">动作要点</summary><ol className="list-decimal space-y-1 pl-5">{action.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol>{action.secondary.length ? <p className="mt-2 text-muted">辅助部位：{action.secondary.map(partName).join('、')}</p> : null}</details> : null}</div>
      {onAdd ? <button type="button" aria-label={`${chosen ? '已选择' : '添加'}${action.name}`} disabled={chosen} className="fk-actlib-add" onClick={() => onAdd(action)}>{chosen ? '✓ 已选' : addLabel}</button> : <span />}
    </article>;
  };
  const groups = pick ? null : groupByPattern(found);
  const activeChips: [string, () => void][] = [
    ...(query.trim() ? [[`搜索：${query.trim().slice(0, 12)}`, () => setQuery('')] as [string, () => void]] : []),
    ...(cat ? [[cat, () => setCat('')] as [string, () => void]] : []),
    ...(equipment ? [[equipment, () => setEquipment('')] as [string, () => void]] : []),
    ...(level ? [[level, () => setLevel('')] as [string, () => void]] : []),
    ...(onlyApproved ? [['已审核视频', () => setOnlyApproved(false)] as [string, () => void]] : []),
  ];
  return <section aria-label="按部位找动作" className="fk-actlib mt-3 space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold">{pick ? '相关动作' : '全部动作'}</h3><span className="text-xs text-muted" role="status">{found.length} 项</span></div>
    <input aria-label="搜索相关动作" type="search" className={control + ' w-full'} placeholder="搜索动作" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="fk-actlib-chips" role="group" aria-label="动作分类">{['', ...ACTION_CATEGORIES].map(c => <button key={c || 'all'} type="button" className="fk-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c || '全部'}</button>)}</div>
    <details className="fk-actlib-filters"><summary>更多筛选{equipment || level || onlyApproved ? ' · 已启用' : ''}</summary>
      <div className="grid grid-cols-2 gap-2"><select aria-label="动作器械" className={control} value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">全部器械 / 徒手</option>{equipmentOptions.map(e => <option key={e} value={e}>{e}</option>)}</select>{levelOptions.length > 1 ? <select aria-label="动作难度" className={control} value={level} onChange={e => setLevel(e.target.value)}><option value="">全部难度</option>{levelOptions.map(e => <option key={e} value={e}>{e}</option>)}</select> : null}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="人物版本">{(['male', 'female'] as const).map(g => <button key={g} type="button" className="fk-chip" aria-pressed={gender === g} onClick={() => setGender(g)}>{g === 'male' ? '男版示意' : '女版示意'}</button>)}</div>
      <label className="mt-1 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={onlyApproved} onChange={e => setOnlyApproved(e.target.checked)} />只看已审核视频（当前 {approvedCount} 个）</label>
    </details>
    {activeChips.length ? <div className="fk-actlib-active" aria-label="已选条件">{activeChips.map(([label, clear]) => <button key={label} type="button" className="fk-chip" aria-label={`取消${label}`} onClick={clear}>{label} ✕</button>)}<button type="button" className="min-h-11 px-2 text-sm text-muted underline" onClick={clearAll}>清除全部</button></div> : null}
    {groups ? groups.map((group, index) => {
      const open = openMap[group.name] ?? (filtering || index === 0), limit = limits[group.name] ?? GROUP_PAGE;
      return <details key={group.name} className="fk-actlib-group" open={open} onToggle={e => { const next = (e.currentTarget as HTMLDetailsElement).open; setOpenMap(m => m[group.name] === next ? m : { ...m, [group.name]: next }); }}>
        <summary><b>{group.name}</b><span>{group.items.length} 个</span></summary>
        {open ? <>{group.items.slice(0, limit).map(row)}{group.items.length > limit ? <button type="button" className="fk-chip mb-2" onClick={() => setLimits(l => ({ ...l, [group.name]: limit + GROUP_PAGE }))}>更多动作（剩余 {group.items.length - limit} 项）</button> : null}</> : null}
      </details>;
    }) : <div>{found.slice(0, limits.__flat ?? GROUP_PAGE).map(row)}{found.length > (limits.__flat ?? GROUP_PAGE) ? <button type="button" className="fk-chip" onClick={() => setLimits(l => ({ ...l, __flat: (l.__flat ?? GROUP_PAGE) + GROUP_PAGE }))}>更多动作</button> : null}</div>}
    {!found.length ? <p className="py-3 text-sm text-muted">{onlyApproved && !approvedCount ? '当前还没有审核通过的同角色视频，可取消“只看已审核视频”查看图文示意。' : pick ? '暂无匹配动作，可更换部位或清除筛选。' : '没有匹配动作，试试其他名称或清除筛选。'}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} aria-pressed={source} className="fk-chip" onClick={() => { if (source && external.length) { setSource(false); setEquipment(''); setLevel(''); } else void loadExternal(); }}>{busy ? '加载中…' : source && external.length ? '收起扩展动作' : '查找更多动作'}</button></div>
    {error ? <p className="keep text-xs text-amber-400" role="status">{error}</p> : null}
  </section>;
}
