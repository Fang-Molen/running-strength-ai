import { CATALOG } from "./catalog";
import {
  advanceCycle,
  displayName,
  logSession,
  nudgeMove,
  weekReady,
  type Plan,
  type Session,
  type WeekBias,
} from "./model";

export type FatigueBand = "fresh" | "ready" | "tired" | "cooked";

export type Report = {
  text: string;
  rpe: number | null;
  completed: boolean | null;
  easy: boolean;
  hard: boolean;
  pain: boolean;
  postRun: boolean;
  sleepBad: boolean;
  wantsNextWeek: boolean;
  loads: { moveId: string; kg: number; name: string }[];
};

export type FatigueRule = {
  id: string;
  add: number;
  reason: string;
  when: (report: Report) => boolean;
};

/** 以后改判断，主要改这张表。正分更累，负分更有余力。 */
export const FATIGUE_RULES: FatigueRule[] = [
  { id: "rpe-max", add: 36, reason: "强度接近力竭", when: (report) => (report.rpe ?? 0) >= 9 },
  { id: "rpe-8", add: 28, reason: "强度 8，余力不多", when: (report) => report.rpe === 8 },
  { id: "rpe-7", add: 16, reason: "强度 7，有一点累", when: (report) => report.rpe === 7 },
  { id: "rpe-low", add: -16, reason: "强度不高，还有余力", when: (report) => report.rpe !== null && report.rpe <= 5 },
  { id: "incomplete", add: 22, reason: "这节没做完", when: (report) => report.completed === false },
  { id: "easy", add: -14, reason: "这节偏轻松", when: (report) => report.easy && (report.rpe === null || report.rpe <= 6) },
  { id: "hard", add: 24, reason: "你说这节偏重", when: (report) => report.hard && report.rpe === null },
  { id: "run", add: 12, reason: "跑完腿还沉", when: (report) => report.postRun },
  { id: "sleep", add: 18, reason: "恢复不够", when: (report) => report.sleepBad },
  { id: "pain", add: 20, reason: "有疼痛", when: (report) => report.pain },
];

const BAND_LABEL: Record<FatigueBand, string> = {
  fresh: "疲劳低",
  ready: "疲劳适中",
  tired: "疲劳偏高",
  cooked: "疲劳很高",
};

export function fatigueLabel(band: FatigueBand): string {
  return BAND_LABEL[band];
}

export function bandOf(score: number): FatigueBand {
  if (score < 28) return "fresh";
  if (score < 48) return "ready";
  if (score < 72) return "tired";
  return "cooked";
}

export function weekBiasFor(band: FatigueBand): WeekBias {
  if (band === "cooked") return "deload";
  if (band === "tired") return "hold";
  return "build";
}

export type RunKind = "speed" | "endurance";

export type RunGoal = {
  meters: number;
  goalSec: number;
  kind: RunKind;
  deadline?: string;
};

export type WeekNote = {
  text: string;
  band: FatigueBand;
  pain: boolean;
  heavy: boolean;
  decay?: boolean;
  easyHard?: boolean;
  smashed?: boolean;
};

export type DiagnosisCause = "fatigue" | "pacing" | "fitness" | "pain" | "on-target" | "unknown";

export type AgentContext = {
  fatigue: number;
  goals: RunGoal[];
  notes: WeekNote[];
};

export const FOCUS_EVENTS = [400, 800, 1500];

export function kindFor(meters: number): RunKind {
  return meters <= 800 ? "speed" : "endurance";
}

export function formatTime(sec: number): string {
  const rounded = Math.round(sec);
  if (rounded < 90) return `${rounded}秒`;
  return `${Math.floor(rounded / 60)}分${String(rounded % 60).padStart(2, "0")}`;
}

export function distanceLabel(meters: number): string {
  if (meters >= 1000 && meters % 1000 === 0) return `${meters / 1000}公里`;
  return `${meters}米`;
}

