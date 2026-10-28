import {preview} from '@/lib/character/identity'
import { supplementalMediaId } from '@/lib/character/inventory'
import { defaultPoseGender } from '@/lib/strength/pose-cards-r8'
import { FangkunExerciseVideo } from './fangkun-unified-video'
import { MuscleExplorerSheet } from "@/components/muscle-explorer";
import { MuscleTargetCard } from "@/components/muscle-target-card";
import { Sheet } from "@/components/sheet";
import { isChunkError, recoverFromChunkError } from "@/lib/chunk-recover";
import { toSec } from "@/lib/strength/rest";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { demoData } from "@/lib/strength/demo/provider";
const ExerciseDemo = lazy(() => import("@/components/exercise-demo").catch((e) => { if (isChunkError(e)) void recoverFromChunkError(); throw e; }));
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { CATALOG } from "@/lib/strength/catalog";
import { PARTS, ACTIONS, type ActionEntry } from '@/lib/strength/action-picker';
import { ActionPicker } from '@/components/action-picker';
import { FOOT_LIBRARY } from '@/lib/body/foot-library';
import { muscleName } from '@/lib/body/muscle-display';

export type Unit = "reps" | "sec" | "m";
export type Ex = { id?: string; catalogId?: string | null; sourceId?: string; sourceUrl?: string; name: string; sets: string; reps: string; weight: string; rpe: string; unit?: Unit; perSide?: boolean; counting?: "bilateral" | "perSide" | "left" | "right"; restSec?: number | null; sideRestSec?: number | null };
export type Dose = { unit: Unit; perSide: boolean; bodyweight: boolean; sets: string; amount: string };
export const UNIT_LABEL: Record<Unit, string> = { reps: "次", sec: "秒", m: "米" };
export function doseOf(name: string): Dose {
  const loaded = /杠铃|哑铃|壶铃|绳索|龙门|器械|腿举|坐姿|负重|药球/.test(name);
  const unit: Unit = /农夫行走|冲刺|雪橇|行走(?!弓步)|搬运/.test(name) ? "m" : /平板|侧桥|支撑|悬挂|静态|靠墙|保持|等长/.test(name) ? "sec" : "reps";
  const perSide = /单腿|单臂|分腿|弓步|Pallof|抗旋|侧桥|侧平板|侧卧|鸟狗|登阶|台阶|单侧/.test(name);
  const bodyweight = !loaded && /俯卧撑|引体|平板|侧桥|死虫|卷腹|起坐|两头起|悬垂|波比|登山者|臀桥|鸟狗|侧卧抬腿|臂屈伸|反向划船|弹跳|蹲跳|跳箱|抗旋|Pallof|行走弓步|北欧/.test(name);
  const amount = unit === "sec" ? "30" : unit === "m" ? "20" : bodyweight ? "10" : "8";
  return { unit, perSide, bodyweight, sets: "3", amount };
}
// Never show a different exercise's animation based only on a substring name match.
const ALIAS: Record<string, string> = { '罗马尼亚硬拉 RDL': '罗马尼亚硬拉', 'RDL': '罗马尼亚硬拉' };
export function demoIdFor(name: string): string | null {
  const normalized = name.trim();
  const exact = ALIAS[normalized] ?? normalized;
  const catalog = CATALOG.find(e => e.name === exact);
  return catalog && demoData.exercises.some(e => e.id === catalog.id) ? catalog.id : null;
}
type Cue = { setup: string[]; execution: string[]; breathing: string[]; mistakes: string[]; safety: string[]; regression: string[]; progression: string[] };
type DemoEx = { id: string; name_zh: string; name_en: string; category: string; equipment: string[]; default_sets: number; default_reps_or_time: { mode: string; amount: number }; default_rest_sec: number; review?: string; primary_muscles: string[]; secondary_muscles: string[]; cues?: Cue; muscle_source?: string };
function DemoBlock({ id }: { id: string }) {
  return <section className="fk-dash-card mt-3" aria-label="新版动作演示区域">
    <h2 className="fk-dash-title">动作示范</h2>
    <Suspense fallback={<p className="p-4 text-sm">演示加载中…</p>}>
      <ExerciseDemo key={id} catalogId={id} compact />
    </Suspense>
  </section>;
}
export function ExerciseDetailBody({ id }: { id: string }) {
  const e = demoData.exercises.find((x) => x.id === id) as unknown as DemoEx | undefined;
  const cue = e?.cues;
  return <>
    {e ? <div className="flex flex-wrap gap-2 text-xs">{[e.category, ...e.equipment].map(t => <span key={t} className="rounded-md border border-line px-2 py-1">{t}</span>)}</div> : null}
    <DemoBlock key={`demo-${id}`} id={id} />
    {e ? <MuscleTargetCard key={`target-${id}`} exercise={e} /> : null}
    {cue ? <div className="fk-dash-card mt-3 text-sm"><h3 className="fk-dash-title">动作步骤</h3><ol className="mt-2 list-decimal space-y-2 pl-5">{[...cue.setup, ...cue.execution].map((line, i) => <li key={i}>{line}</li>)}</ol>{cue.safety.length ? <section className="mt-3"><h4 className="font-bold">注意事项</h4><ul className="mt-1 list-disc space-y-1 pl-5">{cue.safety.map((line, i) => <li key={i}>{line}</li>)}</ul></section> : null}{([["呼吸与易错点", [...cue.breathing, ...cue.mistakes]], ["简化与进阶", [...cue.regression.map(x => "简化：" + x), ...cue.progression.map(x => "进阶：" + x)]]] as [string, string[]][]).filter(([, lines]) => lines.length).map(([title, lines]) => <details key={title} className="mt-2"><summary className="min-h-11 cursor-pointer py-2 font-bold">{title}</summary><ul className="list-disc space-y-1 pl-5">{lines.map((line, n) => <li key={n}>{line}</li>)}</ul></details>)}</div> : null}
  </>;
}
/** action：从动作库/动作选择器进入时的明确操作（“加入训练”“选择此动作”）。只浏览（不传 action）时详情页不写入任何数据。 */
export type DemoAction = { label: string; onClick: () => void; disabled?: boolean; hint?: string };
export function DemoSheet({ id, onClose, action }: { id: string; onClose: () => void; action?: DemoAction }) {
  const e = demoData.exercises.find(x => x.id === id);
  return <Sheet full label="动作详情" title={e?.name_zh ?? '动作详情'} onClose={onClose} footer={action ? <div>{action.hint ? <p className="mb-1 text-center text-xs text-muted">{action.hint}</p> : null}<button type="button" disabled={action.disabled} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50" onClick={action.onClick}>{action.label}</button></div> : null}><ExerciseDetailBody id={id} /></Sheet>;
}

/** 76 条原始动作数据以外的补充动作：可靠图文优先，绝不拿相似动作冒充本动作3D。 */
export function BasicExerciseSheet({ name, onClose }: { name: string; onClose: () => void }) {
  const [gender, setGender] = useState<'male' | 'female'>(defaultPoseGender);
  const mediaId = supplementalMediaId(name);
  const foot = FOOT_LIBRARY.find(x => x.name === name);
  return <Sheet full label="动作说明" title={name} onClose={onClose} footer={null}>
    <section className="fk-dash-card space-y-3 text-sm" aria-label="动作教学回退">
      <div className="flex gap-2" role="group" aria-label="新版人物选择">
        {(['male','female'] as const).map(value=><button type="button" key={value} aria-pressed={gender===value} className="fk-chip" onClick={()=>setGender(value)}>{value==='male'?'男性':'女性'}</button>)}
      </div>
      {mediaId ? <FangkunExerciseVideo exerciseId={mediaId} title={name} gender={gender}/> : <figure><img src={preview(gender)} alt="角色参考，非本动作姿势" className="mx-auto max-h-[26dvh] w-full object-contain" loading="lazy" /><figcaption className="mt-1 text-center text-sm text-muted">角色参考</figcaption></figure>}
      {foot ? <>
        <h3 className="font-bold">动作步骤</h3>
        <ol className="ml-5 list-decimal space-y-2">{foot.demo.steps.map((line, i) => <li key={i}>{line}</li>)}</ol>
        <h3 className="font-bold">技术要点</h3><ul className="ml-5 list-disc">{foot.tips.map((line, i) => <li key={i}>{line}</li>)}</ul>
        <h3 className="font-bold">常见错误</h3><ul className="ml-5 list-disc">{foot.mistakes.map((line, i) => <li key={i}>{line}</li>)}</ul>
        <p>相关部位：{[...new Set([...foot.muscles, ...foot.secondary])].map(muscleName).join('、')}</p>
      </> : <p className="text-sm text-muted">暂无动作步骤。</p>}
    </section>
  </Sheet>;
}

// Keep the original public exports for existing training-plan and regression consumers.
export { PARTS, LIBRARY } from '@/lib/strength/action-picker';

export function PartChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return <div className="flex flex-wrap gap-2">{PARTS.map((t) => <button key={t} type="button" className="fk-chip" aria-pressed={value.includes(t)} onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}>{t}</button>)}</div>;
}

