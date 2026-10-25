import type { SymptomRow } from "./symptom-store";
import { shiftDay, validDay } from "./observation";
import { detectRedFlags } from "../core/coach-red-flags";
export function reviewSymptoms(rows: SymptomRow[], day: string, span: 3 | 7 | 14) {
  if (!validDay(day) || ![3, 7, 14].includes(span)) throw Error("症状窗口无效");
  const through = rows.filter((r) => !r.retracted && r.occurredAt.slice(0, 10) <= day),
    start = shiftDay(day, 1 - span);
  const shown = through.filter((r) => r.occurredAt.slice(0, 10) >= start),
    map = new Map<string, SymptomRow[]>();
  for (const row of shown) {
    const key = JSON.stringify([row.kind, row.region, row.side]);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  const groups = [...map.values()].map((rs) => {
    const sorted = rs.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      values = sorted.filter((r) => r.severity !== null);
    return {
      kind: sorted[0].kind,
      region: sorted[0].region,
      side: sorted[0].side,
      observations: sorted,
      latest: sorted.at(-1)!,
      change: values.length > 1 ? values.at(-1)!.severity! - values[0].severity! : null,
      missingDays: span - new Set(sorted.map((r) => r.occurredAt.slice(0, 10))).size,
    };
  });
  const flags = through.map((r) => detectRedFlags(r.notes + "，" + (r.trigger ?? "")));
  const emergency = flags.some((x) => ["EMERGENCY", "URGENT_MEDICAL"].includes(x.level));
  const hold =
    through.some(
      (r) =>
        (r.kind === "PAIN" && (r.severity === null || r.severity > 0 || r.trend === "WORSENING")) ||
        ["LIMITED", "UNABLE"].includes(r.functionImpact),
    ) || flags.some((x) => x.level !== "NONE");
  const safety = emergency
    ? ("ESCALATION_REQUIRED" as const)
    : hold
      ? ("HOLD_ACTIVE" as const)
      : ("NO_KNOWN_HOLD" as const);
  return {
    day,
    span,
    groups,
    safety,
    constraints: through
      .filter(
        (r) =>
          (r.kind === "PAIN" &&
            (r.severity === null || r.severity > 0 || r.trend === "WORSENING")) ||
          ["LIMITED", "UNABLE"].includes(r.functionImpact) ||
          detectRedFlags(r.notes + "，" + (r.trigger ?? "")).level !== "NONE",
      )
      .map((r) => ({
        id: `symptom-hold:${r.id}`,
        version: String(r.revision),
        scope: emergency ? "URGENT_MEDICAL" : "PAIN_REVIEW",
        evidenceRefs: [{ id: `symptom:${r.id}`, revision: r.revision }],
      })),
    message: emergency
      ? "存在危险症状：停止训练并尽快寻求医疗评估；紧急症状立即联系当地急救。"
      : hold
        ? "疼痛或功能限制需复核：暂停诱发症状的训练，不能用设备恢复分数放行；持续、加重或功能受限时寻求医疗评估。"
        : "当前记录未提示新的疼痛限制；缺失记录不代表无症状。",
    caveat:
      "疼痛、酸痛与训练刺激分别展示。缺失日期不补零，不计算组织恢复百分比；一次无痛反馈不会自动解除既有疼痛限制。",
  };
}