export function daysUntil(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function parseTimes(text: string): number[] {
  const times: number[] = [];
  const re = /([0-9]{1,2}|一)\s*分\s*(\d{1,2})|(\d{1,2})\s*[:′']\s*(\d{1,2})|(\d)\.(\d{2})(?!\d)|(\d{1,3})\s*秒|(\d{1,2})\s*分(?!\s*\d)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[1]) times.push((match[1] === "一" ? 1 : Number(match[1])) * 60 + Number(match[2]));
    else if (match[3]) times.push(Number(match[3]) * 60 + Number(match[4]));
    else if (match[5]) times.push(Number(match[5]) * 60 + Number(match[6]));
    else if (match[8]) times.push(Number(match[8]) * 60);
    else times.push(Number(match[7]));
  }
  if (times.length < 2) {
    const short = text.match(/(?<!\d)分\s*(\d{2})/);
    const seconds = short ? Number(short[1]) : 0;
    if (seconds >= 20 && seconds < 60) times.unshift(60 + seconds);
  }
  return times.filter((sec) => sec > 0 && sec < 3600);
}

function readDistances(text: string): number[] {
  const found: number[] = [];
  const re = /(\d{1,2})\s*公里|(\d{3,5})(?=\s*(?:米|目标|要跑))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const meters = match[1] ? Number(match[1]) * 1000 : Number(match[2]);
    if (meters >= 100 && meters <= 50000) found.push(meters);
  }
  return found;
}

export function clockSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = parseTimes(trimmed);
  if (parsed.length > 0) return parsed[0] ?? null;
  if (/^\d{2,4}$/.test(trimmed)) {
    const value = Number(trimmed);
    if (value < 90) return value;
    const minutes = Math.floor(value / 100);
    const seconds = value % 100;
    if (minutes >= 1 && minutes <= 20 && seconds < 60) return minutes * 60 + seconds;
  }
  return null;
}

function kindFromText(text: string, meters: number, goals: RunGoal[]): RunKind {
  if (/耐力/.test(text)) return "endurance";
  if (/速度/.test(text)) return "speed";
  return goals.find((goal) => goal.meters === meters)?.kind ?? kindFor(meters);
}

function upsertGoal(goals: RunGoal[], meters: number, goalSec: number, kind: RunKind) {
  const index = goals.findIndex((goal) => goal.meters === meters);
  const previous = index >= 0 ? goals[index] : undefined;
  const goal: RunGoal = { meters, goalSec, kind, deadline: previous?.deadline };
  if (index >= 0) goals[index] = goal;
  else goals.push(goal);
}

export function readRunUpdate(
  text: string,
  goals: RunGoal[],
): { goals: RunGoal[]; attempt: { meters: number; actualSec: number; goalSec: number | null; kind: RunKind } | null } {
  const distances = readDistances(text);
  if (distances.length === 0) return { goals, attempt: null };
  const times = parseTimes(text);
  const raced = /跑了|结果|实际|跑成|跑出/.test(text);
  if (!raced) {
    if (times.length === 0) return { goals, attempt: null };
    const next = [...goals];
    distances.forEach((meters, index) => {
      const goalSec = times[index] ?? times[0];
      if (!goalSec) return;
      upsertGoal(next, meters, goalSec, kindFromText(text, meters, goals));
    });
    return { goals: next, attempt: null };
  }
  const meters = distances[0];
  const actualSec = times[times.length - 1];
  if (!actualSec) return { goals, attempt: null };
  const saidGoal = times.length >= 2 ? times[0] : null;
  const stored = goals.find((goal) => goal.meters === meters)?.goalSec ?? null;
  const next = [...goals];
  if (saidGoal) upsertGoal(next, meters, saidGoal, kindFromText(text, meters, goals));
  return {
    goals: next,
    attempt: { meters, actualSec, goalSec: saidGoal ?? stored, kind: kindFromText(text, meters, next) },
  };
}

export type SessionSigns = {
  quality: "easy" | "threshold" | "speed" | "special" | "hills" | null;
  decay: boolean;
  spare: boolean;
  smashed: boolean;
  easyHard: boolean;
};

