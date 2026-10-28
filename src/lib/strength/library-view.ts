import { poseCardUrl, posePattern, POSE_PATTERNS, type PoseGender } from './pose-cards-r8';

/** 动作库列表的纯逻辑：演示素材状态、按动作模式分组。只读，不改任何训练数据。 */
export type DemoStatus = 'video' | 'pose' | 'none';
export const DEMO_STATUS_LABEL: Readonly<Record<DemoStatus, string>> = { video: '已审核视频', pose: '待审核示意', none: '暂无演示' };

type Row = { id: string; catalogId: string | null; source: 'local' | 'foot' | 'external' };
/** 审核视频清单里的键是 `${gender}:${exerciseId}`；没有清单或不在清单里就不是“已审核视频”。 */
export function demoStatusOf(row: Row, gender: PoseGender, approved: ReadonlySet<string>): DemoStatus {
  const exerciseId = row.catalogId ?? row.id;
  if (row.source !== 'external' && approved.has(`${gender}:${exerciseId}`)) return 'video';
  if (row.source !== 'external' && poseCardUrl(exerciseId, gender)) return 'pose';
  return 'none';
}

export const EXTERNAL_GROUP = '扩展目录（待核对）';
export function actionPattern(row: Row): string {
  if (row.source === 'external') return EXTERNAL_GROUP;
  return posePattern(row.catalogId ?? row.id);
}
const ORDER = [...POSE_PATTERNS, '其他', EXTERNAL_GROUP];
export type ActionGroup<T> = { name: string; items: T[] };
/** 按固定顺序分组；空组不出现；组内保持原有顺序。 */
export function groupByPattern<T extends Row>(rows: readonly T[]): ActionGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) { const name = actionPattern(row); const list = map.get(name); if (list) list.push(row); else map.set(name, [row]); }
  return ORDER.filter(name => map.has(name)).map(name => ({ name, items: map.get(name)! }));
}
