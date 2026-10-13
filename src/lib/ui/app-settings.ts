/** 设置：8 组（名词分组，每组 ≤5 项），开关当场生效；总开关关闭时子项变灰。 */
import type { ReminderPrefs } from "./streak.ts"
export const SETTINGS_KEY = "fk-settings-v1"
export type AppSettings = { coachStyle: "brief" | "detailed"; showEvidence: boolean; personalize: boolean; reminders: ReminderPrefs; band: boolean; bandBasis: "time" | "distance"; units: "metric" | "imperial"; safetyLevel: "standard" | "strict"; dietAvoid: string }
export const SETTINGS_DEFAULTS: AppSettings = { coachStyle: "brief", showEvidence: false, personalize: true, reminders: { master: false, training: true, pending: true, stale: true, evening: true }, band: true, bandBasis: "time", units: "metric", safetyLevel: "standard", dietAvoid: "" }
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }
const store = (): KV | null => (typeof localStorage === "undefined" ? null : localStorage)
export function loadSettings(s: KV | null = store()): AppSettings {
  try { const v = JSON.parse(s?.getItem(SETTINGS_KEY) ?? "{}") ?? {}; return { ...SETTINGS_DEFAULTS, ...v, reminders: { ...SETTINGS_DEFAULTS.reminders, ...(v.reminders ?? {}) } } } catch { return SETTINGS_DEFAULTS }
}
export function saveSettings(next: AppSettings, s: KV | null = store()) { s?.setItem(SETTINGS_KEY, JSON.stringify(next)) }
/** 子开关是否生效：总开关关闭时一律不生效（界面变灰）。 */
export const effective = (r: ReminderPrefs, k: Exclude<keyof ReminderPrefs, "master">) => r.master && r[k]
/** 教练输出：简短 = 结论 + 最多 3 条；详细 = 全部。安全类（red）永远完整显示。 */
export function coachLines(lines: { text: string; safety?: boolean }[], style: AppSettings["coachStyle"]): { text: string; safety?: boolean }[] {
  const safety = lines.filter((l) => l.safety), rest = lines.filter((l) => !l.safety)
  return [...safety, ...(style === "brief" ? rest.slice(0, 4) : rest)]
}
/** “方坤收集了什么”：数据项、来源、用途、能否删除。 */
export const COLLECTED: { item: string; key: string; source: string; use: string }[] = [
  { item: "训练计划与实际", key: "fk-schedule-v1", source: "你手动记录 / 方坤建议", use: "排课、冲突检查、周对比" },
  { item: "训练日志", key: "fr255-confirmed-training-imports-v1", source: "记一笔 / 设备导入", use: "评估、进步记录" },
  { item: "睡眠·心率·HRV", key: "fr255-vitals-v1", source: "手表导入 / 手动", use: "今日恢复判断" },
  { item: "手表扩展指标", key: "fk-device-extra-v1", source: "手表导入", use: "准备度、身体电量、压力" },
  { item: "每日打卡与疼痛", key: "fk-checkin-v1", source: "你点选", use: "恢复判断、安全提醒" },
  { item: "饮食记录与目标", key: "fk-diet-goal-v1", source: "你记录", use: "饮食目标和建议" },
  { item: "对评估的反馈", key: "fk-assess-feedback-v1", source: "你点 👍/👎", use: "调整以后的建议" },
  { item: "引导问卷", key: "fk-onboard-v1", source: "首次引导", use: "个性化计划" },
]