export function readSigns(text: string, rpe: number | null): SessionSigns {
  const decay = /掉了|掉速|越来越慢|一组比一组|后程掉|没保住|后面慢|后面两组/.test(text);
  const spare = /还能再|还能做|有余力|还能来/.test(text);
  const smashed = /跑废|趴了|虚脱|刮了|力竭/.test(text);
  let quality: SessionSigns["quality"] = null;
  if (/坡|上坡|山坡/.test(text)) quality = "hills";
  else if (/节奏|阈值|乳酸|巡航/.test(text)) quality = "threshold";
  else if (/专项|比赛配速|比赛速度/.test(text)) quality = "special";
  else if (/速度|间歇|冲刺|(?<!\d)200(?!\d)|(?<!\d)300(?!\d)/.test(text)) quality = "speed";
  else if (/轻松跑|恢复跑|慢跑|有氧|轻松课/.test(text)) quality = "easy";
  const easyHard = quality === "easy" && (smashed || /腿.{0,2}(沉|酸)|很累|太累|跑不动/.test(text) || (rpe !== null && rpe >= 7));
  return { quality, decay, spare, smashed, easyHard };
}

export function diagnose(
  attempt: { meters: number; actualSec: number; goalSec: number | null; kind: RunKind },
  ctx: { band: FatigueBand; notes: WeekNote[]; pain: boolean; heavyNow: boolean; signs: SessionSigns },
): { cause: DiagnosisCause; gapSec: number; summary: string } {
  if (!attempt.goalSec) {
    return {
      cause: "unknown",
      gapSec: 0,
      summary: `${attempt.meters}米跑了${formatTime(attempt.actualSec)}。先告诉我这个距离的目标，我才能判断慢在哪里。`,
    };
  }
  const gap = attempt.actualSec - attempt.goalSec;
  const head = `${attempt.meters}米目标${formatTime(attempt.goalSec)}，实际${formatTime(attempt.actualSec)}。`;
  const heavyCount = ctx.notes.filter((note) => note.heavy).length + (ctx.heavyNow ? 1 : 0);
  const decay = ctx.signs.decay || ctx.notes.some((note) => note.decay);
  const easyHard = ctx.signs.easyHard || ctx.notes.some((note) => note.easyHard);
  const smashed = ctx.signs.smashed || ctx.notes.some((note) => note.smashed);
  const tired = ctx.band === "tired" || ctx.band === "cooked" || heavyCount >= 2 || decay || easyHard || smashed;
  const pain = ctx.pain || ctx.notes.some((note) => note.pain);
  const thin = ctx.notes.length === 0 && !ctx.heavyNow && !pain && !decay && !easyHard && !smashed && ctx.band !== "tired" && ctx.band !== "cooked";
  if (pain) return { cause: "pain", gapSec: gap, summary: `${head}这次有疼痛，先不要拿它判断能力。` };
  if (gap <= 0 && !decay && !smashed) {
    const faster = gap === 0 ? "正好达到。" : `快了${Math.abs(gap)}秒。`;
    return { cause: "on-target", gapSec: gap, summary: `${head}${faster}这周的力量没有把成绩压掉。` };
  }
  if (thin) {
    return {
      cause: "unknown",
      gapSec: gap,
      summary: `${head}慢了${gap}秒。这周还没有力量课记录，分不清是疲劳还是能力。把练了什么、强度多少告诉我。`,
    };
  }
  if (tired) {
    const why = decay
      ? "后面在掉速。速度和专项掉了就该停，这是疲劳，不是 400 或 800 突然不行了。"
      : easyHard
        ? "这周连轻松日都沉。轻松日都累，就是还没恢复。"
        : smashed
          ? "这节已经跑透了。节奏课结束时还该能再来两趟，跑废了就先当疲劳。"
          : "对照这周的力量课，疲劳偏高，更像是累了，不是速度突然没了。";
    return { cause: "fatigue", gapSec: gap, summary: `${head}慢了${gap}秒。${why}下一节力量先收。` };
  }
  if (gap <= 2) {
    return {
      cause: "pacing",
      gapSec: gap,
      summary: `${head}只慢了${gap}秒，这周力量并不重。更像节奏或最后没顶住，不是累垮了。`,
    };
  }
  if (attempt.kind === "speed") {
    return {
      cause: "fitness",
      gapSec: gap,
      summary: `${head}慢了${gap}秒，这周力量并不重。更像这个目标对现在的速度还偏紧，或者速度课不够。`,
    };
  }
  return {
    cause: "fitness",
    gapSec: gap,
    summary: `${head}慢了${gap}秒，这周力量并不重。更像后程耐力或节奏还没撑住。`,
  };
}

