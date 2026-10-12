import { dispatchEvent } from "@/lib/core/events";

export type RunLog = {
  id: string;
  km: number;
  seconds: number;
  note: string;
};

export type DayRecord = {
  date: string;
  burn: number | null;
  runs: RunLog[];
};

const KEY = "fr255-day-v1";
const EVENT = "fr255-day";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function empty(): DayRecord {
  return { date: today(), burn: null, runs: [] };
}

export function loadDay(): DayRecord {
  if (typeof localStorage === "undefined") return empty();
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null") as DayRecord | null;
    if (!parsed || parsed.date !== today()) return empty();
    return {
      date: today(),
      burn: typeof parsed.burn === "number" ? parsed.burn : null,
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter((run) => run && typeof run.km === "number") : [],
    };
  } catch {
    return empty();
  }
}

function save(day: DayRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(day));
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function saveBurn(burn: number | null) {
  const previous = loadDay().burn
  save({ ...loadDay(), burn })
  dispatchEvent("WATCH_EXPENDITURE_RECORDED", { burn, previous })
}

export function addRun(run: Omit<RunLog, "id">) {
  const day = loadDay()
  const id = `${Date.now()}`
  save({ ...day, runs: [...day.runs, { ...run, id }] })
  dispatchEvent("RUN_COMPLETED", { id, km: run.km, seconds: run.seconds, note: run.note })
}

export function removeRun(id: string) {
  const day = loadDay();
  save({ ...day, runs: day.runs.filter((run) => run.id !== id) });
}

export function onDayChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function parseKm(text: string): number | null {
  const value = Number(text.trim());
  if (!Number.isFinite(value) || value <= 0 || value > 80) return null;
  return Math.round(value * 100) / 100;
}

export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const clock = trimmed.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    if (clock[3] != null) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  const spoken = trimmed.match(/^(\d+)\s*分\s*(\d{1,2})?/);
  if (spoken) return Number(spoken[1]) * 60 + (spoken[2] ? Number(spoken[2]) : 0);
  const minutes = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (minutes) return Math.round(Number(minutes[1]) * 60);
  return null;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "";
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  if (hour > 0) return `${hour}小时${minute}分`;
  if (second > 0) return `${minute}分${second}秒`;
  return `${minute}分`;
}

export function runSummary(day = loadDay()): string {
  if (day.runs.length === 0) return "";
  return day.runs
    .map((run) => {
      const time = formatDuration(run.seconds);
      return `${run.note ? `${run.note} ` : ""}${run.km}公里${time ? ` ${time}` : ""}`;
    })
    .join("；");
}
