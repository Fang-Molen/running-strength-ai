import { EnergyGauge } from "@/components/energy-gauge";
import { useEffect, useState } from "react";
import { loadEvents, onAppEvent } from "@/lib/core/events";
import {
  projectRunningExecution,
  type RecoveryExecution,
  type RunningExecutionProjection,
  type RunningRepetitionSlot,
} from "@/lib/core/running-execution";
import { explainRunningFeedback } from "@/lib/core/running-transaction";
import { getRunningPlan } from "@/lib/core/running-plan";
import {
  TRACK_PRESETS,
  commitTrackContinuous,
  finishTrackSession,
  recordTrackRecoveryFeedback,
  withRunningWriteLock,
  commitTrackRecovery,
  commitTrackSlot,
  confirmTrackPlan,
  describeTrackPlan,
  emptyDraft,
  listTrackPlans,
  openTrackOccurrence,
  saveCustomTrackPlan,
  startTrackSessionSafely,
  trackHomeView,
  type CustomStep,
  type TrackDraft,
  type TrackPresetId,
} from "@/lib/ui/running-workouts";

const STATUS: Record<string, string> = {
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
  NOT_YET_RECORDED: "未完成",
  NOT_RECORDED: "未记录",
  DUPLICATE_UNRESOLVED: "记录冲突",
};

function secondsLabel(value: number | null): string {
  return value == null ? "未设置" : `${value} 秒`;
}

/** Read-only planning aid. Unknown targets/rests are never silently treated as zero. */
export function estimatePendingTrackTime(view: RunningExecutionProjection): {
  knownSeconds: number;
  unknownParts: number;
  remainingSegments: number;
} {
  const pending = view.repetitions.filter((item) => item.status === "NOT_YET_RECORDED");
  const knownTargets = pending.map((item) => item.plannedDurationSeconds);
  const continuousTargets = view.continuous
    .filter((x) => x.status === "NOT_YET_RECORDED")
    .map((x) => x.plannedDurationSeconds);
  const knownSeconds = [...knownTargets, ...continuousTargets].reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const unknownTargets = [...knownTargets, ...continuousTargets].filter(
    (value) => value == null,
  ).length;
  // Rest projections may include completed rest; count only unrecorded planned rests.
  const pendingRests = view.recoveries.filter((item) => item.status === "NOT_YET_RECORDED");
  const knownRestSeconds = pendingRests.reduce(
    (sum, item) => sum + (item.plannedRecoverySeconds ?? 0),
    0,
  );
  const unknownRests = pendingRests.filter((item) => item.plannedRecoverySeconds == null).length;
  return {
    knownSeconds: knownSeconds + knownRestSeconds,
    unknownParts: unknownTargets + unknownRests,
    remainingSegments: pending.length + continuousTargets.length,
  };
}

