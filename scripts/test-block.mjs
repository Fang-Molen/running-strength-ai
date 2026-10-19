// 只复测一个区块：node scripts/test-block.mjs <区块名> [更多区块...]   （或 npm run test:block:<名>）
// 先做该区块的 import 边界检查，再只跑该区块 tests（不跑全量）。
import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { BLOCKS } from './blocks.mjs'
import { checkBlock } from './check-blocks.mjs'
const names = process.argv.slice(2)
if (!names.length || names.some(n => !BLOCKS[n])) { console.error(`用法: node scripts/test-block.mjs <${Object.keys(BLOCKS).join('|')}>`); process.exit(2) }
const expand = p => { if (!p.includes('*')) return [p]; const dir = dirname(p), re = new RegExp('^' + basename(p).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'); return readdirSync(dir).filter(f => re.test(f)).sort().map(f => join(dir, f)) }
let bad = 0
for (const n of names) for (const v of checkBlock(n)) { bad++; console.error(`边界违规 [${n}] ${v}`) }
if (bad) process.exit(1)
const files = [...new Set(names.flatMap(n => BLOCKS[n].tests.flatMap(expand)))]
const missing = files.filter(f => !existsSync(f)); if (missing.length) { console.error('缺少测试文件:', missing.join(' ')); process.exit(2) }
const r = spawnSync(process.execPath, ['--import', './scripts/test-register.mjs', '--test', '--test-concurrency=3', ...files], { stdio: 'inherit' })
process.exit(r.status ?? 1)
