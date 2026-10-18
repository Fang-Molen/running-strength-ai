/** Optional UI-owned preparation. These records never become main-workout facts. */
export type WarmupUnit = 'sec' | 'reps' | 'm';
export type WarmupStep = { id: string; actionId: string | null; name: string; sets: number; amount: number; unit: WarmupUnit; perSide: boolean; note: string; windowSeconds?: number; weightKg?: number | null; catalogId?: string | null; restSec?: number | null };
export type WarmupPlan = { version: 1; enabled: boolean; preset: string; budgetMinutes?: number; steps: WarmupStep[] };
export type WarmupPreset = 'easy-run' | 'quality-run' | 'strength' | 'strength-upper' | 'strength-lower';
export type WarmupAction = { id: string; name: string; motion: string | null; amount: number; unit: WarmupUnit; perSide?: boolean; cues: string[] };
export const WARMUP_ACTIONS: WarmupAction[] = [
  { id: 'easy-jog', name: '快走／轻松慢跑', motion: 'warmup_jog', amount: 300, unit: 'sec', cues: ['从轻松速度开始，呼吸可以交谈。', '放松肩部，小步自然过渡，不把热身跑成主课。'] },
  { id: 'ankle-rock', name: '踝关节前移', motion: 'warmup_ankle', amount: 8, unit: 'reps', perSide: true, cues: ['一脚在前，前脚全脚掌保持接地。', '膝盖随脚尖方向缓慢前移，再还原；控制在舒适幅度。'] },
  { id: 'leg-swing', name: '前后摆腿', motion: 'warmup_leg_swing', amount: 8, unit: 'reps', perSide: true, cues: ['可扶稳固支撑，躯干保持稳定。', '从小幅度前后摆腿开始，避免腰部代偿和甩到极限。'] },
  { id: 'a-march', name: 'A-March 行进抬腿', motion: 'warmup_march', amount: 20, unit: 'm', cues: ['身体直立，交替抬膝，脚踝自然背屈。', '异侧手臂配合，落脚在身体下方；先控制，再增加节奏。'] },
  { id: 'a-skip', name: 'A-Skip 交替跳步', motion: 'warmup_skip', amount: 20, unit: 'm', cues: ['在A-March协调动作基础上加入轻跳。', '支撑脚轻快回弹，抬腿后主动向下落脚，避免越跳越高。'] },
  { id: 'butt-kick', name: '后踢腿', motion: 'warmup_butt_kick', amount: 20, unit: 'm', cues: ['轻快交替屈膝回收小腿，身体保持直立。', '控制幅度，不为碰到臀部而过度后仰。'] },
  { id: 'arm-swing', name: '跑步摆臂', motion: 'warmup_arm_swing', amount: 20, unit: 'sec', cues: ['肩部放松，肘部自然弯曲。', '手臂前后摆动，避免手臂横跨身体中线和耸肩。'] },
  { id: 'body-squat', name: '自重深蹲', motion: 'warmup_squat', amount: 8, unit: 'reps', cues: ['全脚掌稳定，膝盖方向随脚尖。', '以可控、舒适深度下蹲，站起时髋膝协调伸展。'] },
  { id: 'hip-hinge', name: '徒手髋铰链', motion: 'warmup_hinge', amount: 8, unit: 'reps', cues: ['膝微屈，髋向后移，背部保持自然中立。', '感受髋后侧参与，再用髋伸展回到站姿。'] },
  { id: 'calf-raise', name: '自重站姿提踵', motion: 'calf', amount: 8, unit: 'reps', cues: ['扶稳支撑，全脚掌开始，缓慢抬起脚跟。', '控制还原，不用弹震反复抢次数。'] },
  { id: 'stride', name: '渐进加速跑', motion: 'warmup_stride', amount: 50, unit: 'm', cues: ['热身和技术练习后，再从轻松速度逐步加快。', '保持放松、协调，回走恢复；不是全力冲刺。'] },
  { id: 'arm-circle', name: '肩部绕环', motion: 'warmup_arm_circle', amount: 8, unit: 'reps', cues: ['躯干保持稳定，从小幅度绕环开始。', '自然呼吸，不以甩动肩关节追求幅度。'] },
  { id: 'main-prep', name: '主项轻负荷预备组', motion: null, amount: 5, unit: 'reps', cues: ['先选择本次力量主项，以可控轻负荷预演动作。', '重量、组数和恢复按实际主项调整；这里不会从工作重量自动填一个百分比。'] },
];
export const WARMUP_SOURCES = [
  { name: 'NSCA · Introduction to Dynamic Warm-Up', url: 'https://www.nsca.com/education/articles/kinetic-select/introduction-to-dynamic-warm-up/' },
  { name: 'World Athletics · Warm-up Essentials', url: 'https://worldathletics.org/download/downloadnsa?filename=77d72573-46b5-43ad-8291-3f4f4f3026ce.pdf&urlslug=warm-up-essentials' },
];
export const WARMUP_PRESETS: { id: WarmupPreset; name: string }[] = [{ id: 'easy-run', name: '轻松跑准备' }, { id: 'quality-run', name: '速度／间歇准备' }, { id: 'strength', name: '力量·全身' }, { id: 'strength-upper', name: '力量·上肢' }, { id: 'strength-lower', name: '力量·下肢' }];
export const WARMUP_BUDGETS = [5, 15, 30, 40] as const;
export function warmupStep(actionId: string, id = crypto.randomUUID()): WarmupStep {
  const a = WARMUP_ACTIONS.find(a => a.id === actionId); if (!a) throw Error('热身动作不存在');
  return { id, actionId, name: a.name, sets: 1, amount: a.amount, unit: a.unit, perSide: !!a.perSide, note: '' };
}
export function warmupPreset(preset: WarmupPreset, budget: number = 15, main?: { name: string; catalogId?: string | null }): WarmupPlan {
  const minutes = WARMUP_BUDGETS.includes(budget as 5) ? budget : 15;
  const short = minutes === 5, full = minutes >= 30, strength = preset.startsWith('strength');
  // Reference examples authored for this app; budgets include drills and recovery.
  // Longer variants add task-specific preparation, rather than scaling every dose.
  let ids = strength ? preset === 'strength-upper' ? ['easy-jog', 'arm-circle', 'arm-swing', 'main-prep'] : preset === 'strength-lower' ? ['easy-jog', 'ankle-rock', 'hip-hinge', 'body-squat', 'main-prep'] : ['easy-jog', 'arm-circle', 'hip-hinge', 'body-squat', 'main-prep'] : preset === 'quality-run' ? ['easy-jog', 'ankle-rock', 'leg-swing', 'a-march', 'a-skip', 'stride'] : ['easy-jog', 'ankle-rock', 'leg-swing', 'a-march'];
  if (short) ids = strength ? ['easy-jog', preset === 'strength-upper' ? 'arm-circle' : 'hip-hinge', 'main-prep'] : preset === 'quality-run' ? ['easy-jog', 'a-march', 'stride'] : ['easy-jog', 'ankle-rock', 'leg-swing'];
  if (full && !strength) ids.splice(ids.length - (preset === 'quality-run' ? 1 : 0), 0, 'arm-swing', 'butt-kick');
  if (full && strength && preset !== 'strength-upper') ids.splice(ids.length - 1, 0, 'calf-raise');
  const steps = ids.map(id => warmupStep(id)), total = minutes * 60;
  const pulse = short ? strength ? 120 : 180 : strength ? full ? 480 : 240 : full ? minutes === 40 ? 900 : 720 : 480;
  steps[0].amount = pulse; steps[0].windowSeconds = pulse;
  const last = steps.at(-1)!;
  const specific = strength ? short ? 120 : full ? minutes === 40 ? 720 : 600 : 300 : preset === 'quality-run' ? short ? 60 : full ? 360 : 120 : 0;
  if (strength) { last.sets = short ? 1 : full ? minutes === 40 ? 4 : 3 : 2; last.weightKg = null; last.restSec = null; if (main) { last.name = `${main.name} · 预备组`; last.catalogId = main.catalogId; } }
  if (!strength && preset === 'quality-run') { last.sets = short ? 1 : full ? minutes === 40 ? 4 : 3 : 2; last.amount = short ? 30 : 50; last.note = '逐渐加快，回走或充分恢复；不做全力冲刺。'; }
  if (specific) last.windowSeconds = specific;
  const middle = steps.filter((s, i) => i > 0 && (!specific || i !== steps.length - 1)), remain = total - pulse - specific;
  for (const [i, s] of middle.entries()) { s.windowSeconds = Math.floor(remain / middle.length) + (i === middle.length - 1 ? remain % middle.length : 0); if (full && s.unit !== 'sec') s.sets = 2; }
  return { version: 1, enabled: true, preset, budgetMinutes: minutes, steps };
}
export function warmupError(p: WarmupPlan, execution = false): string | null {
  if (!p || p.version !== 1 || typeof p.enabled !== 'boolean' || !Array.isArray(p.steps) || p.steps.length > 30) return '热身配置无法读取。';
  if (!p.enabled) return null;
  if (!p.steps.length) return '使用热身时，请至少选择一个动作。';
  const ids = new Set<string>();
  for (const s of p.steps) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id)) return '热身动作编号重复或无效，请重新添加。'; ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim() || !['sec', 'reps', 'm'].includes(s.unit) || !Number.isInteger(s.sets) || s.sets < 1 || s.sets > 20 || !Number.isFinite(s.amount) || s.amount <= 0 || (s.unit === 'reps' && !Number.isInteger(s.amount)) || (s.windowSeconds != null && (!Number.isFinite(s.windowSeconds) || s.windowSeconds < 0)) || (s.weightKg != null && (!Number.isFinite(s.weightKg) || s.weightKg < 0))) return `${s.name || '热身动作'}：请确认名称、组数和数量。`;
    if (s.restSec != null && (!Number.isFinite(s.restSec) || s.restSec < 0)) return '组间休息须为非负秒数，留空表示未设置。';
    if (execution && s.actionId === 'main-prep' && (s.name === '主项轻负荷预备组' || s.weightKg == null)) return '请选择预备组的实际主项并明确轻负荷，自重填0。';
  }
  return null;
}
export const warmupDose = (s: WarmupStep) => `${s.sets}组 × ${s.amount}${s.unit === 'sec' ? '秒' : s.unit === 'm' ? '米' : '次'}${s.perSide ? '／每侧' : ''}`;

