export type DeviceConflictAudit = {
  raw: string;
  source: "USER_REPORT";
  uncertainty: string[];
  text: string;
};
/** Missing measurements are not asserted readings; keep the original question for provenance. */
export function withoutUnavailableMetrics(question: string): string {
  return question
    .replace(/(?:没有|无|未|没)(?:测量|测|记录|提供|有)?\s*(?:hrv|心率变异性?|静息心率|rhr)(?:数据|记录)?/gi, '')
    .replace(/(?:hrv|心率变异性?|静息心率|rhr)(?:数据|记录)?\s*(?:未测|没测|未记录|没记录|未知|缺失|没有)/gi, '');
}
/** Read-only provenance audit, not a parser that promotes chat text into health facts. */
export function auditDeviceConflict(question: string): DeviceConflictAudit | null {
  const asserted = withoutUnavailableMetrics(question).replace(/(?:没有|无|未|没|不)(?:使用|佩戴|戴|有|用)?\s*(?:手表|设备)/g, '');
  const device = /手表|设备|健康|hrv|静息心率|rhr/i.test(asserted);
  const metrics = /睡眠|hrv|静息心率|rhr/i.test(asserted);
  const conflict = /冲突|不一致|不同|到底|正常|高强度|照常|睡了|小时|h(?:rv)?|心率/i.test(asserted);
  if (!device || !metrics || !conflict) return null;
  const uncertainty = [
    "同一日期、时区、夜间/全天统计窗口与佩戴覆盖未知",
    "健康汇总可能包含多个来源；原始来源、重复记录与优先级待核对",
    "HRV算法、单位与个人同设备基线未知；静息心率基线窗口、测量条件与趋势待核对",
    "本课RPE与当前症状/恢复信息不足；主观感觉正常不能补齐缺失",
  ];
  return {
    raw: question,
    source: "USER_REPORT",
    uncertainty,
    text: `设备证据审计（用户自报，未导入或写成事实）：${question}\n保留每个设备的原值及来源，不平均、不选择较好的睡眠数据，也不因品牌决定可信度。\n未知：${uncertainty.join("；")}。\n竞争解释：睡眠统计口径或佩戴覆盖不同；也可能存在真实状态变化。HRV单值与静息心率变化不能单独诊断疲劳或确认恢复正常。\n行动：先核对同一天的原始来源、覆盖时段及同设备个人基线，再补本课RPE和当前症状。不据此确认高强度或自动加量；可讨论不诱发不适的轻松候选。疼痛、胸痛、晕厥等安全线索优先专业评估。`,
  };
}
