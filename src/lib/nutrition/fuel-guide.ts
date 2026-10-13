/**
 * 方坤“怎么吃”：按当天已确认的训练安排给出碳水/蛋白/补水与时机建议。
 * 数值只取自以下立场声明，未给数值的地方标【经验规则】，不另造数字：
 *  [ACSM2016] Thomas DT, Erdman KA, Burke LM. Nutrition and Athletic Performance. Med Sci Sports Exerc. 2016;48(3):543–568（ACSM/营养与饮食学会/加拿大营养师联合立场）
 *  [ISSN2017P] Jäger R, et al. ISSN Position Stand: protein and exercise. JISSN 2017;14:20
 *  [ISSN2017T] Kerksick CM, et al. ISSN Position Stand: nutrient timing. JISSN 2017;14:33
 *  [IOC2023] Mountjoy M, et al. 2023 IOC consensus statement on REDs. BJSM 2023;57:1073–1098
 */
export type Evidence = "【证据】" | "【共识】" | "【经验规则】"
export type DayType = "rest" | "light" | "moderate" | "high"
export type SessionLite = { title: string; modality: "run" | "strength" | "rest"; minutes: number; intensity: "EASY" | "MODERATE" | "HARD" }
export type Tip = { text: string; tag: Evidence; cite?: string }

export const DAY_LABEL: Record<DayType, string> = { rest: "休息日", light: "轻量日", moderate: "中等训练日", high: "大训练量日" }
// [ACSM2016] 碳水 g/kg/天：轻强度 3–5；中等（约 1 h/天）5–7；高训练量（1–3 h/天中高强度）6–10。休息日沿用 3–5 属外推。
export const CARB_RANGE: Record<DayType, [number, number]> = { rest: [3, 5], light: [3, 5], moderate: [5, 7], high: [6, 10] }

export function dayType(sessions: SessionLite[]): DayType {
  const live = sessions.filter((s) => s.modality !== "rest")
  if (!live.length) return "rest"
  const mins = live.reduce((a, s) => a + s.minutes, 0)
  if (mins >= 90 || (mins >= 60 && live.some((s) => s.intensity === "HARD"))) return "high"
  if (mins >= 45 || live.some((s) => s.intensity === "HARD")) return "moderate"
  return "light"
}

export type DailyTargets = { type: DayType; carbG: [number, number]; carbPerKg: [number, number]; proteinG: number; proteinPerMeal: number; meals: number; tips: Tip[] }
export function dailyTargets(weightKg: number, sessions: SessionLite[]): DailyTargets | null {
  if (!(weightKg >= 30 && weightKg <= 250)) return null
  const type = dayType(sessions)
  const [lo, hi] = CARB_RANGE[type]
  const protein = Math.round(weightKg * 1.6) // ISSN 1.4–2.0、ACSM 1.2–2.0 g/kg/天 范围内取 1.6
  const perMeal = Math.round(weightKg * 0.3) // ACSM2016：约 0.3 g/kg，每 3–5 小时一次
  return {
    type, carbPerKg: [lo, hi], carbG: [Math.round(lo * weightKg), Math.round(hi * weightKg)], proteinG: protein, proteinPerMeal: perMeal, meals: Math.max(3, Math.min(5, Math.round(protein / Math.max(perMeal, 1)))),
    tips: [
      { text: `碳水 ${lo}–${hi} g/kg（${DAY_LABEL[type]}），训练多的日子多吃主食，休息日少一些。`, tag: type === "rest" ? "【经验规则】" : "【共识】", cite: "ACSM 2016" },
      { text: `蛋白约 1.6 g/kg，分 ${Math.max(3, Math.min(5, Math.round(protein / Math.max(perMeal, 1))))} 次吃，每次约 ${perMeal} g，比一顿吃完更好。`, tag: "【共识】", cite: "ISSN 2017 蛋白立场；ACSM 2016" },
    ],
  }
}

