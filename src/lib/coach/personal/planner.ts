export type Goal = "FAT_LOSS" | "WEIGHT_MAINTENANCE" | "HYPERTROPHY" | "RUN_PERFORMANCE";
export type Service = "NUTRITION" | "STRENGTH" | "RUNNING";
export interface PersonalProfile {
  schema: 1;
  athleteId: string;
  revision: number;
  goal: Goal;
  services: Service[];
  age: number | null;
  sex: "male" | "female" | null;
  heightCm: number | null;
  weightKg: number | null;
  activity: "LOW" | "MODERATE" | "HIGH" | null;
  screen: "UNKNOWN" | "CLEAR" | "PAIN" | "MEDICAL";
  experience: "BEGINNER" | "TRAINED";
  days: number[];
  minutes: number;
  equipment: "NONE" | "DUMBBELLS";
  diet: "OMNIVORE" | "PLANT_BASED";
}
export interface StrengthMove {
  id: string;
  name: string;
  sets: number;
  reps: string;
  restSec: number;
  loadKg: null | "BODYWEIGHT";
  effort: string;
}
export interface PersonalPlan {
  schema: 1;
  athleteId: string;
  profileRevision: number;
  version: number;
  createdAt: string;
  goal: Goal;
  services: Service[];
  nutrition: null | {
    basis: "INITIAL_ESTIMATE";
    maintenanceKcal: [number, number] | null;
    energyKcal: [number, number] | null;
    proteinG: [number, number] | null;
    guidance: string[];
  };
  strength: { day: number; minutes: number; moves: StrengthMove[] }[];
  running: string | null;
  cautions: string[];
  sources: string[];
}
export interface Feedback {
  planVersion: number;
  completedSessions: number;
  effort: "EASY" | "OK" | "HARD";
  pain: boolean;
  adherenceDays: number;
  weightTrend: "UP" | "STABLE" | "DOWN" | "UNKNOWN";
  completeWeightWindows: boolean;
}
export type Adjustment =
  { field: "strengthSets"; delta: -1 } | { field: "energyKcal"; delta: 100 | -100 };
export interface FeedbackReview {
  status: "HOLD" | "OBSERVE" | "PROPOSE";
  message: string;
  change: Adjustment | null;
  requiresConfirmation: boolean;
}
const includes = <T extends string>(v: unknown, options: readonly T[]): v is T =>
  typeof v === "string" && options.includes(v as T);
