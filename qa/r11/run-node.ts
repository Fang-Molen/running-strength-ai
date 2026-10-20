import fs from 'node:fs'
import { newSession, localTurn } from './local-turn.ts'
const src = process.argv[2] ?? '/workspace/in-1020b/questions.jsonl', out = process.argv[3] ?? '/tmp/r11-node.jsonl'
const cases = fs.readFileSync(src, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const w = fs.createWriteStream(out)
for (const c of cases) { const s = newSession(); const turns = []
  for (const t of c.turns) { const q = t.user_message.replace(/\r?\n/g, ' '); try { const r = localTurn(s, q); turns.push({ turn_id: t.turn_id, shown: r.shown, goal: r.dialogue.goalTarget ?? null }) } catch (e) { turns.push({ turn_id: t.turn_id, error: String(e).slice(0, 300) }) } }
  w.write(JSON.stringify({ case_id: c.case_id, variant: c.variant, turns }) + '\n') }
w.end(); console.log('done', cases.length)
