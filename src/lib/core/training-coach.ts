import type { ConfirmedTrainingImport, ImportedRunningSegment } from "./training-import.ts"

export type CoachEvidenceClaim = {
  text: string
  citations: string[]
  kind: "FACT" | "OBSERVATION" | "BOUNDARY" | "QUESTION"
}

export type ImportedTrainingCoachAssessment = {
  confirmedImportId: string
  status: "REVIEW_ONLY" | "NEEDS_INPUT" | "HOLD_OR_REDUCE"
  facts: CoachEvidenceClaim[]
  observations: CoachEvidenceClaim[]
  evidenceGaps: CoachEvidenceClaim[]
  nextSession: CoachEvidenceClaim
  capabilityConclusion: "NOT_ASSESSED_FROM_ONE_SESSION"
  planComparison: "UNAVAILABLE_ACTUAL_ONLY"
}

export type ImportedTrainingTrend = {
  status: "INSUFFICIENT_SESSIONS" | "NOT_COMPARABLE" | "OBSERVATION_READY"
  sessionCount: number
  distinctDayCount: number
  observations: CoachEvidenceClaim[]
  evidenceGaps: CoachEvidenceClaim[]
  adjustment: {
    action: "ASK" | "HOLD" | "HOLD_OR_REDUCE"
    text: string
    citations: string[]
    requiresUserConfirmation: true
  }
  capabilityConclusion: "NOT_ESTABLISHED"
}

function sourceId(record: ConfirmedTrainingImport, suffix: string): string | null {
  const id = `import:${record.draftId}:${suffix}`
  return record.sourceIds.includes(id) ? id : null
}

function claim(text: string, citations: (string | null | undefined)[], kind: CoachEvidenceClaim["kind"]): CoachEvidenceClaim {
  return { text, citations: [...new Set(citations.filter((id): id is string => Boolean(id)))], kind }
}

function recorded<T>(field: { status: string; value: T | null }): field is { status: "RECORDED"; value: T } {
  return field.status === "RECORDED" && field.value != null
}

function completedComparableSegments(record: ConfirmedTrainingImport): { segment: ImportedRunningSegment; index: number; distance: number; seconds: number; sourceId: string }[] {
  return record.runningSegments.flatMap((segment, index) => {
    const id = sourceId(record, `run-${index + 1}`)
    if (segment.kind === "RECOVERY" || segment.completion !== "COMPLETED" || !recorded(segment.distanceMeters) || !recorded(segment.durationSeconds) || !id) return []
    return [{ segment, index, distance: segment.distanceMeters.value, seconds: segment.durationSeconds.value, sourceId: id }]
  })
}

function sameDistanceSeries(record: ConfirmedTrainingImport) {
  if (record.runningStructure !== "REPEATED") return []
  const work = record.runningSegments.filter((segment) => segment.kind !== "RECOVERY")
  const completed = completedComparableSegments(record)
  if (completed.length < 2 || completed.length !== work.length || work.some((segment) => segment.kind !== "REPETITION") || new Set(completed.map((item) => item.distance)).size !== 1) return []
  return completed
}

