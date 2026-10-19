/**
 * UI-only read model for Fangkun's existing five destinations.
 * No decisions, health scoring, storage writes, or network calls.
 */
export type CoachOrganTarget = 'today' | 'plan' | 'log' | 'body';
export type CoachOrganReadout = {
  id: CoachOrganTarget;
  label: string;
  role: string;
  readout: string;
};

export type TodayPartState = 'done' | 'reduced' | 'skipped' | 'partial' | 'live' | 'candidate' | 'none';
/** v83（P0-05）：今日每一项（V4 跑步/力量分项、日程上的其他课）的真实状态，来自统一读模型；不再写死 0。 */
export type TodayPart = { label: string; state: TodayPartState };
export type CoachCoordinationInput = {
  loaded: boolean;
  /** 兼容旧调用：没有 todayParts 时才用这两个数 */
  todayPlanned?: number;
  todayMarkedDone?: number;
  todayParts?: TodayPart[];
  /** 今日计划外记录条数（记一笔/手表自录等），只做说明，不算完成计划 */
  todayUnplanned?: number;
  strengthSessions: number;
};
const PART_WORD: Record<TodayPartState, string> = { done: '已完成', reduced: '减量完成', skipped: '已跳过', partial: '有记录·未完成', live: '进行中', candidate: '有手表记录·待确认', none: '未记录' };
const terminal = (s: TodayPartState) => s === 'done' || s === 'reduced' || s === 'skipped';
function counts(input: CoachCoordinationInput) {
  if (input.todayParts) return { planned: input.todayParts.length, marked: input.todayParts.filter(p => terminal(p.state)).length };
  const planned = safeCount(input.todayPlanned ?? 0);
  return { planned, marked: Math.min(planned, safeCount(input.todayMarkedDone ?? 0)) };
}
export function todayPartsText(parts: TodayPart[]): string {
  return parts.map(p => `${p.label}${PART_WORD[p.state]}`).join('，');
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function coachCoordinationView(input: CoachCoordinationInput): CoachOrganReadout[] {
  const { planned: today, marked: completed } = counts(input);
  const extra = safeCount(input.todayUnplanned ?? 0) ? ` · 另有 ${safeCount(input.todayUnplanned ?? 0)} 条计划外记录` : '';
  const strengthSessions = safeCount(input.strengthSessions);
  return [
    {
      id: 'plan', label: '计划', role: '方向与目标',
      readout: !input.loaded ? '读取中' : strengthSessions > 0 ? `当前显示 ${strengthSessions} 节力量课` : '力量课未安排',
    },
    {
      id: 'today', label: '今日', role: '训练执行',
      readout: !input.loaded ? '读取中' : input.todayParts?.length ? todayPartsText(input.todayParts) + extra : today > 0 ? `${completed}/${today} 项完成标记${extra}` : `尚无已确认课程${extra}`,
    },
    {
      id: 'log', label: '日志', role: '事实与反馈',
      readout: '按训练编号核对来源',
    },
    {
      id: 'body', label: '身体', role: '健康与恢复',
      readout: '恢复判断需独立证据',
    },
  ];
}

/** A navigation hint based only on existing display markers, never a coach decision. */
export function coachCoordinationNext(input: CoachCoordinationInput): { target: CoachOrganTarget; title: string; detail: string } {
  if (!input.loaded) {
    return { target: 'today', title: '先核对今日安排', detail: '当前数据尚未读取完成，不能判断训练是否完成。' };
  }
  const { planned, marked } = counts(input);
  if (planned > marked) {
    const cand = input.todayParts?.some(p => p.state === 'candidate');
    return { target: 'today', title: cand ? '确认今天的手表跑步' : '前往今日训练', detail: input.todayParts?.length ? `${todayPartsText(input.todayParts)}。未记录不等于没练，练了请补一笔。` : `今日 ${marked}/${planned} 项完成标记；未标记不等于未训练。` };
  }
  if (planned > 0) return { target: 'log', title: '今日已全部记录', detail: input.todayParts?.length ? `${todayPartsText(input.todayParts)}。可到日志核对或补反馈。` : '按训练编号核对实际记录。' };
  return { target: 'log', title: '核对训练与反馈', detail: '按训练编号核对实际记录；没有数据时保持未知。' };
}

type RowLite = { date: string; v4?: { date: string; running: { state: TodayPartState } | null; strength: { state: TodayPartState } | null }; quickLog?: boolean; runLink?: unknown; plan?: string; source?: string; originIds?: string[] };
type EntryLite = { id: string; date: string; title?: string; status?: string; unplanned?: boolean; actual?: { outcome?: string; executionState?: string } | null };
/**
 * 今日各项状态：V4 当天（跑步/力量分项，来自 row.v4 —— 与首页/计划/日志同一个投影）＋ 日程上今天的其他计划课。
 * v4Planned：今天 V4 课表里有哪几项（没有任何证据时 row 不存在，各项就是“未记录”）。
 */
export function todayCoordinationParts(rows: RowLite[], entries: EntryLite[], today: string, v4Planned: { run: boolean; lift: boolean } | null): { parts: TodayPart[]; unplanned: number } {
  const parts: TodayPart[] = [];
  const v4 = rows.find(r => r.v4?.date === today)?.v4;
  if (v4Planned?.run) parts.push({ label: '跑步', state: v4?.running?.state ?? 'none' });
  if (v4Planned?.lift) parts.push({ label: '力量', state: v4?.strength?.state ?? 'none' });
  for (const e of entries) {
    if (!e || e.date !== today || e.unplanned || e.id.startsWith('plan400:') || !(e.status === 'planned' || e.status === 'done')) continue;
    const a = e.actual;
    const st: TodayPartState = !a ? 'none' : a.executionState === 'PARTIAL' || a.executionState === 'INTERRUPTED' ? 'partial' : a.outcome === 'missed' ? 'skipped' : 'done';
    parts.push({ label: (e.title ?? '训练').slice(0, 12), state: st });
  }
  const unplanned = rows.filter(r => r.date === today && !r.v4 && !r.runLink && (r.quickLog || r.source === 'garmin' || r.source === 'import') && !(r.originIds ?? []).some(id => id.startsWith('sched:'))).length;
  return { parts, unplanned };
}
