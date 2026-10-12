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

export type CoachCoordinationInput = {
  loaded: boolean;
  todayPlanned: number;
  todayMarkedDone: number;
  strengthSessions: number;
};

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function coachCoordinationView(input: CoachCoordinationInput): CoachOrganReadout[] {
  const today = safeCount(input.todayPlanned);
  const completed = Math.min(today, safeCount(input.todayMarkedDone));
  const strengthSessions = safeCount(input.strengthSessions);
  return [
    {
      id: 'plan', label: '计划', role: '方向与目标',
      readout: !input.loaded ? '读取中' : strengthSessions > 0 ? `当前显示 ${strengthSessions} 节力量课` : '力量课未安排',
    },
    {
      id: 'today', label: '今日', role: '训练执行',
      readout: !input.loaded ? '读取中' : today > 0 ? `${completed}/${today} 项完成标记` : '尚无已确认课程',
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
  const planned = safeCount(input.todayPlanned);
  const marked = Math.min(planned, safeCount(input.todayMarkedDone));
  if (planned > marked) {
    return { target: 'today', title: '前往今日训练', detail: `今日 ${marked}/${planned} 项完成标记；未标记不等于未训练。` };
  }
  return { target: 'log', title: '核对训练与反馈', detail: '按训练编号核对实际记录；没有数据时保持未知。' };
}