export function assessImportedTraining(record: ConfirmedTrainingImport): ImportedTrainingCoachAssessment {
  const facts: CoachEvidenceClaim[] = []
  const observations: CoachEvidenceClaim[] = []
  const evidenceGaps: CoachEvidenceClaim[] = []

  if (recorded(record.occurredAt)) facts.push(claim(`训练时间已确认为 ${record.occurredAt.value}。`, [sourceId(record, "occurred-at")], "FACT"))
  if (recorded(record.totalDistanceMeters)) facts.push(claim(`已记录总距离 ${record.totalDistanceMeters.value} 米。`, [sourceId(record, "distance")], "FACT"))
  if (recorded(record.durationSeconds)) facts.push(claim(`已记录总时长 ${record.durationSeconds.value} 秒。`, [sourceId(record, "duration")], "FACT"))

  const series = sameDistanceSeries(record)
  if (series.length >= 2) {
    const first = series[0]!
    const last = series.at(-1)!
    const delta = Number((last.seconds - first.seconds).toFixed(2))
    const direction = delta > 0 ? `末段比首段慢 ${delta} 秒` : delta < 0 ? `末段比首段快 ${Math.abs(delta)} 秒` : "首末段用时相同"
    observations.push(claim(`这次记录里，同为 ${first.distance} 米的首段 ${first.seconds} 秒、末段 ${last.seconds} 秒；${direction}。这只是本次分段观察，不等于长期能力变化。`, [first.sourceId, last.sourceId], "OBSERVATION"))
  } else if ((record.sport === "RUNNING" || record.sport === "MIXED") && record.runningStructure === "UNAVAILABLE") {
    evidenceGaps.push(claim("跑步结构不可用，不能把这次记录拆成间歇，也不能分析分段变化。", [sourceId(record, "occurred-at")], "BOUNDARY"))
  } else if (record.runningStructure === "REPEATED" && record.runningSegments.some((segment) => segment.kind !== "RECOVERY" && segment.completion === "NOT_RECORDED")) {
    evidenceGaps.push(claim("有重复跑槽位未记录实际，不能把局部成绩当作完整间歇课的首末变化。未记录不等于没做。", [], "BOUNDARY"))
  }

  const runningWork = record.runningSegments.filter((segment) => segment.kind !== "RECOVERY")
  const segment = runningWork.length === 1 ? runningWork[0] : undefined
  if (segment?.kind === "CONTINUOUS" && segment.completion === "COMPLETED" && recorded(segment.distanceMeters) && recorded(segment.durationSeconds)) {
    const secondsPerKm = segment.durationSeconds.value / segment.distanceMeters.value * 1000
    const rounded = Math.round(secondsPerKm)
    const segmentSource = sourceId(record, `run-${record.runningSegments.indexOf(segment) + 1}`)
    if (segmentSource && rounded > 0 && rounded < 3600) {
      observations.push(claim(`已记录的连续跑 ${segment.distanceMeters.value} 米、${segment.durationSeconds.value} 秒，折算约 ${Math.floor(rounded / 60)} 分 ${String(rounded % 60).padStart(2, "0")} 秒/公里。这是本段实际的算术观察，不代表整节混合训练的配速或长期能力。`, [segmentSource], "OBSERVATION"))
    }
  }

  const completedStrength = record.strengthSets.flatMap((set, index) => set.completion === "COMPLETED" ? [sourceId(record, `set-${index + 1}`)] : []).filter((id): id is string => Boolean(id))
  if (completedStrength.length) {
    observations.push(claim(`力量部分已记录完成 ${completedStrength.length} 组；没有记录的组不能推断为实际没做。`, completedStrength, "OBSERVATION"))
  }

  const rpe = recorded(record.sessionRpe) ? record.sessionRpe.value : null
  const recovery = recorded(record.subjectiveRecovery) ? record.subjectiveRecovery.value : null
  const sleep = recorded(record.sleepHours) ? record.sleepHours.value : null
  if (rpe != null) facts.push(claim(`本次已记录 RPE ${rpe}/10。`, [sourceId(record, "rpe")], "FACT"))
  if (recovery != null) facts.push(claim(`本次已记录主观恢复 ${recovery}/10。`, [sourceId(record, "recovery")], "FACT"))
  if (sleep != null) facts.push(claim(`已记录睡眠 ${sleep} 小时；单次记录不能确定训练表现的原因。`, [sourceId(record, "sleep")], "FACT"))
  if (recorded(record.pain)) {
    const severity = record.pain.value.intensity == null ? "程度未记录" : `${record.pain.value.intensity}/10`
    observations.push(claim(`已记录${record.pain.value.location}疼痛 ${severity}；这里不作伤病诊断。`, [sourceId(record, "pain")], "OBSERVATION"))
  }
  if (recorded(record.soreness)) {
    const severity = record.soreness.value.intensity == null ? "程度未记录" : `${record.soreness.value.intensity}/10`
    observations.push(claim(`已记录${record.soreness.value.location}酸痛 ${severity}；酸痛不等于疼痛或伤病。`, [sourceId(record, "soreness")], "OBSERVATION"))
  }

  if (rpe != null && rpe >= 8 && recovery == null) evidenceGaps.push(claim("RPE 较高，但恢复评分未记录；下一课前需要先确认主观恢复。", [sourceId(record, "rpe")], "QUESTION"))
  if (recovery == null) evidenceGaps.push(claim("主观恢复未记录，不能把缺失当成恢复正常或 0。", [], "BOUNDARY"))
  if (!recorded(record.pain)) evidenceGaps.push(claim("没有绑定的疼痛记录，不等于确认没有疼痛，也不能据此确认安全回归。", [], "BOUNDARY"))

  let status: ImportedTrainingCoachAssessment["status"] = "REVIEW_ONLY"
  let nextSession = claim("单次实际记录只支持复盘；暂不据此增加训练量，后续仍需结合恢复、疼痛与连续训练反应。", record.sourceIds.slice(0, 6), "BOUNDARY")
  if (recorded(record.pain)) {
    status = "HOLD_OR_REDUCE"
    nextSession = claim("下一课只考虑保持、减量或恢复；停止诱发疼痛的动作，症状持续或加重时考虑运动医学或康复评估。", [sourceId(record, "pain"), sourceId(record, "recovery")], "BOUNDARY")
  } else if (recovery != null && recovery <= 3) {
    status = "HOLD_OR_REDUCE"
    nextSession = claim("主观恢复较低，下一课先考虑保持、减量或恢复，并核对后续恢复情况；不据此判断已有疼痛或伤病。", [sourceId(record, "recovery")], "BOUNDARY")
  } else if ((rpe != null && rpe >= 8 && recovery == null) || recovery == null) {
    status = "NEEDS_INPUT"
    nextSession = claim("先补充 1–10 的主观恢复评分，并确认当前是否仍有疼痛；在此之前不形成加量建议。", [sourceId(record, "rpe")], "QUESTION")
  } else if (sleep != null && sleep < 6) {
    status = "HOLD_OR_REDUCE"
    nextSession = claim("已记录睡眠较短，下一课先考虑保持、减量或恢复，并核对后续睡眠与身体感受；单次睡眠记录不能证明表现变化的原因。", [sourceId(record, "sleep"), sourceId(record, "recovery")], "BOUNDARY")
  } else if (recorded(record.soreness)) {
    status = "HOLD_OR_REDUCE"
    nextSession = claim("酸痛本身不能证明受伤，但下一课先保持、减量或恢复，并继续观察是否出现疼痛。", [sourceId(record, "soreness"), sourceId(record, "recovery")], "BOUNDARY")
  }

  return {
    confirmedImportId: record.confirmedImportId,
    status,
    facts,
    observations,
    evidenceGaps,
    nextSession,
    capabilityConclusion: "NOT_ASSESSED_FROM_ONE_SESSION",
    planComparison: "UNAVAILABLE_ACTUAL_ONLY",
  }
}

