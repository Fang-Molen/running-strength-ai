import type { CoachAnalysisPacket } from "../../health/analysis-contract";
import { auditAnalysisContent } from "../../health/analysis-reply-validation";
/** Reuse the established numeric, unit, reference and safety audit. This is not a scientific certification. */
export function guardR5Reply(text: string, packet: CoachAnalysisPacket) {
  const audit = auditAnalysisContent(text, packet, { legacy: true }),
    errors = [...audit.errors];
  // A catalogue match alone cannot bind a number to its source or dimension.
  // Only exact host-owned factual sentences may carry numeric claims.
  let unbound = text;
  for (const row of [
    ...(packet.derivedFacts ?? []).map((d) => ({ text: d.text })),
    ...packet.assessment.observations,
  ])
    unbound = unbound.split(row.text).join("");
  if (/\d/.test(unbound)) errors.push("UNBOUND_NUMERIC_SOURCE");
  if (
    /(?:已|已经)(?:替你|为你)?(?:修改|保存|更新|执行)(?:了)?(?:课表|计划|资料)|解除(?:安全|疼痛|训练)?限制|恢复(?:百分比|率)\s*\d+/.test(
      text,
    )
  )
    errors.push("UNAUTHORIZED_WRITE_OR_CLEARANCE");
  if (
    packet.assessment.safetyState !== "NO_KNOWN_HOLD" &&
    /(?:可以|继续|照常|允许|放心).{0,10}(?:训练|跑步|深蹲|力量)|(?:恢复|准备度|HRV).{0,12}(?:正常|很好).{0,12}(?:训练|放行)/i.test(
      text,
    )
  )
    errors.push("ACTIVE_HOLD_RELEASE");
  if (/(?:确诊|诊断为|就是).{0,10}(?:炎|撕裂|骨折|拉伤)/.test(text)) errors.push("DIAGNOSIS_CLAIM");
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    professionalValidation: "NOT_PROVEN" as const,
    semanticReviewRequired: true as const,
  };
}
