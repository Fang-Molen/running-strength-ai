/** Developer-owned candidate review CLI. No network and no runtime activation. */
import { readFileSync, writeFileSync } from 'node:fs'
import { advanceResearchGap, type ResearchGap } from '../src/lib/core/coach-cognition-knowledge.ts'
const [input, patchFile, output]=process.argv.slice(2)
if (!input || !patchFile || !output || input===output) throw new Error('Usage: input.json patch.json new-version.json; original must be preserved')
const before=JSON.parse(readFileSync(input,'utf8')) as ResearchGap
const patch=JSON.parse(readFileSync(patchFile,'utf8')) as Partial<ResearchGap>
const after=advanceResearchGap(before,patch)
writeFileSync(output,JSON.stringify(after,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({id:after.id,status:after.status,version:after.version,runtimeActivated:false}))
