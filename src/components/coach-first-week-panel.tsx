import { stampCN } from "@/lib/ui/activity-format";
import { onAppEvent } from "@/lib/core/events";
import { ownedByCurrent } from "@/lib/core/ownership";
import { TrackRunner } from "./track-session";
import { firstWeekOccurrences, startFirstWeekSessionSafely } from "@/lib/core/coach-first-week";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  appendIntakeAnswer,
  buildFirstWeek,
  editFirstWeek,
  firstWeekGoalFromText,
  INTAKE_FIELDS,
  INTAKE_PREFIX,
  INTAKE_QUESTIONS,
  intakeState,
  loadIntake,
  recordFirstWeekChoice,
  savedFirstWeekDraft,
  type FirstWeekDraft,
  type IntakeField,
  type IntakeInputs,
  type IntakeRecord,
} from "@/lib/core/coach-first-week";
import { readJournal } from "@/lib/core/storage-journal";
import { calendarDay } from "@/lib/core/coach-calendar";

const empty = (field: IntakeField, today: string): Record<string, unknown> =>
  ({
    goal: { event: "400米", targetSeconds: null },
    ability: {
      age: null,
      experienceMonths: null,
      current400Seconds: null,
      measuredOn: null,
      timing: "unknown",
      continuousEasyMinutes: null,
      note: "",
    },
    recent: {
      actual: null,
      sessionsPerWeek: null,
      easyMinutes: null,
      distanceMeters: null,
      repsPerRound: null,
      rounds: null,
      fastestSeconds: null,
      slowestSeconds: null,
      restSeconds: null,
      roundRestSeconds: null,
      measuredOn: null,
      rpe: null,
      recovery48: null,
      note: "",
    },
    deadline: { targetDate: null, noDeadline: false },
    availability: { weekdays: [], minutes: 30, startDate: today },
    limits: {
      pain: "UNKNOWN",
      medicalRestriction: "UNKNOWN",
      sleepHours: null,
      recoveryNow: null,
      note: "",
    },
  })[field];
