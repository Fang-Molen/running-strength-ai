import { displayName, type Move } from "@/lib/strength/model";

type Props = { name: string; focus?: string; moves: Move[]; minutes: number; onEdit: () => void };

/** Read-only preview. It does not change the plan or infer a running workout. */
export function SessionOverview({ name, focus, moves, minutes, onEdit }: Props) {
  const totalSets = moves.reduce((sum, move) => sum + move.sets, 0);
  return (
    <section aria-label="完整训练安排" className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-muted">训练前先看完整安排</p>
          <h2 className="mt-1 text-lg font-bold">{name}</h2>
          <p className="mt-1 text-sm text-muted">{moves.length} 个力量动作 · {totalSets} 组 · 预计 {minutes} 分钟</p>
        </div>
        <button type="button" onClick={onEdit} className="min-h-11 shrink-0 rounded-card border border-line px-3 text-sm font-bold">调整课表</button>
      </div>
      {focus ? <p className="mt-2 text-sm">本节目标：{focus}</p> : null}
      <p className="mt-2 text-xs text-muted">下方展示当前已保存的力量计划，不代表完整跑步训练结构或 AI 已确认训练适宜性。</p>
      {moves.length ? (
        <ol className="mt-3 space-y-2">
          {moves.map((move, index) => (
            <li key={move.id} className="rounded-card border border-line bg-bg px-3 py-3">
              <div className="flex items-start gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-xs font-bold">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{displayName(move)}</p>
                  <p className="mt-1 text-sm">{move.sets} 组 × 每组 {move.amount} {move.mode === "seconds" ? "秒" : "次"}{move.weightKg > 0 ? ` · ${move.weightKg} kg` : " · 自重"}</p>
                  <p className="mt-1 text-xs text-muted">组间休息 {move.restSec} 秒</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="mt-3 text-sm text-muted">本节尚未添加力量动作。请先核对训练安排。</p>}
    </section>
  );
}
