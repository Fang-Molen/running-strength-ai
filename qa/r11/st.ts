import fs from 'node:fs'
import { statedFactsSection } from '../../src/lib/coach/stated/compose.ts'
const cases = fs.readFileSync('/workspace/in-1020b/questions.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l))
for (const c of cases) for (const t of c.turns) { if (process.argv[2] && !t.turn_id.startsWith(process.argv[2])) continue; console.log('==', t.turn_id); console.log(statedFactsSection(t.user_message).text) }
