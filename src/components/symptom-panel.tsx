import { useEffect, useState } from "react";
import { subscribeHealthUpdates } from "@/lib/health/health-subscription";
import {
  readSymptoms,
  appendSymptom,
  reviseSymptom,
  type SymptomInput,
  type SymptomRow,
} from "@/lib/health/symptom-store";
import { reviewSymptoms } from "@/lib/health/symptom-review";
import { localDay } from "@/lib/health/observation";
const sideLabel = { LEFT: "左侧", RIGHT: "右侧", BILATERAL: "双侧", UNSPECIFIED: "未注明侧别" };
export function SymptomPanel() {
  const [span, setSpan] = useState<3 | 7 | 14>(7),
    [rows, setRows] = useState<SymptomRow[]>([]),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<SymptomInput>({
    kind: "PAIN",
    region: "膝",
    side: "UNSPECIFIED",
    severity: null,
    durationHours: null,
    trigger: null,
    functionImpact: "UNKNOWN",
    trend: "UNKNOWN",
    notes: "",
    occurredAt: new Date().toISOString(),
    trainingRefs: [],
  });
  useEffect(
    () => subscribeHealthUpdates(() => setRows(readSymptoms()), { batch: true, reconcile: true }),
    [],
  );
  const r = reviewSymptoms(rows, localDay(), span),
    patch = (v: Partial<SymptomInput>) => setDraft((d) => ({ ...d, ...v }));
  const save = () => {
    const result = appendSymptom({ ...draft, occurredAt: new Date().toISOString() });
    setNotice(result.ok ? "症状已保存；教练将按新证据复核。" : result.message);
    if (result.ok) {
      setRows(readSymptoms());
      setOpen(false);
    }
  };
  const retract = (row: SymptomRow) => {
    const result = reviseSymptom(row.id, row.revision, {}, true);
    setNotice(result.ok ? "误记已撤回，原记录和修订历史保留。" : result.message);
    if (result.ok) setRows(readSymptoms());
  };
  return (
    <section className="home-card my-3 p-4" aria-label="疼痛与酸痛追踪" data-testid="r5-symptoms">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">疼痛与酸痛追踪</h3>
        <button
          type="button"
          className="min-h-11 rounded-xl border border-line px-3 text-sm"
          onClick={() => setOpen((v) => !v)}
        >
          记录症状
        </button>
      </div>
      <div className="my-2 flex gap-2" aria-label="症状趋势窗口">
        {([3, 7, 14] as const).map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={span === n}
            className="min-h-10 rounded-lg border border-line px-3 text-sm"
            onClick={() => setSpan(n)}
          >
            {n}天
          </button>
        ))}
      </div>
      <p className={r.safety === "NO_KNOWN_HOLD" ? "text-sm text-muted" : "text-sm text-amber-500"}>
        {r.message}
      </p>
      {r.groups.length ? (
        <div className="mt-3 space-y-3">
          {r.groups.map((g) => (
            <div
              key={`${g.kind}:${g.region}:${g.side}`}
              className="rounded-xl border border-line p-3 text-sm"
            >
              <b>
                {sideLabel[g.side]}
                {g.region} · {g.kind === "PAIN" ? "疼痛" : "酸痛"}
              </b>
              <p className="mt-1">
                最近 {g.latest.severity ?? "未知"}/10 ·{" "}
                {g.change === null
                  ? "趋势数据不足"
                  : `较窗口首条 ${g.change > 0 ? "+" : ""}${g.change}分`}{" "}
                · 缺 {g.missingDays} 天
              </p>
              <p className="text-xs text-muted">
                诱发：{g.latest.trigger ?? "未知"}；功能：
                {
                  {
                    NORMAL: "日常动作正常",
                    LIMITED: "动作受限",
                    UNABLE: "无法完成日常动作",
                    UNKNOWN: "未知",
                  }[g.latest.functionImpact]
                }
                ；持续：
                {g.latest.durationHours ?? "未知"}小时
              </p>
              <details className="mt-1">
                <summary className="min-h-8 cursor-pointer text-xs">查看观测与纠错</summary>
                {g.observations.map((o) => (
                  <div key={o.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span>
                      {new Date(o.occurredAt).toLocaleString("zh-CN")} · {o.severity ?? "未知"}/10
                    </span>
                    <button
                      type="button"
                      className="min-h-9 shrink-0 underline"
                      onClick={() => {
                        if (
                          window.confirm("确认撤回这条误记？更正历史会保留，不代表医学解除限制。")
                        )
                          retract(o);
                      }}
                    >
                      撤回误记
                    </button>
                  </div>
                ))}
              </details>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">本窗口没有症状观测；没有记录的日期保持未知。</p>
      )}
      <p className="mt-3 text-xs text-muted">{r.caveat}</p>
      {open ? (
        <div className="mt-3 grid gap-3 rounded-xl border border-line p-3 text-sm">
          <label>
            类型
            <select
              className="ml-2 rounded border border-line bg-surface p-2"
              value={draft.kind}
              onChange={(e) => patch({ kind: e.target.value as SymptomInput["kind"] })}
            >
              <option value="PAIN">疼痛</option>
              <option value="SORENESS">酸痛</option>
            </select>
          </label>
          <label>
            部位
            <input
              aria-label="症状部位"
              className="ml-2 max-w-40 rounded border border-line bg-surface p-2"
              value={draft.region}
              maxLength={40}
              onChange={(e) => patch({ region: e.target.value })}
            />
          </label>
          <label>
            侧别
            <select
              className="ml-2 rounded border border-line bg-surface p-2"
              value={draft.side}
              onChange={(e) => patch({ side: e.target.value as SymptomInput["side"] })}
            >
              {Object.entries(sideLabel).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            程度 0–10
            <input
              aria-label="症状程度"
              className="ml-2 w-20 rounded border border-line bg-surface p-2"
              type="number"
              min={0}
              max={10}
              value={draft.severity ?? ""}
              onChange={(e) =>
                patch({ severity: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <label>
            持续小时
            <input
              aria-label="持续小时"
              type="number"
              min={0}
              className="ml-2 w-24 rounded border border-line bg-surface p-2"
              value={draft.durationHours ?? ""}
              onChange={(e) =>
                patch({ durationHours: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <label>
            诱发动作
            <input
              aria-label="诱发动作"
              className="ml-2 max-w-44 rounded border border-line bg-surface p-2"
              value={draft.trigger ?? ""}
              maxLength={160}
              onChange={(e) => patch({ trigger: e.target.value || null })}
            />
          </label>
          <label>
            功能影响
            <select
              aria-label="功能影响"
              className="ml-2 rounded border border-line bg-surface p-2"
              value={draft.functionImpact}
              onChange={(e) =>
                patch({ functionImpact: e.target.value as SymptomInput["functionImpact"] })
              }
            >
              <option value="UNKNOWN">未知</option>
              <option value="NORMAL">未影响日常动作</option>
              <option value="LIMITED">动作受限</option>
              <option value="UNABLE">无法完成日常动作</option>
            </select>
          </label>
          <label>
            变化
            <select
              className="ml-2 rounded border border-line bg-surface p-2"
              value={draft.trend}
              onChange={(e) => patch({ trend: e.target.value as SymptomInput["trend"] })}
            >
              <option value="UNKNOWN">未知</option>
              <option value="WORSENING">加重</option>
              <option value="STABLE">稳定</option>
              <option value="IMPROVING">减轻</option>
            </select>
          </label>
          <label>
            补充说明
            <textarea
              aria-label="症状补充说明"
              className="mt-1 w-full rounded border border-line bg-surface p-2"
              maxLength={1000}
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg"
            onClick={save}
          >
            确认保存症状
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="mt-2 text-sm" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
