import { mainTrainingLines } from '../plan/plan-main';
/** v89.2：肌群视图 / 方坤事实 读取“日志里的同一份真实记录”。
 *  - 力量：这次训练自己的逐组事件（completed 且未跳过；更正按日志同口径覆盖），动作名经动作库精确别名映射，不做模糊猜测。
 *  - 跑步：只用计划课的类型（V4 当天课文字 / 日程跑步课 purpose），不按平均心率、标题或距离推断。
 *  只读，不写任何存储。 */
import { CATALOG, exerciseById } from '../strength/catalog'
import type { V4Day } from '../ui/plan400-view'
import type { TrainingPart } from './muscle-recovery-u11'
export type RunType = NonNullable<TrainingPart['runType']>

/** 动作库（ACTIONS）键：local:<catalogId> / extra:<名称>。V4 课表与“我的力量安排”里的常用写法 → 库条目。逐字匹配，未列出的名称如实标“未映射”。 */
export const LIBRARY_ALIAS: Record<string, string> = {
  '分腿蹲': 'extra:分腿蹲', '保加利亚分腿蹲': 'local:bss', 'RDL': 'local:rdl', '罗马尼亚硬拉': 'local:rdl', '罗马尼亚硬拉 RDL': 'local:rdl',
  '臀推': 'local:hip-thrust', '杠铃臀推': 'local:hip-thrust', '臀桥': 'local:glute-bridge', '单腿臀桥': 'local:single-hip',
  '提踵': 'local:calf', '站姿提踵': 'local:calf', '膝屈提踵': 'local:seat-calf', '坐姿提踵': 'local:seat-calf',
  '抗旋': 'extra:Pallof 抗旋转', '抗旋转': 'extra:Pallof 抗旋转', 'Pallof 抗旋转': 'extra:Pallof 抗旋转', 'Pallof抗旋转': 'extra:Pallof 抗旋转',
  '台阶上步': 'local:step-up', '上步': 'local:step-up', '登阶': 'local:step-up', '侧桥': 'local:side-plank', '侧平板': 'local:side-plank',
  '死虫': 'local:dead-bug', '鸟狗': 'extra:鸟狗', '北欧腿弯举': 'extra:北欧腿弯举', '深蹲': 'extra:深蹲', '陷阱杠硬拉': 'local:trap-dl', '六角杠硬拉': 'local:trap-dl',
  '核心': 'extra:核心',
}
const clean = (s: string) => s.normalize('NFKC').replace(/[（(][^）)]*[）)]/g, '').replace(/(每侧|每腿|\/腿|\/侧|左右)$/g, '').trim()
/** 名称/目录 ID → 动作库键；找不到返回 null（不猜）。 */
export function libraryKey(name: string | null | undefined, catalogId?: string | null): string | null {
  if (catalogId && exerciseById(catalogId)) return `local:${catalogId}`
  const n = clean(name ?? ''); if (!n) return null
  if (LIBRARY_ALIAS[n]) return LIBRARY_ALIAS[n]
  const exact = CATALOG.filter(e => e.name === n)
  return exact.length === 1 ? `local:${exact[0].id}` : null
}

const PURPOSE: Record<string, RunType> = { EASY_AEROBIC: 'EASY', LONG: 'EASY', WARMUP: 'EASY', COOLDOWN: 'EASY', TEMPO_THRESHOLD: 'TEMPO', INTERVAL: 'INTERVAL', REPETITION_SPEED: 'SPRINT', HILL: 'HILL', RACE: 'INTERVAL' }
export const purposeRunType = (p: unknown): RunType => typeof p === 'string' ? PURPOSE[p] ?? 'UNKNOWN' : 'UNKNOWN'
/** V4 当天课的计划类型：只看计划文字（标题 + 主课），与手表数据无关。 */
export function v4RunType(d: Pick<V4Day, 'title' | 'main'> | undefined): RunType {
  if (!d || /^休息|完全休息|赛前休息/.test(d.title)) return 'UNKNOWN'
  const main = mainTrainingLines(d).join('')
  const reps = /\d{2,4}\s*(?:m|米)\s*[×xX*✕]|\(\d{2,4}m[＋+]\d{2,4}m\)|（\d{2,4}m[＋+]\d{2,4}m）|\d{3}m全力/.test(main)
  if (reps) return /节奏|容量/.test(d.title) ? 'TEMPO' : 'INTERVAL'
  if (/恢复|轻松|有氧/.test(d.title) || /轻松跑|慢跑/.test(main)) return 'EASY'
  return 'UNKNOWN'
}
export const RUN_TYPE_LABEL: Record<RunType, string> = { EASY: '轻松/恢复跑', TEMPO: '节奏跑', INTERVAL: '间歇/速度耐力', SPRINT: '冲刺', HILL: '坡跑', UNKNOWN: '类型未知' }