/** 某节课前/中/后怎么吃（只引用立场声明给出的数值）。 */
export function sessionTiming(s: SessionLite, weightKg: number | null, nextSessionWithinHours: number | null = null): { before: Tip[]; during: Tip[]; after: Tip[] } {
  const kg = weightKg && weightKg >= 30 ? weightKg : null
  const before: Tip[] = [
    { text: kg ? `开练前 1–4 小时吃一顿以碳水为主的正餐（约 ${Math.round(kg)}–${Math.round(kg * 4)} g 碳水，越接近开练吃得越少）。` : "开练前 1–4 小时吃一顿以碳水为主的正餐，越接近开练吃得越少。", tag: "【共识】", cite: "ACSM 2016：1–4 g/kg，训练前 1–4 h" },
    { text: "来不及吃正餐：提前 30–60 分钟吃根香蕉或一片面包，少油少纤维，避免肠胃不适。", tag: "【经验规则】" },
  ]
  if (kg) before.push({ text: `开练前约 4 小时喝 ${Math.round(kg * 5)}–${Math.round(kg * 7)} ml 水。`, tag: "【共识】", cite: "ACSM 2016：5–7 ml/kg" })
  const during: Tip[] = s.minutes >= 60
    ? [{ text: "超过 1 小时：每小时补 30–60 g 碳水（如能量胶 1–2 支、运动饮料），少量多次喝水，别让体重掉超过 2%。", tag: "【共识】", cite: "ACSM 2016" }]
    : [{ text: "1 小时以内：一般喝水就够，不需要额外补碳水。", tag: "【共识】", cite: "ACSM 2016" }]
  const after: Tip[] = [
    { text: kg ? `练完 2 小时内吃一餐含约 ${Math.round(kg * 0.3)} g 蛋白 + 主食的饭。` : "练完 2 小时内吃一餐含蛋白（约 0.3 g/kg）+ 主食的饭。", tag: s.modality === "strength" ? "【证据】" : "【共识】", cite: "ISSN 2017 蛋白/时机立场；ACSM 2016" },
    { text: "称一下练前练后体重：每少 1 kg，慢慢补 1.25–1.5 L 水（可加点盐）。", tag: "【共识】", cite: "ACSM 2016" },
  ]
  if (nextSessionWithinHours != null && nextSessionWithinHours < 8 && kg) after.unshift({ text: `距下一节不到 8 小时：练完头 4 小时每小时补约 ${Math.round(kg)}–${Math.round(kg * 1.2)} g 碳水，尽快恢复糖原。`, tag: "【共识】", cite: "ACSM 2016：1.0–1.2 g/kg/h" })
  return { before, during, after }
}

/** 食堂/外卖怎么选（具体菜品属经验举例，不给虚构热量）。 */
export const MEAL_EXAMPLES: Record<DayType, { scene: string; pick: string }[]> = {
  rest: [{ scene: "食堂", pick: "半碗到一碗米饭 + 一份瘦肉或豆腐 + 两份蔬菜" }, { scene: "外卖", pick: "清炒/蒸菜套餐，主食少半份，加一份青菜" }, { scene: "早餐", pick: "鸡蛋 1–2 个 + 牛奶或豆浆 + 一个包子" }],
  light: [{ scene: "食堂", pick: "一碗米饭 + 鸡腿/鱼 + 一份蔬菜" }, { scene: "外卖", pick: "牛肉饭或鸡腿饭，加一份青菜" }, { scene: "早餐", pick: "鸡蛋 + 牛奶 + 全麦面包或燕麦" }],
  moderate: [{ scene: "食堂", pick: "一碗多米饭 + 一份肉 + 一份豆制品 + 蔬菜" }, { scene: "外卖", pick: "牛肉面/盖浇饭（主食别减），加个卤蛋" }, { scene: "练后加餐", pick: "牛奶或酸奶 + 香蕉/面包" }],
  high: [{ scene: "食堂", pick: "两碗米饭或米饭+馒头 + 两份荤菜 + 蔬菜" }, { scene: "外卖", pick: "盖浇饭加饭 + 一杯豆浆/牛奶" }, { scene: "加餐", pick: "上午、下午各一次：面包、香蕉、酸奶" }],
}

export type FuelFlag = { level: "info" | "warn" | "refer"; text: string; tag: Evidence; cite?: string }
/**
 * 温和提示，不诊断。低能量可用性（REDs）由运动医学医生判断 [IOC2023]，方坤只“识别线索 → 建议就医 → 不加量”。
 */
