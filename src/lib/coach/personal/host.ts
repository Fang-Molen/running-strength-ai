import { currentAthleteId } from "@/lib/core/events";
import { createPersonalStore } from "./store";
import { readEffectiveProfile } from "../loop/effective-host";
import { withEffectivePersonal } from "../loop/effective-profile";
import {
  buildPersonalPlan,
  formatPersonalPlan,
  routePersonalIntent,
  type PersonalProfile,
} from "./planner";
export function personalStore() {
  if (typeof window === "undefined") throw Error("请在设备中读取");
  return createPersonalStore(window.localStorage, currentAthleteId);
}
/** All browser writers use the same origin lock. No unlocked write fallback. */
export async function changePersonal<T>(
  action: (s: ReturnType<typeof createPersonalStore>) => T,
): Promise<T> {
  const owner = currentAthleteId();
  if (typeof navigator === "undefined" || !navigator.locks)
    throw Error("当前浏览器不支持安全确认锁，请换用支持Web Locks的浏览器；未修改方案。");
  return navigator.locks.request(`fk-personal-coach:${owner}`, () => {
    if (owner !== currentAthleteId()) throw Error("用户已切换，请重新读取");
    const result=action(personalStore());
    window.dispatchEvent(new Event('fk-personal-profile-changed'));
    return result;
  });
}
export function defaultPersonalProfile(athleteId: string): PersonalProfile {
  return {
    schema: 1,
    athleteId,
    revision: 0,
    goal: "WEIGHT_MAINTENANCE",
    services: ["NUTRITION"],
    age: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    activity: null,
    screen: "UNKNOWN",
    experience: "BEGINNER",
    days: [],
    minutes: 35,
    equipment: "NONE",
    diet: "OMNIVORE",
  };
}
export function personalAnswer(question: string, asOf: string): string | null {
  const stored = personalStore().read();
  // Plan from the shared current weight/age/sex/height, not a private copy.
  const s = stored.profile ? { ...stored, profile: withEffectivePersonal(stored.profile, readEffectiveProfile()) } : stored;
  if (!s.profile) {
    // Not enough confirmed conditions is not a reason to give nothing: draft a
    // general plan from the shared profile, clearly marked as unconfirmed. The
    // planner itself withholds numbers that depend on the missing screening.
    const effective = readEffectiveProfile();
    const goal = effective.goal && effective.goal.value !== "WEIGHT_GAIN" ? effective.goal.value : "WEIGHT_MAINTENANCE";
    const draft = withEffectivePersonal({
      ...defaultPersonalProfile(currentAthleteId()),
      goal,
      services: ["NUTRITION", "STRENGTH", "RUNNING"] as PersonalProfile["services"],
      days: [1, 3, 5],
    }, effective);
    const domain = routePersonalIntent(question, draft);
    if (!domain) return null;
    try {
      return "先按已有资料给出一般方案（尚未在“私人教练”里确认条件，以下不是你的确认事实）：\n" +
        formatPersonalPlan(buildPersonalPlan(draft, asOf, 1), domain).replace("草案需核对后确认采用；采用仅保存私人教练方案，不等于写入原训练日程。", "确认条件后可在“私人教练”里保存为正式方案；不会自动写入训练日程。");
    } catch {
      return null;
    }
  }
  const domain = routePersonalIntent(question, s.profile);
  if (!domain) return null;
  const age = Date.parse(asOf) - Date.parse(s.profileSavedAt ?? "");
  if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000)
    return "个人条件已超过30天未复核，请在私人教练面板核对并保存当前身体和健康条件，再生成具体方案。";
  const last = s.feedback.at(-1);
  if (last?.value.pain)
    return "此前反馈仍有疼痛：暂停力量和跑步建议，先评估疼痛；饮食保持规律，不以减餐补偿停训。请在私人教练面板更新实际反馈。";
  if (s.active && s.active.profileRevision === s.profile.revision)
    return formatPersonalPlan(s.active, domain).replace(
      "草案需核对后确认采用；采用仅保存私人教练方案，不等于写入原训练日程。",
      "这是已采用的本机私人教练方案；仍需按当天健康与恢复情况复核，不自动写入原训练日程。",
    );
  return formatPersonalPlan(
    buildPersonalPlan(s.profile, asOf, (s.active?.version ?? 0) + 1),
    domain,
  );
}
