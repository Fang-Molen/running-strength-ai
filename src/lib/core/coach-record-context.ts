import type { CoachBrief } from "./coach-brief.ts"

/** Only restates existing, provenance-backed facts. No diagnosis, completeness assumption, or plan changes. */
export function answerFromRecordedContext(brief: CoachBrief): string | null {
  const q = brief.question.toLowerCase()
  const askFood = /今天|当天|这天|最近|记录|摄入|热量|吃了多少/.test(q) && /吃|饮食|热量|摄入|营养|卡路里/.test(q)
  const askTraining = /训练|跑步|力量|rpe|睡眠|恢复|完成/.test(q) && /记录|上次|最近|完成|多少|情况|数据/.test(q)
  if (!askFood && !askTraining) return null
  const lines: string[] = []
  if (askTraining) {
    if (!brief.occurrenceId) lines.push("没有选定可核验的训练记录；不会按日期猜测是哪一节。")
    else {
      lines.push(`已关联训练编号：${brief.occurrenceId}。`)
      if (brief.sessionRpe !== null) lines.push(`本次记录 RPE ${brief.sessionRpe}/10。`)
      if (brief.sleepHours !== null) lines.push(`本次绑定睡眠 ${brief.sleepHours} 小时。`)
      if (brief.subjectiveRecovery != null) lines.push(`本次绑定主观恢复 ${brief.subjectiveRecovery}/10。`)
      if (brief.plannedSetCount != null && brief.completedSetCount != null) lines.push(`力量组数：已完成 ${brief.completedSetCount}/${brief.plannedSetCount}。`)
      if (lines.length === 1) lines.push("本次可引用的量化数据不足。")
    }
  }
  if (askFood) {
    const fuel = brief.fuel
    if (!fuel || fuel.status === "DIFFERENT_DAY") lines.push("当前关联训练与今天不在同一天，不能将今天饮食记录归属到那次训练。")
    else if (fuel.status === "NO_RECORD") lines.push("关联训练当天没有可用的饮食记录；这不等于当天没有进食。")
    else if (fuel.logSourceId && brief.sourceIds.includes(fuel.logSourceId) && fuel.recordedKcal != null) {
      lines.push(`关联训练当天已记录 ${fuel.entries.length} 条饮食，合计 ${fuel.recordedKcal} 千卡（来源 ${fuel.logSourceId}）。`)
      lines.push("这只是已录入条目的合计，不能认定为全天实际摄入，也不能据此确认热量缺口。")
    } else lines.push("饮食来源未核验，暂不展示数值。")
    if (fuel?.targetKcal != null && fuel.targetSourceId && brief.sourceIds.includes(fuel.targetSourceId)) lines.push(`当天设置的热量目标为 ${fuel.targetKcal} 千卡（目标，不是实际摄入）。`)
  }
  return lines.join("\n") + "\n只读核对；没有修改训练、饮食或身体记录。"
}
