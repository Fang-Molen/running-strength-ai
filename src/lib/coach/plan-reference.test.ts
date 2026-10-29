import test from 'node:test'
import assert from 'node:assert/strict'
import {validateCoachAssertions} from './assertion-policy'
const question='原计划这周有五次训练，这周工作忙只能训练三次，请先分析，不改日历。'
const citedQuotes=['原计划这周有五次训练','这周工作忙只能训练三次']
const options={question,citedQuotes,factQuotes:citedQuotes,safetyRestricted:false}
test('sourced planned and available counts can be referenced in conditional advice',()=>{
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
