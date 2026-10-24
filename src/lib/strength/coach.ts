import { currentAthleteId } from '../core/events';
import { energySentence } from "@/lib/nutrition/calc";
import type { ReasoningBasis } from '@/lib/core/coach-reasoning';
import { validDialogue, type CoachDialogue } from '@/lib/core/coach-dialogue';
import { advise, bandOf, type FatigueBand, type RunGoal, type WeekNote } from "./agent";
import {
  displayName,
  estimateMinutes,
  softenMove,
  uid,
  type Feel,
  type Move,
  type Plan,
  type Session,
} from "./model";

export type ChatMessage = {
  id: string;
  role: "user" | "coach";
  text: string;
  /** Library explanations are chat history, never personal training evidence. */
  purpose?: "KNOWLEDGE_READING";
  analysisBasis?: ReasoningBasis;
  factDetails?: string;
  /** Host-generated R4 reference answer; never a knowledge approval receipt. */
  r4Basis?: {question:string;day:string;athleteId:string;version:string};
  /** v87：本回答用过的经批准知识卡（版本+内容哈希），用于知识变化后复核。 */
  knowledgeUses?: import('@/lib/coach/knowledge/complete').CompleteKnowledgeUse[];
};

export type CoachMemory = {
  /** Owner of this in-memory chat; legacy unscoped history belongs only to local. */
  athleteId?: string;
  dialogue?: CoachDialogue;
  minutes: number;
  messages: ChatMessage[];
  fatigue: number;
  band: FatigueBand;
  goals: RunGoal[];
  notes: WeekNote[];
};

const STORAGE_KEY = "fr255-coach-v2";
const OLD_KEY = "fr255-coach-v1";
export const coachStorageKey = (athleteId = currentAthleteId()) => athleteId === "local" ? STORAGE_KEY : `${STORAGE_KEY}:${encodeURIComponent(athleteId)}`;

export const GREETING =
  "可以给我目标，也可以指定一节训练。我会核对计划、实际记录与反馈，比较可能解释；资料不足时先问关键问题，调整建议由你确认。";
const LEGACY_GREETING="可以说这节练得怎样，也可以说成绩。掉速、轻松日很沉、节奏课跑废了，都按疲劳处理，不拿来改目标。力量课照旧记。";

export const COACH_CHIPS = ["综合这次表现，下一课怎么安排？", "这次记录里，酸痛和疼痛分别是什么？", "最近三次同一训练有什么变化？", "这次掉速，现有记录能说明什么？", "推进做完，RPE 8，腿沉"];

export function freshMemory(): CoachMemory {
  return {
    athleteId: currentAthleteId(),
    minutes: 30,
    messages: [{ id: "hi", role: "coach", text: GREETING }],
    fatigue: 20,
    band: "ready",
    goals: [],
    notes: [],
  };
}

/** Default 20 / ready is the empty coach, not a recorded recovery fact. */
export function recordedCoachFatigue(memory: CoachMemory): number | null {
  const untouched = memory.fatigue === 20
    && memory.band === "ready"
    && memory.notes.length === 0
    && memory.messages.every((item) => item.role !== "user" || item.purpose === "KNOWLEDGE_READING")
  return untouched ? null : memory.fatigue
}

export function loadCoach(): CoachMemory {
  if (typeof localStorage === "undefined") return freshMemory();
  try {
    const athleteId = currentAthleteId();
    const raw = localStorage.getItem(coachStorageKey(athleteId)) ?? (athleteId === "local" ? localStorage.getItem(OLD_KEY) : null);
    if (!raw) return freshMemory();
    const parsed = JSON.parse(raw) as Partial<CoachMemory>;
    if (parsed?.athleteId && parsed.athleteId !== athleteId) return freshMemory();
    if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length === 0) return freshMemory();
    const fatigue = typeof parsed.fatigue === "number" ? parsed.fatigue : 20;
    return {
      athleteId,
      ...(validDialogue(parsed.dialogue) && parsed.dialogue.athleteId === athleteId ? {dialogue:parsed.dialogue}:{}),
      minutes: parsed.minutes || 30,
      messages: parsed.messages.slice(-40).map(m=>m.id==='hi'&&m.role==='coach'&&m.text===LEGACY_GREETING?{...m,text:GREETING}:m),
      fatigue,
      band: parsed.band ?? bandOf(fatigue),
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return freshMemory();
  }
}

