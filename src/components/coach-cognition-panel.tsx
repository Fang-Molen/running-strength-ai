import { useEffect, useState } from "react";
import type { CoachBrief } from "@/lib/core/coach-brief";
import type { CoachCognition } from "@/lib/core/coach-cognition";
import {
  appendLearningRecord,
  loadLearning,
  evaluateLearning,
  COGNITION_JOURNAL_PREFIX,
  type LearningRecord,
  type LearningStore,
} from "@/lib/core/coach-cognition-learning";
import type { ComparisonContext } from "@/lib/core/coach-cognition-tools";

export function CoachCognitionPanel({
  cognition,
  brief,
}: {
  cognition: CoachCognition;
  brief: CoachBrief;
}) {
  const [state, setState] = useState<LearningStore>({ revision: 0, records: [] });
  useEffect(() => {
    setState(loadLearning());
    const refresh = (e: StorageEvent) => {
      if (e.key?.startsWith(COGNITION_JOURNAL_PREFIX)) setState(loadLearning());
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [rest, setRest] = useState("");
  const [timing, setTiming] = useState("");
  const [surface, setSurface] = useState("");
  const [phase, setPhase] = useState("");
  const [message, setMessage] = useState("");
  const [candidateOptionId, setCandidateOptionId] = useState(
    cognition.options[0]?.id ?? "HOLD_VERIFY",
  );
  const [correctionTarget, setCorrectionTarget] = useState("");
  const [horizon, setHorizon] = useState<24 | 48>(24);
  const event = cognition.events[0];
  const execution =
    brief.running?.filter((r) => r.kind === "REPETITION" && r.status === "COMPLETED") ?? [];
  const d = execution[0]?.actual.match(/^(\d+(?:\.\d+)?)米/);
  const distanceMeters = d ? Number(d[1]) : 0;
  const starts = brief.sources
    ?.find((s) => s.id === brief.occurrenceId)
    ?.detail.match(/\d{4}-\d\d-\d\dT[^；]+/);
  const sessionAt = starts?.[0] ?? "";
  const eligible =
    !!brief.occurrenceId &&
    !!sessionAt &&
    execution.length > 0 &&
    !!distanceMeters &&
    execution.every((r) => r.actual.startsWith(`${distanceMeters}米/`)) &&
    brief.duplicateCount === 0 &&
    cognition.facts[0].kind !== "THIRD_PARTY" &&
    !brief.runningTruncated;
  const context: ComparisonContext = {
    event,
    distanceMeters,
    reps: execution.length,
    rounds: new Set(execution.map((r) => r.position.match(/第(\d+)轮/)?.[1] ?? "UNKNOWN")).size,
    restSeconds: rest.trim() && Number(rest) > 0 ? Number(rest) : null,
    timing: timing.trim() || null,
    surface: surface.trim() || null,
    phase: phase.trim() || null,
  };
  const predictions = state.records.filter(
    (r) =>
      r.kind === "PREDICTION" &&
      r.trainingOccurrenceId === brief.occurrenceId &&
      r.horizonHours === horizon &&
      !state.records.some((s) => s.supersedes === r.id),
  );
  const [predictionId, setPredictionId] = useState("");
  const chosen = predictions.find((p) => p.id === predictionId);
  const summary = evaluateLearning(state, event);
  function save(
    kind: LearningRecord["kind"],
    value: number | null,
    choice: LearningRecord["choice"] = null,
    supersedes: string | null = null,
  ) {
    if (!eligible) {
      setMessage("需选定有来源且无冲突的实际跑步记录；聊天数字不会自动成为完成事实。");
      return;
    }
    if (kind === "CHOICE" && !cognition.options.some((o) => o.id === candidateOptionId)) {
      setMessage("当前安全限制不允许记录训练候选。");
      return;
    }
    if (
      kind === "PREDICTION" &&
      (!rest.trim() || !timing.trim() || !surface.trim() || !phase.trim())
    ) {
      setMessage("请补齐可比条件；未知不能默认为相同。");
      return;
    }
    if (kind === "OBSERVATION" && !chosen) {
      setMessage("请选择事先记录的预测。");
      return;
    }
    const r: LearningRecord = {
      id: crypto.randomUUID(),
      kind,
      layer: kind === "OBSERVATION" ? "M3" : "M7",
      athleteId: "local",
      trainingOccurrenceId: brief.occurrenceId!,
      sourceIds: [
        brief.occurrenceId!,
        ...(chosen?.sourceIds ?? []),
        ...execution.flatMap((r) => r.sourceEventIds),
      ],
      createdAt: new Date().toISOString(),
      observedAt: kind === "OBSERVATION" && observedAt ? new Date(observedAt).toISOString() : null,
      sessionAt,
      context: chosen?.context ?? context,
      horizonHours: horizon,
      value,
      predictionId: kind === "OBSERVATION" ? chosen!.id : null,
      supersedes: kind === "OBSERVATION" ? correctionTarget || null : supersedes,
      candidateOptionId,
      reasoningVersion: cognition.version,
      hypothesisIds: cognition.hypotheses.map((h) => h.id),
      choice,
      confirmed: true,
    };
    const result = appendLearningRecord(r, state.revision);
    setMessage(
      result.ok
        ? "已保存到独立反馈记忆，正式计划与训练事实没有改动。"
        : `没有保存：${result.error}。`,
    );
    setState(loadLearning());
  }
  return (
    <details className="rounded-card border border-line p-3 text-sm" open>
      <summary className="font-bold">400米与专项推理 · 反馈验证</summary>
      <p className="mt-2">
        这里记录你的候选选择和预测误差，用于核对个人响应。三次独立可比观察仍只形成低置信线索。
      </p>
      <p className="mt-2">
        {summary.patterns.length}组低置信响应；{summary.excluded.length}条冲突或无效观察排除。
      </p>
      {!eligible ? (
        <p className="mt-2">当前只作问答分析；请选定有来源的已完成跑步记录，再记录反馈学习。</p>
      ) : (
        <>
          <label className="mt-2 block">
            选择候选方向
            <select
              className="w-full"
              aria-label="选择认知候选"
              value={candidateOptionId}
              onChange={(e) => setCandidateOptionId(e.target.value as typeof candidateOptionId)}
            >
              {cognition.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.direction}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 border border-line rounded-card px-3"
              onClick={() => save("CHOICE", null, "ACCEPT")}
            >
              接受候选方向
            </button>
            <button
              type="button"
              className="min-h-11 border border-line rounded-card px-3"
              onClick={() => save("CHOICE", null, "REJECT")}
            >
              拒绝候选方向
            </button>
            <button
              type="button"
              className="min-h-11 border border-line rounded-card px-3"
              onClick={() => save("CHOICE", null, "MODIFY")}
            >
              需要重改
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label>
              间隔秒数
              <input
                aria-label="学习间隔秒数"
                type="number"
                min="1"
                className="w-full rounded border border-line p-2"
                value={rest}
                onChange={(e) => setRest(e.target.value)}
              />
            </label>
            <label>
              计时条件
              <input
                aria-label="学习计时条件"
                className="w-full rounded border border-line p-2"
                value={timing}
                onChange={(e) => setTiming(e.target.value)}
              />
            </label>
            <label>
              场地
              <input
                aria-label="学习场地"
                className="w-full rounded border border-line p-2"
                value={surface}
                onChange={(e) => setSurface(e.target.value)}
              />
            </label>
            <label>
              周期阶段
              <input
                aria-label="学习周期阶段"
                className="w-full rounded border border-line p-2"
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
              />
            </label>
          </div>
          <label className="mt-2 block">
            观察窗口
            <select
              aria-label="学习观察窗口"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value) as 24 | 48)}
            >
              <option value={24}>24h</option>
              <option value={48}>48h</option>
            </select>
          </label>
          <label className="mt-2 block">
            预计恢复感1–10
            <input
              aria-label="预计恢复感"
              type="number"
              min="1"
              max="10"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="min-h-11 border border-line rounded-card px-3 mt-2"
            onClick={() => save("PREDICTION", expected ? Number(expected) : null)}
          >
            确认记录预测
          </button>
          <label className="mt-3 block">
            核对哪条预测
            <select
              aria-label="选择学习预测"
              className="w-full"
              value={predictionId}
              onChange={(e) => setPredictionId(e.target.value)}
            >
              <option value="">请选择</option>
              {predictions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.createdAt} · {p.value}/10
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block">
            观察更正（可选）
            <select
              aria-label="更正学习观察"
              className="w-full"
              value={correctionTarget}
              onChange={(e) => setCorrectionTarget(e.target.value)}
            >
              <option value="">新增观察；不替换旧记录</option>
              {state.records
                .filter(
                  (r) =>
                    r.kind === "OBSERVATION" &&
                    r.predictionId === chosen?.id &&
                    !state.records.some((s) => s.supersedes === r.id),
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    明确更正：{r.observedAt} · {r.value}/10
                  </option>
                ))}
            </select>
          </label>
          <label className="mt-2 block">
            实际恢复感1–10
            <input
              aria-label="实际恢复感"
              type="number"
              min="1"
              max="10"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </label>
          <label className="mt-2 block">
            实际观察时间
            <input
              aria-label="实际观察时间"
              type="datetime-local"
              className="w-full"
              value={observedAt}
              onChange={(e) => setObservedAt(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="min-h-11 border border-line rounded-card px-3 mt-2"
            onClick={() => save("OBSERVATION", actual ? Number(actual) : null)}
          >
            确认记录观察
          </button>
          {state.records
            .filter(
              (r) =>
                r.trainingOccurrenceId === brief.occurrenceId &&
                r.kind !== "RETRACTION" &&
                !state.records.some((s) => s.supersedes === r.id),
            )
            .map((r) => (
              <div key={r.id} className="mt-2 flex gap-2">
                <span>
                  {r.kind} · {r.value ?? r.choice}
                </span>
                <button type="button" onClick={() => save("RETRACTION", null, null, r.id)}>
                  撤回这条学习记录
                </button>
              </div>
            ))}
        </>
      )}
      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </details>
  );
}
