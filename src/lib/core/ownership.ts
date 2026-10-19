/** 归属规则（单一出处，C03/R14 合并时新增）。
 * - 新写入的记录一律显式写 athleteId。
 * - 旧记录没有 athleteId：属于保留的本机历史档案 'local'（线上 App 只有这一个运动员）。
 *   读取和原地修改只对 'local' 开放，不补写 athleteId（不做隐式迁移）；其他运动员既看不到也改不了。
 * - 其他运动员的记录永远不写进当前档案。 */
import { currentAthleteId } from './events.ts'
export const LEGACY_OWNER = 'local'
export const ownerOf = (x: { athleteId?: string | null } | null | undefined): string => x?.athleteId ?? LEGACY_OWNER
export const ownedBy = (x: { athleteId?: string | null } | null | undefined, athleteId: string) => ownerOf(x) === athleteId
export const ownedByCurrent = (x: { athleteId?: string | null } | null | undefined) => ownedBy(x, currentAthleteId())