export function readReport(plan: Plan, text: string): Report {
  const rpeHit = text.match(/rpe\s*(\d{1,2})|强度\s*(\d{1,2})|用力\s*(\d{1,2})/i);
  let rpe = rpeHit ? clamp(Number(rpeHit[1] || rpeHit[2] || rpeHit[3]), 1, 10) : null;
  if (rpe === null && /力竭/.test(text)) rpe = 10;
  const easy = /轻松|太轻|还能|没感觉|简单|很顺/.test(text);
  const hard = /太重|偏重|吃力|力竭/.test(text);
  const missed = /没做完|做不完|没完成/.test(text);
  const done = /做完|练完|完成了|今天练/.test(text);
  return {
    text,
    rpe,
    completed: missed ? false : done ? true : null,
    easy,
    hard,
    pain: /疼|痛|不舒服|不适|受伤|膝盖|腰痛|肩/.test(text),
    postRun: /跑完|跑过|腿.{0,2}(沉|酸)|今天跑/.test(text),
    sleepBad: /很累|太累|没精神|睡不|没恢复|乏力/.test(text),
    wantsNextWeek: /下一周|下周|进入下周|这周结束|排下周|生成下一周/.test(text),
    loads: readLoads(plan, text),
  };
}

export function hasTrainingSignal(report: Report): boolean {
  return (
    report.rpe !== null ||
    report.completed !== null ||
    report.easy ||
    report.hard ||
    report.pain ||
    report.postRun ||
    report.sleepBad ||
    report.loads.length > 0
  );
}

export function scoreFatigue(previous: number, report: Report): { score: number; band: FatigueBand; reasons: string[] } {
  const reasons: string[] = [];
  let add = 0;
  for (const rule of FATIGUE_RULES) {
    if (!rule.when(report)) continue;
    add += rule.add;
    reasons.push(rule.reason);
  }
  const score = clamp(Math.round(previous * 0.45 + 22 + add), 0, 100);
  return { score, band: bandOf(score), reasons };
}

export function applyLoads(plan: Plan, report: Report): { plan: Plan; notes: string[] } {
  if (report.loads.length === 0) return { plan, notes: [] };
  const byId = new Map(report.loads.map((load) => [load.moveId, load]));
  const notes = report.loads.map((load) => `${load.name}按你说的记成 ${load.kg} 公斤`);
  return {
    notes,
    plan: {
      ...plan,
      sessions: plan.sessions.map((session) => ({
        ...session,
        moves: session.moves.map((move) => {
          const load = byId.get(move.id);
          return load ? { ...move, weightKg: load.kg } : move;
        }),
      })),
    },
  };
}

export function intensityTarget(plan: Plan, text: string, activeId?: string): Session | undefined {
  const named = plan.sessions.filter((session) => session.name.split("·").some((part) => part.length >= 2 && text.includes(part)) || text.includes(session.name));
  const finished = !/没做完|做不完|没完成/.test(text) && /做完|练完|完成了|今天练/.test(text);
  if (finished && named[0]) {
    const index = plan.sessions.findIndex((session) => session.id === named[0].id);
    return plan.sessions[(index + 1) % plan.sessions.length];
  }
  if (named[0]) return named[0];
  return plan.sessions.find((session) => session.id === activeId) ?? plan.sessions[0];
}