export function absorbFeel(memory: CoachMemory, sessionName: string, feel: Feel, note: string): CoachMemory {
  if (feel === "skip") return memory;
  const delta = feel === "easy" ? -10 : feel === "hard" ? 28 : feel === "pain" ? 16 : -2;
  const fatigue = Math.max(0, Math.min(100, (memory.fatigue || 20) + delta));
  const band = bandOf(fatigue);
  const label = feel === "easy" ? "偏轻松" : feel === "hard" ? "偏重" : feel === "pain" ? "有不适" : "刚好";
  const text = `${sessionName}${label}${note.trim() ? `，${note.trim()}` : ""}`.slice(0, 80);
  return {
    ...memory,
    fatigue,
    band,
    goals: memory.goals ?? [],
    notes: [...(memory.notes ?? []), { text, band, pain: feel === "pain", heavy: feel === "hard" || feel === "pain" }].slice(-8),
  };
}

export function acceptExplanation(text: string, band: FatigueBand): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 8 || clean.length > 360) return null;
  if ((band === "tired" || band === "cooked") && /加重|加重量|再加一组|加一组|把目标改/.test(clean)) return null;
  return clean;
}

export function saveCoach(memory: CoachMemory): boolean {
  const athleteId = currentAthleteId();
  if ((memory.athleteId && memory.athleteId !== athleteId) || (!memory.athleteId && athleteId !== "local") || (memory.dialogue && memory.dialogue.athleteId !== athleteId)) return false;
  const key = coachStorageKey(athleteId);
  const raw = JSON.stringify({ ...memory, athleteId })
  try {
    if (localStorage.getItem(key) === raw) return true
    localStorage.setItem(key, raw)
    return localStorage.getItem(key) === raw
  } catch {
    return false
  }
}

const KNEE = new Set(["bss", "db-lunge", "walk-lunge", "rev-lunge", "goblet", "db-squat", "back-squat", "front-squat", "leg-press", "step-up"]);
const BACK = new Set(["rdl", "bb-dl", "db-rdl", "kb-swing", "good-morning", "trap-dl", "sumo"]);
const SHOULDER = new Set(["db-ohp", "bb-ohp", "arnold", "bb-bench", "db-bench", "inc-db-bench", "pushup", "knee-pushup", "bench-dip"]);
const ANKLE = new Set(["calf", "bb-calf", "seat-calf"]);

function namedSessions(plan: Plan, text: string): Session[] {
  return plan.sessions.filter((session) => {
    if (text.includes(session.name)) return true;
    return session.name.split("·").some((part) => part.length >= 2 && text.includes(part));
  });
}

function replaceSessions(plan: Plan, next: Session[]): Plan {
  const byId = new Map(next.map((session) => [session.id, session]));
  return { ...plan, sessions: plan.sessions.map((session) => byId.get(session.id) ?? session) };
}

function mapMoves(session: Session, fn: (move: Move, taken: Set<string>) => Move): Session {
  const taken = new Set(session.moves.map((move) => move.catalogId).filter((id): id is string => Boolean(id)));
  return { ...session, moves: session.moves.map((move) => fn(move, taken)) };
}

