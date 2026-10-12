// These are explicit inputs for this planning request, not occurrence-bound evidence.
export function projectPlanningRecovery(raw: unknown): {
  scores: number[]
  status: "MISSING" | "AVAILABLE" | "CONFLICTING"
  sourceIds: string[]
  sources: { id: string; detail: string }[]
} {
  if (!Array.isArray(raw) || raw.length > 2 || raw.some((score) => typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 10)) throw new Error("invalid planning recovery")
  const scores = [...raw] as number[]
  const sources = scores.map((score, index) => ({ id: `planning:recovery:${index + 1}`, detail: `本次计划准备填写的主观恢复记录 ${index + 1}：${score}/10；未绑定历史训练` }))
  // Multiple records require an explicit human resolution even when scores match.
  return { scores, status: scores.length === 0 ? "MISSING" : scores.length === 1 ? "AVAILABLE" : "CONFLICTING", sources, sourceIds: sources.map((source) => source.id) }
}