export function applyIntensity(session: Session, band: FatigueBand): { session: Session; note: string } {
  if (band === "fresh") {
    return {
      note: `${session.name}下一回加一档`,
      session: { ...session, moves: session.moves.map((move) => nudgeMove(move, 1)) },
    };
  }
  if (band === "tired") {
    return {
      note: `${session.name}少一组，组间多休息 15 秒`,
      session: {
        ...session,
        moves: session.moves.map((move) => ({ ...move, sets: Math.max(2, move.sets - 1), restSec: Math.min(120, move.restSec + 15) })),
      },
    };
  }
  if (band === "cooked") {
    return {
      note: `${session.name}少一组，再退一档重量`,
      session: {
        ...session,
        moves: session.moves.map((move) => ({ ...nudgeMove(move, -1), sets: Math.max(2, move.sets - 1) })),
      },
    };
  }
  return { session, note: `${session.name}强度保持，留 2 次余力` };
}

export function advise(
  plan: Plan,
  ctx: AgentContext,
  text: string,
  activeId?: string,
): {
  plan: Plan;
  score: number;
  band: FatigueBand;
  reasons: string[];
  lines: string[];
  principle: string;
  goals: RunGoal[];
  notes: WeekNote[];
} {
  const report = readReport(plan, text);
  const signs = readSigns(text, report.rpe);
  const run = readRunUpdate(text, ctx.goals);
  const fatigue = hasTrainingSignal(report) ? scoreFatigue(ctx.fatigue, report) : { score: ctx.fatigue, band: bandOf(ctx.fatigue), reasons: [] as string[] };
  const lines: string[] = [];
  let next = plan;
  let goals = run.goals;
  let notes = ctx.notes;

  if (run.attempt) {
    const heavyNow = (report.rpe !== null && report.rpe >= 8) || report.hard || report.sleepBad || report.postRun;
    const verdict = diagnose(run.attempt, { band: fatigue.band, notes, pain: report.pain, heavyNow, signs });
    lines.push(verdict.summary);
    if (verdict.cause === "fatigue") {
      const sessionBand = fatigue.band === "cooked" ? "cooked" : "tired";
      const target = intensityTarget(next, text, activeId);
      if (target) {
        const tuned = applyIntensity(target, sessionBand);
        next = replaceSession(next, tuned.session);
        lines.push(`${tuned.note}。`);
      }
      const bias = weekBiasFor(sessionBand);
      next = { ...next, cycle: { ...(next.cycle ?? { block: 1, week: 1, logs: [], lastChange: "" }), bias } };
    }
    notes = remember(notes, text, fatigue.band, report.pain, verdict.cause === "fatigue" || heavyNow, signs);
    const meters = run.attempt.meters;
    const deadline = goals.find((goal) => goal.meters === meters)?.deadline;
    const left = deadline ? daysUntil(deadline) : null;
    if (verdict.cause === "fatigue" && left !== null && left <= 28) {
      lines.push(left < 0 ? "这个项目的期限过了，这次仍不改目标。" : `这个项目离期限还有 ${left} 天，疲劳高也不改目标。`);
    }
    return {
      plan: next,
      score: fatigue.score,
      band: fatigue.band,
      reasons: fatigue.reasons,
      lines,
      principle: principleFor(verdict.cause, run.attempt.kind),
      goals,
      notes,
    };
  }

  if (goals !== ctx.goals) {
    lines.push(goalLine(goals));
    return { plan, score: ctx.fatigue, band: bandOf(ctx.fatigue), reasons: [], lines, principle: "800 米及以内当速度，更长的当耐力。目标以后可以改。", goals, notes };
  }

  if (signs.quality && !report.wantsNextWeek) {
    const review = reviewSession(signs);
    lines.push(review.summary);
    let band = fatigue.band;
    let score = fatigue.score;
    if (review.ease) {
      band = band === "cooked" ? "cooked" : "tired";
      score = Math.max(score, band === "cooked" ? 80 : 60);
      const target = intensityTarget(next, text, activeId);
      if (target) {
        const tuned = applyIntensity(target, band);
        next = replaceSession(next, tuned.session);
        lines.push(`${tuned.note}。`);
      }
      next = { ...next, cycle: { ...(next.cycle ?? { block: 1, week: 1, logs: [], lastChange: "" }), bias: weekBiasFor(band) } };
    }
    notes = remember(notes, text, band, report.pain, review.ease, signs);
    return { plan: next, score, band, reasons: fatigue.reasons, lines, principle: review.principle, goals, notes };
  }

  if (!hasTrainingSignal(report) && !report.wantsNextWeek) {
    return { plan, score: ctx.fatigue, band: bandOf(ctx.fatigue), reasons: [], lines: [], principle: "", goals, notes };
  }

  const loaded = applyLoads(next, report);
  next = loaded.plan;
  if (loaded.notes.length) lines.push(`${loaded.notes.slice(0, 3).join("、")}。`);

  const bias = weekBiasFor(fatigue.band);
  if (hasTrainingSignal(report)) {
    const target = intensityTarget(next, text, activeId);
    if (target && fatigue.band !== "ready") {
      const tuned = applyIntensity(target, fatigue.band);
      next = replaceSession(next, tuned.session);
      lines.push(`${tuned.note}。`);
    } else if (target) {
      lines.push(`${target.name}先按现在的强度。`);
    }
    if ((next.cycle?.bias ?? "build") !== bias) {
      next = { ...next, cycle: { ...(next.cycle ?? { block: 1, week: 1, logs: [], lastChange: "" }), bias } };
    }
    const weekText = bias === "deload" ? "下周每节少一组。" : bias === "hold" ? "下周先不加量。" : "下周可以照常加一点。";
    lines.push(`${fatigueLabel(fatigue.band)}。${weekText}`);
    notes = remember(notes, text, fatigue.band, report.pain, fatigue.band === "tired" || fatigue.band === "cooked" || (report.rpe !== null && report.rpe >= 8) || report.sleepBad || report.hard, signs);
  }

  let principle = "疲劳高就先保住动作质量，不在没恢复的时候加重。";
  if (fatigue.band === "fresh") principle = "还有余力，下一节才加。每组仍然留 1 到 2 次。";
  if (fatigue.band === "ready") principle = "强度刚好。下一节保持，把动作做干净。";

  if (report.wantsNextWeek) {
    let staged = next;
    const feel = fatigue.band === "fresh" ? "easy" : "ok";
    if (!weekReady(staged)) {
      for (const session of staged.sessions) {
        const logged = staged.cycle?.logs.some((log) => log.sessionId === session.id);
        if (!logged) staged = logSession(staged, session.id, feel, [], "");
      }
    }
    const advanced = advanceCycle(staged);
    next = advanced.plan;
    lines.push(advanced.summary);
    principle = "三周是大周期。疲劳高的时候，下一周少做，不追加重量。";
  }

  return { plan: next, score: fatigue.score, band: fatigue.band, reasons: fatigue.reasons, lines, principle, goals, notes };
}

