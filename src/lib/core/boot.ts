import { loadCoach } from "@/lib/strength/coach"
import { loadPlan } from "@/lib/strength/model"
import { setEventContext } from "./events.ts"
import { runMigrations } from "./migrate.ts"
import { refreshAthleteState, wireStateEngine } from "./state.ts"

let started = false

export function bootCore() {
  if (started) return
  started = true
  try {
    runMigrations()
    wireStateEngine()
    setEventContext({
      context: () => {
        const plan = loadPlan()
        const coach = loadCoach()
        return {
          block: plan?.cycle?.block ?? null,
          week: plan?.cycle?.week ?? null,
          fatigue: coach.fatigue,
          band: coach.band,
        }
      },
      cycleId: `block-${loadPlan()?.cycle?.block ?? 1}-week-${loadPlan()?.cycle?.week ?? 1}`,
    })
    refreshAthleteState()
  } catch {
    /* core boot must not stop the existing app */
  }
}
