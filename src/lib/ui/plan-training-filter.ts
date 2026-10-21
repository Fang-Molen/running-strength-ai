import { dayKind, hasRunPart, hasStrength, type V4Day } from './plan400-view';

export type PlanTrainingPane = 'run' | 'strength';

type ScheduledPlanPaneEntry = {
  readonly id: string;
  readonly modality: string;
  readonly status: string;
  readonly trainingType?: string;
  readonly unplanned?: boolean;
};

/** 只筛选计划页的已有条目；组合训练在两个入口中仍是同一条日程。 */
export function matchesScheduledPlanPane(entry: ScheduledPlanPaneEntry, pane: PlanTrainingPane): boolean {
  return (entry.status === 'planned' || entry.status === 'done')
    && !entry.id.startsWith('plan400:')
    && !entry.unplanned
    && (entry.trainingType === 'mixed' || entry.modality === pane);
}

/** 沿用导入课表的分项口径，不改标题、内容或完成状态。 */
export function matchesImportedPlanPane(day: V4Day, pane: PlanTrainingPane): boolean {
  return pane === 'run' ? hasRunPart(day) : hasStrength(day) && dayKind(day) !== 'rest';
}
