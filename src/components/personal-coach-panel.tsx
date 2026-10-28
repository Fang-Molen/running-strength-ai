import { useEffect, useState } from "react";
import { currentAthleteId, onAppEvent, ATHLETE_SCOPE_CHANGED } from "@/lib/core/events";
import { changePersonal, defaultPersonalProfile, personalStore } from "@/lib/coach/personal/host";
import { personalDependencyLabels } from "@/lib/coach/personal/store";
import {
  formatPersonalPlan,
  goalNames,
  type PersonalProfile,
  type PersonalPlan,
  type Feedback,
  type Service,
} from "@/lib/coach/personal/planner";
const control = "min-h-11 w-full rounded-card border border-line bg-bg px-2";
const button =
  "min-h-11 rounded-card border border-line px-3 py-2 text-sm font-bold disabled:opacity-50";
type ActiveReview = ReturnType<ReturnType<typeof personalStore>["reviewActive"]>;
export function PersonalPlanReview({ review }: { review: ActiveReview }) {
  if (review.status === "EMPTY" || review.status === "FRESH") return null;
  return <section aria-label="方案依据复核" className="mt-3 rounded-card border border-line p-3">
    <p role="status">原方案保留，待复核：{review.status === "UNKNOWN" ? "原依据缺失或来源暂不可读取" : review.changed.map(key => personalDependencyLabels[key]).join("、") + "已变化"}。尚未采用以下候选。</p>
    {review.clarification && <p>{review.clarification}</p>}
    {review.candidate && <details><summary className="min-h-11 cursor-pointer py-2">条件性刷新候选（未采用）</summary><pre className="whitespace-pre-wrap break-words font-sans text-sm">{formatPersonalPlan(review.candidate)}</pre></details>}
  </section>;
}
export function PersonalCoachPanel() {
  const [profile, setProfile] = useState<PersonalProfile | null>(null),
    [plan, setPlan] = useState<PersonalPlan | null>(null),
    [token, setToken] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reduction, setReduction] = useState(false),
    [review, setReview] = useState<ActiveReview | null>(null);
  const [feedback, setFeedback] = useState<Omit<Feedback, "planVersion">>({
    completedSessions: 0,
    effort: "OK",
    pain: false,
    adherenceDays: 0,
    weightTrend: "UNKNOWN",
    completeWeightWindows: false,
  });
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!loadedOwner) return;
    const refresh = () => {
      if (loadedOwner !== currentAthleteId()) {
        setProfile(null); setPlan(null); setToken(null); setReview(null); setReduction(false);
        setMessage("用户已切换，请重新读取当前目标。"); return;
      }
      try {
        const store = personalStore(), next = store.reviewActive();
        setReview(next);
        if (token && store.reviewProposal(token).status !== "FRESH") {
          setToken(null); setPlan(store.read().active); setReduction(false);
          setMessage("草案依据已变化或无法读取，请重新预览；原方案保留。");
        } else if (!token) setPlan(store.read().active);
      } catch {
        setToken(null); setReduction(false); setPlan(null);
        setMessage("方案依据无法读取，请核对存储后重新读取；未改动原方案。");
      }
    };
    const events = ["fk-food-changed", "fk-health-changed", "fk-training-corrected", "fk-schedule-changed", "fk-profile-changed", "fk-personal-profile-changed", ATHLETE_SCOPE_CHANGED, "storage"];
    events.forEach(event => window.addEventListener(event, refresh));
    const off = onAppEvent(refresh);
    return () => { events.forEach(event => window.removeEventListener(event, refresh)); off(); };
  }, [loadedOwner, token]);
  const edit = (next: PersonalProfile) => {
    setProfile(next);
    setPlan(null);
    setToken(null);
    setReduction(false);
  };
  async function act(action: () => void | Promise<void>, reload = false) {
    setBusy(true);
    setMessage("");
    try {
      if (!reload && loadedOwner && loadedOwner !== currentAthleteId())
        throw Error("用户已切换，请重新读取");
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "本机操作失败；请重新读取");
      setToken(null);
      setPlan(null);
      setReduction(false);
    } finally {
      setBusy(false);
    }
  }
  function load() {
    void act(() => {
      const owner = currentAthleteId(),
        s = personalStore().read();
      setLoadedOwner(owner);
      setProfile(s.profile ?? defaultPersonalProfile(owner));
      setPlan(s.active);
      setReview(personalStore().reviewActive());
      setToken(null);
      setReduction(false);
      setMessage(
        s.active
          ? "已读取已采用方案；请核对健康与资料是否仍适用。"
          : "已读取。选择自己的目标和条件后生成草案。",
      );
    }, true);
  }
  async function generate() {
    if (!profile) return;
    await act(async () => {
      const result = await changePersonal((s) => {
        if (s.read().feedback.at(-1)?.value.pain)
          throw Error("此前有疼痛，请先评估并记录当前版本的实际反馈，再生成方案");
        const saved = s.saveProfile(profile);
        return { saved, proposal: s.prepare()! };
      });
      setProfile(result.saved);
      setPlan(result.proposal.plan);
      setToken(result.proposal.token);
      setReduction(false);
      setMessage("请核对下方完整草案，再确认采用。原日程未修改。");
    });
  }
  async function confirm() {
    if (!token) return;
    await act(async () => {
      const active = await changePersonal((s) => s.confirm(token, "CONFIRM_PERSONAL_PLAN"));
      setPlan(active);
      setToken(null);
      setReduction(false);
      setReview(personalStore().reviewActive());
      setMessage("已保存为本机私人教练方案。未写入原训练日程；未知器械重量仍需试练。");
    });
  }
  async function refreshCandidate() {
    await act(async () => {
      const proposal = await changePersonal(store => store.prepare());
      if (!proposal) throw Error("请先核对个人条件");
      setPlan(proposal.plan); setToken(proposal.token); setReduction(false);
      setMessage("按当前可读资料生成刷新候选；核对后可确认采用，也可拒绝并保留原方案。");
    });
  }
  async function reject() {
    if (!token) return;
    await act(async () => {
      await changePersonal(store => store.reject(token));
      const store = personalStore();
      setPlan(store.read().active); setToken(null); setReduction(false); setReview(store.reviewActive());
      setMessage("已拒绝候选，原已采用方案保留；尚未核实的新依据仍需复核。");
    });
  }
  async function recordFeedback() {
    if (!plan) return;
    await act(async () => {
      const r = await changePersonal((s) => s.feedback({ ...feedback, planVersion: plan.version }));
      setToken(null);
      setReduction(!!r.change);
      setMessage(r.message);
    });
  }
  async function reduce() {
    await act(async () => {
      const p = await changePersonal((s) => s.prepareReduction());
      setPlan(p.plan);
      setToken(p.token);
      setMessage("下方为每个多组动作减少1组的完整草案；请核对后确认。");
    });
  }
  function choice<K extends keyof PersonalProfile>(
    key: K,
    label: string,
    options: readonly [string, string][],
  ) {
    return (
      <label className="text-sm">
        {label}
        <select
          className={control}
          value={String(profile?.[key] ?? "")}
          onChange={(e) => edit({ ...profile!, [key]: e.target.value || null })}
        >
          {options.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <details className="rounded-card border border-line bg-surface p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">
        私人教练 · 饮食、力量与目标
      </summary>
      <p className="text-sm text-muted">
        可以只用饮食、只练力量，或结合跑步。先读取并核对自己的条件，再生成方案；不会自动联网。
      </p>
      <button className={button} disabled={busy} onClick={load}>
        读取我的目标
      </button>
      {profile && (
        <fieldset disabled={busy} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {choice("goal", "当前主目标", Object.entries(goalNames))}
            {choice("screen", "当前健康筛查", [
              ["UNKNOWN", "尚未确认"],
              ["CLEAR", "成人，无疼痛及下列特殊情况"],
              ["PAIN", "当前有疼痛"],
              ["MEDICAL", "疾病/用药/孕哺期/进食障碍等需专业指导"],
            ])}
            {choice("sex", "静息能量公式参数", [
              ["", "未提供"],
              ["male", "男性公式"],
              ["female", "女性公式"],
            ])}
            {choice("activity", "整体日常活动（包含训练）", [
              ["", "未知"],
              ["LOW", "以久坐为主"],
              ["MODERATE", "日常活动中等"],
              ["HIGH", "日常活动较多"],
            ])}
            {choice("experience", "力量经验", [
              ["BEGINNER", "初学或重新开始"],
              ["TRAINED", "有系统训练经历"],
            ])}
            {choice("equipment", "本轮可用器械", [
              ["NONE", "徒手"],
              ["DUMBBELLS", "哑铃"],
            ])}
            {choice("diet", "饮食偏好", [
              ["OMNIVORE", "可接受多类食物"],
              ["PLANT_BASED", "以植物食物为主"],
            ])}
            {(["age", "heightCm", "weightKg", "minutes"] as const).map((k) => (
              <label key={k} className="text-sm">
                {
                  {
                    age: "年龄（岁）",
                    heightCm: "身高（厘米）",
                    weightKg: "体重（公斤）",
                    minutes: "单次可用时间（分钟，15–90）",
                  }[k]
                }
                <input
                  className={control}
                  type="number"
                  step={k === "weightKg" ? "0.1" : "1"}
                  value={profile[k] ?? ""}
                  onChange={(e) =>
                    edit({ ...profile, [k]: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <div>
            <p className="text-sm font-bold">需要的服务</p>
            {(
              [
                ["NUTRITION", "饮食"],
                ["STRENGTH", "力量"],
                ["RUNNING", "跑步"],
              ] as [Service, string][]
            ).map(([v, t]) => (
              <label className="mr-4 inline-flex min-h-11 items-center gap-2" key={v}>
                <input
                  type="checkbox"
                  checked={profile.services.includes(v)}
                  onChange={(e) =>
                    edit({
                      ...profile,
                      services: e.target.checked
                        ? [...profile.services, v]
                        : profile.services.filter((s) => s !== v),
                    })
                  }
                />
                {t}
              </label>
            ))}
          </div>
          <div>
            <p className="text-sm font-bold">可安排力量的日期</p>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label className="mr-3 inline-flex min-h-11 items-center gap-1" key={d}>
                <input
                  type="checkbox"
                  checked={profile.days.includes(d)}
                  onChange={(e) =>
                    edit({
                      ...profile,
                      days: e.target.checked
                        ? [...profile.days, d]
                        : profile.days.filter((x) => x !== d),
                    })
                  }
                />
                周{"日一二三四五六"[d]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            以上是当前自报资料，不代表系统已完成医学筛查。健康或身体条件改变后请更新。过敏与治疗饮食需要进一步核验。
          </p>
          <button className={button} onClick={()=>void act(async()=>{
            const saved=await changePersonal(s=>s.saveProfile(profile));
            setProfile(saved);setToken(null);setPlan(null);
            setMessage('当前条件已保存，教练回答将按这些条件重新核对。');
          })}>保存当前条件</button>
          <button className={button} onClick={() => void generate()}>
            保存条件并生成草案
          </button>
        </fieldset>
      )}
      {plan && (
        <div className="mt-3">
          {!token && review && <PersonalPlanReview review={review} />}
          {!token && review && ["STALE", "UNKNOWN"].includes(review.status) && <button className={button} disabled={busy} onClick={() => void refreshCandidate()}>查看刷新候选</button>}
          <p className="mb-2 text-sm font-bold">
            {token ? "待核对草案" : review?.status === "STALE" || review?.status === "UNKNOWN" ? "已采用的历史方案（待复核，不代表当前建议）" : "已采用方案记录（使用前复核当天状态）"}
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">
            {token
              ? formatPersonalPlan(plan)
              : formatPersonalPlan(plan).replace(
                  "草案需核对后确认采用；采用仅保存私人教练方案，不等于写入原训练日程。",
                  "本版本已保存；未自动写入原训练日程。",
                )}
          </pre>
          {token && (
            <>
            <button className={button} disabled={busy} onClick={() => void confirm()}>
              已核对，确认采用此版本
            </button>
            <button className={button} disabled={busy} onClick={() => void reject()}>拒绝此候选，保留原方案</button>
            </>
          )}
          {!token && (
            <fieldset disabled={busy} className="mt-4 space-y-2">
              <legend className="font-bold">已采用版本的执行反馈</legend>
              <label className="block text-sm">
                实际完成力量次数
                <input
                  className={control}
                  type="number"
                  min="0"
                  max="100"
                  value={feedback.completedSessions}
                  onChange={(e) =>
                    setFeedback({ ...feedback, completedSessions: Number(e.target.value) })
                  }
                />
              </label>
              <label className="block text-sm">
                总体感受
                <select
                  className={control}
                  value={feedback.effort}
                  onChange={(e) =>
                    setFeedback({ ...feedback, effort: e.target.value as Feedback["effort"] })
                  }
                >
                  <option value="EASY">轻松</option>
                  <option value="OK">适中</option>
                  <option value="HARD">连续训练过难</option>
                </select>
              </label>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={feedback.pain}
                  onChange={(e) => setFeedback({ ...feedback, pain: e.target.checked })}
                />
                当前有疼痛
              </label>
              <button className={button} onClick={() => void recordFeedback()}>
                记录本版本反馈
              </button>
              {reduction && (
                <button className={button} onClick={() => void reduce()}>
                  查看单变量减量草案
                </button>
              )}
            </fieldset>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 whitespace-pre-wrap text-sm">
          {message}
        </p>
      )}
    </details>
  );
}
