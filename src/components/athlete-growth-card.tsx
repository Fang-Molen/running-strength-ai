import type { Plan } from "@/lib/strength/model";
import { currentWeekGrowth } from "@/lib/ui/athlete-growth";

export function AthleteGrowthCard({ plan }: { plan: Plan }) {
  const growth = currentWeekGrowth(plan);
  const start = growth.current.xp;
  const percent = growth.next ? Math.max(0, Math.min(100, (growth.xp - start) / (growth.next.xp - start) * 100)) : 100;
  return <section className="mt-4 rounded-card border border-line bg-surface p-4" aria-label="本周训练记录成长">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-xs text-muted">本周记录成长 · 本机预览</p><h2 className="mt-1 text-lg font-bold">Lv.{growth.current.level} · {growth.current.name}</h2></div>
      <strong className="text-lg">{growth.xp} XP</strong>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="本周成长进度" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} /></div>
    <p className="mt-2 text-xs text-muted">{growth.next ? `距 Lv.${growth.next.level} 还差 ${growth.next.xp - growth.xp} XP` : "已达到本周预览的最高等级"} · 有效反馈 {growth.feedbackCount} 节 · 休息/跳过记录 {growth.recoveryCount} 节</p>
    <p className="mt-3 text-xs text-muted">仅按当前训练周的去重反馈展示；换周后重新计算，不代表终身经验、真实运动能力或完整训练量。休息不会扣分。</p>
    <div className="mt-3 rounded-card bg-surface-2 p-3 text-sm"><p className="font-bold">方坤线上 AI 体验卡 · 规划中</p><p className="mt-1 text-xs text-muted">未来拟定 Lv.5 可申请，7 天/30 次为暂定额度。当前无真实卡券、无在线领取或调用权限；必须由安全服务端审核与签发。</p></div>
  </section>;
}
