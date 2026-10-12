/** Read-only V3.3 plan amendment arbitration. No storage writes or medical diagnosis. */
export type PlanChangeRequest = {
  daysAhead: number
  expectedRevision: number
  actualRevision: number
  reason: string
  evidenceIds: string[]
  discomfort?: { region: string; severity: number | null; functionalLimitation: boolean | null }
  nextSessionIntensity: "EASY" | "MODERATE" | "HARD" | "UNKNOWN"
  proposedAction: "KEEP" | "REDUCE" | "REPLACE" | "POSTPONE" | "INCREASE"
}
export type PlanChangeDecision = {
  status: "REJECT_CONFLICT" | "SAFETY_REVIEW" | "REQUIRE_CONFIRMATION" | "NOTIFY_BEFORE_CHANGE" | "REPLAN_REVIEW"
  canApplyAutomatically: false
  explanation: string
  evidenceIds: string[]
  expectedRevision: number
}
export function arbitratePlanChange(request: PlanChangeRequest): PlanChangeDecision {
  const { daysAhead, expectedRevision, actualRevision, proposedAction, nextSessionIntensity, discomfort } = request
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !Number.isInteger(actualRevision) || actualRevision < 0 || !request.reason.trim() || !Array.isArray(request.evidenceIds) || request.evidenceIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("invalid plan change request")
  if (discomfort && (typeof discomfort.region !== "string" || !discomfort.region.trim() || (discomfort.severity !== null && (!Number.isInteger(discomfort.severity) || discomfort.severity < 0 || discomfort.severity > 10)))) throw new Error("invalid discomfort evidence")
  const base = { canApplyAutomatically: false as const, evidenceIds: [...new Set(request.evidenceIds)], expectedRevision }
  if (expectedRevision !== actualRevision) return { ...base, status: "REJECT_CONFLICT", explanation: "计划版本已改变，请重新生成修改建议，不能覆盖新版本。" }
  if (discomfort && (discomfort.severity === null || discomfort.functionalLimitation === null || discomfort.functionalLimitation || discomfort.severity >= 4 || (discomfort.severity > 0 && (nextSessionIntensity === "HARD" || nextSessionIntensity === "UNKNOWN")) || proposedAction === "INCREASE")) return { ...base, status: "SAFETY_REVIEW", explanation: "存在肌肉不适或功能风险，先停止高风险训练并复核；用户确认不能绕过安全复核。" }
  if (daysAhead <= 1) return { ...base, status: "REQUIRE_CONFIRMATION", explanation: "当天或次日计划调整必须由用户明确确认。" }
  if (daysAhead <= 7) return { ...base, status: "NOTIFY_BEFORE_CHANGE", explanation: "未来一周内的调整须提示用户；当前集成版本不自动写入计划。" }
  return { ...base, status: "REPLAN_REVIEW", explanation: "超过一周的变化需要重新审查周期目标与负荷。" }
}