export function fuelFlags(input: { targetKcal: number | null; bmr: number | null; aim: "lose" | "keep" | "gain" | null; dayType: DayType; loggedDays: { kcal: number; trainingDay: boolean }[]; weekWeightDeltaKg: number | null; signs: { frequentIllness?: boolean; boneStress?: boolean; missedPeriods?: boolean; persistentFatigue?: boolean } }): FuelFlag[] {
  const out: FuelFlag[] = []
  if (input.targetKcal != null && input.bmr != null && input.targetKcal < input.bmr) out.push({ level: "warn", text: "热量目标低于估算基础代谢，缺口太大：建议把减重速度放慢。", tag: "【经验规则】" })
  if (input.aim === "lose" && input.dayType === "high") out.push({ level: "info", text: "今天训练量大：今天别刻意少吃，把热量缺口放到休息日。", tag: "【经验规则】" })
  const lowTrainDays = input.bmr ? input.loggedDays.filter((d) => d.trainingDay && d.kcal > 0 && d.kcal < input.bmr!).length : 0
  if (lowTrainDays >= 3) out.push({ level: "warn", text: `最近 ${lowTrainDays} 个训练日记录的摄入低于基础代谢（可能没记全）。长期吃不够会影响恢复和表现。`, tag: "【经验规则】" })
  if (input.aim !== "lose" && input.weekWeightDeltaKg != null && input.weekWeightDeltaKg <= -1) out.push({ level: "warn", text: "没打算减重，但最近一周均重下降约 1 kg 以上，留意是否吃得不够。", tag: "【经验规则】" })
  const s = input.signs
  const hits = [s.missedPeriods && "月经不规律或停经", s.boneStress && "骨应力损伤/骨头上一点按压痛", s.frequentIllness && "频繁生病", s.persistentFatigue && "持续疲劳、表现下滑"].filter(Boolean) as string[]
  if (hits.length) out.push({ level: "refer", text: `出现${hits.join("、")}：可能与长期能量不足有关，建议看运动医学医生评估。方坤不做诊断，期间不加量。`, tag: "【共识】", cite: "IOC 2023 REDs 共识" })
  return out
}

/** 主页每天 1–3 条“怎么吃”。 */
export function homeTips(t: DailyTargets | null, sessions: SessionLite[], flags: FuelFlag[]): Tip[] {
  const tips: Tip[] = []
  const refer = flags.find((f) => f.level === "refer"); if (refer) tips.push({ text: refer.text, tag: refer.tag, cite: refer.cite })
  const main = sessions.filter((s) => s.modality !== "rest").sort((a, b) => b.minutes - a.minutes)[0]
  if (main) {
    const tm = sessionTiming(main, null)
    tips.push({ ...tm.before[0], text: `「${main.title}」前：${tm.before[0].text}` })
    tips.push(main.minutes >= 60 ? tm.during[0] : tm.after[0])
  } else if (t) tips.push(t.tips[1])
  if (t && tips.length < 3) tips.push(t.tips[0])
  return tips.slice(0, 3)
}

export const QUICK_FOODS = ["米饭一碗", "鸡蛋2个", "牛奶250ml", "豆浆一杯", "包子2个", "面条一碗", "鸡胸肉150g", "香蕉1根", "酸奶1杯", "全麦面包2片", "番茄炒蛋", "牛肉面一碗"]
export function mealByHour(h: number): "早餐" | "午餐" | "晚餐" | "加餐" { return h < 10 ? "早餐" : h < 14 ? "午餐" : h >= 17 && h < 21 ? "晚餐" : "加餐" }

/* ---------------- 目标：增肌 / 减脂 / 保持 / 跑步表现 ---------------- */
export type FuelGoal = "gain" | "cut" | "keep" | "run"
export const GOAL_LABEL: Record<FuelGoal, string> = { gain: "增肌", cut: "减脂", keep: "保持", run: "跑步表现" }
export const GOAL_AIM: Record<FuelGoal, "gain" | "lose" | "keep"> = { gain: "gain", cut: "lose", keep: "keep", run: "keep" }
/** 每周体重变化参考（占体重 %）。来源：Helms 2014（减脂 0.5–1%/周）、Iraki 2019（自然增肌约 0.25–0.5%/周），均为基于有限研究的建议 →【经验规则】。 */
export const RATE_PCT: Record<FuelGoal, [number, number] | null> = { cut: [-1, -0.5], gain: [0.25, 0.5], keep: null, run: null }