function shanghaiDay(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value
  const [year, month, day] = [get("year"), get("month"), get("day")]
  return year && month && day ? `${year}-${month}-${day}` : null
}

function signature(record: ConfirmedTrainingImport): string | null {
  if (record.runningStructure !== "REPEATED") return null
  const completed = completedComparableSegments(record)
  const repetitions = record.runningSegments.filter((item) => item.kind !== "RECOVERY")
  if (completed.length < 2 || completed.length !== repetitions.length || repetitions.some((item) => item.kind !== "REPETITION") || new Set(completed.map((item) => item.distance)).size !== 1) return null
  const keys = completed.map(({ segment, distance }) => recorded(segment.round) && recorded(segment.repeat) ? `${segment.round.value}:${segment.repeat.value}:${distance}` : null)
  return keys.every(Boolean) && new Set(keys).size === keys.length ? keys.join("|") : null
}

function sessionMedian(record: ConfirmedTrainingImport): { value: number; citations: string[] } | null {
  const values = completedComparableSegments(record).sort((a, b) => a.seconds - b.seconds)
  if (!values.length) return null
  const middle = Math.floor(values.length / 2)
  const value = values.length % 2 ? values[middle]!.seconds : (values[middle - 1]!.seconds + values[middle]!.seconds) / 2
  return { value: Number(value.toFixed(2)), citations: values.map((item) => item.sourceId) }
}