export function CoachFirstWeekPanel({
  requestedGoal = null,
}: {
  requestedGoal?: ReturnType<typeof firstWeekGoalFromText>;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null),
    [records, setRecords] = useState<IntakeRecord[]>([]);
  const [step, setStep] = useState<IntakeField>("goal"),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [notice, setNotice] = useState("");
  const [draftOverride, setDraftOverride] = useState<FirstWeekDraft | null>(null),
    [editValues, setEditValues] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [history, setHistory] = useState<ReturnType<typeof firstWeekOccurrences>>([]);
  const lastRequested = useRef(""),
    today = calendarDay(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
  const result = useMemo(() => buildFirstWeek(records, today), [records, today]);
  const draft = showForm ? null : (draftOverride ?? result.draft);
  const chooseStep = (f: IntakeField, rs = records) => {
    setStep(f);
    setForm({ ...empty(f, today), ...(intakeState(rs).inputs[f] ?? {}) });
    setDraftOverride(null);
    setShowForm(true);
  };
  const begin = (goal: IntakeInputs["goal"] | null) => {
    const id = crypto.randomUUID();
    setSessionId(id);
    setNotice("");
    setDraftOverride(null);
    if (goal) {
      const saved = appendIntakeAnswer(id, "goal", goal);
      if (!saved.ok) {
        setNotice(saved.error ?? "目标保存失败");
        return;
      }
      const rs = loadIntake(id);
      setRecords(rs);
      chooseStep("ability", rs);
    } else {
      setRecords([]);
      chooseStep("goal", []);
    }
  };
  useEffect(() => {
    const latest = readJournal<IntakeRecord>(INTAKE_PREFIX)
      .map((x) => x.data)
      .filter((x) => ownedByCurrent(x) && x.kind === "ANSWER" && x.field === "goal")
      .at(-1);
    if (latest) {
      setSessionId(latest.sessionId);
      const rs = loadIntake(latest.sessionId);
      setRecords(rs);
      setHistory(firstWeekOccurrences(rs));
      const next = buildFirstWeek(rs, today);
      chooseStep(next.nextField ?? "goal", rs);
      if (next.draft) {
        setDraftOverride(savedFirstWeekDraft(rs));
        setShowForm(false);
      }
    } else setForm(empty("goal", today));
  }, []);
  useEffect(() => {
    if (requestedGoal && JSON.stringify(requestedGoal) !== lastRequested.current) {
      lastRequested.current = JSON.stringify(requestedGoal);
      begin(requestedGoal);
    }
  }, [requestedGoal]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (sessionId && event.key?.startsWith(INTAKE_PREFIX)) {
        const rs = loadIntake(sessionId);
        setRecords(rs);
        setDraftOverride(buildFirstWeek(rs, today).draft ? savedFirstWeekDraft(rs) : null);
      }
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [sessionId]);
  useEffect(
    () =>
      onAppEvent(() => {
        if (sessionId) {
          const rs = loadIntake(sessionId);
          setRecords(rs);
          setHistory(firstWeekOccurrences(rs));
        }
      }),
    [sessionId],
  );
  const numeric = (name: string, label: string, min = 0, max = 240) => (
    <label className="flex flex-col gap-1 text-sm" key={name}>
      {label}
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={form[name] === null || form[name] === undefined ? "" : String(form[name])}
        onChange={(e) =>
          setForm({ ...form, [name]: e.target.value === "" ? null : Number(e.target.value) })
        }
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
      />
    </label>
  );
  const dateInput = (name: string, label: string) => (
    <label className="flex flex-col gap-1 text-sm" key={name}>
      {label}
      <input
        aria-label={label}
        type="date"
        value={String(form[name] ?? "")}
        onChange={(e) => setForm({ ...form, [name]: e.target.value || null })}
        className="min-h-11 min-w-0 w-full rounded-xl border border-line bg-surface px-2"
      />
    </label>
  );
  const select = (name: string, label: string, options: [string, string][]) => (
    <label className="flex flex-col gap-1 text-sm" key={name}>
      {label}
      <select
        aria-label={label}
        value={String(form[name] ?? "UNKNOWN")}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-2"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
  const answer = () => {
    const id = sessionId ?? crypto.randomUUID();
    if (!sessionId) setSessionId(id);
    const superseded = new Set(
      records.flatMap((x) => [...(x.supersedes ? [x.supersedes] : []), ...(x.supersedesIds ?? [])]),
    );
    const prior = records
      .filter((x) => x.kind === "ANSWER" && x.field === step && !superseded.has(x.id))
      .map((x) => x.id);
    const saved = appendIntakeAnswer(id, step, form as IntakeInputs[IntakeField], prior);
    if (!saved.ok) {
      setNotice(saved.error ?? "保存失败，未进入下一步");
      return;
    }
    const rs = loadIntake(id),
      next = buildFirstWeek(rs, today);
    setRecords(rs);
    setNotice(
      next.status === "READY_CANDIDATE"
        ? "首周候选已生成，尚未替换正式课表"
        : "已保存本步骤的自报信息",
    );
    chooseStep(next.nextField ?? step, rs);
    if (next.draft) {
      setDraftOverride(savedFirstWeekDraft(rs));
      setShowForm(false);
    }
  };
  const choice = (c: "ACCEPT" | "REJECT") => {
    if (
      !sessionId ||
      !draft ||
      buildFirstWeek(loadIntake(sessionId), today).status !== "READY_CANDIDATE"
    ) {
      setNotice("当前条件已变化，请重新核对");
      return;
    }
    setNotice(
      recordFirstWeekChoice(sessionId, draft, c)
        ? c === "ACCEPT"
          ? "已记录接受首周候选；没有替换正式课表或写入完成事实"
          : "已记录拒绝首周候选；可修改信息再生成"
        : "保存失败，未记录选择",
    );
  };
  const modify = (id: string) => {
    if (!draft || !sessionId) return;
    try {
      const s = draft.sessions.find((x) => x.id === id)!;
      const number = Number(editValues[id]);
      const next = editFirstWeek(
        draft,
        id,
        s.kind === "FOUNDATION" ? { mainMinutes: number } : { repsPerRound: number },
      );
      if (!recordFirstWeekChoice(sessionId, next, "MODIFY")) throw Error("修改保存失败");
      setDraftOverride(next);
      setNotice("已保存修改后的候选，原候选保留；未自动执行");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "修改失败");
    }
  };
  return (
    <section
      aria-label="首次使用与首周候选"
      className="rounded-2xl border border-line bg-surface p-3 text-sm"
    >
      {runningId && (
        <TrackRunner
          occurrenceId={runningId}
          onClose={() => {
            setRunningId(null);
            if (sessionId) {
              const rs = loadIntake(sessionId);
              setRecords(rs);
              setHistory(firstWeekOccurrences(rs));
              const next = buildFirstWeek(rs, today);
              if (next.nextField) {
                chooseStep(next.nextField, rs);
                setNotice(next.issues.join("；"));
              }
            }
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold">从目标建立首周计划</h3>
        <button
          type="button"
          className="min-h-11 rounded-xl border border-line px-3"
          onClick={() => begin(null)}
        >
          新建目标
        </button>
      </div>
      <p className="mt-1 text-muted">
        目标、当前能力和实际训练分开。空白表示未知；每步确认后再继续。
      </p>
      {history.length > 0 && (
        <div aria-label="已保存候选训练" className="mt-3 flex flex-col gap-2">
          <p className="font-medium">已保存训练（刷新后从这里恢复）</p>
          {history.map((o) => (
            <button
              type="button"
              key={o.trainingOccurrenceId}
              className="min-h-12 rounded-xl border border-line px-3 text-left"
              onClick={() => setRunningId(o.trainingOccurrenceId)}
            >
              查看/继续 · {stampCN(o.startedAt, "ymd")} · {o.lifecycle} · {o.trainingOccurrenceId}
            </button>
          ))}
        </div>
      )}
      <nav aria-label="首次使用步骤" className="mt-2 flex flex-wrap gap-1">
        {INTAKE_FIELDS.map((f, k) => (
          <button
            type="button"
            key={f}
            aria-current={step === f ? "step" : undefined}
            className="min-h-10 rounded-lg border border-line px-2"
            onClick={() => chooseStep(f)}
          >
            {k + 1}.{" "}
            {
              {
                goal: "目标",
                ability: "当前能力",
                recent: "近期训练",
                deadline: "期限",
                availability: "可用时间",
                limits: "限制与恢复",
              }[f]
            }
          </button>
        ))}
      </nav>
      {notice && (
        <p role="status" className="mt-2 rounded-xl bg-surface-2 p-2">
          {notice}
        </p>
      )}
      {result.issues.length > 0 && (
        <ul className="mt-2 text-muted">
          {result.issues.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {!draft && (
        <form
          aria-label="首次使用信息"
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            answer();
          }}
        >
          <p className="mb-3 font-medium">
            {result.status === "BLOCKED" ? result.question : INTAKE_QUESTIONS[step]}
          </p>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {step === "goal" && numeric("targetSeconds", "400米目标秒数（未知可空）", 10)}
            {step === "ability" && (
              <>
                {numeric("age", "年龄", 1, 110)}
                {numeric("experienceMonths", "训练经验（月）", 0, 720)}
                {numeric("current400Seconds", "当前实际400米秒数（不是目标）", 10)}
                {dateInput("measuredOn", "实际成绩日期")}
                {select("timing", "计时方式", [
                  ["unknown", "未知"],
                  ["electronic", "电子计时"],
                  ["hand", "手计"],
                ])}
                {numeric("continuousEasyMinutes", "目前能轻松连续走跑（分钟）", 1, 180)}
              </>
            )}
            {step === "recent" && (
              <>
                <label className="flex flex-col gap-1">
                  近期训练性质
                  <select
                    aria-label="近期训练性质"
                    value={
                      form.actual === true
                        ? "actual"
                        : form.actual === false
                          ? "planned"
                          : "unknown"
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        actual:
                          e.target.value === "actual"
                            ? true
                            : e.target.value === "planned"
                              ? false
                              : null,
                      })
                    }
                    className="min-h-11 rounded-xl border border-line bg-surface px-2"
                  >
                    <option value="unknown">未知</option>
                    <option value="actual">本人实际完成（无规律训练可填0次）</option>
                    <option value="planned">只是计划，尚未完成</option>
                  </select>
                </label>
                {numeric("sessionsPerWeek", "实际每周训练次数", 0, 7)}
                {numeric("easyMinutes", "近期每次轻松走跑分钟（未知可空）", 1, 180)}
                {dateInput("measuredOn", "近期实际主课日期")}
                {numeric("distanceMeters", "重复跑单组米数（无此课可空）", 50, 400)}
                {numeric("repsPerRound", "每轮组数", 1, 20)}
                {numeric("rounds", "轮数", 1, 4)}
                {numeric("fastestSeconds", "实际最快一组秒数", 5)}
                {numeric("slowestSeconds", "实际最慢一组秒数", 5)}
                {numeric("restSeconds", "实际组间休息秒数", 15, 1800)}
                {numeric("roundRestSeconds", "实际轮间休息秒数（多轮时填写）", 15, 1800)}
                {numeric("rpe", "上节主课RPE（1–10）", 1, 10)}
                {numeric("recovery48", "上节48小时恢复（1–10）", 1, 10)}
              </>
            )}
            {step === "deadline" && (
              <>
                {dateInput("targetDate", "目标或比赛日期")}
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="无固定期限"
                    checked={form.noDeadline === true}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        noDeadline: e.target.checked,
                        targetDate: e.target.checked ? null : form.targetDate,
                      })
                    }
                  />
                  无固定期限
                </label>
              </>
            )}
            {step === "availability" && (
              <>
                {dateInput("startDate", "首周开始日期")}
                {numeric("minutes", "每次可用分钟", 15, 120)}
                <fieldset className="col-span-full">
                  <legend>可练星期</legend>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 0].map((d, k) => (
                      <label
                        key={d}
                        className="flex min-h-11 items-center gap-1 rounded-lg border border-line px-2"
                      >
                        <input
                          aria-label={"周" + ["一", "二", "三", "四", "五", "六", "日"][k]}
                          type="checkbox"
                          checked={((form.weekdays as number[]) ?? []).includes(d)}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              weekdays: e.target.checked
                                ? [...((form.weekdays as number[]) ?? []), d]
                                : (form.weekdays as number[]).filter((x) => x !== d),
                            })
                          }
                        />
                        周{["一", "二", "三", "四", "五", "六", "日"][k]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {step === "limits" && (
              <>
                {select("pain", "当前疼痛", [
                  ["UNKNOWN", "未知"],
                  ["NONE_REPORTED", "本人报告当前无疼痛"],
                  ["PRESENT", "有疼痛/不适"],
                ])}
                {select("medicalRestriction", "运动限制", [
                  ["UNKNOWN", "未知"],
                  ["NONE_REPORTED", "本人报告无已知运动限制"],
                  ["PRESENT", "有运动限制/待评估症状"],
                ])}
                {numeric("sleepHours", "最近睡眠小时", 0, 24)}
                {numeric("recoveryNow", "当前主观恢复（1–10）", 1, 10)}
              </>
            )}
            {["ability", "recent", "limits"].includes(step) && (
              <label className="col-span-full flex flex-col gap-1">
                补充说明
                <textarea
                  aria-label="补充说明"
                  value={String(form.note ?? "")}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="min-h-20 rounded-xl border border-line bg-surface p-2"
                />
              </label>
            )}
          </div>
          <button
            type="submit"
            className="mt-3 min-h-12 rounded-full bg-accent px-4 font-bold text-accent-fg"
          >
            {intakeState(records).conflicts.includes(step)
              ? "确认更正本字段所有冲突记录"
              : "确认本步并继续"}
          </button>
        </form>
      )}
      {draft && (
        <div aria-label="首周候选计划" className="mt-3">
          <p className="font-bold">
            400米首周候选 · 低置信 · 当前{draft.currentAbilitySeconds ?? "未知"}秒 / 目标
            {draft.goalSeconds ?? "未定"}秒
          </p>
          <p className="mt-1 text-muted">首周不是正式课表或完成记录，目标可行性仍为UNKNOWN。</p>
          <div className="mt-2 flex flex-col gap-2">
            {draft.sessions.map((s) => (
              <article key={s.id} className="rounded-xl border border-line p-2">
                <p className="font-bold">
                  {s.date} · {s.purpose}
                </p>
                {s.kind === "REST" ? (
                  <p>休息/观察，不安排额外主课</p>
                ) : (
                  <>
                    <p>
                      热身{s.warmupMinutes}分钟；
                      {s.kind === "FOUNDATION"
                        ? `轻松走跑${s.mainMinutes}分钟`
                        : `${s.distanceMeters}米 × 每轮${s.repsPerRound}组 × ${s.rounds}轮，${s.targetSeconds?.join("–")}秒，组间${s.restSeconds}秒、轮间${s.roundRestSeconds ?? "不适用"}秒`}
                      ；放松{s.cooldownMinutes}分钟；预计{s.estimatedMinutes}分钟。
                    </p>
                    <p>{s.intensity}</p>
                    <label className="mt-2 flex flex-wrap items-center gap-2">
                      修改候选{s.kind === "FOUNDATION" ? "主课分钟" : "每轮组数"}
                      <input
                        aria-label={`修改${s.id}`}
                        type="number"
                        min="1"
                        max={s.kind === "FOUNDATION" ? s.mainMinutes : (s.repsPerRound ?? 1)}
                        value={editValues[s.id] ?? ""}
                        onChange={(e) => setEditValues({ ...editValues, [s.id]: e.target.value })}
                        className="min-h-11 w-20 rounded-xl border border-line bg-surface px-2"
                      />
                      <button
                        type="button"
                        className="min-h-11 rounded-xl border border-line px-2"
                        onClick={() => modify(s.id)}
                      >
                        保存修改
                      </button>
                    </label>
                  </>
                )}
                <p className="mt-1 text-muted">依据：{s.reason}</p>
                {s.kind !== "REST" && (
                  <button
                    type="button"
                    disabled={starting}
                    className="mt-2 min-h-12 rounded-full border border-line px-4"
                    onClick={async () => {
                      if (!sessionId || starting) return;
                      setStarting(true);
                      try {
                        const r = await startFirstWeekSessionSafely(
                          sessionId,
                          draft.id,
                          s.id,
                          today,
                        );
                        if (r.ok) setRunningId(r.trainingOccurrenceId);
                        else setNotice(r.reason);
                      } catch {
                        setNotice("开练保存未确认，请刷新核对。");
                      } finally {
                        setStarting(false);
                      }
                    }}
                  >
                    开始/查看这天训练（先接受候选）
                  </button>
                )}
                {s.kind !== "REST" && (
                  <details className="mt-1">
                    <summary className="min-h-10">退出条件</summary>
                    {s.stop}
                  </details>
                )}
              </article>
            ))}
          </div>
          <details className="mt-2">
            <summary className="min-h-11 font-medium">知识、竞争假设与反馈边界</summary>
            {draft.knowledge.map((k) => (
              <p key={k.id}>
                {k.id} [{k.verification}] {k.claim}；{k.limitations}{" "}
                {k.url && (
                  <a href={k.url} target="_blank" rel="noreferrer">
                    原文
                  </a>
                )}
              </p>
            ))}
            {draft.sources.map((x) => (
              <p key={x.url}>
                <a href={x.url} target="_blank" rel="noreferrer">
                  {x.title}
                </a>
                ；{x.limitation}
              </p>
            ))}
            {draft.hypotheses.map((h) => (
              <p key={h.explanation}>
                {h.explanation}；反证：{h.counterEvidence}；验证：{h.check}
              </p>
            ))}
            {draft.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-12 rounded-full bg-accent px-4 text-accent-fg"
              onClick={() => choice("ACCEPT")}
            >
              接受首周候选
            </button>
            <button
              type="button"
              className="min-h-12 rounded-full border border-line px-4"
              onClick={() => choice("REJECT")}
            >
              拒绝首周候选
            </button>
            <button
              type="button"
              className="min-h-12 rounded-full border border-line px-4"
              onClick={() => {
                setDraftOverride(null);
                setRecords(records.filter((x) => x.kind === "ANSWER"));
                chooseStep("ability");
              }}
            >
              更正能力或训练信息
            </button>
          </div>
          <p className="mt-2 text-muted">
            训练后通过原跑步记录绑定实际分段，再到方坤反馈面板记录RPE、预测及24h/48h观察；不能把本候选当完成事实。
          </p>
        </div>
      )}
    </section>
  );
}