export type GoalTargets = DailyTargets & { goal: FuelGoal; proteinPerKg: number; goalTips: Tip[] }
export function goalTargets(goal: FuelGoal, weightKg: number, sessions: SessionLite[], servingAdjust = 0): GoalTargets | null {
  const base = dailyTargets(weightKg, sessions)
  if (!base) return null
  const proteinPerKg = goal === "cut" ? 2.0 : 1.6
  const [lo, hi] = base.carbPerKg
  // 减脂取范围下端、增肌取上端：在 ACSM 范围内按目标取值【经验规则】
  const carbPerKg: [number, number] = goal === "cut" ? [lo, Math.round((lo + hi) / 2)] : goal === "gain" ? [Math.round((lo + hi) / 2), hi] : [lo, hi]
  const proteinG = Math.round(weightKg * proteinPerKg)
  const goalTips: Tip[] = []
  if (goal === "cut") goalTips.push({ text: "减脂期蛋白取范围上限约 2.0 g/kg，帮助保住肌肉。", tag: "【共识】", cite: "ISSN 2017 蛋白立场（1.4–2.0 g/kg，热量不足时可更高）" }, { text: "缺口要温和：每周掉体重的 0.5–1% 以内；大训练日别刻意少吃。", tag: "【经验规则】", cite: "Helms 2014" })
  if (goal === "gain") goalTips.push({ text: "增肌每天约 1.6 g/kg 蛋白，分 4–5 次吃，每次约 0.3 g/kg；超过 1.6 收益很小。", tag: "【证据】", cite: "Morton 2018 Meta 分析；ACSM 2016" }, { text: "小幅热量盈余，体重每周涨 0.25–0.5% 左右，涨太快多半是脂肪。", tag: "【经验规则】", cite: "Iraki 2019" })
  if (goal === "run") goalTips.push({ text: "按课吃碳水：强度课/长距离日多吃主食，轻松日和休息日少一些。", tag: "【共识】", cite: "ACSM 2016；IOC 运动营养共识 2011" })
  if (goal === "keep") goalTips.push({ text: "保持体重：按饥饿感和训练量调整，周均体重稳定就说明吃得合适。", tag: "【经验规则】" })
  if (servingAdjust) goalTips.push({ text: `你已接受调整：每天${servingAdjust > 0 ? "多" : "少"} ${Math.abs(servingAdjust)} 份主食（约一拳头米饭）。`, tag: "【经验规则】" })
  return { ...base, goal, proteinPerKg, proteinG, carbPerKg, carbG: [Math.round(carbPerKg[0] * weightKg), Math.round(carbPerKg[1] * weightKg)], goalTips }
}

/** 每周体重趋势 vs 目标 → 温和建议（用户确认后才生效）。 */
export type TrendAdvice = { status: "ok" | "fast" | "slow" | "unknown"; text: string; tag: Evidence; cite?: string; adjust: -1 | 0 | 1 }
export function weightTrendAdvice(goal: FuelGoal, weightKg: number | null, weekDeltaKg: number | null): TrendAdvice {
  const range = RATE_PCT[goal]
  if (weightKg == null || weekDeltaKg == null) return { status: "unknown", text: "至少两周的体重记录才能看趋势，建议每周固定时间称 2–3 次。", tag: "【经验规则】", adjust: 0 }
  const pct = Math.round((weekDeltaKg / weightKg) * 1000) / 10
  const line = `近一周均重变化 ${weekDeltaKg > 0 ? "+" : ""}${Math.round(weekDeltaKg * 10) / 10} kg（${pct > 0 ? "+" : ""}${pct}%）`
  if (!range) return Math.abs(pct) >= 1 ? { status: pct < 0 ? "fast" : "slow", text: `${line}，没打算改变体重却变化较大：${pct < 0 ? "可能吃少了，建议每天多 1 份主食" : "可以每天少 1 份主食或零食"}。`, tag: "【经验规则】", adjust: pct < 0 ? 1 : -1 } : { status: "ok", text: `${line}，基本稳定。`, tag: "【经验规则】", adjust: 0 }
  const [lo, hi] = range
  const cite = goal === "cut" ? "Helms 2014" : "Iraki 2019"
  if (pct < lo) return { status: "fast", text: `${line}，${goal === "cut" ? "掉得偏快，容易掉肌肉和影响训练" : "低于目标"}：建议每天多 1 份主食。`, tag: "【经验规则】", cite, adjust: 1 }
  if (pct > hi) return { status: goal === "cut" ? "slow" : "fast", text: `${line}，${goal === "cut" ? "几乎没降" : "涨得偏快，多半是脂肪"}：建议每天少 1 份主食或零食。`, tag: "【经验规则】", cite, adjust: -1 }
  return { status: "ok", text: `${line}，在目标范围内，继续保持。`, tag: "【经验规则】", cite, adjust: 0 }
}

export const GOAL_EXAMPLES: Partial<Record<FuelGoal, { scene: string; pick: string }[]>> = {
  cut: [{ scene: "食堂", pick: "半碗到一碗米饭 + 鱼/鸡胸/豆腐一大份 + 两份蔬菜，少选油炸和勾芡" }, { scene: "外卖", pick: "轻食饭、清蒸/白灼套餐；麻辣烫选清汤，多菜多豆腐少丸子" }, { scene: "加餐", pick: "无糖酸奶、鸡蛋、水果，代替饼干奶茶" }],
  gain: [{ scene: "食堂", pick: "一碗半米饭 + 两份荤菜（一份红肉）+ 蔬菜 + 一个鸡蛋" }, { scene: "外卖", pick: "牛肉饭加饭加蛋 + 一杯牛奶" }, { scene: "加餐", pick: "练后牛奶/酸奶 + 香蕉或面包；睡前一杯牛奶" }],
}
