import { currentAthleteId, EVENTS_KEY, EVENT_JOURNAL_PREFIX } from "@/lib/core/events";
import { createPersonalStore, personalDependencyLabels } from "./store";
import { readEffectiveProfile } from "../loop/effective-host";
import { withEffectivePersonal } from "../loop/effective-profile";
import { readEffectiveTrainingProfile } from "../loop/effective-training";
import { currentStore } from "../../core/storage";
import { storeKeys } from "../../core/storage-journal";
import { RUNNING_TRANSACTION_PREFIX, validRunningTransaction } from "../../core/running-transaction";
import { sha256Hex } from "../../core/sha256-sync";
import { stableJson } from "../../health/analysis-evidence";
import { readRecoveryProjection } from "../../health/recovery-host-u11";
import { readSymptoms } from "../../health/symptom-store";
import { reviewSymptoms } from "../../health/symptom-review";
import { localDay } from "../../health/observation";
import { loadChecks } from "../../nutrition/body";
import { loadEntries } from "../../nutrition/log";
import { readScheduleDocument } from "../../ui/day-schedule";
import { profileStorageKey } from "../../strength/profile";
import { onlineNutritionFacts } from "../online-nutrition-facts";
import {
  buildPersonalPlan,
  formatPersonalPlan,
  routePersonalIntent,
  type PersonalProfile,
  type PersonalContext,
  type PersonalDependencies,
  type PersonalDependencyDomain,
} from "./planner";
/** Dependencies reuse effective projections; unrelated metrics or another athlete never enter the token. */
export function readPersonalContext(profile: PersonalProfile, asOf: string): PersonalContext {
  const owner = currentAthleteId(), day = localDay(new Date(asOf)), box = currentStore();
  const dependencies: PersonalDependencies = { schema: 1, athleteId: owner, scope: "LIVE", domains: {} };
  const fingerprint = (domain: PersonalDependencyDomain, value: unknown, sources: string[], available = true) => {
    dependencies.domains[domain] = { version: available ? sha256Hex(stableJson(value)) : null, sources };
  };
  const readable = (key: string, array = false) => {
    try { if (!box) return false; const raw = box.getItem(key); if (raw === null) return true; const value = JSON.parse(raw); return array ? Array.isArray(value) : !!value && typeof value === "object"; } catch { return false; }
  };
  let eventsReadable = !!box;
  try {
    if (!box) throw Error("NO_STORE");
    const raw = box.getItem(EVENTS_KEY);
    if (raw && !Array.isArray(JSON.parse(raw)?.data)) throw Error("BAD_EVENTS");
    for (const key of storeKeys(box).filter(key => key.startsWith(EVENT_JOURNAL_PREFIX) || key.startsWith(RUNNING_TRANSACTION_PREFIX))) {
      const entry = JSON.parse(box.getItem(key) ?? "null");
      if (entry?.schemaVersion !== 1 || !entry.data || typeof entry.id !== "string") throw Error("BAD_EVENT_SOURCE");
      if (key.startsWith(RUNNING_TRANSACTION_PREFIX) && !validRunningTransaction(entry.data)) throw Error("BAD_TRANSACTION");
    }
  } catch { eventsReadable = false; }
  const effective = readEffectiveProfile();
  let resolved = withEffectivePersonal(profile, effective);
  if (effective.goal && effective.goal.value !== "WEIGHT_GAIN") resolved = { ...resolved, goal: effective.goal.value };
  const sourceProfile = readable(profileStorageKey());
  const { revision: _revision, weightKg: _weight, sex: _sex, heightCm: _height, goal: _goal, ...conditions } = profile;
  fingerprint("PROFILE", [conditions, effective.age], ["personal-profile", "effective-profile"], sourceProfile);
  let goalDetails: unknown = null;
  try { const raw = JSON.parse(box?.getItem(profileStorageKey()) ?? "null"); goalDetails = raw ? { aim: raw.aim, targetKg: raw.targetKg, marks: raw.marks } : null; } catch { /* sourceProfile is already unknown */ }
  fingerprint("GOAL", [profile.goal, effective.goal, goalDetails], ["personal-profile", profileStorageKey()], sourceProfile);
  if (profile.services.includes("NUTRITION")) {
    const checks = loadChecks().filter(row => (row.athleteId ?? "local") === owner && row.date <= day);
    fingerprint("BODY", [effective.weightKg, effective.age, effective.sex, effective.heightCm, checks], ["effective-profile", "fr255-body-v1", EVENTS_KEY], eventsReadable && sourceProfile && readable("fr255-body-v1", true));
    const meals = loadEntries().filter(row => (row.athleteId ?? "local") === owner && row.date <= day).sort((a, b) => a.id.localeCompare(b.id));
    fingerprint("MEALS", meals, ["fr255-food-log-v1", EVENTS_KEY], eventsReadable && readable("fr255-food-log-v1", true));
  }
  try {
    const training = readRecoveryProjection(day, asOf, 90 * 24), calendar = readScheduleDocument();
    const rows = calendar.ok ? calendar.value.entries.filter(row => (row.athleteId ?? "local") === owner).sort((a, b) => a.id.localeCompare(b.id)) : [];
    fingerprint("TRAINING", [training.analysis.facts.filter(fact => fact.kind === "TRAINING").sort((a, b) => a.id.localeCompare(b.id)), rows], ["recovery-projection", "fk-schedule-v1"], eventsReadable && !training.unreadable && calendar.ok);
    const conditions = readEffectiveTrainingProfile(), symptoms = readSymptoms(asOf), constraints = reviewSymptoms(symptoms, day, 14).constraints;
    const symptomPrefix = `fk-symptoms-r5:${encodeURIComponent(owner)}:`;
    let symptomsReadable = !!box;
    try {
      if (!box) throw Error("NO_SYMPTOM_STORE");
      for (const key of storeKeys(box).filter(key => key.startsWith(symptomPrefix))) {
        const entry = JSON.parse(box?.getItem(key) ?? "null");
        if (entry?.schemaVersion !== 1 || typeof entry.id !== "string" || !Number.isFinite(entry.order) || !entry.data || entry.data.athleteId !== owner)
          throw Error("BAD_SYMPTOM_SOURCE");
      }
    } catch { symptomsReadable = false; }
    const painFeedback = createPersonalStore(window.localStorage, currentAthleteId).read().feedback.at(-1)?.value.pain ?? false;
    const active = conditions.restrictions.some(item => !/^健康筛查：UNKNOWN$/.test(item.value)) || constraints.length > 0 || training.painReviewRequired || painFeedback;
    fingerprint("RESTRICTIONS", [conditions.restrictions, symptoms, training.painReviewRequired, painFeedback], ["effective-training", symptomPrefix, "recovery-projection", "personal-feedback"], eventsReadable && sourceProfile && symptomsReadable && !training.unreadable);
    if (active) resolved = { ...resolved, screen: "PAIN" };
    else if (!dependencies.domains.RESTRICTIONS?.version) resolved = { ...resolved, screen: "UNKNOWN" };
  } catch {
    fingerprint("TRAINING", null, ["recovery-projection", "fk-schedule-v1"], false);
    fingerprint("RESTRICTIONS", null, ["effective-training", "symptom-store"], false);
    resolved = { ...resolved, screen: "UNKNOWN" };
  }
  if (owner !== profile.athleteId) throw Error("用户已切换，请重新读取");
  if (dependencies.domains.BODY && !dependencies.domains.BODY.version) resolved = { ...resolved, weightKg: null, heightCm: null, sex: null };
  const goalConflict = effective.conflicts.find(conflict => conflict.field === "goal");
  const clarification = goalConflict
    ? `当前目标在资料中不一致（${goalConflict.values.map(value => value.value).join(" / ")}），请先核对目标后再生成候选；原方案保留为历史。`
    : effective.goal?.value === "WEIGHT_GAIN" ? "共享档案的当前目标为增重；请先核对它与私人教练目标的对应关系，再生成候选。原方案保留为历史，不继续沿用旧减脂数值。" : undefined;
  return { profile: resolved, dependencies, ...(clarification ? { clarification } : {}) };
}
export function personalStore(asOf?: string) {
  if (typeof window === "undefined") throw Error("请在设备中读取");
  return createPersonalStore(window.localStorage, currentAthleteId, () => asOf ?? new Date().toISOString(), readPersonalContext);
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
  const store = personalStore(asOf), stored = store.read();
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
  const review = store.reviewActive(domain);
  if (review.active && review.clarification)
    return `已采用的版本${review.active.version}保留为历史记录，待复核。${review.clarification}`;
  if (s.active && review.status === "FRESH")
    return formatPersonalPlan(s.active, domain).replace(
      "草案需核对后确认采用；采用仅保存私人教练方案，不等于写入原训练日程。",
      "这是已采用的本机私人教练方案；仍需按当天健康与恢复情况复核，不自动写入原训练日程。",
    );
  if (review.active && review.candidate) {
    const why = review.status === "UNKNOWN" ? "原方案依据未知或来源暂不可读取" : `${review.changed.map(key => personalDependencyLabels[key]).join("、")}已变化`;
    const nutrition = domain === "NUTRITION" || domain === "ALL" && review.candidate.services.includes("NUTRITION");
    return `已采用的版本${review.active.version}保留为历史记录，待复核：${why}。以下为按当前可读资料重新评估的条件性候选，尚未采用；拒绝候选会保留原方案。\n` +
      formatPersonalPlan(review.candidate, domain) +
      (nutrition ? "\n" + onlineNutritionFacts(localDay(new Date(asOf)), asOf).summary.join("\n") : "");
  }
  return formatPersonalPlan(
    buildPersonalPlan(s.profile, asOf, (s.active?.version ?? 0) + 1),
    domain,
  );
}