function remember(notes: WeekNote[], text: string, band: FatigueBand, pain: boolean, heavy: boolean, signs: SessionSigns): WeekNote[] {
  return [...notes, { text: text.slice(0, 80), band, pain, heavy, decay: signs.decay, easyHard: signs.easyHard, smashed: signs.smashed }].slice(-8);
}

function reviewSession(signs: SessionSigns): { summary: string; ease: boolean; principle: string } {
  if (signs.decay) {
    return {
      ease: true,
      summary: "后面掉速了。速度课和专项课掉了就该停，这是疲劳，不说明这项不行了。",
      principle: "掉速就停。拿掉速的那几组去改目标，会把疲劳当成能力不够。",
    };
  }
  if (signs.easyHard) {
    return {
      ease: true,
      summary: "轻松日不该这么沉。大部分课本来就该很轻，轻松日都累，就是还没恢复。专项先别上。",
      principle: "轻松日都累，后面的速度课先让开。恢复比多练一次有用。",
    };
  }
  if (signs.quality === "threshold" && signs.smashed) {
    return {
      ease: true,
      summary: "节奏课不该跑到趴下。这种课结束时还该觉得能再来两趟。这次过了，先当疲劳。",
      principle: "节奏课要留余力。跑废了，疲劳会拖过后面的速度课。",
    };
  }
  if (signs.quality === "threshold" && signs.spare) {
    return {
      ease: false,
      summary: "节奏课强度是对的，结束还有余力。力量不用加，也不用减。",
      principle: "控制得住的节奏课，比一次跑废更有用。",
    };
  }
  if ((signs.quality === "speed" || signs.quality === "special") && signs.spare && !signs.smashed) {
    return {
      ease: false,
      summary: "速度保住了，恢复也够。力量可以照常，但不要和速度课排在同一天。",
      principle: "专项和速度课要在恢复好的时候做，做完留一天轻松。",
    };
  }
  if (signs.quality === "hills" && (signs.smashed || signs.decay)) {
    return {
      ease: true,
      summary: "坡地课要冲得动。冲不动就是疲劳，不是腿部力量不够。",
      principle: "坡地冲不动就停。不要在同一天再把腿部力量加上去。",
    };
  }
  return {
    ease: false,
    summary: "这节没有掉速。先按这个强度记，力量先不动。",
    principle: "没有掉速、也不沉，就不要因为一次课去改计划。",
  };
}

