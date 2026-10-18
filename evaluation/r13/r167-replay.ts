/** Supplied R167 specifications; executable probes and rubric below are 自行生成, not independent scientific review. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {answerLocally} from '../../src/lib/core/coach-local-first.ts'
import {deriveCoachBrief} from '../../src/lib/core/coach-brief.ts'
import {buildParts} from '../k12/fixtures.ts'
import {firstWeekMemory} from '../../src/lib/core/coach-first-week.fixtures.ts'
import {setStoreBackend} from '../../src/lib/core/storage.ts'
const cases=JSON.parse(readFileSync(new URL('./r167-scenarios.json',import.meta.url),'utf8')) as Record<string,string>[]
const store=firstWeekMemory();setStoreBackend(store)
let attemptedNetwork=0;globalThis.fetch=()=>{attemptedNetwork++;throw Error('External network forbidden in R167 replay')}
const checks:Record<string,RegExp[]>={
 'AT-001':[/2轮|2 轮|两轮/,/4/], 'AT-002':[/3:15|195|配速/,/不是|不宣称|不代表/], 'AT-003':[/未知|UNKNOWN|UNAVAILABLE/],
 'AT-006':[/5/,/不能|不等于|不诊断/], 'AT-007':[/基线|平时|个人/,/设备|协议|方法/], 'AT-008':[/暂停|停止/,/专业|医学|就医/],
 'AT-009':[/不等于|不能|不直接/,/评估|功能/], 'AT-010':[/不能|不/,/医生|评估/], 'AT-011':[/评估|医学|专业/],
 'AT-013':[/5秒|5 秒/,/不能|不代表|不是/], 'AT-017':[/不等于|不能|不直接/,/迁移|跑步|专项/],
 'AT-018':[/10%|安全/,/不能|不等于|不是/], 'AT-019':[/专项|项目|目标/,/症状|恢复/,/不|不能/],
 'AT-020':[/热|环境/,/不.*(?:体能|效率)|不能/], 'AT-021':[/设备|型号|算法/,/不能|不代表/],
 'AT-023':[/摘要/,/全文|核验|核对/], 'AT-025':[/确认|候选/,/没有修改|不.*改/],
 'AT-026':[/青少年|未成年|监督|监护/,/不.*成人|不.*冠军/], 'AT-033':[/2轮|轮间|大组/,/8|480/,/2|120/],
 'AT-034':[/120/], 'AT-038':[/耐受|胃肠|消化/,/不.*(?:增加|剂量)|避免/],
 'AT-039':[/不等于|不能/,/效果|适应|进步|改善/], 'AT-040':[/拒绝|确认/,/没有修改|不.*改/],
}
const results=cases.map(c=>{
 const question=c['输入'],answer=answerLocally(deriveCoachBrief(buildParts(question,{}))).text
 const assertions=checks[c.case_id]??[],results=assertions.map(re=>({assertion:re.source,pass:re.test(answer)}))
 return {id:c.case_id,input:question,expected:c['必须满足'],answer,executed:true,status:!assertions.length?'HUMAN_REVIEW_REQUIRED':results.every(r=>r.pass)?'AUTOMATED_CONTENT_CHECK_PASSED':'CONTENT_GAP',checks:results,scope:'Raw chat probe; factual integration separately tested with synthetic formal records; no clinical certification'}
})
const output={rubric:'自行生成的可观察文字检查；原40条预期未改动。通过文字检查不等于全部行为或科学验收。',sourceSha256:createHash('sha256').update(readFileSync(new URL('./r167-scenarios.csv',import.meta.url))).digest('hex'),attemptedNetwork,results}
writeFileSync('/workspace/fangkun/evidence/r13/r167-replay.json',JSON.stringify(output,null,2))
console.log(JSON.stringify({executed:results.length,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{} as Record<string,number>),attemptedNetwork}))
setStoreBackend(null)
