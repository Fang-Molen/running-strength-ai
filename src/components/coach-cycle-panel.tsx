import { adaptiveSummary } from '@/lib/health/adaptive-review';
import { historySummary } from '@/lib/coach/assessment/history';
import { cycleCourseLines } from "@/lib/coach/cycle/display";
import { useEffect, useState } from "react";
import {
  CYCLE_CHANGED,
  readCycleGoal,
  saveCycleGoal,
  readCycleDocuments,
  prepareCycle,
  decideCycle,
  cycleRevisionState,
  refreshCycleFeedback,
  readCycleContext,
  type CycleDocument,
} from "@/lib/coach/cycle/host";
import { buildAthletePortrait } from "@/lib/coach/cycle/portrait";
import { phaseLabels, priorityLabels, type CycleGoal, type CyclePhaseReview } from "@/lib/coach/cycle/types";
import { CYCLE_SOURCES } from "@/lib/coach/cycle/prompt";
import { subscribeHealthUpdates } from "@/lib/health/health-subscription";
const intensityLabel = {EASY:'轻松',MODERATE:'中等',HARD:'高强度'};
const variableLabel = {NONE:'保持剂量',DURATION:'时长',REPEAT_COUNT:'重复次数',SETS:'组数',EXECUTION:'执行安排'};
const initial = {
  eventMeters: "",
  raceDate: "",
  targetSeconds: "",
  experience: "UNKNOWN",
  priority: "BALANCED",
  horizonWeeks: "4",
  taperDays: "7",
  proposeExtraMinutes: "",
};
export function CyclePhaseEvidence({ review }: { review: CyclePhaseReview | undefined }) {
  if (!review?.entryChecks || !review.exitChecks) return <p className="mt-2 text-xs">旧草案没有逐项条件依据，请重新生成后复核。</p>;
  const labels = { SATISFIED: "已满足记录条件", UNKNOWN: "待核对", CONTRADICTED: "现有证据不支持" };
  return <details className="mt-2 text-xs">
    <summary className="min-h-10 cursor-pointer">阶段条件依据（不等于生理放行）</summary>
    <p>{review.selectionReason}</p>
    {[...review.entryChecks, ...review.exitChecks].map(check => <div key={check.id} className="mt-2">
      <p>{check.label}：{labels[check.state]}。{check.reason}</p>
      <p className="break-words text-muted">依据：{[
        ...check.evidenceRefs.map(ref => `${ref.id}@${ref.revision}`),
        ...check.sourceEntryIds.map(id => `课程 ${id}`),
        ...check.sourceVersions.map(source => `${source.source} ${source.version}`),
      ].join("；") || "尚无对应事实，保持未知"}</p>
    </div>)}
  </details>;
}
export function CoachCyclePanel() {
  const [form, setForm] = useState(initial),
    [goal, setGoal] = useState<CycleGoal | null>(null),
    [docs, setDocs] = useState<CycleDocument[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [portrait, setPortrait] = useState<ReturnType<typeof buildAthletePortrait> | null>(null),
    [revision, setRevision] = useState(0);
  const refresh = () => {
    try {
      setDocs(readCycleDocuments());
      setPortrait(buildAthletePortrait(readCycleContext()));
      setRevision((n) => n + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "当前资料暂不可读取");
    }
  };
  const loadGoal = () => {
    try {
      const g = readCycleGoal();
      setGoal(g);
      setForm(
        g
          ? {
              eventMeters: String(g.eventMeters ?? ""),
              raceDate: g.raceDate ?? "",
              targetSeconds: String(g.targetSeconds ?? ""),
              experience: g.experience,
              priority: g.priority,
              horizonWeeks: String(g.horizonWeeks),
              taperDays: String(g.taperDays),
              proposeExtraMinutes: String(g.proposeExtraMinutes ?? ""),
            }
          : initial,
      );
      refresh();
    } catch (e) {
      setNotice(String(e));
    }
  };
  useEffect(() => {
    loadGoal();
    const off = subscribeHealthUpdates(
      () => {
        try {
          refreshCycleFeedback();
        } catch {
          /* read failure is surfaced by refresh */
        }
        refresh();
      },
      { batch: true },
    );
    window.addEventListener(CYCLE_CHANGED, refresh);
    return () => {
      off();
      window.removeEventListener(CYCLE_CHANGED, refresh);
    };
  }, []);
  const action = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    try {
      setNotice(await work());
      refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败，原计划保留");
    } finally {
      setBusy(false);
    }
  };
  const patch = (v: Partial<typeof form>) => setForm((f) => ({ ...f, ...v }));
  const saveGoal = () =>
    action(async () => {
      const g = await saveCycleGoal(
        {
          eventMeters: form.eventMeters.trim() ? Number(form.eventMeters) : null,
          raceDate: form.raceDate || null,
          targetSeconds: form.targetSeconds.trim() ? Number(form.targetSeconds) : null,
          experience: form.experience as CycleGoal["experience"],
          priority: form.priority as CycleGoal["priority"],
          horizonWeeks: Number(form.horizonWeeks),
          taperDays: Number(form.taperDays),
          proposeExtraMinutes: form.proposeExtraMinutes.trim()
            ? Number(form.proposeExtraMinutes)
            : null,
        },
        goal?.revision ?? 0,
      );
      setGoal(g);
      return "周期目标已确认保存；正式课表未改变，请重新生成草案";
    });
  const d = docs[0],
    status = {
      PENDING: "待确认",
      ACCEPTED: "最近一周已采用",
      REJECTED: "已拒绝",
      STALE: "依据已更新",
      UNDONE: "已撤销",
    };
  return (
    <section
      className="home-card my-3 min-w-0 p-4"
      data-testid="r6-cycle"
      data-revision={revision}
      aria-label="个体周期计划"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">个体周期计划</h3>
        <button
          disabled={busy}
          className="min-h-11 rounded-xl border border-line px-3 text-sm"
          onClick={() =>
            void action(async () => {
              await prepareCycle();
              return "周期草案已生成；只有最近一周可在核对后确认，后续周按新反馈重算";
            })
          }
        >
          生成周期草案
        </button>
      </div>
      <button className="mt-2 min-h-11 rounded-xl border border-line px-3 text-sm" disabled={busy} onClick={()=>void action(async()=>{await prepareCycle(new Date().toISOString(),{historyDays:14,horizonWeeks:4});return '已按最近两周实际记录生成四周跑步与力量草案；目标与正式课表未改变';})}>按近两周生成四周草案</button>
      <p className="mt-2 text-xs text-muted">
        按已确认目标、实际训练与可用时间规划。远期周是有条件安排；不会自行修改正式课表。
      </p>
      <details className="mt-3 rounded-xl border border-line p-3" open={!goal}>
        <summary className="min-h-10 cursor-pointer font-bold text-sm">
          比赛目标与训练背景{goal ? ` · 已确认第${goal.revision}版` : " · 尚未确认"}
        </summary>
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
          <label>
            项目距离（米）
            <input
              aria-label="周期项目距离"
              inputMode="decimal"
              value={form.eventMeters}
              onChange={(e) => patch({ eventMeters: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
              placeholder="未知可留空，如800"
            />
          </label>
          <label>
            比赛日期
            <input
              aria-label="周期比赛日期"
              type="date"
              value={form.raceDate}
              onChange={(e) => patch({ raceDate: e.target.value })}
              className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2"
            />
          </label>
          <label>
            目标用时（秒，非实测）
            <input
              aria-label="周期目标用时"
              inputMode="decimal"
              value={form.targetSeconds}
              onChange={(e) => patch({ targetSeconds: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
              placeholder="可留空"
            />
          </label>
          <label>
            训练经历
            <select
              aria-label="周期训练经历"
              value={form.experience}
              onChange={(e) => patch({ experience: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            >
              <option value="UNKNOWN">尚未确认</option>
              <option value="NOVICE">新手或近期重新开始</option>
              <option value="TRAINED">已有持续训练经历</option>
            </select>
          </label>
          <label>
            本周期优先重点
            <select
              aria-label="周期训练重点"
              value={form.priority}
              onChange={(e) => patch({ priority: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            >
              {Object.entries(priorityLabels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            规划窗口（周）
            <input
              aria-label="周期规划周数"
              type="number"
              min="1"
              max="52"
              value={form.horizonWeeks}
              onChange={(e) => patch({ horizonWeeks: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            />
          </label>
          <label>
            赛前减量窗口（天，可调整）
            <input
              aria-label="周期减量天数"
              type="number"
              min="1"
              max="21"
              value={form.taperDays}
              onChange={(e) => patch({ taperDays: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            />
          </label>
          <label>
            允许提出单次增时（分钟，留空不加量）
            <input
              aria-label="周期候选增加分钟"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={form.proposeExtraMinutes}
              onChange={(e) => patch({ proposeExtraMinutes: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface px-2"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted">
          训练星期、单次时间、器材与身体限制沿用已有个人资料；冲突先核对。允许提出不等于执行许可，仍需实际依据和逐次确认。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => void saveGoal()}
            className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg"
          >
            确认保存周期目标
          </button>
          <button
            disabled={busy}
            onClick={loadGoal}
            className="min-h-11 rounded-xl border border-line px-3"
          >
            重新读取目标
          </button>
        </div>
      </details>
      {portrait && (
        <details className="mt-3 rounded-xl border border-line p-3">
          <summary className="min-h-10 cursor-pointer text-sm font-bold">
            当前能力画像与来源
          </summary>
          <p className="text-sm">
            可核实成绩 {portrait.performances.length} 条；实际跑力明细 {portrait.training.length}{" "}
            条。不合成全能等级。
          </p>
          <p data-testid="r7-history" className="mt-2 whitespace-pre-line text-xs leading-relaxed">{historySummary(portrait.history)}</p>
          <details className="mt-2 text-xs"><summary className="min-h-10 cursor-pointer">本次画像引用的实际记录</summary>{portrait.history.sessions.slice(0,6).map(s=><p key={s.ref.id} className="mt-2 break-words">{s.date} · {s.provider} · 设备 {s.deviceId??'未知'} · 协议 {s.protocol??'未知'} · {s.ref.id}@{s.ref.revision}</p>)}</details>
          <p data-testid="r8-adaptive" className="mt-2 whitespace-pre-line text-xs leading-relaxed">{adaptiveSummary(portrait.adaptive)}</p>
          {portrait.performances.map((p) => (
            <p key={p.ref.id} className="mt-2 break-words text-xs">
              {p.date} · {p.meters}米 / {p.seconds}秒 · {p.source}
            </p>
          ))}
          {portrait.weeks.map((w) => (
            <p key={w.start} className="mt-1 text-xs">
              {w.start}：已记{w.observedSessions}次，时长
              {w.minutes === null ? "未知" : `${w.minutes}分钟`}（仅记录覆盖）
            </p>
          ))}
          <p className="mt-2 text-xs text-muted">{portrait.unknowns.slice(0, 3).join("；")}</p>
        </details>
      )}
      {d && (
        <div className="mt-3" data-testid="r6-cycle-draft">
          <p className="font-bold">
            {status[d.status]} · {d.draft.goal.eventMeters ?? "项目未确认"}米 ·{" "}
            {priorityLabels[d.draft.goal.priority]}
          </p>
          {cycleRevisionState(d) !== "CURRENT" && (
            <p className="mt-2 text-sm text-amber-600">
              依据已变化，请重新生成；旧结论与原始记录保留。
            </p>
          )}
          {d.feedback && (
            <p className="mt-2 text-sm" data-testid="r6-cycle-feedback">
              {d.feedback.message}
            </p>
          )}
          {d.draft.weeks.map((w, i) => (
            <details
              key={w.start}
              open={i === 0}
              className="mt-2 rounded-xl border border-line p-3"
            >
              <summary className="min-h-10 cursor-pointer text-sm font-bold">
                第{i + 1}周 · {w.start} · {phaseLabels[w.phase]}
                {i ? "（到期重算）" : ""}
              </summary>
              <p className="mt-1 text-sm">{w.purpose}</p>
              <CyclePhaseEvidence review={w.phaseReview} />
              {w.strengthFocus&&<p className="mt-2 text-xs">力量周期：{w.strengthFocus}</p>}
              {w.existingSessions?.map((e, j) => (
                <p key={j} className="mt-2 text-xs">
                  原课保留：{e.date} · {e.title} · {e.minutes}分钟 · {e.intensity}
                </p>
              ))}
              {w.sessions.length ? (
                w.sessions.map((s, j) => (
                  <div key={j} className="mt-3 border-t border-line pt-2 text-sm">
                    <b>
                      {s.date} · {s.candidate?.title ?? s.purpose}
                    </b>
                    <p>
                      {s.candidate
                        ? `${s.candidate.minutes}分钟 · ${intensityLabel[s.candidate.intensity]}`
                        : "条件安排，尚无可确认的执行剂量"}
                    </p>
                    {s.candidate && (
                      <>
                        <p className="mt-1 text-xs">
                          变更：原日历此日无课程 → 新增上述课程；调整变量：{variableLabel[s.changedVariable]}
                        </p>
                        {cycleCourseLines(s.candidate).map((line, k) => (
                          <p key={k} className="mt-1 text-xs">
                            {line}
                          </p>
                        ))}
                        <p className="mt-1 text-xs text-muted">
                          依据：
                          {s.sourceCourses
                            ?.map((e) => `${e.date} ${e.title} 实际${e.minutes ?? "未知"}分钟`)
                            .join("、") ?? "旧版本，需重新核对来源"}
                          ；本人实际记录，候选不是完成记录。
                        </p>
                      </>
                    )}
                    <p className="mt-1 text-xs text-muted">{s.reason}</p>
                    <p className="mt-1 text-xs">
                      {s.observation}；{s.withdrawWhen}
                    </p>
                    {s.missing.length > 0 && (
                      <p className="mt-1 text-xs text-amber-600">需核对：{s.missing.join("；")}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">
                      配套饮食：核对本课前后进食与补水；饮食记录不完整时不推断全天缺口。
                    </p>
                  </div>
                ))
              ) : (
                <p className="mt-2 text-sm">尚无可确认日期；已有课表保留，未知条件不自动填入。</p>
              )}
            </details>
          ))}
          <details className="mt-3 rounded-xl border border-line p-3">
            <summary className="min-h-10 cursor-pointer text-sm">解释、反证与参考</summary>
            {d.draft.hypotheses.map((h, i) => (
              <p className="mt-2 text-xs" key={i}>
                可能解释{i + 1}：{h.claim}；关联事实{h.support.length}条，待核对的反向线索{h.counter.length}条；不代表独立因果证据。
                {h.discriminator}
              </p>
            ))}
            {d.draft.warnings.map((w, i) => (
              <p className="mt-2 text-xs text-muted" key={i}>
                {w}
              </p>
            ))}
            {CYCLE_SOURCES.filter((s) => d.draft.sourceIds.includes(s.id)).map((s) => (
              <p className="mt-2 text-xs" key={s.id}>
                <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>{" "}
                · {s.scope}。{s.limit}
              </p>
            ))}
            <p className="mt-2 text-xs">
              待补充：{d.draft.questions.join("；") || "后续实际响应"}。以上不等于个人效果已经验证。
            </p>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.status === "PENDING" && (
              <>
                <button
                  disabled={
                    busy ||
                    !d.draft.weeks[0].canConfirm ||
                    !goal ||
                    cycleRevisionState(d) !== "CURRENT"
                  }
                  onClick={() =>
                    void action(async () => (await decideCycle(d.id, "ACCEPT")).message)
                  }
                  className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50"
                >
                  确认最近一周
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => (await decideCycle(d.id, "REJECT")).message)
                  }
                  className="min-h-11 rounded-xl border border-line px-3"
                >
                  拒绝周期草案
                </button>
              </>
            )}
            {d.status === "ACCEPTED" && (
              <button
                disabled={busy}
                onClick={() => void action(async () => (await decideCycle(d.id, "UNDO")).message)}
                className="min-h-11 rounded-xl border border-line px-3"
              >
                撤销最近一周
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  refreshCycleFeedback();
                  return "已按当前实际记录复核执行反馈";
                })
              }
              className="min-h-11 rounded-xl border border-line px-3"
            >
              复核执行反馈
            </button>
          </div>
        </div>
      )}
      {docs.length > 1 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="min-h-10 cursor-pointer">
            周期版本与修订历史（{docs.length - 1}）
          </summary>
          {docs.slice(1).map((x) => (
            <p key={x.id} className="mt-1">
              {x.draft.generatedAt} · {status[x.status]} ·{" "}
              {x.history.map((h) => h.action).join(" → ")}
              {x.status === "ACCEPTED" && (
                <button
                  disabled={busy}
                  className="ml-2 min-h-11 rounded-xl border border-line px-3"
                  onClick={() => void action(async () => (await decideCycle(x.id, "UNDO")).message)}
                >
                  撤销此版本最近一周
                </button>
              )}
            </p>
          ))}
        </details>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
    </section>
  );
}