function goalLine(goals: RunGoal[]): string {
  if (goals.length === 0) return "还没写下成绩目标。可以在「我的情况」里加。";
  return `目标记下了：${goals
    .map((goal) => {
      const when = goal.deadline ? `，${goal.deadline}前` : "";
      return `${distanceLabel(goal.meters)} ${formatTime(goal.goalSec)}${when}`;
    })
    .join("；")}。`;
}

function principleFor(cause: DiagnosisCause, kind: RunKind): string {
  if (cause === "fatigue") return "没达到目标时，先看这周力量是不是把腿压累了。累了就收力量，不改跑的目标。";
  if (cause === "pacing") return kind === "speed" ? "差一两秒、人又不累，多半是前半太快或最后没顶上。" : "差一两秒、人又不累，多半是后程节奏没稳住。";
  if (cause === "fitness") return "力量不重还是差一截，就先别怪疲劳，目标或专项课还没跟上。";
  if (cause === "pain") return "疼的时候，这次成绩不能拿来加目标，也不能拿来加力量。";
  if (cause === "on-target") return "达到了就保持。力量继续服务跑步，不额外加码。";
  return "没有这周的训练记录，就不猜原因。";
}

function replaceSession(plan: Plan, session: Session): Plan {
  return { ...plan, sessions: plan.sessions.map((item) => (item.id === session.id ? session : item)) };
}

function readLoads(plan: Plan, text: string): { moveId: string; kg: number; name: string }[] {
  const loads: { moveId: string; kg: number; name: string }[] = [];
  for (const session of plan.sessions) {
    for (const move of session.moves) {
      const name = displayName(move);
      const key = name.length >= 3 ? name.slice(0, 3) : name;
      const at = text.indexOf(key);
      if (!key || at < 0) continue;
      const window = text.slice(Math.max(0, at - 8), at + name.length + 10);
      const hit = window.match(/(\d+(?:\.\d+)?)\s*(?:公斤|kg)/i);
      if (!hit) continue;
      const kg = clamp(Number(hit[1]), 0, 200);
      if (!loads.some((load) => load.moveId === move.id)) loads.push({ moveId: move.id, kg, name });
    }
  }
  if (loads.length > 0) return loads;
  for (const item of CATALOG) {
    const key = item.name.slice(0, 3);
    if (!text.includes(key)) continue;
    const hit = text.slice(Math.max(0, text.indexOf(key) - 8), text.indexOf(key) + item.name.length + 10).match(/(\d+(?:\.\d+)?)\s*(?:公斤|kg)/i);
    if (!hit) continue;
    const move = plan.sessions.flatMap((session) => session.moves).find((entry) => entry.catalogId === item.id);
    if (move) loads.push({ moveId: move.id, kg: clamp(Number(hit[1]), 0, 200), name: item.name });
  }
  return loads;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
