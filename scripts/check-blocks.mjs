// 区块 import 边界检查：每个区块源码不得 import 其 forbid 列表里的路径片段。npm run check:blocks
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { BLOCKS } from './blocks.mjs'
// 纯类型 import（import type …）不产生运行时依赖，不算越界。
const imports = src => [...src.replace(/^\s*(?:import|export)\s+type\s[^;\n]*from\s*['"][^'"]+['"]/gm, '').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1])
export function checkBlock(name) {
  const b = BLOCKS[name], out = []
  for (const f of b.files) {
    if (!existsSync(f)) { out.push(`${f} 不存在`); continue }
    for (const spec of imports(readFileSync(f, 'utf8'))) for (const bad of b.forbid) if (spec.includes(bad)) out.push(`${f} import '${spec}'（禁止: ${bad}）`)
  }
  return out
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let n = 0
  for (const name of Object.keys(BLOCKS)) for (const v of checkBlock(name)) { n++; console.error(`[${name}] ${v}`) }
  console.log(n ? `区块边界违规 ${n} 处` : `区块边界检查通过（${Object.keys(BLOCKS).length} 个区块）`)
  process.exit(n ? 1 : 0)
}