export type WarmupStepActual = { stepId: string; status: 'COMPLETED' | 'SKIPPED'; amount: number | null; sets: number | null; weightKg: number | null; restSeconds: number | null; unit: WarmupUnit; elapsedSeconds: number | null; at: string };
export type WarmupRecord = { id: string; entryId: string; date: string; plan: WarmupPlan; status: 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED'; startedAt: string | null; endedAt: string | null; steps: WarmupStepActual[]; mainOccurrenceIds: string[]; revision: number };
export const WARMUP_RECORDS_KEY = 'fk-warmup-records-v1';
function readRecords(): WarmupRecord[] {
  const rows = JSON.parse(localStorage.getItem(WARMUP_RECORDS_KEY) ?? '[]');
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.id !== 'string' || typeof r.entryId !== 'string' || !Array.isArray(r.steps) || !Array.isArray(r.mainOccurrenceIds) || !Number.isInteger(r.revision) || !['IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'SKIPPED'].includes(r.status) || warmupError(r.plan))) throw Error('已有热身记录无法读取，请先导出备份核对，尚未覆盖。');
  return rows;
}
export function loadWarmups(): WarmupRecord[] { try { return readRecords(); } catch { return []; } }
export function latestWarmup(entryId: string) { return loadWarmups().filter(r => r.entryId === entryId).at(-1) ?? null; }
export function warmupStoreError(): string | null { try { readRecords(); return null; } catch { return '已有热身记录无法读取，请先导出备份核对，尚未覆盖。'; } }
async function locked<T>(fn: () => T): Promise<T> { return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('fr255-running-write-r3', fn) : fn(); }
export function warmupMainError(p: WarmupPlan | undefined, main: { name: string; catalogId?: string | null }[]) {
  if (!p?.enabled) return null;
  return p.steps.some(s => s.actionId === 'main-prep' && !main.some(m => `${m.name} · 预备组` === s.name && (m.catalogId ?? null) === (s.catalogId ?? null))) ? '预备组与当前主项不一致，请在热身设置中重新选择。' : null;
}
function saveWarmups(rows: WarmupRecord[]) { const raw = JSON.stringify(rows); localStorage.setItem(WARMUP_RECORDS_KEY, raw); if (localStorage.getItem(WARMUP_RECORDS_KEY) !== raw) throw Error('热身记录未核实保存，输入保留。'); if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-warmup-changed')); }
export async function beginWarmup(entryId: string, date: string, plan: WarmupPlan, canBegin?: () => string | null): Promise<WarmupRecord> {
  return locked(() => { const rows = readRecords(), open = rows.find(r => r.entryId === entryId && r.status === 'IN_PROGRESS'); if (open) return open; if (rows.some(r => r.status === 'IN_PROGRESS')) throw Error('已有另一节热身进行中，请先继续或结束。'); const block = canBegin?.(); if (block) throw Error(block); const error = warmupError(plan, true); if (error || !plan.enabled) throw Error(error ?? '请先启用热身。');
    const record: WarmupRecord = { id: crypto.randomUUID(), entryId, date, plan: structuredClone(plan), status: 'IN_PROGRESS', startedAt: new Date().toISOString(), endedAt: null, steps: [], mainOccurrenceIds: [], revision: 1 };
    saveWarmups([...rows, record]); return record; });
}
export async function updateWarmup(id: string, revision: number, update: (r: WarmupRecord) => WarmupRecord): Promise<WarmupRecord> {
  return locked(() => { const rows = readRecords(), i = rows.findIndex(r => r.id === id), old = rows[i]; if (!old || old.revision !== revision) throw Error('热身记录已在另一处更新，请刷新后继续。'); const next = { ...update(structuredClone(old)), id: old.id, entryId: old.entryId, date: old.date, plan: old.plan, revision: old.revision + 1 }; rows[i] = next; saveWarmups(rows); return next; });
}
export async function recordWarmupStep(r: WarmupRecord, stepId: string, status: 'COMPLETED' | 'SKIPPED', elapsedSeconds: number | null, actual?: { amount: number; sets: number; weightKg: number | null; restSeconds?: number | null }) {
  return updateWarmup(r.id, r.revision, old => { if (old.status !== 'IN_PROGRESS' || old.steps.some(s => s.stepId === stepId)) throw Error('此项已处理，不会重复记录。'); const s = old.plan.steps.find(s => s.id === stepId); if (!s) throw Error('热身动作不在本次快照内。');
    const a = actual ?? { amount: s.amount, sets: s.sets, weightKg: s.weightKg ?? null, restSeconds: null };
    if (status === 'COMPLETED' && (!Number.isFinite(a.amount) || a.amount <= 0 || !Number.isInteger(a.sets) || a.sets < 1 || (s.unit === 'reps' && !Number.isInteger(a.amount)) || (a.weightKg != null && (!Number.isFinite(a.weightKg) || a.weightKg < 0)) || (a.restSeconds != null && (!Number.isFinite(a.restSeconds) || a.restSeconds < 0)))) throw Error('请填写有效的实际组数、数量、负重和休息。');
    old.steps.push({ stepId, status, sets: status === 'COMPLETED' ? a.sets : null, amount: status === 'COMPLETED' ? a.amount : null, weightKg: status === 'COMPLETED' ? a.weightKg : null, restSeconds: status === 'COMPLETED' && a.restSeconds != null && Number.isFinite(a.restSeconds) && a.restSeconds >= 0 ? a.restSeconds : null, unit: s.unit, elapsedSeconds: status === 'COMPLETED' && Number.isFinite(elapsedSeconds) && elapsedSeconds! >= 0 ? elapsedSeconds : null, at: new Date().toISOString() }); return old; });
}
export async function finishWarmup(r: WarmupRecord, skip = false) {
  return updateWarmup(r.id, r.revision, old => { if (old.status !== 'IN_PROGRESS') throw Error('这次热身已经结束。'); if (!skip && old.steps.length !== old.plan.steps.length) throw Error('还有热身动作未处理，可完成、逐项跳过或结束本次热身。'); const completed = old.steps.filter(s => s.status === 'COMPLETED').length; return { ...old, status: !completed ? 'SKIPPED' : skip || completed !== old.plan.steps.length ? 'PARTIAL' : 'COMPLETED', endedAt: new Date().toISOString() }; });
}
/** Link preparation by explicit occurrence IDs, never by title/date similarity. */
export async function linkWarmup(r: WarmupRecord, occurrenceId: string) { if (r.status === 'IN_PROGRESS') throw Error('请先结束热身。'); if (r.mainOccurrenceIds.includes(occurrenceId)) return r; return updateWarmup(r.id, r.revision, old => ({ ...old, mainOccurrenceIds: [...old.mainOccurrenceIds, occurrenceId] })); }

export async function skipWarmup(entryId: string, date: string, plan?: WarmupPlan): Promise<WarmupRecord> {
  const open = latestWarmup(entryId); if (open?.status === 'IN_PROGRESS') return finishWarmup(open, true);
  return locked(() => { const rows = readRecords(), latest = rows.filter(r => r.entryId === entryId).at(-1); if (latest?.status === 'SKIPPED' && !latest.mainOccurrenceIds.length) return latest; const r: WarmupRecord = { id: crypto.randomUUID(), entryId, date, plan: structuredClone(plan ?? { version: 1, enabled: false, preset: '', steps: [] }), status: 'SKIPPED', startedAt: null, endedAt: new Date().toISOString(), steps: [], mainOccurrenceIds: [], revision: 1 }; saveWarmups([...rows, r]); return r; });
}
export function warmupForPart(entryId: string, sessionId: string, occurrences: { trainingOccurrenceId: string; sessionId: string }[]) {
  const r = latestWarmup(entryId); if (!r) return null;
  return r.mainOccurrenceIds.some(id => occurrences.some(o => o.trainingOccurrenceId === id && o.sessionId === sessionId)) ? null : r;
}
export function warmupGate(plan: WarmupPlan | undefined, record: WarmupRecord | null): string | null {
  if (record?.status === 'IN_PROGRESS') return '热身尚未结束。请完成热身，或选择跳过剩余后进入主课。';
  return plan?.enabled && !record ? '请选择开始热身，或本次不使用热身，再开始主课。' : null;
}

export type WarmupClock = { version: 1; recordId: string; stepId: string; elapsedMs: number; runningSince: number | null; started: boolean };
export const warmupClockKey = (id: string, stepId: string) => `fk-warmup-clock-v1:${id}:${stepId}`;
export function clockElapsed(c: WarmupClock, now = Date.now()) { return Math.max(0, c.elapsedMs + (c.runningSince == null ? 0 : Math.max(0, now - c.runningSince))); }
export function readWarmupClock(recordId: string, stepId: string): WarmupClock {
  try { const c = JSON.parse(localStorage.getItem(warmupClockKey(recordId, stepId)) ?? 'null'); if (c?.version === 1 && c.recordId === recordId && c.stepId === stepId && typeof c.started === 'boolean' && Number.isFinite(c.elapsedMs) && c.elapsedMs >= 0 && (c.runningSince === null || Number.isFinite(c.runningSince) && c.runningSince >= 0)) return c; } catch { /* fresh */ }
  return { version: 1, recordId, stepId, elapsedMs: 0, runningSince: null, started: false };
}
export function saveWarmupClock(c: WarmupClock) { const key = warmupClockKey(c.recordId, c.stepId), raw = JSON.stringify(c); localStorage.setItem(key, raw); if (localStorage.getItem(key) !== raw) throw Error('计时状态未保存，请保持此页面。'); return c; }
export function toggleWarmupClock(recordId: string, stepId: string, now = Date.now()) {
  const current = readWarmupClock(recordId, stepId);
  if (current.runningSince == null) {
    const otherId = stepId.endsWith(':rest') ? stepId.slice(0, -5) : `${stepId}:rest`, other = readWarmupClock(recordId, otherId);
    if (other.runningSince != null) saveWarmupClock({ ...other, elapsedMs: clockElapsed(other, now), runningSince: null });
  }
  const next = saveWarmupClock({ ...current, started: true, elapsedMs: clockElapsed(current, now), runningSince: current.runningSince == null ? now : null });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fk-warmup-clock-changed'));
  return next;
}
export type WarmupInput = { different: boolean; sets: string; amount: string; weight: string; rest: string };
export const warmupInputKey = (recordId: string, stepId: string) => `fk-warmup-input-v1:${recordId}:${stepId}`;
export function readWarmupInput(recordId: string, s: WarmupStep): WarmupInput {
  try { const p = JSON.parse(localStorage.getItem(warmupInputKey(recordId, s.id)) ?? 'null'); if (p && typeof p.different === 'boolean' && ['sets', 'amount', 'weight', 'rest'].every(k => typeof p[k] === 'string')) return p; } catch { /* fresh */ }
  return { different: false, sets: String(s.sets), amount: String(s.amount), weight: s.weightKg == null ? '' : String(s.weightKg), rest: '' };
}
export function saveWarmupInput(recordId: string, stepId: string, p: WarmupInput) { const key = warmupInputKey(recordId, stepId), raw = JSON.stringify(p); localStorage.setItem(key, raw); if (localStorage.getItem(key) !== raw) throw Error('实际输入尚未保存，请保持页面并重试。'); return p; }