export function validateProfile(p: PersonalProfile) {
  if (
    !p ||
    p.schema !== 1 ||
    typeof p.athleteId !== "string" ||
    !p.athleteId.trim() ||
    !Number.isInteger(p.revision) ||
    p.revision < 0
  )
    throw Error("身份或版本无效");
  if (
    !includes(p.goal, ["FAT_LOSS", "WEIGHT_MAINTENANCE", "HYPERTROPHY", "RUN_PERFORMANCE"]) ||
    !Array.isArray(p.services) ||
    !p.services.length ||
    new Set(p.services).size !== p.services.length ||
    p.services.some((s) => !includes(s, ["NUTRITION", "STRENGTH", "RUNNING"]))
  )
    throw Error("请选择目标和服务");
  for (const [value, min, max] of [
    [p.age, 12, 90],
    [p.heightCm, 120, 220],
    [p.weightKg, 35, 250],
  ] as const)
    if (value !== null && (!Number.isFinite(value) || value < min || value > max))
      throw Error("身体资料超出支持范围，请核对");
  if (
    !includes(p.screen, ["UNKNOWN", "CLEAR", "PAIN", "MEDICAL"]) ||
    !includes(p.experience, ["BEGINNER", "TRAINED"]) ||
    !includes(p.equipment, ["NONE", "DUMBBELLS"]) ||
    !includes(p.diet, ["OMNIVORE", "PLANT_BASED"]) ||
    (p.sex !== null && !includes(p.sex, ["male", "female"])) ||
    (p.activity !== null && !includes(p.activity, ["LOW", "MODERATE", "HIGH"]))
  )
    throw Error("资料选项无效");
  if (
    !Array.isArray(p.days) ||
    new Set(p.days).size !== p.days.length ||
    p.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !Number.isInteger(p.minutes) ||
    p.minutes < 15 ||
    p.minutes > 90
  )
    throw Error("可训练时间无效");
}
const round = (n: number) => Math.round(n / 10) * 10;
export function buildPersonalPlan(p: PersonalProfile, asOf: string, version = 1): PersonalPlan {
  validateProfile(p);
  if (!Number.isFinite(Date.parse(asOf)) || !Number.isInteger(version) || version < 1)
    throw Error("时间或版本无效");
  // Age is routed by condition, never narrowed: 12–90 can record, ask and get
  // general advice; only calculations without a reliable method are paused.
  const population = p.age === null ? "unknown" : p.age < 18 ? "minor" : p.age > 65 ? "older" : "adult";
  const cautions: string[] = [],
    screened = p.screen === "CLEAR",
    safe = screened && population !== "unknown";
  if (!screened)
    cautions.push(
      p.screen === "PAIN"
        ? "有疼痛：暂停训练处方，先评估疼痛。"
        : "需补齐健康筛查；疾病、用药、孕哺期或进食障碍情况请先获得专业指导。",
    );
  else if (population === "unknown")
    cautions.push("年龄未填：先给一般原则；补充年龄后再给热量、蛋白等精确数值。");
  if (population === "minor")
    cautions.push("未成年人：给出一般饮食与训练原则；成人热量和蛋白公式不适用，精确数值暂停；力量训练需在监护人知情和教练指导下进行，不做最大重量测试。");
  if (population === "older")
    cautions.push("65岁以上：热量和蛋白按一般成人估算，仅作起点；慢病、用药或肾功能情况请先与医生确认，训练进阶放慢。");
  const underweight =
    p.weightKg !== null && p.heightCm !== null && p.weightKg / (p.heightCm / 100) ** 2 < 18.5;
  if (underweight && p.goal === "FAT_LOSS") cautions.push("体重偏低，不提供减脂热量目标。");
  let nutrition: PersonalPlan["nutrition"] = null;
  if (p.services.includes("NUTRITION")) {
    let maintenanceKcal: [number, number] | null = null,
      energyKcal: [number, number] | null = null;
    if (
      safe &&
      p.age !== null &&
      population !== "minor" &&
      p.sex &&
      p.heightCm !== null &&
      p.weightKg !== null &&
      p.activity
    ) {
      const rest = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
      const factor = { LOW: 1.2, MODERATE: 1.45, HIGH: 1.65 }[p.activity],
        estimate = rest * factor;
      maintenanceKcal = [round(estimate * 0.95), round(estimate * 1.05)];
      const deficit = p.goal === "FAT_LOSS" && !p.services.includes("RUNNING") && !underweight;
      const surplus = p.goal === "HYPERTROPHY" && p.services.includes("STRENGTH");
      energyKcal = underweight
        ? null
        : deficit
          ? [round(estimate * 0.9), round(estimate * 0.95)]
          : surplus
            ? [round(estimate * 1.05), round(estimate * 1.1)]
            : [...maintenanceKcal];
      // Product support boundary, not a universal medical minimum.
      if (rest < 1000 || (energyKcal && energyKcal[0] < 1200)) energyKcal = null;
    }
    const exercising = p.services.includes("STRENGTH") || p.services.includes("RUNNING");
    nutrition = {
      basis: "INITIAL_ESTIMATE",
      maintenanceKcal,
      energyKcal,
      proteinG:
        safe && population !== "minor" && p.weightKg !== null && exercising
          ? [round(p.weightKg * 1.4), round(p.weightKg * 2)]
          : null,
      guidance: [
        "先规律吃饭：每餐安排蔬菜、主食和蛋白来源，按饥饿感与实际记录复核份量。",
        p.diet === "PLANT_BASED"
          ? "蛋白来源优先考虑豆类、豆腐和其他适合自己的植物蛋白；纯素饮食需关注维生素B12。"
          : "蛋白来源可选豆类、蛋、奶、鱼或瘦肉，按个人耐受替换。",
        ...(population === "minor" ? ["生长期优先保证规律三餐和足够总量，训练前后各有一次含主食和蛋白的加餐；不节食减重。"] : []),
        "食物过敏、禁忌和用药未逐项核验，不生成保证适用的具体食谱。",
        "热量是起始估计，不是测得的消耗；不按手表热量自动加餐，不用缺失餐次计算缺口，不承诺减重期限。",
      ],
    };
    if (!energyKcal)
      nutrition.guidance.push("当前只提供饮食结构建议；精确目标所需资料或健康条件尚不满足。");
    if (p.goal === "FAT_LOSS" && p.services.includes("RUNNING"))
      cautions.push(
        "减脂与跑步同时进行：暂以维持能量为起点，先核对跑量、恢复与供能，避免削减关键课供能。",
      );
  }
  const strength: PersonalPlan["strength"] = [];
  if (p.services.includes("STRENGTH") && safe) {
    const selected: number[] = [];
    for (const d of [...p.days].sort((a, b) => a - b)) {
      if (selected.length >= 2) break;
      if (selected.every((x) => Math.min(Math.abs(x - d), 7 - Math.abs(x - d)) >= 2))
        selected.push(d);
    }
    if (!selected.length) cautions.push("尚未选择力量训练日期。");
    if (selected.length < 2)
      cautions.push("目前只能安排一次力量训练；可增加不相邻日期后重新评估。");
    const db = p.equipment === "DUMBBELLS",
      sets = p.minutes < 25 ? 1 : p.experience === "TRAINED" && p.minutes >= 45 ? 3 : 2;
    const moves: StrengthMove[] = [
      {
        id: db ? "db-squat" : "personal-bodyweight-squat",
        name: db ? "哑铃深蹲" : "徒手深蹲",
        sets,
        reps: "8–12次",
        restSec: 90,
        loadKg: db ? null : "BODYWEIGHT",
        effort: "动作稳定，保留约3次余力；初次先学习动作",
      },
      {
        id: "pushup",
        name: "俯卧撑（可改墙面或高支撑）",
        sets,
        reps: "6–12次",
        restSec: 90,
        loadKg: "BODYWEIGHT",
        effort: "保留约3次余力",
      },
      {
        id: db ? "db-row" : "glute-bridge",
        name: db ? "单臂哑铃划船（每侧）" : "臀桥",
        sets,
        reps: "8–12次",
        restSec: 90,
        loadKg: db ? null : "BODYWEIGHT",
        effort: "保留约3次余力；无疼痛范围",
      },
      {
        id: "dead-bug",
        name: "死虫式（每侧）",
        sets: 1,
        reps: "6–8次",
        restSec: 60,
        loadKg: "BODYWEIGHT",
        effort: "缓慢控制，保持自然呼吸",
      },
    ];
    for (const day of selected)
      strength.push({
        day,
        minutes: p.minutes,
        moves: moves.slice(0, p.minutes < 25 ? 3 : 4).map((m) => ({ ...m })),
      });
    if (!db) cautions.push("当前无拉类器械，背部拉类训练尚不完整；补充合适器械或指导后再完善。");
    cautions.push(
      "这是保守起始模板，不是已验证的最佳增肌剂量；未知哑铃重量须先试练确认，不自动加重。",
    );
    if (p.services.includes("RUNNING"))
      cautions.push(
        "力量日期仅为可用时段草案；需在训练模型工具核对关键跑课，冲突时优先保留主目标。",
      );
  }
  return {
    schema: 1,
    athleteId: p.athleteId,
    profileRevision: p.revision,
    version,
    createdAt: asOf,
    goal: p.goal,
    services: [...p.services],
    nutrition,
    strength,
    running: p.services.includes("RUNNING")
      ? "使用下方“训练模型与课表候选”读取真实阈值、现有课程与恢复证据；缺证据不生成专项配速。"
      : null,
    cautions,
    sources: [
      "https://pubmed.ncbi.nlm.nih.gov/2305711/",
      "https://doi.org/10.1186/s12970-017-0177-8",
      "https://acsm.org/resistance-training-guidelines-update-2026/",
      "https://doi.org/10.1136/bjsports-2023-106994",
    ],
  };
}
export function routePersonalIntent(q: string, p: PersonalProfile): Service | "ALL" | null {
  if (/复盘|昨天|前天|记录|实际摄入|什么是|解释|文献|证据/.test(q)) return null;
  if (/整体方案|完整方案|私人教练|我的目标/.test(q)) return "ALL";
  const positive = q.replace(
    /(?:不想|不要|不用|别说|不)(?:再|去|说|做)?(?:减肥|减脂|饮食|训练|力量|健身)/g,
    "",
  );
  const nutrition = /饮食|吃什么|热量|蛋白|控制体重|减肥|减脂|增肌/.test(positive);
  const strength =
    /力量|练腿|练胸|哑铃|健身|增肌/.test(positive) &&
    !/(?:不|不要|不用|不想)(?:做|练)?(?:训练|力量|健身)/.test(q);
  if (nutrition && p.services.includes("NUTRITION") && strength && p.services.includes("STRENGTH"))
    return "ALL";
  if (nutrition && p.services.includes("NUTRITION")) return "NUTRITION";
  if (strength && p.services.includes("STRENGTH")) return "STRENGTH";
  return null;
}
export function reviewFeedback(plan: PersonalPlan, f: Feedback): FeedbackReview {
  if (
    !f ||
    f.planVersion !== plan.version ||
    !Number.isInteger(f.completedSessions) ||
    f.completedSessions < 0 ||
    f.completedSessions > 100 ||
    !Number.isInteger(f.adherenceDays) ||
    f.adherenceDays < 0 ||
    f.adherenceDays > 365 ||
    !includes(f.effort, ["EASY", "OK", "HARD"]) ||
    !includes(f.weightTrend, ["UP", "DOWN", "STABLE", "UNKNOWN"]) ||
    typeof f.pain !== "boolean" ||
    typeof f.completeWeightWindows !== "boolean"
  )
    throw Error("反馈与当前方案不匹配或无效");
  if (f.pain)
    return {
      status: "HOLD",
      message: "有疼痛：暂停执行力量与跑步建议，先评估；不以减餐补偿停训。",
      change: null,
      requiresConfirmation: false,
    };
  if (
    f.effort === "HARD" &&
    f.completedSessions >= 2 &&
    plan.strength.some((s) => s.moves.some((m) => m.sets > 1))
  )
    return {
      status: "PROPOSE",
      message: "连续训练感觉过难：只建议每个多组动作减少1组，其他变量保持。确认后才生效。",
      change: { field: "strengthSets", delta: -1 },
      requiresConfirmation: true,
    };
  // Self-reported trend is useful context, but not a verified longitudinal body-mass dataset.
  return {
    status: "OBSERVE",
    message: "先保持并补充记录。单日体重、缺失饮食和自报趋势不足以自动调整热量；轻松也不自动加重。",
    change: null,
    requiresConfirmation: false,
  };
}
export function formatPersonalPlan(p: PersonalPlan, domain: Service | "ALL" = "ALL") {
  const lines = [`私人教练草案 · ${goalNames[p.goal]} · 版本${p.version}`];
  if ((domain === "ALL" || domain === "NUTRITION") && p.nutrition) {
    const n = p.nutrition;
    lines.push(
      "饮食：" +
        (n.energyKcal
          ? `起始估计 ${n.energyKcal[0]}–${n.energyKcal[1]} kcal/天。`
          : "先调整饮食结构，暂不设热量目标。"),
    );
    if (n.proteinG)
      lines.push(`适用于健康运动成人的蛋白参考 ${n.proteinG[0]}–${n.proteinG[1]} g/天。`);
    lines.push(...n.guidance);
  }
  if (domain === "ALL" || domain === "STRENGTH")
    for (const s of p.strength)
      lines.push(
        `周${"日一二三四五六"[s.day]} · 预留${s.minutes}分钟（含热身）：` +
          s.moves
            .map(
              (m) =>
                `${m.name} ${m.sets}组×${m.reps}，休息${m.restSec}秒${m.loadKg === null ? "，重量待试练确认" : ""}`,
            )
            .join("；"),
      );
  if ((domain === "ALL" || domain === "RUNNING") && p.running) lines.push(p.running);
  lines.push(...p.cautions, "草案需核对后确认采用；采用仅保存私人教练方案，不等于写入原训练日程。");
  return lines.join("\n");
}
export const goalNames: Record<Goal, string> = {
  FAT_LOSS: "减脂",
  WEIGHT_MAINTENANCE: "控制体重",
  HYPERTROPHY: "增肌健身",
  RUN_PERFORMANCE: "跑步表现",
};