function timeEstimateLabel(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分钟` : `${minutes}分钟`;
}

function upcomingRecovery(
  view: RunningExecutionProjection,
  slot: RunningRepetitionSlot,
): RecoveryExecution | null {
  const between = view.recoveries.find(
    (item) =>
      item.kind === "AFTER_REPEAT" &&
      item.stepId === slot.stepId &&
      item.roundOrdinal === slot.roundOrdinal &&
      item.afterRepeatOrdinal === slot.repeatOrdinal,
  );
  if (between) return between;
  const nextStep = view.recoveries.find(
    (item) =>
      item.kind === "BEFORE_NEXT_STEP" &&
      item.fromStepId === slot.stepId &&
      item.roundOrdinal === slot.roundOrdinal,
  );
  if (nextStep) return nextStep;
  const index = view.repetitions.indexOf(slot);
  const lastInRound = !view.repetitions.some(
    (item, itemIndex) => itemIndex > index && item.roundOrdinal === slot.roundOrdinal,
  );
  if (!lastInRound) return null;
  return (
    view.recoveries.find(
      (item) => item.kind === "AFTER_ROUND" && item.afterRoundOrdinal === slot.roundOrdinal,
    ) ?? null
  );
}

function restLabel(item: RecoveryExecution): string {
  const name =
    item.kind === "AFTER_REPEAT"
      ? "组间休息"
      : item.kind === "AFTER_ROUND"
        ? "轮间休息"
        : "下一段前休息";
  return `${name} · 计划 ${secondsLabel(item.plannedRecoverySeconds)} · 实际 ${item.actualRecoverySeconds ?? "未记录"} 秒`;
}

export function TrackStructureList({ occurrenceId }: { occurrenceId: string }) {
  const view = projectRunningExecution(occurrenceId, loadEvents());
  if (view.availability !== "AVAILABLE" || view.repetitions.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="font-bold">田径分段</p>
      {view.repetitions.map((slot) => (
        <div
          key={`${slot.stepId}-${slot.roundOrdinal}-${slot.repeatOrdinal}`}
          className="rounded-card border border-line p-2"
        >
          <p>
            第 {slot.roundOrdinal} 轮 · 第 {slot.repeatOrdinal} 次 ·{" "}
            {STATUS[slot.status] ?? slot.status}
          </p>
          <p>
            计划 {slot.plannedDistanceMeters ?? "未设置"} 米 · 目标{" "}
            {secondsLabel(slot.plannedDurationSeconds)}
          </p>
          <p>
            实际 {slot.actualDistanceMeters ?? "未记录"} 米 ·{" "}
            {slot.actualDurationSeconds ?? "未记录"} 秒
          </p>
        </div>
      ))}
      {view.continuous.map((x) => (
        <p key={x.componentId}>
          {x.componentId} · {STATUS[x.status]} · 实际 {x.actualDurationSeconds ?? "未记录"} 秒 /{" "}
          {x.actualDistanceMeters ?? "未记录"} 米
        </p>
      ))}
      {view.recoveries.map((item) => (
        <p
          key={`${item.kind}-${item.stepId}-${item.roundOrdinal}-${item.afterRepeatOrdinal}-${item.afterRoundOrdinal}`}
          className="text-muted"
        >
          {item.kind === "AFTER_REPEAT"
            ? "组间休息"
            : item.kind === "AFTER_ROUND"
              ? "轮间休息"
              : "下一段前休息"}{" "}
          · 计划 {secondsLabel(item.plannedRecoverySeconds)} · 实际{" "}
          {item.actualRecoverySeconds ?? "未记录"} 秒
        </p>
      ))}
    </div>
  );
}

export function TrackRunner({
  occurrenceId,
  onClose,
  embedded = false,
}: {
  occurrenceId: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [tick, setTick] = useState(0);
  const [seconds, setSeconds] = useState("");
  const [distance, setDistance] = useState("");
  const [restSeconds, setRestSeconds] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [rpe, setRpe] = useState("");
  const [pain, setPain] = useState("");
  const [recovery, setRecovery] = useState("");
  const [horizon, setHorizon] = useState<"24H" | "48H">("24H");
  const view = projectRunningExecution(occurrenceId, loadEvents());
  const pendingRepetition =
    view.repetitions.find((item) => item.status === "NOT_YET_RECORDED") ?? null;
  const continuous =
    view.continuous.find(
      (x) => x.status === "NOT_YET_RECORDED" && (x.componentId === "warmup" || !pendingRepetition),
    ) ?? null;
  const current = continuous ? null : pendingRepetition;
  const next = current
    ? (view.repetitions.find(
        (item) =>
          item !== current &&
          item.status === "NOT_YET_RECORDED" &&
          view.repetitions.indexOf(item) > view.repetitions.indexOf(current),
      ) ?? null)
    : null;
  const rest = current ? upcomingRecovery(view, current) : null;
  const completedCount = view.repetitions.filter((item) => item.status === "COMPLETED").length;
  const skippedCount = view.repetitions.filter((item) => item.status === "SKIPPED").length;
  const pendingCount = view.repetitions.filter((item) => item.status === "NOT_YET_RECORDED").length;
  const unresolvedCount = view.repetitions.filter(
    (item) => item.status === "DUPLICATE_UNRESOLVED",
  ).length;
  const estimate = estimatePendingTrackTime(view);
  const currentIndex = current ? view.repetitions.indexOf(current) : -1;
  const previous = currentIndex > 0 ? view.repetitions[currentIndex - 1] : null;
  const changedStep =
    !!previous &&
    !!current &&
    (previous.stepId !== current.stepId ||
      previous.blockId !== current.blockId ||
      previous.componentId !== current.componentId);
  const changedRound = !!previous && !!current && previous.roundOrdinal !== current.roundOrdinal;
  useEffect(() => {
    setTick(0);
    setSeconds("");
    setDistance("");
  }, [occurrenceId]);
  useEffect(() => onAppEvent(() => setTick((x) => x + 1)), []);
  const score = (text: string): number | null => (text.trim() ? Number(text) : null);

  async function write(action: "complete" | "skip") {
    if (!current || saving) return;
    setSaving(true);
    const result = await withRunningWriteLock(() =>
      commitTrackSlot(
        current,
        action,
        action === "skip" ? "" : seconds,
        action === "skip" ? "" : distance,
      ),
    );
    setNotice(result.ok ? "本段已保存到本机；下一段会自动显示。" : result.reason);
    if (result.ok) {
      setSeconds("");
      setDistance("");
    }
    setSaving(false);
    setTick((value) => value + 1);
  }

  return (
    <div className={embedded ? 'relative min-w-0 bg-bg' : 'fixed inset-0 z-40 overflow-y-auto bg-bg'} data-refresh={tick}>
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-28">
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold">田径专项</p>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full border border-line px-3"
          >
            返回
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          逐段保存到本机。刷新后从第一段未完成的位置继续；返回页面不等于结束训练。
        </p>
        <div className="mt-3 rounded-card border border-line bg-surface p-3" aria-live="polite">
          <p className="font-bold">
            本次训练进度 ·{" "}
            {completedCount +
              skippedCount +
              view.continuous.filter((x) => x.status === "COMPLETED").length}
            /{view.repetitions.length + view.continuous.length} 段已处理
          </p>
          <p className="mt-1 text-sm">
            完成 {completedCount} · 跳过 {skippedCount} · 待做 {pendingCount}
            {unresolvedCount ? ` · 冲突 ${unresolvedCount}` : ""}
          </p>
          <p className="mt-1 text-sm font-medium">
            预计剩余：
            {estimate.unknownParts === 0
              ? timeEstimateLabel(estimate.knownSeconds)
              : `已知部分约 ${timeEstimateLabel(estimate.knownSeconds)}，另有 ${estimate.unknownParts} 项时间未设置`}
          </p>
          <p className="mt-1 text-xs text-muted">
            仅按跑步目标时间与计划休息估算，不含热身、转场、力量和实际超时；不是整节课预计结束时间。
          </p>
          <p className="mt-1 text-xs text-muted">
            跑步分段已保存 ≠ 整节训练已结束；力量部分和正式结束反馈仍需单独确认。
          </p>
        </div>
        {continuous ? (
          <div className="mt-4 rounded-card border border-line p-3">
            <h2 className="text-xl font-bold">
              {continuous.componentId === "warmup"
                ? "热身"
                : continuous.componentId === "cooldown"
                  ? "放松"
                  : "轻松走跑"}
            </h2>
            <p>计划 {secondsLabel(continuous.plannedDurationSeconds)}；可走跑，不要求全速。</p>
            <label className="mt-3 block">
              实际秒数
              <input
                aria-label="连续跑实际秒数"
                inputMode="decimal"
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                className="mt-1 h-14 w-full rounded-card border border-line px-3"
              />
            </label>
            <label className="mt-3 block">
              实际距离（米，可留空）
              <input
                inputMode="decimal"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                className="mt-1 h-14 w-full rounded-card border border-line px-3"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              className="mt-3 min-h-12 w-full rounded-card bg-accent"
              onClick={async () => {
                setSaving(true);
                try {
                  const r = await withRunningWriteLock(() =>
                    commitTrackContinuous(occurrenceId, continuous.componentId, seconds, distance),
                  );
                  setNotice(r.ok ? "本段实际已保存。" : r.reason);
                  if (r.ok) {
                    setSeconds("");
                    setDistance("");
                  }
                } finally {
                  setSaving(false);
                  setTick((x) => x + 1);
                }
              }}
            >
              记录这段实际
            </button>
          </div>
        ) : current ? (
          <>
            {changedStep || changedRound ? (
              <div className="mt-4 rounded-card border border-accent p-3" role="status">
                <p className="font-bold">
                  {changedStep ? "上一模块已处理，进入下一训练模块" : "上一轮已处理，进入下一轮"}
                </p>
                <p className="mt-1 text-sm">系统已按冻结计划找到下一段，原来的完成记录不会清空。</p>
              </div>
            ) : null}
            <p className="mt-4 text-sm text-accent">
              当前这一段 · 第 {currentIndex + 1}/{view.repetitions.length} 段
            </p>
            <h2 className="break-words text-2xl font-bold">
              第 {current.roundOrdinal} 轮 · 第 {current.repeatOrdinal} 次
            </h2>
            <p className="mt-2">计划距离 {current.plannedDistanceMeters ?? "未设置"} 米</p>
            <p>目标成绩 {secondsLabel(current.plannedDurationSeconds)}</p>
            {rest ? <p className="mt-1 text-sm text-muted">{restLabel(rest)}</p> : null}
            {next ? (
              <div className="mt-2 rounded-card border border-line p-3 text-sm">
                <p className="font-bold">
                  接下来：
                  {next.stepId !== current.stepId || next.blockId !== current.blockId
                    ? "下一训练模块"
                    : next.roundOrdinal !== current.roundOrdinal
                      ? "下一轮"
                      : "下一段"}
                </p>
                <p>
                  第 {next.roundOrdinal} 轮 · 第 {next.repeatOrdinal} 次 ·{" "}
                  {next.plannedDistanceMeters ?? "未设置"} 米 · 目标{" "}
                  {secondsLabel(next.plannedDurationSeconds)}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm">
                这已是跑步计划的最后一段。记录后请检查力量训练及训练结束反馈。
              </p>
            )}
            <label className="mt-4 block text-sm">
              实际秒数
              <input
                value={seconds}
                inputMode="decimal"
                onFocus={(event) => event.currentTarget.scrollIntoView({ block: "center" })}
                onChange={(event) => setSeconds(event.target.value)}
                placeholder="可留空，表示成绩未记录"
                className="mt-1 h-14 w-full rounded-card border border-line bg-surface px-3 text-lg outline-none"
              />
            </label>
            <label className="mt-3 block text-sm">
              实际距离（米）
              <input
                value={distance}
                inputMode="decimal"
                onChange={(event) => setDistance(event.target.value)}
                placeholder="可留空，不会自动填计划距离"
                className="mt-1 h-14 w-full rounded-card border border-line bg-surface px-3 text-lg outline-none"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => write("complete")}
              className="mt-4 min-h-12 w-full rounded-card bg-accent font-bold text-accent-fg"
            >
              记下这段
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => write("skip")}
              className="mt-2 min-h-12 w-full rounded-card border border-line font-bold"
            >
              跳过这段
            </button>
            {rest && rest.status === "NOT_YET_RECORDED" ? (
              <>
                <label className="mt-4 block text-sm">
                  实际休息秒
                  <input
                    value={restSeconds}
                    inputMode="decimal"
                    onChange={(event) => setRestSeconds(event.target.value)}
                    placeholder="留空就是未记录，不会写成 0"
                    className="mt-1 h-14 w-full rounded-card border border-line bg-surface px-3 text-lg outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (saving) return;
                    setSaving(true);
                    const result = await withRunningWriteLock(() =>
                      commitTrackRecovery(rest, restSeconds),
                    );
                    setNotice(result.ok ? "这次休息已记下。计划休息没有被改掉。" : result.reason);
                    if (result.ok) setRestSeconds("");
                    setSaving(false);
                    setTick((value) => value + 1);
                  }}
                  className="mt-2 min-h-12 w-full rounded-card border border-line font-bold"
                >
                  记下这次休息
                </button>
              </>
            ) : null}
          </>
        ) : (
          <div className="mt-4 rounded-card border border-line p-3" role="status">
            <p className="font-bold">跑步计划已无待记录段</p>
            <p className="mt-2 text-sm">
              完成与跳过记录仍保留在本机，但这不代表整次训练已正式结束。若今天还有力量、核心或其他模块，请继续相应训练；不要把跑步完成误当成全部完成。
            </p>
            {unresolvedCount ? (
              <p className="mt-2 text-sm">存在重复冲突，请先到日志核对。</p>
            ) : null}
          </div>
        )}
        <div className="mt-4 rounded-card border border-line p-3">
          {view.terminal ? (
            <>
              <p className="font-bold">本次训练已结束并保存；未做段保持未记录。</p>
              <p className="mt-2 text-sm">{explainRunningFeedback(occurrenceId)}</p>
              <label className="block mt-3">
                恢复观察时段
                <select
                  value={horizon}
                  onChange={(e) => setHorizon(e.target.value as "24H" | "48H")}
                  className="min-h-12 border border-line"
                >
                  <option value="24H">24h</option>
                  <option value="48H">48h</option>
                </select>
              </label>
              <label className="block mt-3">
                此时段恢复（1–10，按实际观察）
                <input
                  value={recovery}
                  inputMode="decimal"
                  onChange={(e) => setRecovery(e.target.value)}
                  className="h-12 w-full border border-line"
                />
              </label>
              <label className="block mt-3">
                当前疼痛（0–10；空白为未知）
                <input
                  value={pain}
                  inputMode="decimal"
                  onChange={(e) => setPain(e.target.value)}
                  className="h-12 w-full border border-line"
                />
              </label>
              <button
                type="button"
                disabled={saving}
                className="mt-3 min-h-12 border border-line rounded-full px-4"
                onClick={async () => {
                  setSaving(true);
                  try {
                    const r = await withRunningWriteLock(() =>
                      recordTrackRecoveryFeedback(
                        occurrenceId,
                        horizon,
                        score(recovery) ?? NaN,
                        score(pain),
                      ),
                    );
                    setNotice(
                      r.ok ? "恢复观察已绑定训练并保存；下次分析会核对这条来源。" : r.reason,
                    );
                  } finally {
                    setSaving(false);
                    setTick((x) => x + 1);
                  }
                }}
              >
                保存恢复观察
              </button>
            </>
          ) : (
            <>
              <p className="font-bold">正式结束这次跑步训练</p>
              <p className="text-sm">
                结束与反馈一并保存。缺失为未知；提前结束不会把剩余段写成完成。
              </p>
              <div className="mt-3"><EnergyGauge label="整课用力（气力槽，可不填）" mode="run" value={rpe === "" ? null : Number(rpe)} onChange={(v) => setRpe(v == null ? "" : String(v))} /></div>
              <label className="block mt-3">
                疼痛（0–10；空白为未知）
                <input
                  value={pain}
                  inputMode="decimal"
                  onChange={(e) => setPain(e.target.value)}
                  className="h-12 w-full border border-line"
                />
              </label>
              {(["COMPLETED", "INTERRUPTED"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={saving}
                  className="mt-3 mr-2 min-h-12 border border-line rounded-full px-4"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const r = await withRunningWriteLock(() =>
                        finishTrackSession(occurrenceId, kind, score(rpe), score(pain)),
                      );
                      setNotice(r.ok ? "本次结束和反馈已原子保存，可刷新恢复。" : r.reason);
                      if (r.ok) setPain("");
                    } finally {
                      setSaving(false);
                      setTick((x) => x + 1);
                    }
                  }}
                >
                  {kind === "COMPLETED" ? "确认完成并保存" : "确认提前结束并保存"}
                </button>
              ))}
            </>
          )}
        </div>
        {notice ? (
          <p role="status" className="mt-3 text-sm">
            {notice}
          </p>
        ) : null}
        <div className="mt-4 text-sm">
          <TrackStructureList occurrenceId={occurrenceId} />
        </div>
      </div>
    </div>
  );
}

function optionalNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function optionalRest(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function wholeNumber(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= 1 ? value : null;
}

type EditorStep = {
  distance: string;
  repeats: string;
  target: string;
  repRest: string;
  stepRest: string;
};

export function TrackSessionPanel({ onLog, selectedPlanId }: { onLog?: () => void; selectedPlanId?: string }) {
  const [mounted, setMounted] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<
    Record<
      TrackPresetId,
      { target: string[]; repRest: string; roundRest: string; stepRest: string }
    >
  >({
    "200x4x2": { target: [""], repRest: "", roundRest: "", stepRest: "" },
    "400-200": { target: ["", ""], repRest: "", roundRest: "", stepRest: "" },
  });
  const [rounds, setRounds] = useState("2");
  const [roundRest, setRoundRest] = useState("");
  const [editorSteps, setEditorSteps] = useState<EditorStep[]>([
    { distance: "600", repeats: "1", target: "", repRest: "", stepRest: "90" },
    { distance: "400", repeats: "1", target: "", repRest: "", stepRest: "70" },
    { distance: "300", repeats: "1", target: "", repRest: "", stepRest: "" },
  ]);
  const [draftPlanId, setDraftPlanId] = useState("");
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  function draftOf(id: TrackPresetId): TrackDraft | null {
    const form = drafts[id];
    const targetSeconds = form.target.map(optionalNumber);
    if (targetSeconds.some((item) => item === undefined)) return null;
    const repRestSeconds = optionalNumber(form.repRest);
    const roundRestSeconds = optionalNumber(form.roundRest);
    const stepRestSeconds = optionalNumber(form.stepRest);
    if (
      repRestSeconds === undefined ||
      roundRestSeconds === undefined ||
      stepRestSeconds === undefined
    )
      return null;
    return {
      targetSeconds: targetSeconds.map((item) => item ?? null),
      repRestSeconds,
      roundRestSeconds,
      stepRestSeconds,
    };
  }

  async function confirm(id: TrackPresetId) {
    const draft = draftOf(id);
    if (!draft) {
      setNotice("目标或休息要写成大于 0 的数，或留空表示未设置。");
      return;
    }
    const saved = await withRunningWriteLock(() => confirmTrackPlan(id, draft));
    setNotice(saved.ok ? "这节计划已确认。还没开始，不会写入训练记录。" : "计划没有保存。");
  }

  async function begin(planId: string) {
    const started = await startTrackSessionSafely(planId);
    if (!started.ok) {
      setNotice(started.reason);
      return;
    }
    setOpenId(started.trainingOccurrenceId);
  }

  async function saveEditor() {
    const roundCount = wholeNumber(rounds);
    if (roundCount == null) {
      setNotice("轮数要写成大于 0 的整数。");
      return;
    }
    const roundRestSeconds = optionalRest(roundRest);
    if (roundRestSeconds === undefined) {
      setNotice("轮间休息要写成 0 或更大的数，或留空。");
      return;
    }
    if (roundCount === 1 && roundRestSeconds != null) {
      setNotice("只有一轮时，现有计划不能保存轮间休息。");
      return;
    }
    const steps: CustomStep[] = [];
    for (let index = 0; index < editorSteps.length; index += 1) {
      const step = editorSteps[index];
      if (!step) continue;
      const repeatCount = wholeNumber(step.repeats);
      const distanceMeters = optionalNumber(step.distance);
      const targetSeconds = optionalNumber(step.target);
      const repRestSeconds = optionalRest(step.repRest);
      const stepRestSeconds = optionalRest(step.stepRest);
      if (
        repeatCount == null ||
        distanceMeters === undefined ||
        targetSeconds === undefined ||
        repRestSeconds === undefined ||
        stepRestSeconds === undefined
      ) {
        setNotice("距离、次数、目标和休息要写成有效数字，或把可留空的项留空。");
        return;
      }
      if (repeatCount === 1 && repRestSeconds != null) {
        setNotice("这一段只做 1 次，不能另写组间休息。");
        return;
      }
      if (index === editorSteps.length - 1 && stepRestSeconds != null) {
        setNotice("最后一段后面没有下一段，不能写段间休息。");
        return;
      }
      steps.push({ distanceMeters, repeatCount, targetSeconds, repRestSeconds, stepRestSeconds });
    }
    const planId =
      draftPlanId ||
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `track-${crypto.randomUUID()}`
        : `track-${Date.now()}`);
    const saved = await withRunningWriteLock(() =>
      saveCustomTrackPlan(planId, roundCount, roundRestSeconds, steps),
    );
    if (!saved.ok) {
      setNotice("计划没有保存。结构不符合现有跑步计划规则。");
      return;
    }
    setDraftPlanId(planId);
    setNotice(
      openTrackOccurrence(planId)
        ? "已开始的这节仍用开始时冻住的计划。这次修改只给下一节。"
        : "这节计划已确认。还没开始，不会写入训练记录。",
    );
  }

  const customPlans = listTrackPlans().filter(
    (plan) => !TRACK_PRESETS.some((preset) => preset.planId === plan.planId),
  );
  const home = trackHomeView(selectedPlanId);
  const selected = selectedPlanId ? getRunningPlan(selectedPlanId) : null;
  const startId = selectedPlanId ? selected?.planId ?? null : home.planId;
  const selectedOpen = startId ? openTrackOccurrence(startId) : null;

  return (
    <section id="track-session" className="mb-4 rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-bold text-muted">今日训练 · 田径</p>
      <h2 className="mt-1 break-words text-xl font-bold">{selectedPlanId ? selected ? describeTrackPlan(selected) : "选定课程已不存在" : home.title}</h2>
      <p className="mt-2 break-words text-sm">{home.rest}</p>
      <p className="mt-1 text-sm">{home.progress}</p>
      <p className="mt-2 text-sm text-muted">
        计划日期是安排，不是完成限制：周一可以提前执行周三的课，但应明确选择原计划，保留原定日期和实际训练日期。当前田径快捷入口尚未实现跨日计划选择，不会自动把周三课程标记为已完成。
      </p>
      <p className="mt-1 text-sm text-muted">{home.previous}</p>
      <p className="mt-2 text-sm">{home.evidenceNote}</p>
      {startId ? (
        <button
          type="button"
          onClick={() => begin(startId!)}
          className="mt-3 min-h-12 w-full rounded-card bg-accent font-bold text-accent-fg"
        >
          {selectedOpen ? "继续这节" : "开始这节"}
        </button>
      ) : (
        <p className="mt-3 text-sm">展开下面确认一节后再开始。这里不会自动编训练。</p>
      )}
      {onLog ? (
        <button
          type="button"
          onClick={onLog}
          className="mt-2 min-h-12 w-full rounded-card border border-line font-bold"
        >
          看日志
        </button>
      ) : null}
      <details className="mt-4 border-t border-line pt-3">
        <summary className="min-h-11 cursor-pointer py-2 font-bold">确认或修改计划</summary>
        <h2 className="mt-3 font-bold">田径专项</h2>
        <p className="mt-1 text-sm text-muted">
          只执行你确认过的计划。目标留空就是未设置，不会自动填秒数。
        </p>
        {TRACK_PRESETS.map((preset) => {
          const saved = getRunningPlan(preset.planId);
          const open = openTrackOccurrence(preset.planId);
          const form = drafts[preset.id];
          return (
            <div key={preset.id} className="mt-4 border-t border-line pt-3">
              <p className="font-bold">{preset.title}</p>
              <p className="mt-1 text-xs text-muted">
                {saved ? "已确认" : "还没确认"}
                {open ? " · 有一节还没做完" : ""}
              </p>
              {preset.id === "200x4x2" ? (
                <>
                  <label className="mt-2 block text-sm">
                    目标秒数
                    <input
                      value={form.target[0]}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "200x4x2": { ...form, target: [event.target.value] },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                  <label className="mt-2 block text-sm">
                    组间休息秒
                    <input
                      value={form.repRest}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "200x4x2": { ...form, repRest: event.target.value },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                  <label className="mt-2 block text-sm">
                    轮间休息秒
                    <input
                      value={form.roundRest}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "200x4x2": { ...form, roundRest: event.target.value },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="mt-2 block text-sm">
                    400米目标秒数
                    <input
                      value={form.target[0]}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "400-200": {
                            ...form,
                            target: [event.target.value, form.target[1] ?? ""],
                          },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                  <label className="mt-2 block text-sm">
                    200米目标秒数
                    <input
                      value={form.target[1]}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "400-200": {
                            ...form,
                            target: [form.target[0] ?? "", event.target.value],
                          },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                  <label className="mt-2 block text-sm">
                    两段之间休息秒
                    <input
                      value={form.stepRest}
                      inputMode="decimal"
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          "400-200": { ...form, stepRest: event.target.value },
                        })
                      }
                      placeholder="未设置"
                      className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                    />
                  </label>
                </>
              )}
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => confirm(preset.id)}
                  className="min-h-11 rounded-card border border-line font-bold"
                >
                  确认这节计划
                </button>
                <button
                  type="button"
                  onClick={() => begin(preset.planId)}
                  className="min-h-11 rounded-card bg-accent font-bold text-accent-fg"
                >
                  {open ? "继续这节" : "开始这节"}
                </button>
              </div>
            </div>
          );
        })}
        <div className="mt-4 border-t border-line pt-3">
          <p className="font-bold">自己编一节</p>
          <p className="mt-1 text-sm text-muted">
            训练名称和备注没有计划字段，不能安全保存。这节课用距离、次数和轮数表示。改已开始的课不会改掉已经冻住的计划。
          </p>
          <label className="mt-2 block text-sm">
            轮数
            <input
              value={rounds}
              inputMode="numeric"
              onChange={(event) => setRounds(event.target.value)}
              className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
            />
          </label>
          <label className="mt-2 block text-sm">
            轮间休息秒
            <input
              value={roundRest}
              inputMode="decimal"
              onChange={(event) => setRoundRest(event.target.value)}
              placeholder="只有一轮时不能填"
              className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
            />
          </label>
          {editorSteps.map((step, index) => (
            <div key={index} className="mt-3 rounded-card border border-line p-3">
              <p className="text-sm font-bold">第 {index + 1} 段</p>
              <label className="mt-2 block text-sm">
                距离（米）
                <input
                  value={step.distance}
                  inputMode="decimal"
                  onChange={(event) =>
                    setEditorSteps(
                      editorSteps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, distance: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="未设置"
                  className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                />
              </label>
              <label className="mt-2 block text-sm">
                重复次数
                <input
                  value={step.repeats}
                  inputMode="numeric"
                  onChange={(event) =>
                    setEditorSteps(
                      editorSteps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, repeats: event.target.value } : item,
                      ),
                    )
                  }
                  className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                />
              </label>
              <label className="mt-2 block text-sm">
                目标秒数
                <input
                  value={step.target}
                  inputMode="decimal"
                  onChange={(event) =>
                    setEditorSteps(
                      editorSteps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, target: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="未设置"
                  className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                />
              </label>
              <label className="mt-2 block text-sm">
                组间休息秒
                <input
                  value={step.repRest}
                  inputMode="decimal"
                  onChange={(event) =>
                    setEditorSteps(
                      editorSteps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, repRest: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="只做 1 次时不能填"
                  className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                />
              </label>
              <label className="mt-2 block text-sm">
                下一段前休息秒
                <input
                  value={step.stepRest}
                  inputMode="decimal"
                  onChange={(event) =>
                    setEditorSteps(
                      editorSteps.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, stepRest: event.target.value } : item,
                      ),
                    )
                  }
                  placeholder="最后一段不能填"
                  className="mt-1 h-12 w-full rounded-card border border-line bg-bg px-3"
                />
              </label>
              {editorSteps.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setEditorSteps(editorSteps.filter((_, itemIndex) => itemIndex !== index))
                  }
                  className="mt-2 min-h-11 rounded-card border border-line px-3"
                >
                  删除这段
                </button>
              ) : null}
            </div>
          ))}
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={() =>
                setEditorSteps([
                  ...editorSteps,
                  { distance: "", repeats: "1", target: "", repRest: "", stepRest: "" },
                ])
              }
              className="min-h-11 rounded-card border border-line font-bold"
            >
              加一段
            </button>
            <button
              type="button"
              onClick={saveEditor}
              className="min-h-11 rounded-card border border-line font-bold"
            >
              确认自编计划
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftPlanId("");
                setNotice("下一节会另存，不会改掉刚才确认的计划。");
              }}
              className="min-h-11 rounded-card border border-line font-bold"
            >
              另存一节
            </button>
          </div>
        </div>
        {customPlans.map((plan) => {
          const open = openTrackOccurrence(plan.planId);
          return (
            <div key={plan.planId} className="mt-3 border-t border-line pt-3">
              <p className="break-words font-bold">{describeTrackPlan(plan)}</p>
              <p className="mt-1 text-xs text-muted">
                {open ? "有一节还没做完" : "已确认，还没开始"}
              </p>
              <button
                type="button"
                onClick={() => begin(plan.planId)}
                className="mt-2 min-h-11 w-full rounded-card bg-accent font-bold text-accent-fg"
              >
                {open ? "继续这节" : "开始这节"}
              </button>
            </div>
          );
        })}
        {notice ? <p className="mt-3 text-sm">{notice}</p> : null}
      </details>
      {openId ? <TrackRunner occurrenceId={openId} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}
