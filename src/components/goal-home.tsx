import type { ReactNode } from "react"
import type { HomeVariant } from "@/lib/ui/sport-goal"

export type GoalMove = {
  id: string
  name: string
  sets: number
  amount: number
  mode: "reps" | "seconds"
  weightKg: number
}

type GoalHomeProps = {
  variant: Exclude<HomeVariant, "track">
  sportLabel: string
  primaryLabel: string
  secondaryLabel: string | null
  sessionName: string | null
  minutes: number
  moves: GoalMove[]
  weightText: string | null
  runKm: number | null
  kcal: number | null
  onBody: () => void
  onLog: () => void
  onPlan: () => void
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  )
}

export function GoalHome({ variant, sportLabel, primaryLabel, secondaryLabel, sessionName, minutes, moves, weightText, runKm, kcal, onBody, onLog, onPlan }: GoalHomeProps) {
  const title = variant === "fat-loss" ? "减脂与体重管理" : variant === "muscle" ? "力量与增肌" : "综合体能"
  return (
    <div className="mb-4 flex flex-col gap-3">
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-xs font-bold text-muted">{sportLabel} · {title}</p>
        <p className="mt-1 text-xl font-bold">主要目标 · {primaryLabel}</p>
        <p className="mt-1 text-sm text-muted">{secondaryLabel ? `次要目标 · ${secondaryLabel}。次要目标只保存选择，不改课表。` : "没有次要目标。"}</p>
        <p className="mt-2 text-sm text-muted">这里只展示已经保存的记录和现有入口。不生成热量赤字、减重速度或新的训练处方。这个目标的 AI 训练决策尚未接入。</p>
      </section>
      {variant === "fat-loss" ? (
        <Card title="今日有氧">
          {runKm != null ? <p>今天已记录跑步 {runKm} 公里。这是已保存的跑步记录，不是建议配速。</p> : <p>暂无今日跑步记录。</p>}
          <p className="mt-2 text-muted">下面仍使用现有跑步记录，不会另建一套训练。</p>
        </Card>
      ) : null}
      <Card title={variant === "muscle" ? "今日力量训练" : "全身力量"}>
        {sessionName && moves.length > 0 ? (
          <p>{sessionName} · {moves.length} 个动作 · 约 {minutes} 分钟。来自当前课表。开始按钮在上方的力量卡，这里不重复列动作，也不新生成计划。</p>
        ) : (
          <p>暂无已安排的力量课。不会在这里编造动作或组数。</p>
        )}
      </Card>
      {variant !== "conditioning" ? (
        <Card title={variant === "fat-loss" ? "体重趋势" : "身体与营养"}>
          <p>{weightText ?? "暂无体重记录。"}</p>
          <p className="mt-1">{kcal != null ? `今日已记录摄入 ${kcal} 千卡。` : "暂无今日饮食记录。"}</p>
          <p className="mt-1 text-muted">没有记录就不会显示成正常或已达标。</p>
        </Card>
      ) : (
        <Card title="已有记录">
          <p>{weightText ?? "暂无体重记录。"}</p>
          <p className="mt-1">{runKm != null ? `今天已记录跑步 ${runKm} 公里。` : "暂无今日跑步记录。"}</p>
          <p className="mt-1 text-muted">综合体能没有单独的处方引擎。下面仍是原来的课表和记录。</p>
        </Card>
      )}
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onPlan} className="min-h-12 rounded-card border border-line bg-surface px-3 text-sm font-bold">查看现有课表</button>
        <button type="button" onClick={onLog} className="min-h-12 rounded-card border border-line bg-surface px-3 text-sm font-bold">训练历史</button>
        <button type="button" onClick={onBody} className="min-h-12 rounded-card border border-line bg-surface px-3 text-sm font-bold">身体与营养</button>
      </div>
    </div>
  )
}
