import { parseChatTraining } from '../../src/lib/core/coach-chat-evidence.ts'
for (const q of process.argv.slice(2)) { const c = parseChatTraining(q); console.log(JSON.stringify({ planned: c.planned, splits: c.splits.map(s => [s.meters, s.seconds]), rest: c.restSeconds, rpe: c.rpe, has: c.hasActual, issues: c.issues })) }
