import { r5ScopeReady } from "./scope";
import { readR4CoachAnswer } from "../r4/answer";
import { readR4Sources } from "../r4/reference";
import { currentAthleteId } from "../../core/events";
import { currentStore } from "../../core/storage";
import { appendJournal, readJournal } from "../../core/storage-journal";
import { loadEntries, nutrientOf } from "../../nutrition/log";
import { localDay } from "../../health/observation";
import { readSuggestionDocument, refreshSuggestions } from "../loop/suggestion-host";
import { createPersonalStore } from "../personal/store";
import { readEffectiveProfile } from "../loop/effective-host";
import {
  loadSchedule,
  readScheduleDocument,
  saveSchedule,
  type R5ScheduleAudit,
} from "../../ui/day-schedule";
import { withScheduleLock } from "../../ui/schedule-writer";
import { weekOf, addDays } from "../../ui/day-schedule-rules";
import { activePlanDoc, planDocumentKey } from "../../plan/active-plan";
import { r4CourseStarted } from "../r4/courses";
import { analysisDigest } from "../../health/analysis-evidence";
import { readR5Context, commitR5Schedule, r5Changed } from "./host";
import { buildWeeklyReview, buildNextWeekDraft } from "./weekly";
export type WeeklyDocument = {
  id: string;
  athleteId: string;
  generatedAt: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "STALE" | "UNDONE";
  sourceVersion: string;
  review: ReturnType<typeof buildWeeklyReview>;
  draft: ReturnType<typeof buildNextWeekDraft>;
  history: { at: string; action: string }[];
};
const prefix = () => `fk-r5-week:${encodeURIComponent(currentAthleteId())}:`;
export function readWeeklyDocuments() {
  if (!r5ScopeReady()) return [];
  const map = new Map<string, WeeklyDocument>();
  for (const r of readJournal<WeeklyDocument>(prefix()))
    if (r.data.athleteId === currentAthleteId()) map.set(r.data.id, r.data);
  return [...map.values()]
    .reverse() // Newest journal insertion wins when generated timestamps tie.
    .map(reconcileWeeklyReceipt)
    .slice()
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
function reconcileWeeklyReceipt(d: WeeklyDocument): WeeklyDocument {
  const read = readScheduleDocument();
  if (!read.ok) return d;
  const rows = (
    (read.value as typeof read.value & { r4Receipts?: R5ScheduleAudit[] }).r4Receipts ?? []
  ).filter((r) => r.athleteId === currentAthleteId() && r.proposalId === d.id);
  if (rows.some((r) => r.kind === "R5_UNDO")) return { ...d, status: "UNDONE" };
  if (rows.some((r) => r.kind === "R5_CHANGE")) return { ...d, status: "ACCEPTED" };
  return d;
}
function save(d: WeeklyDocument) {
  const ok = appendJournal(prefix(), `${d.id}:${d.history.length}`, d);
  if (ok && typeof window !== "undefined") window.dispatchEvent(new Event("fk-r5-changed"));
  return ok;
}
const safeDays = (v: number[] | undefined) => v ?? null;
function weekSource(now: string, start: string) {
  const c = readR5Context(now),
    foods = loadEntries()
      .filter(
        (f) =>
          (f.athleteId ?? "local") === c.owner &&
          !!f.recordedAt &&
          Date.parse(f.recordedAt) <= Date.parse(now),
      )
      .map((f) => ({
        id: f.id,
        athleteId: f.athleteId,
        date: f.date,
        kcal: nutrientOf(f, "kcal"),
        protein: nutrientOf(f, "protein"),
        carb: nutrientOf(f, "carb"),
        fat: nutrientOf(f, "fat"),
      }));
  const reference = readR4CoachAnswer("跑步力量疲劳恢复复盘", now, c.day);
  const knowledgeSources = readR4Sources([
    ...new Set(reference?.knowledge.flatMap((k) => k.sourceIds) ?? []),
  ]);
  const suggestions = readSuggestionDocument().suggestions,
    review = buildWeeklyReview({
      athleteId: c.owner,
      asOf: now,
      weekStart: start,
      entries: c.entries,
      facts: c.analysis.snapshot.facts,
      foods,
      symptoms: c.symptoms,
      suggestions,
      checks: c.checks,
      knowledgeSources,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  let personal: ReturnType<ReturnType<typeof createPersonalStore>["read"]>["profile"] = null;
  try {
    const box = currentStore();
    if (box) personal = createPersonalStore(box, currentAthleteId).read().profile;
  } catch {
    /* unknown is retained */
  }
  const effective = readEffectiveProfile(),
    events = c.profile.marks
      .filter((m) => m.deadline)
      .map((m) => ({ date: m.deadline, label: `${m.meters}米比赛/测试` }));
  const planRaw = currentStore()?.getItem(planDocumentKey()) ?? null;
  return {
    c,
    review,
    conditions: {
      safety: c.hold ? "HOLD_ACTIVE" : c.analysis.assessment.safetyState,
      events,
      days: safeDays(c.trainingProfile.days?.value),
      minutes: c.trainingProfile.minutes?.value ?? null,
      goal: effective.goal?.value ?? null,
      phase: null,
    },
    sourceVersion: analysisDigest([c.basisVersion, review.basisVersion, planRaw, personal]),
    planRaw,
  };
}
/** Sunday reviews the current week; Monday-Saturday catch up the last completed week. */
export function weeklyReviewStart(now = new Date().toISOString()) {
  const day = localDay(new Date(now)),
    week = weekOf(day);
  return new Date(day + "T12:00:00Z").getUTCDay() === 0 ? week[0] : addDays(week[0], -7);
}
export async function generateWeeklyDraft(now = new Date().toISOString(), force = false) {
  const owner = currentAthleteId();
  await refreshSuggestions(new Date(now));
  return (
    await withScheduleLock(() => {
      if (currentAthleteId() !== owner) throw Error("身份已变化");
      const start = weeklyReviewStart(now),
        s = weekSource(now, start),
        prior = readWeeklyDocuments(),
        same = prior.find(
          (x) =>
            x.review.weekStart === start &&
            x.sourceVersion === s.sourceVersion &&
            x.status !== "STALE",
        );
      if (same && !force) return same;
      // Corrections append a revised review and keep the previous conclusion visible.
      for (const d of prior.filter(
        (d) =>
          d.review.weekStart === start &&
          d.sourceVersion !== s.sourceVersion &&
          d.status === "PENDING",
      ))
        save({
          ...d,
          status: "STALE",
          history: [...d.history, { at: now, action: "EVIDENCE_REVISED" }],
        });
      const nextWeek = weekOf(addDays(start, 7)),
        next = s.c.entries.filter((e) => nextWeek.includes(e.date));
      const draft = buildNextWeekDraft(s.review, s.c.entries, next, s.conditions);
      const imported = activePlanDoc(currentStore())?.plan.days ?? [];
      draft.sessions = draft.sessions.filter((pair) => {
        if (pair.before) return true;
        const conflict =
          s.c.entries.some(
            (e) => e.date === pair.after.date && !["rejected", "skipped"].includes(e.status),
          ) || imported.some((d) => d.date === pair.after.date && !/休息/.test(d.title));
        if (conflict)
          draft.warnings.push(
            `${pair.after.date} 已有原课表安排，未叠加复制课程；请从日历选择原课修改。`,
          );
        return !conflict && pair.after.date >= s.c.day;
      });
      draft.diff = draft.sessions.map(
        (p) =>
          `${p.after.date} ${p.before ? p.before.title : "复制原已保存课程"} → ${p.after.title}（${p.after.minutes}分钟）`,
      );
      const d: WeeklyDocument = {
        id: crypto.randomUUID(),
        athleteId: owner,
        generatedAt: now,
        status: "PENDING",
        sourceVersion: s.sourceVersion,
        review: s.review,
        draft,
        history: [{ at: now, action: force ? "GENERATED_ON_DEMAND" : "GENERATED_ON_OPEN" }],
      };
      if (!save(d)) throw Error("周复盘保存失败；计划未改变");
      return d;
    })
  ).value;
}
export async function decideWeeklyDraft(
  id: string,
  action: "ACCEPT" | "REJECT" | "UNDO",
  now = new Date().toISOString(),
) {
  const owner = currentAthleteId(),
    fail = (message: string) => ({ ok: false as const, message });
  if (typeof window !== "undefined" && !navigator.locks?.request)
    return fail("当前浏览器无法协调跨页面确认，草案未执行");
  return (
    await withScheduleLock(() => {
      try {
        if (currentAthleteId() !== owner) return fail("身份已变化，未写入其他档案");
        const d = readWeeklyDocuments().find((x) => x.id === id);
        if (!d) return fail("没有当前用户的这份草案");
        if (action === "REJECT") {
          if (d.status !== "PENDING") return fail("草案已处理");
          return save({
            ...d,
            status: "REJECTED",
            history: [...d.history, { at: now, action: "REJECTED" }],
          })
            ? { ok: true as const, message: "已拒绝草案，正式计划未改变。" }
            : fail("拒绝记录保存失败");
        }
        const schedule = readScheduleDocument();
        if (!schedule.ok) return fail(schedule.reason);
        const receipts =
          (schedule.value as typeof schedule.value & { r4Receipts?: R5ScheduleAudit[] })
            .r4Receipts ?? [];
        if (action === "UNDO") {
          if (
            d.status !== "ACCEPTED" ||
            receipts.some((r) => r.proposalId === id && r.kind === "R5_UNDO")
          )
            return fail("草案没有生效或已经撤销");
          const current = loadSchedule();
          if (
            d.draft.sessions.some((p) => {
              const e = current.entries.find((e) => e.id === p.after.id);
              return (
                !e ||
                analysisDigest(e) !== analysisDigest(p.after) ||
                !!e.actual ||
                r4CourseStarted(e)
              );
            })
          )
            return fail("课程后来改变或开始，不能覆盖新记录");
          const pairs = d.draft.sessions,
            restore = new Map(pairs.filter((p) => p.before).map((p) => [p.after.id, p.before!])),
            remove = new Set(pairs.filter((p) => !p.before).map((p) => p.after.id));
          const audit: R5ScheduleAudit = {
            id: crypto.randomUUID(),
            athleteId: owner,
            kind: "R5_UNDO",
            proposalId: id,
            at: now,
            before: pairs[0].after,
            after: pairs[0].before ?? pairs[0].after,
            pairs,
            reason: "用户撤销下周草案",
          };
          if (
            !saveSchedule(
              {
                ...current,
                entries: current.entries
                  .filter((e) => !remove.has(e.id))
                  .map((e) => restore.get(e.id) ?? e),
              },
              "plan-execution",
              audit,
            )
          )
            return fail("撤销写入失败，请刷新核对");
          save({ ...d, status: "UNDONE", history: [...d.history, { at: now, action: "UNDONE" }] });
          r5Changed();
          return { ok: true as const, message: "下周草案已撤销，原安排与全部历史保留。" };
        }
        if (d.status !== "PENDING") return fail("草案已处理，未重复写入");
        if (!d.draft.executable)
          return fail("本周实际剂量上限尚未完整核对，草案只能预览；请补充关键实际记录后重新生成");
        if (!d.draft.sessions.length) return fail("草案没有可执行课程，请先保存具体课程");
        if (
          Date.parse(now) < Date.parse(d.generatedAt) ||
          Date.parse(now) - Date.parse(d.generatedAt) > 7 * 86400000 ||
          d.sourceVersion !== weekSource(now, d.review.weekStart).sourceVersion
        ) {
          save({
            ...d,
            status: "STALE",
            history: [...d.history, { at: now, action: "EVIDENCE_REVISED" }],
          });
          return fail("复盘后资料、记录或课表已变化；请重新生成并核对差异。");
        }
        if (d.draft.sessions.some((p) => p.after.date < localDay(new Date(now))))
          return fail("部分课程日期已过去，请重新生成");
        if (!commitR5Schedule(d.draft.sessions, id, "用户确认下周草案", false, now))
          return fail("草案写入失败或已执行，请刷新核对；不会重复叠加");
        save({
          ...d,
          status: "ACCEPTED",
          sourceVersion: weekSource(now, d.review.weekStart).sourceVersion,
          history: [...d.history, { at: now, action: "ACCEPTED" }],
        });
        r5Changed();
        return {
          ok: true as const,
          message:
            readWeeklyDocuments().find((x) => x.id === id)?.status === "ACCEPTED"
              ? "下周草案已按你的确认生效；日历回执支持撤销。"
              : "日历已写入，但卡片状态未保存，请刷新按回执核对。",
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : "周计划读取或写入失败");
      }
    })
  ).value;
}
export function weeklyRevisionState(d: WeeklyDocument, now = new Date().toISOString()) {
  try {
    return d.sourceVersion === weekSource(now, d.review.weekStart).sourceVersion
      ? "CURRENT"
      : "NEEDS_REVIEW";
  } catch {
    return "UNAVAILABLE";
  }
}
