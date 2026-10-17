import { loadProfile, type Profile } from "@/lib/strength/profile";
import { dispatchEvent } from "@/lib/core/events";

export const GOAL_BF_KEY = "fk-goal-bf-v1";
const PROFILE_KEY = "fr255-profile-v1";
export type BodyGoal = { kg: number; bf: number | null };

export function parseBodyGoal(kg: string, bf: string, withFat: boolean): BodyGoal | string {
  const weight = Number(kg);
  if (!kg.trim() || !Number.isFinite(weight) || weight < 35 || weight > 200) return "目标体重请输入 35–200 kg。";
  if (!withFat) return { kg: weight, bf: null };
  const fat = Number(bf);
  if (!bf.trim() || !Number.isFinite(fat) || fat <= 0 || fat >= 60) return "请填写有效的目标体脂率，或选择暂不设置。";
  return { kg: weight, bf: fat };
}

export function readGoalBodyFat(): number | null {
  try { const v = Number(localStorage.getItem(GOAL_BF_KEY)); return Number.isFinite(v) && v > 0 && v < 60 ? v : null; }
  catch { return null; }
}

/** Existing keys only. Never writes measured weight, checks, simulation or training data. */
export function persistBodyGoal(goal: BodyGoal): { ok: true; profile: Profile } | { ok: false; reason: string } {
  if (typeof parseBodyGoal(String(goal.kg), String(goal.bf ?? ""), goal.bf !== null) === "string") return { ok: false, reason: "目标格式无效，尚未保存。" };
  let before: [string | null, string | null] | undefined;
  let previous: Profile, profile: Profile;
  try {
    before = [localStorage.getItem(PROFILE_KEY), localStorage.getItem(GOAL_BF_KEY)];
    previous = loadProfile(); profile = { ...previous, targetKg: String(goal.kg) };
    if (goal.bf === null) localStorage.removeItem(GOAL_BF_KEY);
    else localStorage.setItem(GOAL_BF_KEY, String(goal.bf));
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    if (loadProfile().targetKg !== profile.targetKg || readGoalBodyFat() !== goal.bf) throw new Error("目标未能写入");
  } catch {
    let restored = true;
    if (before) for (const [key, value] of [[PROFILE_KEY, before[0]], [GOAL_BF_KEY, before[1]]] as const) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
      catch { restored = false; }
    }
    return { ok: false, reason: restored ? "保存失败，输入已保留，请重试。" : "保存未完整完成，请保留当前输入并重试。" };
  }
  // Emit the same goal events as saveProfile, only after both values are durable.
  if (previous.targetKg !== profile.targetKg) {
    try {
      dispatchEvent("GOAL_UPDATED", { aim: profile.aim, targetKg: profile.targetKg, marks: profile.marks });
      dispatchEvent("USER_MODIFIED", { field: "profile", aim: profile.aim, targetKg: profile.targetKg });
    } catch { /* Goal values are durable; journal unavailability must not roll them back. */ }
  }
  return { ok: true, profile };
}