export function replyTo(plan: Plan, memory: CoachMemory, raw: string, activeId?: string): { plan: Plan; memory: CoachMemory } {
  const text = raw.trim().slice(0, 200);
  const lines: string[] = [];
  let next = plan;
  let minutes = memory.minutes;
  let principle = "";
  let fatigue = memory.fatigue;
  let band = memory.band;

  const painKnee = /膝|跪/.test(text);
  const painBack = /腰/.test(text);
  const painShoulder = /肩/.test(text);
  const painAnkle = /脚踝|跟腱|小腿/.test(text);
  const pain = /疼|痛|不舒服|不适|受伤/.test(text) || painKnee || painBack || painShoulder || painAnkle;
  const minuteHit = text.match(/(\d+)\s*分钟/);
  const shortOnTime = Boolean(minuteHit) || /没时间|太长|来不及|只有/.test(text);

  if (pain) {
    const ids = new Set<string>();
    if (painKnee || (!painBack && !painShoulder && !painAnkle)) idsAdd(ids, KNEE);
    if (painBack) idsAdd(ids, BACK);
    if (painShoulder) idsAdd(ids, SHOULDER);
    if (painAnkle) idsAdd(ids, ANKLE);
    const swaps: string[] = [];
    const sessions = namedSessions(next, text);
    const targets = sessions.length ? sessions : next.sessions;
    next = replaceSessions(
      next,
      targets.map((session) =>
        mapMoves(session, (move, taken) => {
          if (!move.catalogId || !ids.has(move.catalogId)) return move;
          const soft = softenMove(move, taken);
          if (soft.swapped) swaps.push(soft.swapped);
          else swaps.push(`${displayName(move)}减轻`);
          return soft.move;
        }),
      ),
    );
    lines.push(swaps.length ? `已改：${[...new Set(swaps)].slice(0, 4).join("、")}。` : "这节里没有对应的动作，重量先不动。");
    principle = "关节疼就换更轻的动作。肌肉酸可以留，疼不要扛。";
  }

  if (shortOnTime) {
    const asked = minuteHit ? Number(minuteHit[1]) : 20;
    minutes = Math.max(15, Math.min(45, asked));
    const targets = namedSessions(next, text);
    const list = targets.length ? targets : next.sessions;
    const before = list[0] ? estimateMinutes(list[0]) : minutes;
    next = replaceSessions(
      next,
      list.map((session) => {
        let moves = session.moves.map((move) => ({ ...move }));
        while (moves.length > 3 && estimateMinutes({ ...session, moves }) > minutes + 1) {
          moves = moves.slice(0, -1);
        }
        if (estimateMinutes({ ...session, moves }) > minutes + 1) {
          moves = moves.map((move) => ({ ...move, restSec: Math.min(move.restSec, 45), sets: Math.min(move.sets, 3) }));
        }
        return { ...session, moves };
      }),
    );
    const sampleId = (list[0] ?? next.sessions[0])?.id;
    const sample = next.sessions.find((session) => session.id === sampleId);
    const mins = sample ? estimateMinutes(sample) : minutes;
    lines.push(mins < before ? `砍到大约 ${mins} 分钟，只留主项。` : `这节大约 ${mins} 分钟，已经在你的时间里。`);
    if (!principle) principle = "备考这段时间，练满短课比把课拖长有用。";
  }

  const advice = advise(next, { fatigue: memory.fatigue, goals: memory.goals ?? [], notes: memory.notes ?? [] }, text, activeId);
  next = advice.plan;
  if (advice.lines.length) {
    fatigue = advice.score;
    band = advice.band;
    lines.push(...advice.lines);
    if (!principle) principle = advice.principle;
    if (advice.reasons.length) lines.push(`依据：${advice.reasons.slice(0, 3).join("、")}。`);
    const energy = energySentence(advice.band);
    if (energy) lines.push(energy);
  }

  const reply = lines.length
    ? `${lines.join("")}${principle}`
    : "可以说力量，也可以说成绩。比如：推进做完，RPE 8。或者：600米目标1分33，跑了1分35。";

  const messages = [
    ...memory.messages,
    { id: uid(), role: "user" as const, text },
    { id: uid(), role: "coach" as const, text: reply },
  ].slice(-40);

  return { plan: next, memory: { athleteId: memory.athleteId ?? currentAthleteId(), minutes, messages, fatigue, band, goals: advice.goals, notes: advice.notes } };
}

function idsAdd(target: Set<string>, source: Set<string>) {
  for (const id of source) target.add(id);
}
