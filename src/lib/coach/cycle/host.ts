import { cyclePrompt } from "./prompt";
import { currentAthleteId } from "../../core/events";
import { currentStore } from "../../core/storage";
import { appendJournal, readJournal } from "../../core/storage-journal";
import { analysisDigest } from "../../health/analysis-evidence";
import { readEffectiveProfile } from "../loop/effective-host";
import { requireR5Scope, r5ScopeReady } from "../r5/scope";
import { readR5Context, commitR5Schedule, r5Changed } from "../r5/host";
import {
  readScheduleDocument,
  loadSchedule,
  saveSchedule,
  type R5ScheduleAudit,
} from "../../ui/day-schedule";
import { withScheduleLock } from "../../ui/schedule-writer";
import { activePlanDoc, planDocumentKey } from "../../plan/active-plan";
import { r4CourseStarted } from "../r4/courses";
import { localDay } from "../../health/observation";
import { buildCycleDraft, cycleBasis, type CycleDraft } from "./planner";
import { validateCycleGoal, type CycleGoal, type CycleInput, type CycleRequest } from "./types";
export const CYCLE_CHANGED = "fk-cycle-changed";
const prefix = (kind: string) => `fk-cycle:${kind}:${encodeURIComponent(currentAthleteId())}:`;
export type CycleDocument = {
  id: string;
  sequence?: number;
  athleteId: string;
  draft: CycleDraft;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "STALE" | "UNDONE";
  acceptedBasis?: string;
  feedback?: CycleFeedback;
  history: { at: string; action: string }[];
};
export type CycleFeedback = {
  state: "PENDING" | "SUPPORTED" | "WEAKENED" | "WITHDRAWN";
  completed: number;
  missed: number;
  unrecorded: number;
  message: string;
  basis: string;
};
const changed = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CYCLE_CHANGED));
  r5Changed();
};
export function readCycleGoal(): CycleGoal | null {
  if (!r5ScopeReady()) return null;
  const rows = readJournal<CycleGoal>(prefix("goal")).filter(
    (r) => r.data.athleteId === currentAthleteId(),
  );
  const values = rows.map((r) => r.data).sort((a, b) => b.revision - a.revision);
  const g = values[0] ?? null;
  if (g && values.some((v) => v.revision === g.revision && analysisDigest(v) !== analysisDigest(g)))
    throw Error("周期目标同版本冲突，请核对来源");
  if (g) validateCycleGoal(g);
  return g;
}
export async function saveCycleGoal(
  values: Omit<CycleGoal, "schema" | "athleteId" | "revision" | "savedAt" | "source">,
  expectedRevision: number,
  now = new Date().toISOString(),
) {
  requireR5Scope();
  const owner = currentAthleteId();
  return (
    await withScheduleLock(() => {
      requireR5Scope();
      if (currentAthleteId() !== owner) throw Error("身份已变化");
      const prior = readCycleGoal();
      if ((prior?.revision ?? 0) !== expectedRevision) throw Error("周期目标已变化，请重新读取");
      const goal: CycleGoal = {
        ...values,
        schema: 1,
        athleteId: owner,
        revision: expectedRevision + 1,
        savedAt: now,
        source: "USER_CONFIRMED_GOAL",
      };
      validateCycleGoal(goal);
      if (!appendJournal(prefix("goal"), `${goal.revision}`, goal))
        throw Error("目标保存失败，原计划未改变");
      changed();
      return goal;
    })
  ).value;
}
export function readCycleContext(now = new Date().toISOString(), request?: CycleRequest): CycleInput {
  const c = readR5Context(now),
    saved = readCycleGoal();
  const goal: CycleGoal = saved ?? {
    schema: 1,
    athleteId: c.owner,
    revision: 0,
    savedAt: now,
    eventMeters: null,
    raceDate: null,
    targetSeconds: null,
    experience: "UNKNOWN",
    priority: "BALANCED",
    horizonWeeks: 4,
    taperDays: 7,
    proposeExtraMinutes: null,
    source: "USER_CONFIRMED_GOAL",
  };
  if (saved && Date.parse(saved.savedAt) > Date.parse(now))
    throw Error("周期目标录入时间晚于本次读取截止，不能用于历史判断");
  // revision=0 is an explicitly unconfirmed rolling proposal; it never authorizes calendar writes.
  const importedDates = (activePlanDoc(currentStore())?.plan.days ?? [])
    .filter((d) => !/休息/.test(d.title))
    .map((d) => d.date);
  const recovery = {
    ...c.analysis.assessment,
    safetyState: c.hold ? ("HOLD_ACTIVE" as const) : c.analysis.assessment.safetyState,
  };
  return {
    request,
    snapshot: { ...c.analysis.snapshot, safetyConstraints: c.analysis.snapshot.safetyConstraints },
    recovery,
    entries: c.entries,
    training: c.trainingProfile,
    goal,
    profileVersion: readEffectiveProfile().version,
    calendarVersion: analysisDigest([
      readScheduleDocument(),
      currentStore()?.getItem(planDocumentKey()) ?? null,
    ]),
    importedDates,
  };
}
function receipts(id: string) {
  const s = readScheduleDocument();
  if (!s.ok) throw Error(s.reason);
  return ((s.value as typeof s.value & { r4Receipts?: R5ScheduleAudit[] }).r4Receipts ?? []).filter(
    (r) => r.athleteId === currentAthleteId() && r.proposalId === id,
  );
}
function reconcile(d: CycleDocument): CycleDocument {
  const rs = receipts(d.id);
  return {
    ...d,
    status: rs.some((r) => r.kind === "R5_UNDO")
      ? "UNDONE"
      : rs.some((r) => r.kind === "R5_CHANGE")
        ? "ACCEPTED"
        : d.status,
  };
}
export function readCycleDocuments() {
  if (!r5ScopeReady()) return [];
  const map = new Map<string, CycleDocument>();
  for (const r of readJournal<CycleDocument>(prefix("draft")))
    if (
      r.data.athleteId === currentAthleteId() &&
      (!map.has(r.data.id) || map.get(r.data.id)!.history.length < r.data.history.length)
    )
      map.set(r.data.id, r.data);
  return [...map.values()]
    .sort(
      (a, b) =>
        (b.sequence ?? 0) - (a.sequence ?? 0) ||
        b.draft.generatedAt.localeCompare(a.draft.generatedAt),
    )
    .map(reconcile);
}
function save(d: CycleDocument) {
  return appendJournal(prefix("draft"), `${d.id}:${d.history.length}`, d);
}
export function assessCycleFeedback(d: CycleDocument, input = readCycleContext()): CycleFeedback {
  const sessions =
      d.draft.weeks[0]?.sessions.flatMap((s) => (s.candidate ? [s.candidate] : [])) ?? [],
    now = input.snapshot.context.asOf,
    today = localDay(new Date(now)),
    byId = new Map(input.entries.map((e) => [e.id, e]));
  const sourceRefs = d.draft.weeks.flatMap((w) => w.sessions.flatMap((s) => s.sourceRefs)),
    refs = new Map(input.snapshot.facts.map((f) => [f.id, f]));
  const oldFacts = new Map(d.draft.portrait.snapshot.facts.map((f) => [f.id, f]));
  const invalid =
    sourceRefs.some(
      (r) =>
        !refs.has(r.id) || analysisDigest(refs.get(r.id)) !== analysisDigest(oldFacts.get(r.id)),
    ) ||
    d.draft.sourceEntries.some(
      (e) => !byId.has(e.id) || analysisDigest(byId.get(e.id)) !== e.version,
    );
  const completed = sessions.filter((s) => {
    const e = byId.get(s.id);
    return (
      e?.status === "done" &&
      e.actual &&
      Date.parse(e.actual.at) <= Date.parse(now) &&
      e.actual.outcome !== "missed" &&
      e.actual.executionState !== "PARTIAL" &&
      e.actual.executionState !== "INTERRUPTED" &&
      e.actual.minutes !== null &&
      e.actual.minutes >= s.minutes &&
      e.actual.intensity === s.intensity &&
      !e.actual.reasons.length &&
      analysisDigest(e.runComponents) === analysisDigest(s.runComponents) &&
      analysisDigest(e.exercises) === analysisDigest(s.exercises)
    );
  }).length;
  const missed = sessions.filter(
    (s) => byId.get(s.id)?.actual?.outcome === "missed" || byId.get(s.id)?.status === "skipped",
  ).length;
  const rows = sessions.flatMap((s) => {
    const e = byId.get(s.id);
    return e?.actual ? [e.actual] : [];
  });
  const shortfall = sessions.some((s) => {
    const e = byId.get(s.id),
      a = e?.actual;
    return (
      !!a &&
      Date.parse(a.at) <= Date.parse(now) &&
      ((a.minutes !== null && a.minutes < s.minutes) ||
        a.executionState === "PARTIAL" ||
        a.executionState === "INTERRUPTED" ||
        a.reasons.length > 0 ||
        (a.intensity !== null && a.intensity !== s.intensity))
    );
  });
  const adverse =
    shortfall ||
    input.recovery.safetyState !== "NO_KNOWN_HOLD" ||
    rows.some(
      (a) => a.reasons.includes("pain") || a.reasons.includes("tired") || (a.rpe ?? 0) >= 9,
    );
  const unrecorded = sessions.filter((s) => s.date < today && !byId.get(s.id)?.actual).length;
  const state: CycleFeedback["state"] = invalid
    ? "WITHDRAWN"
    : adverse || missed > 0
      ? "WEAKENED"
      : sessions.length && completed === sessions.length
        ? "SUPPORTED"
        : "PENDING";
  const message =
    state === "WITHDRAWN"
      ? "原依据已更正或撤回，旧结论撤回，需重新规划"
      : state === "WEAKENED"
        ? "执行或安全反证削弱原安排，优先核对并提出调整"
        : state === "SUPPORTED"
          ? "已有记录支持本周可执行性；尚不能证明长期效果或提高剂量"
          : `完成${completed}，漏练/跳过${missed}，已过期未记${unrecorded}；缺失不当作失败`;
  return {
    state,
    completed,
    missed,
    unrecorded,
    message,
    basis: analysisDigest([
      state,
      completed,
      missed,
      unrecorded,
      rows,
      input.snapshot.facts,
      input.recovery.safetyState,
    ]),
  };
}
export function refreshCycleFeedback(now = new Date().toISOString()) {
  const input = readCycleContext(now),
    docs = readCycleDocuments();
  let updated = false;
  for (const d of docs.filter((d) => d.status === "ACCEPTED")) {
    const f = assessCycleFeedback(d, input);
    if (d.feedback?.basis !== f.basis) {
      if (
        !save({
          ...d,
          feedback: f,
          history: [...d.history, { at: now, action: `FEEDBACK_${f.state}` }],
        })
      )
        throw Error("反馈历史保存失败，原课表保留");
      updated = true;
    }
  }
  if (updated && typeof window !== "undefined") window.dispatchEvent(new Event(CYCLE_CHANGED));
  return readCycleDocuments();
}
export async function prepareCycle(now = new Date().toISOString(), request?: CycleRequest) {
  requireR5Scope();
  const owner = currentAthleteId();
  return (
    await withScheduleLock(() => {
      if (currentAthleteId() !== owner) throw Error("身份已变化");
      refreshCycleFeedback(now);
      const input = readCycleContext(now,request),
        draft = buildCycleDraft(input),
        prior = readCycleDocuments(),
        same = prior.find(
          (d) => d.status === "PENDING" && d.draft.basisVersion === draft.basisVersion,
        );
      if (same) return same;
      for (const d of prior.filter((d) => d.status === "PENDING"))
        if (
          !save({
            ...d,
            status: "STALE",
            history: [...d.history, { at: now, action: "EVIDENCE_REVISED" }],
          })
        )
          throw Error("旧草案修订保存失败");
      const d: CycleDocument = {
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...prior.map((d) => d.sequence ?? 0)) + 1,
        athleteId: owner,
        draft,
        status: "PENDING",
        history: [{ at: now, action: "PROPOSED" }],
      };
      if (!save(d)) throw Error("周期草案保存失败；未修改日历");
      changed();
      return d;
    })
  ).value;
}
export function cycleRevisionState(d: CycleDocument, now = new Date().toISOString()) {
  try {
    return (d.acceptedBasis ?? d.draft.basisVersion) === cycleBasis(readCycleContext(now,d.draft.request))
      ? "CURRENT"
      : "NEEDS_REVIEW";
  } catch {
    return "UNAVAILABLE";
  }
}
export async function decideCycle(
  id: string,
  action: "ACCEPT" | "REJECT" | "UNDO",
  now = new Date().toISOString(),
) {
  const fail = (message: string) => ({ ok: false as const, message });
  requireR5Scope();
  const owner = currentAthleteId();
  if (typeof window !== "undefined" && !navigator.locks?.request)
    return fail("此浏览器无法协调跨页面确认，保留草案");
  return (
    await withScheduleLock(() => {
      try {
        requireR5Scope();
        if (currentAthleteId() !== owner) return fail("身份已变化");
        const d = readCycleDocuments().find((d) => d.id === id);
        if (!d) return fail("没有当前用户的草案");
        if (action === "REJECT") {
          if (d.status !== "PENDING") return fail("草案已处理");
          if (
            !save({
              ...d,
              status: "REJECTED",
              history: [...d.history, { at: now, action: "REJECTED" }],
            })
          )
            return fail("拒绝记录保存失败");
          changed();
          return { ok: true as const, message: "已拒绝，正式课表未改变" };
        }
        const candidates = d.draft.weeks[0].sessions.flatMap((s) =>
            s.candidate ? [s.candidate] : [],
          ),
          current = loadSchedule();
        if (action === "UNDO") {
          if (d.status !== "ACCEPTED" || !candidates.length) return fail("没有可撤销的已接受草案");
          if (
            candidates.some((e) => {
              const row = current.entries.find((x) => x.id === e.id);
              return (
                !row ||
                row.actual ||
                r4CourseStarted(row) ||
                analysisDigest(row) !== analysisDigest(e)
              );
            })
          )
            return fail("课程后来改变或已经开始，不能覆盖新记录");
          const removed = new Set(candidates.map((e) => e.id)),
            pairs = candidates.map((after) => ({ before: null, after }));
          const audit: R5ScheduleAudit = {
            id: crypto.randomUUID(),
            athleteId: owner,
            kind: "R5_UNDO",
            at: now,
            before: candidates[0],
            after: candidates[0],
            proposalId: id,
            pairs,
            reason: "用户撤销周期最近一周",
          };
          if (
            !saveSchedule(
              { ...current, entries: current.entries.filter((e) => !removed.has(e.id)) },
              "plan-execution",
              audit,
            )
          )
            return fail("撤销未完成，请按日历回执核对");
          save({ ...d, status: "UNDONE", history: [...d.history, { at: now, action: "UNDONE" }] });
          changed();
          return { ok: true as const, message: "本周候选已撤销，原课表和实际历史保留" };
        }
        if (d.status !== "PENDING") return fail("草案已处理，不重复写入");
        const input = readCycleContext(now,d.draft.request);
        if (!input.goal.revision) return fail("先确认周期目标与训练背景；条件草案已保留");
        if (
          Date.parse(now) < Date.parse(d.draft.generatedAt) ||
          Date.parse(now) - Date.parse(d.draft.generatedAt) > 7 * 86400000 ||
          cycleBasis(input) !== d.draft.basisVersion
        )
          return fail("依据或时间已变化，请重新生成草案");
        if (!d.draft.weeks[0].canConfirm || !candidates.length)
          return fail("关键剂量或安全条件尚未核对，保留条件草案");
        if (
          candidates.some(
            (e) =>
              e.date < localDay(new Date(now)) ||
              input.importedDates.includes(e.date) ||
              current.entries.some(
                (x) => x.date === e.date && !["rejected", "skipped"].includes(x.status),
              ),
          )
        )
          return fail("日期已过去或原课表已有安排，不叠加覆盖");
        if (
          !commitR5Schedule(
            candidates.map((after) => ({ before: null, after })),
            id,
            "用户确认周期计划最近一周",
            false,
            now,
          )
        )
          return fail("日历写入失败或已执行，请核对回执");
        save({
          ...d,
          status: "ACCEPTED",
          acceptedBasis: cycleBasis(readCycleContext(now,d.draft.request)),
          history: [...d.history, { at: now, action: "ACCEPTED_FIRST_WEEK" }],
        });
        changed();
        return {
          ok: true as const,
          message: "最近一周已按确认写入；后续周需依据新反馈重新生成并确认",
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : "周期操作失败，未静默覆盖");
      }
    })
  ).value;
}
/** Read-only text for existing local/online coach. Never executes a model's proposed JSON. */
export function cycleCoachSummary(now = new Date().toISOString()) {
  try {
    const d = readCycleDocuments()[0],
      g = readCycleGoal();
    if (!d && !g) return "";
    const state = d ? cycleRevisionState(d, now) : "UNAVAILABLE";
    const summary = [
      "【个体周期（计划，不是实际）】",
      g
        ? `用户确认目标：${g.eventMeters ?? "项目未知"}米，比赛${g.raceDate ?? "未知"}，目标${g.targetSeconds ?? "未知"}秒；经验${g.experience}`
        : "目标未确认",
      d
        ? `草案${d.status}；依据${state}；${d.draft.weeks
            .map((w) => `${w.start}:${w.phase}`)
            .slice(0, 6)
            .join("；")}`
        : "尚无周期草案",
      d?.feedback?.message ?? "执行结果尚待复核",
      "后续周有条件；只在用户确认且宿主复核后写入。",
    ]
      .join("\n")
      .slice(0, 700);
    return (
      summary +
      (d && state === "CURRENT" && !["STALE", "REJECTED", "UNDONE"].includes(d.status)
        ? "\n" + cyclePrompt(d.draft)
        : "")
    );
  } catch {
    return "周期资料读取不完整，原计划保持；不要假设目标或执行结果。";
  }
}
