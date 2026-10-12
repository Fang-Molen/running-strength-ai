import { exerciseById, type CatalogExercise } from "./catalog";
import { dispatchEvent } from "@/lib/core/events";

export type EffortMode = "reps" | "seconds";

export type Move = {
  id: string;
  catalogId: string | null;
  customName: string;
  sets: number;
  mode: EffortMode;
  amount: number;
  restSec: number;
  weightKg: number;
  /** User-confirmed execution convention; no additional sets are inferred. */
  executionNote?: string;
};

export type Session = {
  id: string;
  name: string;
  focus?: string;
  moves: Move[];
};

export type PlanKind = "run" | "split" | "full" | "ppl" | "body" | "custom";

export type Feel = "easy" | "ok" | "hard" | "pain" | "skip";

export type SessionLog = {
  sessionId: string;
  feel: Feel;
  painIds: string[];
  note: string;
};

export type WeekBias = "build" | "hold" | "deload";

export type Cycle = {
  block: number;
  week: 1 | 2 | 3 | 4;
  logs: SessionLog[];
  lastChange: string;
  bias?: WeekBias;
};

export type Plan = {
  name: string;
  kind?: PlanKind;
  sessions: Session[];
  cycle?: Cycle;
  /** Preview-only coach edit journal, saved atomically in the same plan JSON value. */
  coachEditRevision?: number;
  coachEditHistory?: {
    id: string; action: "APPLY" | "ROLLBACK"; proposalId: string; sessionId: string;
    before: Session; after: Session; timestamp: string; revision: number;
  }[];
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function moveFromCatalog(item: CatalogExercise, partial?: Partial<Move>): Move {
  return {
    id: uid(),
    catalogId: item.id,
    customName: "",
    sets: 3,
    mode: item.timed ? "seconds" : "reps",
    amount: item.timed ? 30 : 10,
    restSec: 75,
    weightKg: 0,
    ...partial,
  };
}

export function customMove(name: string): Move {
  return {
    id: uid(),
    catalogId: null,
    customName: name.trim() || "自定义动作",
    sets: 3,
    mode: "reps",
    amount: 10,
    restSec: 75,
    weightKg: 0,
  };
}

export function displayName(move: Move): string {
  if (!move.catalogId) return move.customName.trim() || "自定义动作";
  return exerciseById(move.catalogId)?.name ?? (move.customName || "动作");
}

export function estimateMinutes(session: Session): number {
  const seconds = session.moves.reduce((sum, move) => {
    const work = move.mode === "seconds" ? move.amount : Math.max(20, move.amount * 3);
    const rests = Math.max(0, move.sets - 1) * move.restSec;
    return sum + move.sets * work + rests + 20;
  }, 0);
  return Math.max(1, Math.round(seconds / 60));
}

function step(
  catalogId: string,
  sets: number,
  amount: number,
  restSec: number,
  weightKg: number,
  mode?: EffortMode,
): Move {
  const item = exerciseById(catalogId);
  if (!item) return customMove(catalogId);
  return moveFromCatalog(item, { sets, amount, restSec, weightKg, mode: mode ?? (item.timed ? "seconds" : "reps") });
}

function session(name: string, moves: Move[], focus?: string): Session {
  return { id: uid(), name, moves, focus };
}

export const TEMPLATES: { id: PlanKind; label: string; hint: string; plan: () => Plan }[] = [
  {
    id: "run",
    label: "跑步力量",
    hint: "单腿、髋和核心，让步子更稳",
    plan: () => ({
      name: "跑步力量",
      kind: "run",
      sessions: [
        session(
          "跑步·推进",
          [
            step("goblet", 3, 8, 75, 8),
            step("bss", 3, 6, 75, 4),
            step("step-up", 3, 8, 60, 0),
            step("calf", 3, 12, 45, 0),
            step("dead-bug", 3, 6, 45, 0),
          ],
          "跑步每一步都是单腿。起来时脚跟把地面蹬出去。分腿蹲和登阶左右各做完算一组。",
        ),
        session(
          "跑步·后链",
          [
            step("db-rdl", 3, 8, 75, 6),
            step("kb-swing", 3, 12, 60, 8),
            step("glute-bridge", 3, 12, 45, 0),
            step("single-hip", 3, 8, 45, 0),
            step("side-plank", 3, 20, 30, 0, "seconds"),
          ],
          "髋先发力，不是腰。壶铃摆荡用臀部把铃送出去，这是加速用的力量。",
        ),
        session(
          "跑步·稳定",
          [
            step("farmer", 3, 30, 45, 8, "seconds"),
            step("db-row", 3, 8, 60, 8),
            step("knee-pushup", 3, 8, 60, 0),
            step("side-leg", 3, 12, 45, 0),
            step("plank", 3, 30, 45, 0, "seconds"),
          ],
          "躯干稳住，肩膀不耸。后程还能保持姿势，步子才不会散。侧卧抬腿左右各做。",
        ),
      ],
    }),
  },
  {
    id: "split",
    label: "分区块",
    hint: "五天各练一块，增肌组数",
    plan: () => ({
      name: "分区块增肌",
      kind: "split",
      sessions: [
        session(
          "胸",
          [
            step("inc-db-bench", 4, 8, 90, 6),
            step("db-bench", 3, 10, 75, 8),
            step("db-fly", 3, 12, 60, 4),
            step("cable-cross", 3, 12, 45, 6),
          ],
          "上胸先做，再打中缝。每组留 1 到 2 次余力，不要甩。",
        ),
        session(
          "背",
          [
            step("lat-pd", 4, 10, 90, 20),
            step("cable-row", 3, 10, 75, 20),
            step("db-row", 3, 10, 75, 8),
            step("face-pull", 3, 15, 45, 6),
          ],
          "先下拉打开宽度，再划船打厚度。肩胛先沉下去再拉。",
        ),
        session(
          "肩",
          [
            step("db-ohp", 3, 8, 90, 4),
            step("arnold", 3, 10, 75, 4),
            step("lat-raise", 4, 12, 45, 2.5),
            step("face-pull", 3, 15, 45, 6),
          ],
          "侧平举是这节的重点，重量宁轻。面拉拉开后束。",
        ),
        session(
          "手臂",
          [
            step("db-curl", 3, 10, 60, 4),
            step("hammer", 3, 12, 45, 4),
            step("pressdown", 3, 12, 60, 10),
            step("oh-ext", 3, 10, 45, 4),
            step("bench-dip", 3, 12, 45, 0),
          ],
          "弯举和下压对半。顶峰停一秒，手腕不要前后甩。",
        ),
        session(
          "腿臀",
          [
            step("leg-press", 4, 10, 90, 40),
            step("rdl", 3, 8, 90, 20),
            step("hip-thrust", 3, 10, 75, 20),
            step("bss", 3, 8, 75, 6),
            step("leg-curl", 3, 12, 60, 15),
            step("calf", 3, 15, 45, 0),
          ],
          "先腿举和硬拉，再臀推。膝盖顺着脚尖，脚跟踩实。",
        ),
      ],
    }),
  },
  {
    id: "full",
    label: "全身 A/B",
    hint: "一周练两次或三次，器械不多也能做",
    plan: () => ({
      name: "全身力量",
      kind: "full",
      sessions: [
        session("全身 A", [
          step("goblet", 3, 10, 75, 8),
          step("db-bench", 3, 10, 75, 8),
          step("db-row", 3, 10, 75, 8),
          step("glute-bridge", 3, 12, 60, 0),
          step("plank", 3, 30, 45, 0, "seconds"),
        ]),
        session("全身 B", [
          step("rdl", 3, 8, 90, 20),
          step("db-lunge", 3, 8, 75, 6),
          step("db-ohp", 3, 10, 75, 6),
          step("db-curl", 3, 12, 60, 4),
          step("dead-bug", 3, 8, 45, 0),
        ]),
      ],
    }),
  },
  {
    id: "ppl",
    label: "推拉腿",
    hint: "三分化，重量先按能做完来改",
    plan: () => ({
      name: "推拉腿",
      kind: "ppl",
      sessions: [
        session("推", [
          step("bb-bench", 4, 6, 120, 30),
          step("inc-db-bench", 3, 8, 90, 10),
          step("db-ohp", 3, 8, 90, 8),
          step("pressdown", 3, 12, 60, 15),
          step("db-fly", 3, 12, 60, 6),
        ]),
        session("拉", [
          step("pullup", 4, 6, 120, 0),
          step("cable-row", 4, 8, 90, 25),
          step("db-row", 3, 10, 75, 12),
          step("face-pull", 3, 15, 60, 8),
          step("bb-curl", 3, 10, 60, 15),
        ]),
        session("腿", [
          step("back-squat", 4, 6, 150, 40),
          step("rdl", 3, 8, 120, 30),
          step("bss", 3, 8, 90, 8),
          step("leg-curl", 3, 12, 75, 20),
          step("calf", 3, 15, 45, 0),
          step("plank", 3, 40, 45, 0, "seconds"),
        ]),
      ],
    }),
  },
  {
    id: "body",
    label: "徒手",
    hint: "不出门也能记到表上",
    plan: () => ({
      name: "徒手力量",
      kind: "body",
      sessions: [
        session("徒手全身", [
          step("knee-pushup", 3, 10, 60, 0),
          step("inv-row", 3, 8, 60, 0),
          step("goblet", 3, 12, 60, 0),
          step("glute-bridge", 3, 12, 45, 0),
          step("climber", 3, 20, 45, 0),
          step("plank", 3, 30, 45, 0, "seconds"),
        ]),
      ],
    }),
  },
];

export function blankPlan(): Plan {
  return {
    name: "我的力量课",
    kind: "custom",
    sessions: [session("第 1 节", [step("goblet", 3, 10, 75, 0)])],
  };
}

const STORAGE_KEY = "fr255-strength-plan-v3";
const OLDER_KEYS = ["fr255-strength-plan-v2", "fr255-strength-plan-v1"];
const STOCK_NAMES = new Set(["全身力量", "推拉腿", "徒手力量", "分区块增肌"]);

function readPlan(key: string): Plan | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Plan;
    if (!parsed || !Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadPlan(): Plan | null {
  const current = readPlan(STORAGE_KEY);
  if (current) return ensureCycle(current);
  for (const key of OLDER_KEYS) {
    const older = readPlan(key);
    if (older && !STOCK_NAMES.has(older.name)) return ensureCycle(older);
  }
  return null;
}

export function savePlan(plan: Plan): boolean {
  const raw = JSON.stringify(plan)
  try {
    if (localStorage.getItem(STORAGE_KEY) === raw) return true
    localStorage.setItem(STORAGE_KEY, raw)
    return true
  } catch {
    return false
  }
}

export const PHASES: { week: 1 | 2 | 3 | 4; label: string; note: string }[] = [
  { week: 1, label: "适应", note: "大周期第 1 周。把动作做稳，重量够用就行，不要放到力竭。" },
  { week: 2, label: "加量", note: "大周期第 2 周。次数比上周多一点。放在轻松跑之后，不要赶在速度课前一天。" },
  { week: 3, label: "巩固", note: "大周期第 3 周。重量和次数先稳住，把每一组做干净。" },
  { week: 4, label: "调整", note: "只有 3 到 4 天，不是完整的一周。做前两节，少一组，重量保持。第三节可以不做。" },
];

const EASIER: Record<string, string> = {
  bss: "db-lunge",
  "db-lunge": "step-up",
  "walk-lunge": "step-up",
  "rev-lunge": "db-lunge",
  "step-up": "glute-bridge",
  goblet: "glute-bridge",
  "db-squat": "glute-bridge",
  "back-squat": "goblet",
  "front-squat": "goblet",
  "leg-press": "goblet",
  rdl: "db-rdl",
  "bb-dl": "rdl",
  "db-rdl": "glute-bridge",
  "kb-swing": "glute-bridge",
  "hip-thrust": "glute-bridge",
  "single-hip": "glute-bridge",
  "bb-bench": "db-bench",
  "db-bench": "knee-pushup",
  "inc-db-bench": "db-bench",
  pushup: "knee-pushup",
  "knee-pushup": "dead-bug",
  farmer: "db-row",
  "db-row": "inv-row",
  "bb-row": "db-row",
  "cable-row": "db-row",
  "side-plank": "dead-bug",
  plank: "knee-plank",
  calf: "seat-calf",
  "bb-calf": "calf",
  "bb-ohp": "db-ohp",
  "db-ohp": "lat-raise",
  "lat-pd": "assist-chin",
  pullup: "lat-pd",
};

export function freshCycle(): Cycle {
  return { block: 1, week: 1, logs: [], lastChange: "" };
}

export function phaseOf(week: number) {
  return PHASES.find((item) => item.week === week) ?? PHASES[0];
}

export function ensureCycle(plan: Plan): Plan {
  const cycle = plan.cycle;
  if (!cycle || cycle.week < 1 || cycle.week > 4 || !Array.isArray(cycle.logs)) {
    return { ...plan, cycle: freshCycle() };
  }
  return plan;
}

export function logSession(plan: Plan, sessionId: string, feel: Feel, painIds: string[], note: string): Plan {
  const cycle = plan.cycle ?? freshCycle();
  const log: SessionLog = {
    sessionId,
    feel,
    painIds: feel === "pain" ? painIds : [],
    note: note.trim().slice(0, 80),
  };
  const logged = {
    ...plan,
    cycle: { ...cycle, logs: [...cycle.logs.filter((item) => item.sessionId !== sessionId), log] },
  };
  if (feel === "skip") dispatchEvent("TRAINING_INTERRUPTED", { sessionId, note: log.note });
  else dispatchEvent("TRAINING_COMPLETED", { sessionId, feel, note: log.note });
  if (feel === "pain") dispatchEvent("PAIN_RECORDED", { sessionId, moveIds: log.painIds });
  return logged;
}

export function weekReady(plan: Plan): boolean {
  const logs = plan.cycle?.logs ?? [];
  const sessions =
    plan.cycle?.week === 4 && plan.sessions.length > 2 ? plan.sessions.slice(0, -1) : plan.sessions;
  return sessions.length > 0 && sessions.every((session) => logs.some((log) => log.sessionId === session.id));
}

function clampAmount(mode: EffortMode, value: number): number {
  if (mode === "seconds") return Math.max(15, Math.min(90, Math.round(value / 5) * 5));
  return Math.max(4, Math.min(20, Math.round(value)));
}

function shiftAmount(mode: EffortMode, value: number, dir: 1 | -1): number {
  return clampAmount(mode, value + dir * (mode === "seconds" ? 5 : 2));
}

function shiftWeight(kg: number, dir: 1 | -1): number {
  return Math.max(0, Math.min(200, Math.round((kg + dir * 2) * 2) / 2));
}

export function nudgeMove(move: Move, dir: 1 | -1): Move {
  if (move.weightKg > 0) return { ...move, weightKg: shiftWeight(move.weightKg, dir) };
  return { ...move, amount: shiftAmount(move.mode, move.amount, dir) };
}

export function softenMove(move: Move, taken: Set<string>): { move: Move; swapped?: string } {
  let next = { ...move };
  let swapped: string | undefined;
  const seen = new Set<string>([move.catalogId ?? ""]);
  let cursor = move.catalogId ?? "";
  let nextId: string | undefined;
  while (EASIER[cursor] && !seen.has(EASIER[cursor])) {
    cursor = EASIER[cursor];
    seen.add(cursor);
    if (!taken.has(cursor)) {
      nextId = cursor;
      break;
    }
  }
  if (nextId) {
    const item = exerciseById(nextId);
    if (item) {
      if (move.catalogId) taken.delete(move.catalogId);
      taken.add(nextId);
      swapped = `${displayName(move)}→${item.name}`;
      next = {
        ...next,
        catalogId: nextId,
        customName: "",
        mode: item.timed ? "seconds" : "reps",
        amount: item.timed ? 20 : Math.min(next.mode === "reps" ? next.amount : 8, 12),
      };
    }
  }
  if (next.weightKg > 0) next.weightKg = shiftWeight(next.weightKg, -1);
  else next.amount = shiftAmount(next.mode, next.amount, -1);
  next.sets = Math.max(2, next.sets - 1);
  return { move: next, swapped };
}

export function advanceCycle(plan: Plan): { plan: Plan; summary: string } {
  const cycle = plan.cycle ?? freshCycle();
  const bias: WeekBias = cycle.bias ?? "build";
  const from = cycle.week;
  const to = (from === 4 ? 1 : from + 1) as 1 | 2 | 3 | 4;
  const block = from === 4 ? cycle.block + 1 : cycle.block;
  const notes: string[] = [];

  const sessions = plan.sessions.map((session) => {
    const log = cycle.logs.find((item) => item.sessionId === session.id);
    const feel: Feel = log?.feel ?? "skip";
    const pain = new Set(log?.painIds ?? []);
    const taken = new Set(session.moves.map((move) => move.catalogId).filter((id): id is string => Boolean(id)));
    const swaps: string[] = [];
    const moves = session.moves.map((move) => {
      let next = { ...move };
      const picked = feel === "pain" && pain.has(move.id);
      const unnamedPain = feel === "pain" && pain.size === 0;
      if (picked) {
        const soft = softenMove(next, taken);
        next = soft.move;
        if (soft.swapped) swaps.push(soft.swapped);
      } else if (unnamedPain || feel === "hard") {
        if (next.weightKg > 0) next.weightKg = shiftWeight(next.weightKg, -1);
        else next.amount = shiftAmount(next.mode, next.amount, -1);
        if (unnamedPain) next.sets = Math.max(2, next.sets - 1);
      } else if (feel === "easy" && bias === "build") {
        if (next.weightKg > 0) next.weightKg = shiftWeight(next.weightKg, 1);
        else next.amount = shiftAmount(next.mode, next.amount, 1);
      } else if (feel === "ok" && to === 2 && bias === "build") {
        next.amount = shiftAmount(next.mode, next.amount, 1);
      }
      if (to === 4 || bias === "deload") next.sets = Math.max(2, next.sets - 1);
      if (from === 4 && to === 1 && feel !== "pain" && bias !== "deload") next.sets = Math.min(5, next.sets + 1);
      return next;
    });
    const extra = log?.note ? `（${log.note}）` : "";
    if (feel === "skip") notes.push(`${session.name}这周没练，保持${extra}。`);
    else if (feel === "pain") notes.push(swaps.length ? `${session.name}：${swaps.join("、")}${extra}。` : `${session.name}有不适，负荷减轻${extra}。`);
    else if (feel === "easy" && bias === "build") notes.push(`${session.name}偏轻松，加了一档${extra}。`);
    else if (feel === "easy") notes.push(`${session.name}偏轻松，但这周疲劳高，重量不加${extra}。`);
    else if (feel === "hard") notes.push(`${session.name}偏重，退了一档${extra}。`);
    else if (to === 2 && bias === "build") notes.push(`${session.name}刚好，次数加一点${extra}。`);
    else if (extra) notes.push(`${session.name}${extra}。`);
    return { ...session, moves };
  });

  const phase = phaseOf(to);
  const head =
    bias === "deload" && to !== 4
      ? `按疲劳，下一周每节少一组，主项留下。`
      : to === 4
        ? `三周练完，进入调整。大约 3 到 4 天，每节少一组，做前两节就够。`
        : from === 4
          ? `第 ${block} 个三周开始。组数加回来，沿用练出来的重量。`
          : bias === "hold"
            ? `第 ${block} 个三周 · 第 ${to} 周 ${phase.label}。疲劳还在，这周不加量。`
            : `第 ${block} 个三周 · 第 ${to} 周 ${phase.label}。`;
  const summary = [head, ...notes].join("");
  dispatchEvent("PLAN_MODIFIED", { from, to, block, bias, summary });

  return {
    summary,
    plan: {
      ...plan,
      sessions,
      cycle: { block, week: to, logs: [], lastChange: summary },
    },
  };
}
