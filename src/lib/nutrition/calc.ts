import { daysUntil } from "@/lib/strength/agent";
import { loadProfile, type Profile } from "@/lib/strength/profile";
import { loadDay, runSummary } from "./day";
import { energyBasis } from "./energy-source";
import { bodyLine } from "./body";
import { todayEaten } from "./log";

export type Aim = "lose" | "keep" | "gain";
export type Activity = "desk" | "light" | "run" | "hard";

export type NutritionPlan = {
  bmr: number;
  maintain: number;
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  weeklyKg: number;
  aim: Aim;
  /** Case-specific adjustments that were applied, shown next to the numbers. */
  notes?: string[];
};

const FACTOR: Record<Activity, number> = { desk: 1.2, light: 1.375, run: 1.55, hard: 1.725 };

/** Recording, questions and general advice cover the full 12–80 profile range.
 * Only the precise adult energy estimate is paused where its formula does not
 * apply; everything else in the diet and coach features keeps working. */
export type NutritionPlanGate =
  | { plan: NutritionPlan; paused: null }
  | { plan: null; paused: "INCOMPLETE" | "OUT_OF_RANGE" | "MINOR"; reason: string };

/** The minimum target never drops below this or below the estimated BMR. */
const ENERGY_FLOOR_KCAL = 1200;
/** A deadline never justifies a deficit above this share of maintenance. */
const MAX_DEFICIT_SHARE = 0.2;

export function nutritionPlanGate(profile: Profile): NutritionPlanGate {
  const kg = Number(profile.weightKg);
  const cm = Number(profile.heightCm);
  const age = Number(profile.age);
  if (profile.sex !== "female" && profile.sex !== "male")
    return { plan: null, paused: "INCOMPLETE", reason: "填写性别、年龄、身高和体重后可估算每日营养目标。" };
  if (!(kg >= 35 && kg <= 200) || !(cm >= 120 && cm <= 220) || !(age >= 12 && age <= 80))
    return { plan: null, paused: "OUT_OF_RANGE", reason: "身体资料超出现有估算公式的适用范围；可以继续记录和提问，精确热量目标暂不计算。" };
  if (age < 18)
    return { plan: null, paused: "MINOR", reason: "未成年人仍在生长发育，成人代谢公式不适用：暂停精确热量目标，规律三餐、训练前后补给等一般建议照常提供；具体目标请与监护人和专业人员一起确定。" };

  const notes: string[] = [];
  const fat = Number(profile.bodyFat);
  const bmr = fat >= 3 && fat <= 60 ? 370 + 21.6 * kg * (1 - fat / 100) : 10 * kg + 6.25 * cm - 5 * age + (profile.sex === "male" ? 5 : -161);
  const maintain = bmr * FACTOR[profile.activity || "run"];
  let aim: Aim = profile.aim || "keep";
  const bmi = kg / (cm / 100) ** 2;
  if (aim === "lose" && bmi < 18.5) {
    aim = "keep";
    notes.push(`BMI ${bmi.toFixed(1)} 低于 18.5：不提供减重热量缺口，按维持估算；如需减重请先咨询专业人员。`);
  }
  if (age > 65) notes.push("65岁以上：估算按一般成人公式，仅作参考；蛋白和训练量请结合健康状况与医生建议。");
  const target = Number(profile.targetKg);
  const weeks = profile.weeks || 12;
  let daily = aim === "lose" ? -400 : aim === "gain" ? 300 : 0;
  const aimed = target >= 35 && target <= 200 && weeks >= 2;
  const directionOk = !aimed || (aim === "lose" && target < kg) || (aim === "gain" && target > kg) || aim === "keep";
  if (aimed && directionOk && aim !== "keep") daily = ((target - kg) / weeks) * 7700 / 7;
  if (aim === "lose") {
    const cap = Math.min(900, maintain * MAX_DEFICIT_SHARE);
    if (-daily > cap) notes.push(`期限要求的缺口过大，已限制在维持热量的 ${Math.round(MAX_DEFICIT_SHARE * 100)}% 以内；按期达成需要更长时间。`);
    daily = clamp(daily, -cap, -Math.min(200, cap));
  }
  if (aim === "gain") daily = clamp(daily, 200, 500);
  if (aim === "keep") daily = 0;

  let kcal = Math.round(maintain + daily);
  const floor = Math.round(Math.max(ENERGY_FLOOR_KCAL, bmr));
  if (aim === "lose" && kcal < floor) {
    kcal = Math.min(Math.round(maintain), floor);
    daily = kcal - maintain;
    notes.push(`目标不低于 ${floor} 千卡（估算基础代谢与安全下限中较高者），减重速度相应放慢。`);
  }
  const protein = Math.round(kg * (aim === "gain" ? 1.8 : 1.6));
  const fatG = Math.round(kg * 0.8);
  const carb = Math.max(0, Math.round((kcal - protein * 4 - fatG * 9) / 4));
  const plan: NutritionPlan = { bmr: Math.round(bmr), maintain: Math.round(maintain), kcal, protein, fat: fatG, carb, weeklyKg: (daily * 7) / 7700, aim, ...(notes.length ? { notes } : {}) };
  return { plan, paused: null };
}

