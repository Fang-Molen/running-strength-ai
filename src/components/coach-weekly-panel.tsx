import { useEffect, useState } from "react";
import {
  readWeeklyDocuments,
  generateWeeklyDraft,
  decideWeeklyDraft,
  weeklyRevisionState,
  weeklyReviewStart,
  type WeeklyDocument,
} from "@/lib/coach/r5/weekly-host";
import { subscribeHealthUpdates } from "@/lib/health/health-subscription";
import { R5_CHANGED } from "@/lib/coach/r5/host";
export async function ensureWeeklyOnOpen() {
  const start = weeklyReviewStart(),
    found = readWeeklyDocuments().find((x) => x.review.weekStart === start);
  return found && weeklyRevisionState(found) === "CURRENT" ? found : generateWeeklyDraft();
}
/** App-open catch-up and in-app clock only. No background execution is promised. */
export function CoachWeeklyBootstrap({ ready }: { ready: boolean }) {
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const run = () => {
      if (live && document.visibilityState !== "hidden") void ensureWeeklyOnOpen().catch(() => {});
    };
    run();
    const clock = setInterval(run, 3600000);
    window.addEventListener("focus", run);
    window.addEventListener("fk-athlete-scope-changed", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false;
      clearInterval(clock);
      window.removeEventListener("focus", run);
      window.removeEventListener("fk-athlete-scope-changed", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [ready]);
  return null;
}
const status = {
  PENDING: "草案待确认",
  ACCEPTED: "草案已生效",
  REJECTED: "草案已拒绝",
  STALE: "草案依据已变化",
  UNDONE: "草案已撤销",
};
export function CoachWeeklyPanel() {
  const [docs, setDocs] = useState<WeeklyDocument[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setDocs(readWeeklyDocuments());
      setRevision((r) => r + 1);
    };
    refresh();
    const off = subscribeHealthUpdates(refresh, { batch: true });
    window.addEventListener(R5_CHANGED, refresh);
    void ensureWeeklyOnOpen()
      .then(refresh)
      .catch((e) => setNotice(e instanceof Error ? e.message : "复盘读取失败"));
    return () => {
      off();
      window.removeEventListener(R5_CHANGED, refresh);
    };
  }, []);
  const generate = async () => {
    setBusy(true);
    try {
      await generateWeeklyDraft(undefined, true);
      setDocs(readWeeklyDocuments());
      setNotice("复盘和草案已更新；正式计划尚未改变。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "生成失败");
    }
    setBusy(false);
  };
  const decide = async (id: string, a: "ACCEPT" | "REJECT" | "UNDO") => {
    setBusy(true);
    const r = await decideWeeklyDraft(id, a);
    setNotice(r.message);
    setDocs(readWeeklyDocuments());
    setBusy(false);
  };
  const d = docs[0],
    r = d?.review,
    revisionState = d ? weeklyRevisionState(d) : "UNAVAILABLE";
  return (
    <section
      className="home-card my-3 p-4"
      aria-label="每周复盘与下周草案"
      data-testid="r5-weekly"
      data-revision={revision}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">每周复盘与下周草案</h3>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-xl border border-line px-3 text-sm"
          onClick={() => void generate()}
        >
          重新生成周复盘
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        周日或下次打开时生成；也可按需生成。没有后台定时推送，草案需你确认。
      </p>
      {d && r ? (
        <>
          <p className="mt-3 font-bold">
            {r.weekStart} — {r.weekEnd} · {status[d.status]}
          </p>
          {revisionState === "NEEDS_REVIEW" ? (
            <p role="status" className="mt-2 text-sm text-amber-500">
              依据已有更正或新反馈：旧结论保留，需重新复盘；旧草案不能直接覆盖新记录。
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">计划 / 已完成</dt>
              <dd>
                {r.completion.planned} / {r.completion.completed} 节
              </dd>
            </div>
            <div>
              <dt className="text-muted">未完成 / 未记录</dt>
              <dd>
                {r.completion.missed + r.completion.skipped} / {r.completion.unrecorded} 节
              </dd>
            </div>
            <div>
              <dt className="text-muted">实际跑量已知小计</dt>
              <dd>
                {r.running.knownDistanceM === null
                  ? "未知"
                  : `${r.running.knownDistanceM / 1000} km`}
                {!r.running.distanceComplete ? " · 明细不完整" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted">力量已记完成</dt>
              <dd>
                {r.strength.sessions ? `${r.strength.completedSets} 组` : "实际组数未知"} ·{" "}
                {r.strength.knownReps ?? "未知"} 次
              </dd>
            </div>
            <div>
              <dt className="text-muted">饮食记录</dt>
              <dd>
                {r.nutrition.daysRecorded} 天 · {r.nutrition.recordedKcal ?? "未知"} kcal小计
              </dd>
            </div>
            <div>
              <dt className="text-muted">体重窗口变化</dt>
              <dd>
                {r.weight.change === null
                  ? "数据不足"
                  : `${r.weight.change > 0 ? "+" : ""}${r.weight.change.toFixed(1)} kg`}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">{r.nutrition.note}</p>
          <p className="mt-2 text-sm">{r.symptoms.message}</p>
          <details className="mt-3 rounded-xl border border-line p-3">
            <summary className="min-h-9 cursor-pointer text-sm font-bold">
              事实、两种解释与反证
            </summary>
            {r.hypotheses.map((h, i) => (
              <div key={i} className="mt-2 text-sm">
                <b>可能解释 {i + 1}</b>
                <p>{h.claim}</p>
                <p className="mt-1 text-xs text-muted">
                  支持依据 {h.support.length} 条；可用反证 {h.counter.length} 条。
                  {h.discriminator}
                </p>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted">重要缺项：{r.unknowns.slice(0, 5).join("；")}</p>
            {r.chain.scientificSources.map((source) => (
              <p key={source.id} className="mt-2 text-xs text-muted">
                <a className="underline" href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                ：{source.scope}。限制：{source.limitations}
              </p>
            ))}
            <p className="mt-2 text-xs text-muted">
              以上是记录汇总与待核对解释，不等于个人效果验证。
            </p>
          </details>
          <details className="mt-2 rounded-xl border border-line p-3">
            <summary className="min-h-9 cursor-pointer text-sm font-bold">
              恢复、分段、逐组与建议结果
            </summary>
            {r.subjectiveTrends.map((g, i) => (
              <p className="mt-2 text-xs" key={`response-${i}`}>
                {{
                  RECOVERY_FEELING: "主观恢复",
                  SUBJECTIVE_FATIGUE: "主观疲劳",
                  FUNCTION: "功能影响",
                  PAIN: "疼痛",
                  SORENESS: "酸痛",
                }[g.measure as "PAIN"] ?? g.measure}
                ：{g.points.length}条观测，首 {g.points[0]?.value} → 最近 {g.points.at(-1)?.value}（
                {g.scale}）。
              </p>
            ))}
            {r.deterministicCalculations
              .filter((c) => /^RUN_/.test(c.metric))
              .slice(0, 6)
              .map((c) => (
                <p key={c.id} className="mt-2 text-xs">
                  {c.text}
                </p>
              ))}
            {r.metricGroups.map((g) => (
              <p key={g.sourceKey} className="mt-2 text-xs">
                {g.metric} · {g.provider}/{g.deviceId ?? "设备未知"}/{g.protocolKey ?? "协议未知"}：
                {g.points.length}个独立日，均值 {g.mean === null ? "未知" : g.mean.toFixed(1)}{" "}
                {g.unit}，窗口变化 {g.change === null ? "未知" : g.change.toFixed(1)}；冲突{" "}
                {g.conflictedDays.length}天。
              </p>
            ))}
            {r.running.segments.map((s) => (
              <p key={s.ref.id} className="mt-2 text-xs">
                跑步 {s.ref.id}：
                {s.segments
                  .map(
                    (x) =>
                      `第${x.roundIndex ?? "?"}轮 ${x.distanceM ?? "?"}m/${x.durationSeconds ?? "?"}s`,
                  )
                  .join("；")}
              </p>
            ))}
            {r.strength.knownLoadDetails.map((s) => (
              <p key={s.ref.id} className="mt-2 text-xs">
                力量{" "}
                {s.sets
                  .map(
                    (x) =>
                      `${x.catalogId ?? "未匹配"} ${x.loadKg ?? "未知"}kg×${x.reps ?? "未知"}次(${x.loadBasis})`,
                  )
                  .join("；")}
              </p>
            ))}
            {r.exposures.map((e) => (
              <p key={e.region} className="mt-2 text-xs">
                {e.region}：{e.days.length}个日期，{e.modalities.join("＋")}
                参与；不等于损伤或组织恢复率。
              </p>
            ))}
            {r.suggestions.length ? (
              r.suggestions.map((s) => (
                <p key={s.id} className="mt-2 text-xs">
                  建议 {s.status} · 跟踪 {s.outcome?.state ?? "未评估"} ·{" "}
                  {s.history.map((h) => h.action).join(" → ")}
                </p>
              ))
            ) : (
              <p className="mt-2 text-xs text-muted">本周没有可核对的教练建议结果。</p>
            )}
          </details>
          <div className="mt-3 rounded-xl border border-line p-3" data-testid="r5-week-draft">
            <h4 className="font-bold">下周 {d.draft.weekStart} 起 · 草案</h4>
            <p className="mt-1 text-xs text-muted">
              目标：
              {{
                HYPERTROPHY: "增肌",
                FAT_LOSS: "减脂",
                WEIGHT_MAINTENANCE: "维持体重",
                RUN_PERFORMANCE: "跑步表现",
              }[d.draft.conditions.goal ?? ""] ??
                d.draft.conditions.goal ??
                "尚未确认"}
              ；阶段：
              {d.draft.conditions.phase ?? "未知"}；只复用原已保存课程上限。
            </p>
            {d.draft.diff.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {d.draft.diff.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm">没有可确认的具体课程。请先保存或选定课程后重新生成。</p>
            )}
            {d.draft.warnings.map((w, i) => (
              <p key={i} className="mt-2 text-xs text-muted">
                {w}
              </p>
            ))}
            {d.status === "PENDING" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !d.draft.sessions.length || !d.draft.executable}
                  className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50"
                  onClick={() => void decide(d.id, "ACCEPT")}
                >
                  确认采用下周草案
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-line px-3"
                  onClick={() => void decide(d.id, "REJECT")}
                >
                  拒绝草案
                </button>
              </div>
            ) : null}
            {d.status === "ACCEPTED" ? (
              <button
                type="button"
                disabled={busy}
                className="mt-3 min-h-11 rounded-xl border border-line px-3"
                onClick={() => void decide(d.id, "UNDO")}
              >
                撤销下周草案
              </button>
            ) : null}
          </div>
          {docs.length > 1 ? (
            <details className="mt-3 text-xs text-muted">
              <summary className="min-h-9 cursor-pointer">
                历史复盘与修订（{docs.length - 1}份）
              </summary>
              {docs.slice(1, 6).map((x) => (
                <p className="mt-1" key={x.id}>
                  {x.review.weekStart} · {status[x.status]} · {x.history.at(-1)?.action}
                </p>
              ))}
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">尚未生成周复盘，可按需生成。</p>
      )}
      {notice ? (
        <p className="mt-2 text-sm" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
