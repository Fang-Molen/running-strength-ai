import type { Profile } from "@/lib/strength/profile"
import type { SportGoalPreference } from "@/lib/ui/sport-goal"
import { onboardingSteps } from "@/lib/ui/onboarding"

export function AthleteStartCard({ profile, preference, onEdit, onSettings, onBody }: { profile: Profile; preference: SportGoalPreference; onEdit: () => void; onSettings: () => void; onBody: () => void }) {
  const steps = onboardingSteps(profile, preference)
  const completed = steps.filter(step => step.complete).length
  return <section aria-label="完善运动员资料" className="mb-4 rounded-card border border-line bg-surface p-4">
    <h2 className="text-base font-bold">开始使用 · 运动员资料</h2>
    <p className="mt-1 text-sm text-muted">已补充 {completed}/2 项专项信息。身体风险需要单独核对，不会因资料空白判断为安全。</p>
    <ul className="mt-3 space-y-2 text-sm">
      {steps.map(step => <li key={step.id} className="rounded-card border border-line p-3">
        <p className="font-bold">{step.id === "safety" ? "待核对" : step.complete ? "已填写" : "待填写"} · {step.label}</p>
        <p className="mt-1 text-muted">{step.hint}</p>
      </li>)}
    </ul>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={onEdit} className="min-h-11 rounded-card bg-accent px-4 text-sm font-bold text-accent-fg">完善我的情况</button>
      <button type="button" onClick={onSettings} className="min-h-11 rounded-card border border-line px-4 text-sm font-bold">选择运动项目</button>
      <button type="button" onClick={onBody} className="min-h-11 rounded-card border border-line px-4 text-sm font-bold">身体与设备</button>
    </div>
    <p className="mt-2 text-xs text-muted">可以稍后补充；这里仅展示资料完整度，不计算能力、疲劳或训练建议。</p>
  </section>
}
