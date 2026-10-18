import type { EvolutionSnapshot } from "./coach-evolution-v4.ts";
import { computeReasoningFacts } from "./coach-reasoning.ts";
/** R7: preserve R4's computed API; each statistic has full live sources and explicit limits. */
export type ComputedFact = { kind: string; text: string; cites: string[] };
export type V4Computed = {
  focus: string | null;
  facts: ComputedFact[];
  missing: string[];
  version: "FK-V4-R7-COMPUTED";
};
const mmss = (seconds: number) => {
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
function weekKey(iso: string) {
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function computeV4Facts(
  snapshot: EvolutionSnapshot,
  focus: string | null,
  unknownCommitTime = 0,
): V4Computed {
  const facts: ComputedFact[] = [],
    missing: string[] = [...snapshot.missing, ...(snapshot.active.some(e=>e.metric==="HR_AVG_BPM")?[]:["HR_NOT_A_FORMAL_FIELD"])];
  const mine = snapshot.active.filter((e) => e.occurrenceId === focus && e.source !== "PLAN");
  if (!focus || !mine.length)
    return {
      focus,
      facts,
      missing: [...new Set([...missing, "NO_SELECTED_ACTIVE_SESSION_FACTS"])],
      version: "FK-V4-R7-COMPUTED",
    };
  const c = computeReasoningFacts(snapshot, [focus]);
  for(const h of c.heartRates)facts.push({kind:"SEGMENT_HEART_RATE",text:`已记录分段平均心率 ${h.value}bpm；方法 ${h.method}；不能推断生理解耦`,cites:[h.sourceId,h.segmentSourceId]});
  for(const s of c.strength)facts.push({kind:'STRENGTH_SET',text:`已记录力量组 ${s.kg??'未知'}kg × ${s.amount}${s.unit==='s'?'秒':'次'}；${s.volumeKgReps===null?'不能计算重量×次数':`重量×次数 ${s.volumeKgReps}kg·次`}；不是生理负荷或完整周总量`,cites:s.sourceIds});
  for(const r of c.ratings.filter(r=>r.metric==='SUBJECTIVE_RECOVERY'||r.metric==='SORENESS'))facts.push({kind:r.metric,text:`${r.metric==='SORENESS'?'酸痛程度':'主观恢复'} ${r.value}/10；是所选课次记录，不能证明当前恢复；酸痛不等于疼痛`,cites:[r.sourceId]});
  for (const g of c.groups)
    facts.push({
      kind: "REP_PACE",
      text: `同课次、轮次、实际距离与方法的${g.count}段配速 ${g.paces.join("→")}/km；加权平均${g.averagePace}/km；末段与首段用时差${g.firstToLastSeconds.toFixed(2)}秒；趋势${g.trend}，仅为记录观察`,
      cites: g.sourceIds,
    });
  for (const p of c.points)
    facts.push({
      kind: "WORK_PACE",
      text: `实际${p.distanceMeters ?? "未知"}米/${p.seconds}秒；配速${p.pace ?? "未知"}/km；${p.confirmation === "CONFIRMED" ? "已绑定记录" : "来源待核验"}`,
      cites: [p.sourceId],
    });
  for (const r of c.rests)
    if (r.workSourceId && r.recoveryToWorkRatio !== null)
      facts.push({
        kind: "RECOVERY_RATIO",
        text: `实际恢复${r.seconds}秒/对应前一段工作时间比${r.recoveryToWorkRatio}；只按AFTER_REPEAT槽位配对，非恢复充分程度`,
        cites: [r.sourceId, r.workSourceId],
      });
    else missing.push("RECOVERY_WORK_BINDING_UNKNOWN");
  const earlier = snapshot.active.filter(
    (e) =>
      e.occurrenceId !== focus &&
      Date.parse(e.eventAt) < Math.min(...mine.map((e) => Date.parse(e.eventAt))),
  );
  const earlierIds = [...new Set(earlier.map((e) => e.occurrenceId))];
  const prior = computeReasoningFacts({ ...snapshot, active: earlier }, earlierIds);
  for (const g of c.groups) {
    const p = c.points.find((p) => p.sourceId === g.sourceIds[0])!;
    const protocol = p.protocol.replace(/:[1-9]\d*:(\d+(?:\.\d+)?)m$/, ":$1m");
    const others = prior.groups
      .filter(
        (h) =>
          h.distanceMeters === g.distanceMeters &&
          h.count === g.count &&
          prior.points.some(
            (x) =>
              h.sourceIds.includes(x.sourceId) &&
              x.source === p.source &&
              x.confirmation === p.confirmation &&
              x.protocol.replace(/:[1-9]\d*:(\d+(?:\.\d+)?)m$/, ":$1m") === protocol,
          ),
      )
      .slice(-3);
    for (const old of others)
      facts.push({
        kind: "VS_SIMILAR",
        text: `同协议、段数、实际距离及方法的历史观察：本次平均${g.averagePace}/km，较早课次平均${old.averagePace}/km；恢复、天气等可比性仍需核对，不代表能力变化`,
        cites: [...g.sourceIds, ...old.sourceIds],
      });
    if (!others.length) missing.push("NO_VERIFIED_SIMILAR_COMPARISON");
  }
  // Recorded work time is not a load score; include ALL source IDs, never just the first four.
  const wk = weekKey(mine[0].eventAt),
    prev = weekKey(new Date(Date.parse(wk + "T00:00:00Z") - 7 * 864e5).toISOString());
  const work = snapshot.active.filter(
    (e) =>
      e.metric === "SPLIT_SECONDS" && e.source !== "PLAN" && e.value !== null && e.unit === "s",
  );
  const now = work.filter((e) => weekKey(e.eventAt) === wk),
    before = work.filter((e) => weekKey(e.eventAt) === prev);
  if (now.length && before.length) {
    const a = now.reduce((n, e) => n + e.value!, 0),
      b = before.reduce((n, e) => n + e.value!, 0);
    facts.push({
      kind: "WEEKLY_LOAD",
      text: `上海周本周已记录工作时间${mmss(a)}，上周${mmss(b)}，差${((a / b - 1) * 100).toFixed(1)}%；不代表完整周训练量，未校验可比性或生理负荷`,
      cites: [...now, ...before].map((e) => e.sourceId),
    });
  } else missing.push("NO_PREVIOUS_WEEK_FOR_RECORDED_TIME_COMPARISON");
  for (const correction of snapshot.corrections) {
    const replacement = snapshot.active.find((e) => e.id === correction.replacementId);
    if (replacement?.occurrenceId === focus)
      facts.push({
        kind: "CORRECTED",
        text: "本次有已生效的事实更正，依赖旧值的解释需要重新核对",
        cites: [replacement.sourceId],
      });
  }
  const late = mine.filter((e) => Date.parse(e.recordedAt) - Date.parse(e.eventAt) > 24 * 3600e3);
  if (late.length)
    facts.push({
      kind: "LATE_ADDED",
      text: `本次${late.length}条记录在发生24小时后补录；补录之前不得作为已知事实`,
      cites: late.map((e) => e.sourceId),
    });
  if (snapshot.scopeConflictCount) missing.push("SELECTED_FACT_CONFLICT");
  if (unknownCommitTime) missing.push(`UNKNOWN_COMMIT_TIME_${unknownCommitTime}`);
  return { focus, facts, missing: [...new Set(missing)], version: "FK-V4-R7-COMPUTED" };
}
