import { loadConfirmedTrainingImports } from "@/lib/core/training-import"
import type { Feedback, LoggedSession } from "@/lib/ui/coach-assessment"
import { loadTrainingActivities } from './training-read-model';
export const FEEDBACK_KEY = "fk-assess-feedback-v1"
export function loadFeedback(): Feedback[] { try { const v = JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
export function saveFeedback(list: Feedback[]): boolean { try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list.slice(-200))); return true } catch { return false } }
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
export function loadLoggedSessions(): LoggedSession[] {
  return loadTrainingActivities();
}
