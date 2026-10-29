import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCoachAssertions} from './assertion-policy'
const question='原计划这周有五次训练，这周工作忙只能训练三次，请先分析，不改日历。'
const citedQuotes=['原计划这周有五次训练','这周工作忙只能训练三次']
const options={question,citedQuotes,factQuotes:citedQuotes,safetyRestricted:false}
test('sourced planned and available counts can be referenced in conditional advice',()=>{
 assert.equal(validateCoachAssertions('这五次原计划的性质需要核对，不把五次压缩成三次，优先保留三次。',options).ok,true)
 assert.equal(validateCoachAssertions('可以从原计划五次中优先保留三次，具体保留哪些关键课需核对内容，不把其余训练叠加。',options).ok,true)
})
test('counts are dimensioned and role bound, not a whitelist of digits',()=>{
 for(const text of ['本周保留五次训练。','本周只保留两次训练。','你已完成三次训练。','你已练过三次。','明天跑三公里。','保留三次并额外做三组。','把五次训练压成三次。'])assert.equal(validateCoachAssertions(text,options).ok,false,text)
 assert.equal(validateCoachAssertions('本周可练三次。',{...options,citedQuotes:['原计划这周有五次训练']}).ok,false)
})
test('valid plan references do not waive injury clearance or unauthorized writes',()=>{
 assert.equal(validateCoachAssertions('你可以继续跑步，保留三次训练。',{...options,question:question+'我腿疼，走路困难',safetyRestricted:true}).ok,false)
 assert.equal(validateCoachAssertions('保留三次训练。',{...options,safetyRestricted:true}).ok,false)
 assert.equal(validateCoachAssertions('已经替你修改课表，保留三次训练。',options).ok,false)
})
import {asksLoadSummary} from './online-load-context'
test('recorded-distance questions use the same canonical aggregate path as explicit load summaries',()=>{
 assert.equal(asksLoadSummary('2025年我已记录了多少公里？数据能证明全年每次训练都记录齐了吗？'),true)
 assert.equal(asksLoadSummary('10月25日至29日我已记录了多少公里？'),true)
 assert.equal(asksLoadSummary('一般配速是什么？'),false)
})
import {supportedEvidenceQuote} from './question-evidence'
test('quotes may select complete exact source fields, never altered values or cut negations',()=>{
 const s='范围2025年，已记录183课，已知距离915公里；覆盖未确认；未经核验。'
 assert.equal(supportedEvidenceQuote(s,'范围2025年，已记录183课，已知距离915公里'),true)
 assert.equal(supportedEvidenceQuote(s,'已知距离915公里'),true)
 assert.equal(supportedEvidenceQuote(s,'已知距离916公里'),false)
 assert.equal(supportedEvidenceQuote('结论：不能恢复冲刺；需评估。','恢复冲刺'),false)
 assert.equal(supportedEvidenceQuote('距离=5000米；覆盖未知','5000米'),false)
})