export function ExerciseEditor({ value, onChange, parts, betweenRest, onBetweenRest, initialMuscle = false }: { value: Ex[]; onChange: (v: Ex[]) => void; parts: string[]; betweenRest?: number | null; onBetweenRest?: (v: number | null) => void; initialMuscle?: boolean }) {
  const [bulk, setBulk] = useState<[string, string]>(["", ""]), [mx, setMx] = useState(initialMuscle);
  const [picker, setPicker] = useState(false);
  const [demo, setDemo] = useState<string | null>(null), [basic, setBasic] = useState<string | null>(null), [added, setAdded] = useState("");
  const current = useRef(value); current.current = value;
  const commit = (v: Ex[]) => { current.current = v; onChange(v); };
  const isSelected = (item: { name: string; catalogId?: string | null; sourceId?: string | null }) => current.current.some(e =>
    Boolean(item.catalogId && e.catalogId === item.catalogId) || Boolean(item.sourceId && e.sourceId === item.sourceId) || e.name === item.name);
  const set = (i: number, k: keyof Ex, v: Ex[keyof Ex]) => commit(current.current.map((e, j) => j === i ? { ...e, [k]: v } : e));
  const move = (i: number, offset: number) => { const n = [...current.current], j = i + offset; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; commit(n); };
  const addEntry = (item: ActionEntry) => {
    if (isSelected(item)) { setAdded(`已在本次训练：${item.name}`); return; }
    const d = doseOf(item.name);
    commit([...current.current, { id: crypto.randomUUID(), catalogId: item.catalogId, sourceId: item.sourceId ?? undefined,
      name: item.name, sets: '', reps: '', weight: '', rpe: '', unit: item.unit ?? d.unit, perSide: item.perSide ?? d.perSide, restSec: 75 }]);
    setAdded(`已加入：${item.name}`);
  };
  const selectedKeys = value.flatMap(e => [e.catalogId ? `catalog:${e.catalogId}` : `extra:${e.name}`, ...(e.sourceId ? [e.sourceId] : []), ...(e.catalogId ? [`local:${e.catalogId}`] : [])]);
  const previewEntry = (entry: ActionEntry) => {
    const match = entry.catalogId ?? demoIdFor(entry.name);
    if (match) setDemo(match); else setBasic(entry.name);
  };
  /** 详情页“选择此动作”：加入当前编辑器后一并关闭详情/选择器，回到原编辑器；已在训练中则只显示状态。其他未保存内容不受影响。 */
  const demoAction = (id: string): DemoAction | undefined => {
    const entry = ACTIONS.find(x => x.catalogId === id);
    if (!entry) return undefined;
    if (isSelected(entry)) return { label: '已在本次训练', disabled: true, onClick: () => {} };
    return { label: '选择此动作', hint: '加入后回到训练编辑器，其他内容不变', onClick: () => { addEntry(entry); setDemo(null); setPicker(false); setMx(false); } };
  };
  const inp = "mt-1 min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-base";
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">已选动作 · {value.length}</h4><div className="flex gap-2"><button type="button" className="min-h-11 rounded-xl border border-accent px-3 text-sm font-bold text-accent" onClick={() => setPicker(true)}>＋ 添加动作</button><button type="button" className="fk-chip min-h-11" onClick={() => setMx(true)}>肌肉图</button></div></div>
    {picker ? <Sheet full label="添加动作" title="添加动作" onClose={() => setPicker(false)} footer={<button type="button" className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-fg" onClick={() => setPicker(false)}>完成选择 · {value.length} 个</button>}><ActionPicker selectedKeys={selectedKeys} onAdd={addEntry} onPreview={previewEntry} onMuscle={() => setMx(true)} /></Sheet> : null}
    {mx ? <MuscleExplorerSheet onClose={() => setMx(false)} selectedCount={value.length} selected={value.flatMap(e => [ ...(e.sourceId ? [e.sourceId] : []), ...(e.catalogId ? [`local:${e.catalogId}`] : [`extra:${e.name}`]) ])} onShow={setDemo} onAdd={action => {
      if (isSelected({ name: action.name, catalogId: action.catalogId, sourceId: action.id })) { setAdded(`已在本次训练：${action.name}`); return; }
      const d = doseOf(action.name);
      commit([...current.current, { id: crypto.randomUUID(), catalogId: action.catalogId, sourceId: action.id,
        sourceUrl: action.sourceUrl || undefined, name: action.name, sets: '', reps: '', weight: '', rpe: '',
        unit: action.source === 'external' ? action.unit ?? undefined : action.unit ?? d.unit,
        perSide: action.source === 'external' ? undefined : d.perSide, restSec: action.restSec ?? 75 }]);
      setAdded(`已加入：${action.name}`);
    }} /> : null}
    {demo ? <DemoSheet id={demo} onClose={() => setDemo(null)} action={demoAction(demo)} /> : null}
    {basic ? <BasicExerciseSheet name={basic} onClose={() => setBasic(null)} /> : null}
    {added ? <p role="status" className="text-sm text-accent">{added}</p> : null}
    {!value.length ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">尚未添加动作。</p> : null}
    {value.map((e, i) => { const d = doseOf(e.name), external = e.sourceId?.startsWith('external:'), unit = e.unit ?? (external ? '' : d.unit), side = e.perSide ?? d.perSide; return <article key={e.id ?? i} className="rounded-2xl border border-line p-3" data-ex-row>
      <div className="flex items-center justify-between gap-2"><b className="text-sm">动作 {i + 1}</b><div className="flex shrink-0 gap-1"><button type="button" disabled={i === 0} aria-label={`上移动作${i + 1}`} className="grid size-11 place-items-center disabled:opacity-30" onClick={() => move(i, -1)}><ChevronUp size={19} /></button><button type="button" disabled={i === value.length - 1} aria-label={`下移动作${i + 1}`} className="grid size-11 place-items-center disabled:opacity-30" onClick={() => move(i, 1)}><ChevronDown size={19} /></button><button type="button" aria-label={`删除${e.name}`} className="grid size-11 place-items-center text-red-400" onClick={() => commit(current.current.filter((_, j) => j !== i))}><Trash2 size={18} /></button></div></div>
      <input aria-label={`动作${i + 1}名称`} className={inp + ' font-bold'} value={e.name} onChange={x => { set(i, 'name', x.target.value); set(i, 'catalogId', null); set(i, 'sourceId', undefined); set(i, 'sourceUrl', undefined); }} />
      <button type="button" className="mt-2 min-h-11 text-sm font-bold text-accent" onClick={() => {
        const id = e.catalogId ?? demoIdFor(e.name); if (id) setDemo(id); else setBasic(e.name);
      }}>查看示范 ›</button>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm"><label>组数<input aria-label={`${e.name}组数`} className={inp} inputMode="numeric" placeholder="待填写" value={e.sets} onChange={x => set(i, 'sets', x.target.value)} /></label><label>每组数量<input aria-label={`${e.name}每组数量`} className={inp} inputMode="decimal" placeholder="待填写" value={e.reps} onChange={x => set(i, 'reps', x.target.value)} /></label><label>计量单位<select aria-label={`${e.name}计量单位`} className={inp} value={unit} onChange={x => set(i, 'unit', x.target.value as Unit)}>{external ? <option value="">请选择</option> : null}{(['reps', 'sec', 'm'] as Unit[]).map(u => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></label><label>总负重 kg<input aria-label={`${e.name}负重`} className={inp} inputMode="decimal" placeholder="自重请填0" value={e.weight} onChange={x => set(i, 'weight', x.target.value)} /></label></div>
      {external ? <label className="mt-3 block text-sm">侧别与计数<select aria-label={`${e.name}侧别`} className={inp} value={e.counting ?? ''} onChange={x => { set(i, 'counting', x.target.value as Ex['counting']); set(i, 'perSide', x.target.value === 'perSide'); }}><option value="">请选择</option><option value="bilateral">双侧一起／左右合计</option><option value="perSide">每侧计数，两侧完成算一组</option><option value="left">仅左侧</option><option value="right">仅右侧</option></select></label> : <label className="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={side} onChange={x => set(i, 'perSide', x.target.checked)} />数量按每侧填写（两侧做完算一组）</label>}
      <div className="mt-2 space-y-2 rounded-xl bg-surface p-3 text-sm"><label className="block">组间休息（秒）<input aria-label={`${e.name}组间休息秒`} className={inp} inputMode="numeric" placeholder="未设置；不休息填0" value={e.restSec ?? ''} onChange={x => set(i, 'restSec', x.target.value.trim() ? Number(x.target.value) : null)} /></label>{side ? <label className="block">换侧间隔（秒）<input aria-label={`${e.name}换侧间隔秒`} className={inp} inputMode="numeric" placeholder="未设置" value={e.sideRestSec ?? ''} onChange={x => set(i, 'sideRestSec', x.target.value.trim() ? Number(x.target.value) : null)} /></label> : null}</div>
      <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2 text-muted">目标RPE（选填）</summary><input aria-label={`${e.name}目标RPE`} className={inp} inputMode="decimal" placeholder="1—10" value={e.rpe} onChange={x => set(i, 'rpe', x.target.value)} /></details>
    </article>; })}
    {value.length ? <details className="rounded-xl border border-line p-3 text-sm"><summary className="min-h-11 cursor-pointer font-bold">批量休息与动作间休息</summary><div className="mt-2 flex flex-wrap items-center gap-2"><RestInput v={bulk} onV={setBulk} label="批量休息" /><button type="button" className="fk-chip" disabled={toSec(...bulk) == null} onClick={() => commit(current.current.map(e => ({ ...e, restSec: toSec(...bulk) })))}>应用到全部动作</button></div>{onBetweenRest ? <label className="mt-3 block">动作之间休息（秒）<input className={inp} inputMode="numeric" placeholder="未设置" value={betweenRest ?? ''} onChange={e => onBetweenRest(e.target.value.trim() ? Number(e.target.value) : null)} /></label> : null}</details> : null}
  </div>;
}

function RestInput({ v, onV, label }: { v: [string, string]; onV: (v: [string, string]) => void; label: string }) {
  const [m, setM] = useState(v[0]); const [sec, setSec] = useState(v[1]);
  useEffect(() => { setM(v[0]); setSec(v[1]); }, [v[0], v[1]]);
  const c = "min-h-11 w-12 rounded border border-line bg-surface px-1 text-center text-base";
  const clean = (x: string) => x.replace(/\D/g, "").slice(0, 3);
  return <span className="inline-flex items-center gap-0.5"><input aria-label={`${label}分`} className={c} inputMode="numeric" value={m} onChange={(x) => { const n = clean(x.target.value); setM(n); onV([n, sec]); }} />分<input aria-label={`${label}秒`} className={c} inputMode="numeric" value={sec} onChange={(x) => { const n = clean(x.target.value); setSec(n); onV([m, n]); }} />秒</span>;
}