export function computePlan(profile: Profile): NutritionPlan | null {
  return nutritionPlanGate(profile).plan;
}

export function aimLabel(aim: Aim): string {
  if (aim === "lose") return "减重";
  if (aim === "gain") return "增重";
  return "维持";
}

export function activityLabel(activity: Activity): string {
  if (activity === "desk") return "很少动";
  if (activity === "light") return "一周轻松动几次";
  if (activity === "hard") return "训练很多";
  return "有跑步";
}

export function soonestDeadline(profile: Profile): number | null {
  const days = profile.marks.map((mark) => daysUntil(mark.deadline)).filter((day): day is number => day !== null);
  if (days.length === 0) return null;
  return Math.min(...days);
}

export function todayEatTarget(plan: { kcal: number; maintain: number }): number {
  return energyBasis(plan.kcal, plan.maintain, loadDay().burn).targetKcal ?? plan.kcal;
}

export function energyContext(): string {
  const profile = loadProfile();
  const plan = computePlan(profile);
  const day = loadDay();
  const eaten = todayEaten();
  const run = runSummary(day);
  const soon = soonestDeadline(profile);
  return [
    plan ? `${aimLabel(plan.aim)}，公式大约 ${plan.kcal} 千卡` : "",
    day.burn ? `运动设备总消耗 ${day.burn}，今天目标吃 ${plan ? todayEatTarget(plan) : day.burn}` : "",
    eaten > 0 ? `今天吃了 ${Math.round(eaten)} 千卡` : "",
    run ? `跑步：${run}` : "",
    bodyLine(),
    soon !== null ? `最近的成绩期限还有 ${soon} 天` : "",
  ]
    .filter(Boolean)
    .join("，");
}

export function energySentence(band: string): string {
  const profile = loadProfile();
  const plan = computePlan(profile);
  if (!plan) return "";
  const tired = band === "tired" || band === "cooked";
  if (!tired) return "";
  const parts: string[] = [];
  if (plan.aim === "lose") parts.push("减重有缺口，同样的课会更沉，力量不加");
  if (plan.aim === "gain") parts.push("就算在增重，疲劳高也不加重力量");
  const target = todayEatTarget(plan);
  const eaten = todayEaten();
  if (eaten > 0 && eaten < target * 0.75) parts.push("今天吃得比目标少一截，掉速先别当成能力不够");
  const run = runSummary();
  if (run) parts.push(`今天的跑步是${run}`);
  const soon = soonestDeadline(profile);
  if (soon !== null && soon <= 28) parts.push(soon < 0 ? "有成绩期限已经过了，目标先不改" : `最近的期限还有 ${soon} 天，这周也不加重`);
  return parts.length ? `${parts.join("。")}。` : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
