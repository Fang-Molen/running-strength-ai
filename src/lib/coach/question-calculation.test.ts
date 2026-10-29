import test from 'node:test'
import assert from 'node:assert/strict'
import { questionCalculations } from './question-calculation'
const text=(q:string,prior:string[]=[])=>questionCalculations(q,prior).map(x=>x.detail).join('\n')
test('computes mixed-distance work without inventing rest or using fixed benchmark answers',()=>{
 assert.match(text('800米、300米和100米分别用时160秒、60秒、20秒。请算总距离和工作时间。'),/1200米.*240秒/)
 assert.match(text('我做了5×250米，前4组是40秒、41秒、42秒、43秒，第5组未记录。已知完成多少？'),/1000米.*166秒.*未知/)
})
test('session RPE requires explicit whole-session scope and scale',()=>{
 assert.match(text('训练总时长50分钟，整课RPE为4（0–10分）。计算整课负荷。'),/200 AU/)
 assert.doesNotMatch(text('训练50分钟，最后一组RPE4，整课没填。'),/200 AU/)
})
test('pace, yearly range and corrections are computed only from user inputs',()=>{
 assert.match(text('甲跑4公里20分钟，乙跑4公里18分钟。谁配速更快？'),/5:00.*4:30/)
 assert.match(text('2024-12-31跑8公里，2025-02-10跑6公里，2025-08-05跑7公里，2026-01-01跑20公里。请只求2025年已记录公里数。'),/2025年.*13公里/)
 assert.match(text('第3组实际是28秒，其他不变，更新总时间。',['我完成3组，每组150米，成绩是24、26、30秒。请计算总时间。']),/旧.*80秒.*新.*78秒/)
})
test('ambiguous or unrequested new dose is not calculated into a personal prescription',()=>{
 assert.equal(text('我今天腿疼，明天能跑多少公里？'), '')
 assert.equal(text('最后一组RPE6，计划训练45分钟，实际时长未知。'), '')
})
import {supportedEvidenceQuote} from './question-evidence'
test('source matching allows exact excerpts, rejects invented numbers and fuzzy quotations',()=>{
 assert.equal(supportedEvidenceQuote('只能训练一次','只能训练一次'),true)
 assert.equal(supportedEvidenceQuote('这周工作忙只能训练一次。','只能训练两次'),false)
 assert.equal(supportedEvidenceQuote('距离5000米，时间1500秒','5000'),false)
 assert.equal(supportedEvidenceQuote('距离5000米，时间1500秒','5000公里'),false)
})
import {validateCoachAssertions} from './assertion-policy'
test('citing a user wish cannot turn it into injury clearance or a phantom write',()=>{
 const text='你可以继续冲刺。已经替你修改课表。'
 assert.equal(validateCoachAssertions(text,{question:'我腿疼',safetyRestricted:true,factQuotes:[text]}).ok,false)
 assert.equal(supportedEvidenceQuote('距离5000米','5000'),false)
})
import {questionTaskPermission} from './utterance-semantics'
test('acute inability to walk is retained as a restriction; normal walking is not invented into an emergency',()=>{
 assert.equal(questionTaskPermission('小腿突然啪一声，现在走路都困难，我想继续冲刺。',[]).trainingRestricted,true)
 assert.equal(questionTaskPermission('只有轻微酸胀，走路正常，正在减轻。',[]).trainingRestricted,false)
})
