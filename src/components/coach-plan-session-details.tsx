import type { PlanSessionCandidate } from "@/lib/core/coach-plan"

export function CoachPlanSessionDetails({ session }: { session: PlanSessionCandidate }) {
  return <>
    {session.runPrescription ? <div className="mt-2 rounded-card bg-surface p-2 text-sm">
      <p>热身 {session.runPrescription.warmupMinutes} 分钟</p>
      {session.runPrescription.main.map((block, index) => <p key={`${block.label}-${index}`} className="mt-1">{block.label}：{block.repetitions} 次 × {block.distanceMeters != null ? `${block.distanceMeters} 米` : `${block.durationSeconds} 秒`}{block.recoverySeconds != null ? `，恢复 ${block.recoverySeconds} 秒` : ""} · {block.effort}</p>)}
      <p className="mt-1">冷身 {session.runPrescription.cooldownMinutes} 分钟</p>
      <p className="mt-2 font-bold">跑步停止条件</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{session.runPrescription.stopConditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul>
    </div> : null}
    {session.strengthPrescription ? <div className="mt-2 rounded-card bg-surface p-2 text-sm">
      {session.strengthPrescription.exercises.map((exercise, index) => <p key={`${exercise.name}-${index}`} className="mt-1 first:mt-0">{exercise.name}：{exercise.sets} 组 × {exercise.repetitions != null ? `${exercise.repetitions} 次` : `${exercise.durationSeconds} 秒`}，休息 {exercise.restSeconds} 秒 · {exercise.effort}</p>)}
      <p className="mt-2 font-bold">力量停止条件</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{session.strengthPrescription.stopConditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul>
    </div> : null}
  </>
}