export function assessImportedTrainingTrend(records: ConfirmedTrainingImport[]): ImportedTrainingTrend {
  const ordered = [...new Map(records.map((record) => [record.confirmedImportId, record])).values()]
    .filter((record) => record.userConfirmed && record.recordMode === "ACTUAL_ONLY" && record.canonicalOccurrenceId === null && recorded(record.occurredAt) && Number.isFinite(Date.parse(record.occurredAt.value)))
    .sort((a, b) => Date.parse(a.occurredAt.value ?? "") - Date.parse(b.occurredAt.value ?? ""))
    .slice(-6)
  const days = [...new Set(ordered.map((record) => shanghaiDay(record.occurredAt.value)).filter((day): day is string => Boolean(day)))]
  const sharedCitations = ordered.flatMap((record) => [sourceId(record, "occurred-at"), sourceId(record, "rpe"), sourceId(record, "recovery"), sourceId(record, "pain")]).filter((id): id is string => Boolean(id))
  if (ordered.length < 3 || days.length < 3) {
    return {
      status: "INSUFFICIENT_SESSIONS", sessionCount: ordered.length, distinctDayCount: days.length, observations: [],
      evidenceGaps: [claim("至少需要 3 个不同上海日历日的已确认训练，才能开始纵向观察；单次或同日记录不能拼成趋势。", sharedCitations, "BOUNDARY")],
      adjustment: { action: "ASK", text: "继续记录训练，并补齐 RPE、恢复和当前疼痛情况；现在不调整周期负荷。", citations: sharedCitations, requiresUserConfirmation: true },
      capabilityConclusion: "NOT_ESTABLISHED",
    }
  }
  const partial = ordered.filter((record) => record.importCompleteness && record.importCompleteness.status !== "COMPLETE")
  const comparableRecords = ordered.filter((record) => !record.importCompleteness || record.importCompleteness.status === "COMPLETE")
  if (partial.length) {
    return {
      status: "NOT_COMPARABLE", sessionCount: ordered.length, distinctDayCount: days.length, observations: [],
      evidenceGaps: [claim("有训练的提取完整性不是完整。部分草稿不能参加全课完成度、计划偏差或趋势比较。", partial.flatMap((record) => record.sourceIds.slice(0, 2)), "BOUNDARY")],
      adjustment: { action: "ASK", text: "先核对未完整提取的次数和组数；未列出的重复不算没做，现在不比较趋势。", citations: sharedCitations, requiresUserConfirmation: true },
      capabilityConclusion: "NOT_ESTABLISHED",
    }
  }
  const signatures = comparableRecords.map(signature)
  const comparable = signatures[0] != null && signatures.every((value) => value === signatures[0])
  const medians = ordered.map(sessionMedian)
  const painRecords = ordered.filter((record) => recorded(record.pain))
  const lowRecovery = ordered.filter((record) => recorded(record.subjectiveRecovery) && record.subjectiveRecovery.value <= 3)
  const highRpeMissingRecovery = ordered.filter((record) => recorded(record.sessionRpe) && record.sessionRpe.value >= 8 && !recorded(record.subjectiveRecovery))
  const missingRecovery = ordered.some((record) => !recorded(record.subjectiveRecovery))
  if (!comparable || medians.some((item) => item == null)) {
    return {
      status: "NOT_COMPARABLE", sessionCount: ordered.length, distinctDayCount: days.length, observations: [],
      evidenceGaps: [claim("这些训练的跑步结构、槽位、距离或实际用时不能逐次对齐，因此不能比较快慢或推断能力变化。", ordered.flatMap((record) => record.sourceIds.slice(0, 4)), "BOUNDARY")],
      adjustment: { action: painRecords.length || lowRecovery.length ? "HOLD_OR_REDUCE" : missingRecovery ? "ASK" : "HOLD", text: painRecords.length || lowRecovery.length ? "先保持、减量或恢复，不用不可比训练推动加量。" : missingRecovery ? "先核对缺失或冲突的恢复记录，不用不可比训练形成下一课处方。" : "保持现有方向并继续收集可比较训练，不用不可比训练推动加量。", citations: sharedCitations, requiresUserConfirmation: true },
      capabilityConclusion: "NOT_ESTABLISHED",
    }
  }
  const observations = [claim(`最近 ${ordered.length} 次同结构训练的分段用时中位数依次为 ${medians.map((item) => `${item!.value} 秒`).join("、")}。这只是可比训练观察，不等于长期能力已经提高或下降。`, medians.flatMap((item) => item!.citations), "OBSERVATION")]
  let action: ImportedTrainingTrend["adjustment"]["action"] = "HOLD"
  let text = "证据只支持保持现有方向并继续观察；任何进阶仍需新的候选计划和用户确认。"
  if (painRecords.length || lowRecovery.length) {
    action = "HOLD_OR_REDUCE"
    text = "存在疼痛或低恢复记录，只考虑保持、减量或恢复；不能据此加量。"
  } else if (highRpeMissingRecovery.length || ordered.some((record) => !recorded(record.subjectiveRecovery))) {
    action = "ASK"
    text = "有训练缺恢复证据，先补齐恢复与当前疼痛情况；在此之前不形成进阶候选。"
  }
  return {
    status: "OBSERVATION_READY", sessionCount: ordered.length, distinctDayCount: days.length, observations, evidenceGaps: [],
    adjustment: { action, text, citations: sharedCitations, requiresUserConfirmation: true },
    capabilityConclusion: "NOT_ESTABLISHED",
  }
}
